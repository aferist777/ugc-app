/* ═══════════════════════════════════════════════════════
   LOG PANEL  —  active processes + grouped history
   ═══════════════════════════════════════════════════════ */

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
  if (s < 60) return `${s}с`;
  return `${Math.floor(s / 60)}м ${s % 60}с`;
}

/* ── Active tasks (client-side only) ────────────────── */
const _activeTasks = new Map(); // id → { label, startMs, ivId, el }

window.startActiveGen = function(id, label) {
  if (_activeTasks.has(id)) return;
  const startMs = Date.now();
  const avg     = _avgTiming(label);
  const avgStr  = avg != null ? ` (~${_fmtMs(avg)})` : '';

  const el = document.createElement('div');
  el.className = 'log-active-item';
  el.innerHTML =
    `<span class="log-active-dot">●</span>` +
    `<span class="log-active-label">${_esc(label)}</span>` +
    `<span class="log-active-timer">0с</span>` +
    `<span class="log-active-avg">${_esc(avgStr)}</span>`;

  const timerEl = el.querySelector('.log-active-timer');
  const ivId    = setInterval(() => {
    timerEl.textContent = _fmtMs(Date.now() - startMs);
  }, 1000);

  _activeTasks.set(id, { label, startMs, ivId, el });
  _renderActiveSection();

  // Auto-open panel when work starts
  const body = document.getElementById('log-body');
  if (body && !body.classList.contains('open')) toggleLog?.();
};

window.finishActiveGen = function(id) {
  const t = _activeTasks.get(id);
  if (!t) return;
  clearInterval(t.ivId);
  _recordTiming(t.label, Date.now() - t.startMs);
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

/* ── Load & render history from server ───────────────── */
async function _loadHistory() {
  const genList = document.getElementById('log-gen-list');
  const errList = document.getElementById('log-err-list');
  if (!genList || !errList) return;

  genList.innerHTML = '<span style="color:#888;font-size:10px;">Загрузка…</span>';
  errList.innerHTML = '';

  try {
    const d = await fetch('/api/log').then(r => r.json());
    genList.innerHTML = '';
    errList.innerHTML = '';

    if (!d.success || !d.entries.length) {
      genList.innerHTML = '<span style="color:#888;font-size:10px;">Нет записей</span>';
      return;
    }

    let genCount = 0, errCount = 0;
    d.entries.forEach(line => {
      const isErr = line.includes('❌');
      const el    = document.createElement('div');
      el.className = 'log-entry' + (isErr ? ' log-error' : '');
      el.innerHTML = _linkify(line);
      if (isErr) { errList.appendChild(el); errCount++; }
      else        { genList.appendChild(el); genCount++; }
    });

    // Update group counts
    const genTitle = document.getElementById('log-gen-title');
    const errTitle = document.getElementById('log-err-title');
    if (genTitle) genTitle.textContent = `Генерации (${genCount})`;
    if (errTitle) errTitle.textContent = `Ошибки (${errCount})`;

    if (!genCount) genList.innerHTML = '<span style="color:#888;font-size:10px;">Нет записей</span>';
    if (!errCount) errList.innerHTML = '<span style="color:#888;font-size:10px;">Нет ошибок</span>';
  } catch {
    genList.innerHTML = '<span style="color:#888;font-size:10px;">Ошибка загрузки</span>';
  }
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
  const body  = document.getElementById('log-body');
  const arrow = document.getElementById('log-toggle-arrow');
  if (!body) return;
  const open = body.classList.toggle('open');
  if (arrow) arrow.textContent = open ? '▼' : '▶';
  if (open) _loadHistory();
};

// Also expose loadLog for back-compat
window.loadLog = _loadHistory;

/* ── Init: render empty active section on load ────────── */
document.addEventListener('DOMContentLoaded', () => {
  _renderActiveSection();
});
