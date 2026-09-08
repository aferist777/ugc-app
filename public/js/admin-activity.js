/* admin-activity.js — the Activity tab on /admin: who did what, when.

   One row per event, newest first, in the app's own words (lib/audit-map.js for actions, the
   pages' own labels for clicks). The row is for watching a person work; the details under it
   - prompts, ids, the request body, timings - are for the developer, and open on a click.

   Filters: person, page, kind of event, a day range (with the usual shortcuts) and a search
   over the words and the details. Rows page by time: "more" asks for what came before the
   oldest row shown. Times are shown in this browser's zone; the file keeps UTC. */

(function () {

const $ = (id) => document.getElementById(id);
const pane = $('act-rows');
if (!pane) return;

let _meta = null;
let _next = null;          // the cursor for "more": the oldest row's time on screen
let _filters = null;
let _seq = 0;              // the newest request wins; an older answer arriving late is dropped

// ── words and time ────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
function when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { day: '', time: iso };
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` };
}
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtMs = (ms) => ms == null ? '' : ms < 1000 ? ms + ' ms' : ms < 60000 ? (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s'
                    : Math.floor(ms / 60000) + ':' + pad(Math.round((ms % 60000) / 1000));

// The marker chip. A click row says "pressed "Render all" in the queue"; the chip lifts the
// thing pressed out of the sentence so the eye can scan a column of them.
function chipOf(r) {
  const m = r.marker || (r.layer === 'process' ? 'process' : 'action');
  const L = r.label || '';
  let text = m, rest = L, mt;
  if (m === 'button' && (mt = /^pressed "([^"]+)"(.*)$/.exec(L))) { text = 'button: ' + mt[1]; rest = mt[2].trim(); }
  else if (m === 'link' && (mt = /^went to (.+?)( \(.*\))?$/.exec(L))) { text = 'link: ' + mt[1]; rest = mt[2] ? mt[2].trim() : ''; }
  else if (m === 'dropdown' && (mt = /^chose "([^"]+)" in (.+)$/.exec(L))) { text = 'dropdown: ' + mt[2].replace(/ in .*$/, ''); rest = '→ ' + mt[1] + (/ in /.test(mt[2]) ? mt[2].slice(mt[2].indexOf(' in ')) : ''); }
  else if (m === 'field' && (mt = /^(edited|set|picked) (.+?)(:| in |$)(.*)$/.exec(L))) { text = 'field: ' + mt[2]; rest = (mt[3] === ':' ? '' : mt[3]) + mt[4]; }
  else if (m === 'toggle' && (mt = /^switched (.+) (on|off)(.*)$/.exec(L))) { text = 'toggle: ' + mt[1]; rest = mt[2] + mt[3]; }
  else if (m === 'key' && (mt = /^pressed (\S+)(.*)$/.exec(L))) { text = 'key: ' + mt[1]; rest = mt[2].trim(); }
  else if (m !== 'error' && (m === 'sign-in' || r.layer === 'signin')) { text = 'sign-in'; }
  return { m: m === 'sign-in' ? 'signin' : m, text, rest };
}

// ── rows ──────────────────────────────────────────────────────────────────
function detailRow(r) {
  const tr = document.createElement('tr');
  tr.className = 'act-det';
  tr.hidden = true;
  const td = document.createElement('td');
  td.colSpan = 5;
  const grid = document.createElement('div');
  grid.className = 'act-grid';
  const skip = new Set(['t', 'nick', 'label', 'marker', 'layer', 'page', 'status']);
  const order = ['kind', 'route', 'ids', 'params', 'text', 'body', 'error', 'ms', 'uid', 'role', 'ip', 'ua', 'unmapped'];
  const keys = order.filter(k => r[k] != null && r[k] !== '').concat(Object.keys(r).filter(k => !order.includes(k) && !skip.has(k) && r[k] != null));
  for (const k of keys) {
    const kk = document.createElement('div'); kk.className = 'act-k'; kk.textContent = k;
    const vv = document.createElement('div'); vv.className = 'act-v';
    const v = r[k];
    const s = (typeof v === 'object') ? JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ') : String(v);
    if (k === 'text' || s.length > 160) vv.classList.add('long');
    vv.textContent = k === 'ms' ? fmtMs(v) + ' (' + v + ' ms)' : (k === 'text' ? String(v) : s);
    grid.appendChild(kk); grid.appendChild(vv);
  }
  td.appendChild(grid);
  tr.appendChild(td);
  return tr;
}

function row(r) {
  const tr = document.createElement('tr');
  tr.className = 'act-row';
  const w = when(r.t);
  const c = chipOf(r);
  const uc = r.role === 'admin' ? 'admin' : (r.role === 'system' ? 'sys' : '');
  tr.innerHTML = `
    <td class="act-time" title="${r.t}">${w.day} <b>${w.time}</b></td>
    <td class="act-user"><span class="act-u ${uc}">${esc(r.nick || '—')}</span></td>
    <td class="act-page">${esc(r.page || '')}</td>
    <td class="act-ev"><span class="act-m ${c.m}">[${esc(c.text)}]</span> ${esc(c.rest)}${r.unmapped ? ' <span class="act-m error">[unmapped]</span>' : ''}</td>
    <td class="act-st">${statusOf(r)}</td>`;
  const det = detailRow(r);
  tr.addEventListener('click', () => { det.hidden = !det.hidden; tr.classList.toggle('open', !det.hidden); });
  return [tr, det];
}
function statusOf(r) {
  const ok = r.status === 'ok' || r.status == null;
  const s = ok ? (r.layer === 'click' ? '' : '<span class="ok">ok</span>') : `<span class="fail">${esc(String(r.status))}</span>`;
  const ms = (r.ms != null && r.layer !== 'click') ? ` <span class="dur">${fmtMs(r.ms)}</span>` : '';
  return s + ms;
}
const esc = (s) => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// ── loading ───────────────────────────────────────────────────────────────
function setStatus(text, kind) {
  const el = $('act-status');
  el.textContent = text || '';
  el.className = 'adm-status' + (kind ? ' ' + kind : '');
}

function readFilters() {
  const from = $('act-from').value, to = $('act-to').value;
  return {
    user: $('act-user').value, page: $('act-page').value, kind: $('act-kind').value, q: $('act-q').value.trim(),
    fromT: from ? new Date(from + 'T00:00:00').toISOString() : '',
    toT: to ? new Date(to + 'T23:59:59.999').toISOString() : '',
  };
}

async function load(more) {
  const f = more ? _filters : readFilters();
  if (!more) { _filters = f; _next = null; pane.textContent = ''; }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  if (more && _next) qs.set('before', _next);
  qs.set('limit', '200');
  const btn = $('act-more');
  btn.disabled = true;
  setStatus(more ? 'loading more…' : 'loading…');
  const seq = ++_seq;
  try {
    const d = await fetch('/api/audit/activity?' + qs.toString()).then(r => r.json());
    if (seq !== _seq) return;                       // superseded while in flight
    if (!d || !d.success) throw new Error((d && d.error) || 'could not read the log');
    for (const r of d.rows) for (const el of row(r)) pane.appendChild(el);
    _next = d.next;
    btn.hidden = !_next;
    btn.disabled = false;
    const n = pane.querySelectorAll('tr.act-row').length;
    setStatus(n ? `${n} row${n === 1 ? '' : 's'} shown · ${d.days} day file${d.days === 1 ? '' : 's'} read · click a row for details` : 'nothing in this window');
    $('act-count').textContent = n ? String(n) : '—';
  } catch (e) { setStatus(e.message, 'err'); btn.disabled = false; }
}

// ── filters ───────────────────────────────────────────────────────────────
function fill(sel, items, first) {
  sel.textContent = '';
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = first; sel.appendChild(o0);
  for (const it of items) { const o = document.createElement('option'); o.value = it.value; o.textContent = it.label; sel.appendChild(o); }
}
function setRange(days) {
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - days);
  $('act-from').value = localDay(days === 0 ? to : from);
  $('act-to').value = localDay(to);
  if (days === -1) { const y = new Date(); y.setDate(y.getDate() - 1); $('act-from').value = $('act-to').value = localDay(y); }
  document.querySelectorAll('.act-quick').forEach(b => b.classList.toggle('on', +b.dataset.days === days));
}

async function init() {
  try {
    _meta = await fetch('/api/audit/meta').then(r => r.json());
    if (!_meta || !_meta.success) throw new Error((_meta && _meta.error) || 'no meta');
  } catch (e) { setStatus('Could not read the log: ' + e.message, 'err'); return; }
  fill($('act-user'), _meta.people.map(p => ({ value: p.id, label: p.nick + (p.role === 'admin' ? ' (admin)' : '') + (p.disabled ? ' · off' : '') })), 'everyone');
  fill($('act-page'), _meta.pages.map(p => ({ value: p, label: p })), 'all pages');
  const un = $('act-unmapped');
  if (_meta.unmapped && _meta.unmapped.length) {
    un.hidden = false;
    un.textContent = `${_meta.unmapped.length} route${_meta.unmapped.length === 1 ? '' : 's'} without a phrase`;
    un.title = _meta.unmapped.join('\n');
  } else un.hidden = true;
  $('act-keep').textContent = `${_meta.days.length} day${_meta.days.length === 1 ? '' : 's'} on disk · kept ${_meta.keepDays} days`;
  setRange(0);
  load(false);
}

$('act-apply').addEventListener('click', () => load(false));
$('act-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(false); });
for (const id of ['act-user', 'act-page', 'act-kind']) $(id).addEventListener('change', () => load(false));
document.querySelectorAll('.act-quick').forEach(b => b.addEventListener('click', () => { setRange(+b.dataset.days); load(false); }));
$('act-more').addEventListener('click', () => load(true));
$('act-dl-jsonl').addEventListener('click', () => { const d = $('act-to').value || localDay(new Date()); location.href = `/api/audit/day/${d}.jsonl`; });
$('act-dl-csv').addEventListener('click', () => { const d = $('act-to').value || localDay(new Date()); location.href = `/api/audit/day/${d}.csv`; });
$('act-refresh').addEventListener('click', () => load(false));

// Loaded when the tab is first shown, not with the page: the users list is what the admin
// came for most days, and the log can be large.
let _started = null;   // the promise of the first init, so a second caller waits for it
function start() { if (!_started) _started = init(); return _started; }
document.querySelectorAll('.adm-tab[data-pane="activity"]').forEach(t => t.addEventListener('click', () => { start(); }));
if (location.hash === '#activity') { document.querySelector('.adm-tab[data-pane="activity"]').click(); }
// The Users tab's "N today" link: open this tab on that person.
document.addEventListener('adm-activity-user', async (e) => {
  const tab = document.querySelector('.adm-tab[data-pane="activity"]');
  if (tab) tab.click();
  await start();
  $('act-user').value = (e.detail && e.detail.uid) || '';
  setRange(0);
  load(false);
});

})();
