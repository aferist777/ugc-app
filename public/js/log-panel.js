/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVITY STRIP — the progress rows above the workspace (#activity-log).

   This file used to be the slide-out Logs panel as well: a session/step logger that
   drew its own DOM into #log-panel, a grouped history in localStorage, and the toggles
   that opened it. The panel is gone, so all of that went with it - about 500 lines.

   What stayed is what live code actually calls:

     createActivityRow(label)      the visible progress row. Six modules use it -
                                   mergev2-tab, biroly, biroly-bg-monitor, lookbook-tab,
                                   scen-avatar-poller, scen-edit-panel - so it is kept
                                   verbatim, API and all.
     startActiveGen / finishActiveGen   a timed row with a learned ETA (lookbook-tab).
     GenLog                        five modules call it. `fetchLog` was never only a
                                   logger: it PERFORMS the request and returns the parsed
                                   JSON, and biroly, scen-montage, scen-timeline and
                                   scen-edit-panel all run their generations through it.
                                   So it stays real; only the logging half is gone, and
                                   the rest of the surface is kept as no-ops because the
                                   callers still reference it.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── GenLog: the request wrapper the generation paths run through ─────────── */
window.GenLog = (function () {
  let _n = 0;
  // A session id is still handed out: callers gate on it (`window.GenLog && _sid`), and
  // a falsy one would silently route them down their plain-fetch fallback instead.
  function start() { return 'gl' + (++_n).toString(36); }
  function step()  { return _n; }
  function done()     {}
  function fail()     {}
  function finalize() {}
  function cancel()   {}
  function renderGenLog() {}

  // Same contract as before, minus the logging: perform the request, refuse a
  // non-JSON answer with the same error, return the parsed body.
  async function fetchLog(sid, name, url, options) {
    const res = await fetch(url, options);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      throw new Error(`HTTP ${res.status} from ${String(url).split('/').pop()}`);
    }
    return res.json();
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
/* ── Timed rows with a learned ETA ──────────────────────────────────────────
   The panel half of these went with the panel: they used to also build a row for
   #log-active-list and keep a badge count on the toggle. What is left is the part
   that was ever visible without opening anything - the activity row and the timing
   it teaches. */
const _activeTasks = new Map();   // id -> { label, startMs, ivId, actRow }

window.startActiveGen = function (id, label) {
  if (_activeTasks.has(id)) return null;
  const actRow = window.createActivityRow(label);
  _activeTasks.set(id, { label, startMs: Date.now(), actRow });
  return actRow;
};

window.finishActiveGen = function (id) {
  const t = _activeTasks.get(id);
  if (!t) return;
  const elapsed = Date.now() - t.startMs;
  _recordTiming(t.label, elapsed);          // so the next run of this job has an ETA
  t.actRow?.finalize?.(`✅ ${t.label} — ${_fmtMs(elapsed)}`);
  _activeTasks.delete(id);
};
