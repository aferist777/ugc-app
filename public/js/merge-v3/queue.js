/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the render queue, as the page sees it.

   One queue for every project, on every page (js/app-nav.js puts its button on the pages
   that have none): one place to leave work and come back to it.

   The list is the SERVER'S. This module shows it and asks it to do things; it holds no copy
   worth trusting, because other pages and the server add to the same queue and a page's
   copy would quietly be wrong.

   A finished entry STAYS. It is the record of what was rendered and where the file went, and
   the runner never looks at it again. The list shrinks only when somebody says so - and when
   they say so with things still waiting, they are asked which they meant, because "clear"
   over unrendered work is the one press here that cannot be taken back.

   Render all starts what is waiting. The encoder does one at a time, so a started entry may
   still stand in line - the row says how many are ahead.

   A HIGHLIGHTS PROJECT IS ONE ROW: its fragments' entries under "▸ <project> ·
   highlights · 5 fragments" with their way along all together ("rendering 2 of 5 · 1:30 left", "3 rendered · 2
   interrupted"); a press opens its fragments' rows, as any. Its own "Continue" starts only ITS interrupted and failed
   renders (POST /api/mv3q/run { hl }) - Render all, as always, starts everything waiting.
   ═══════════════════════════════════════════════════════════════════════════ */

// Queue is on every page. Merge's store is asked only by addCurrent - Merge's own
// render window -, so it is brought in there: on the other pages the queue loads nothing of Merge but this module.
import * as Layers from '../layers.js';
import { placeBeside } from '../side-nav.js';
// A ready render opens in the Library's viewer - Rename and Delete there
import { openRender } from '../library/render-view.js';
// An empty queue, a queue not read - the shared parts; the reason a popup in the corner.
import { emptyEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';
import { iconEl } from '../icons.js';
import { t, tn } from '../i18n/t.js';

let _pop = null;
let _layer = null;
let _timer = 0;
// The panel refreshes on a beat, and a refresh rebuilds it wholesale. While a question is on
// screen that would erase the question mid-read - gone before it could be answered. So the beat waits.
let _asking = false;

const $ = (id) => document.getElementById(id);

// The Library's viewer's sheet, brought in on the first "open" on a page that has none (Admin, the showcase) - as Alerts do.
function _viewerCss() {
  if (document.querySelector('link[href$="lib-viewer.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/lib-viewer.css';
  document.head.appendChild(link);
}

// `count`: the badge's number alone - the list is megabytes on a long history, and the badge asks every 5 s.
async function _get(count) {
  try { return await fetch('/api/mv3q' + (count ? '?count=1' : '')).then(r => r.json()); }
  catch (e) { return { success: false, items: [], waiting: 0, error: e.message }; }
}
let _failing = false;         // the list's last read failed - said once, not at every beat

// The badge counts what is still to happen - queued and running - not the whole history.
// A number that only grows is not something anybody acts on.
// `known`: the number a list just read gave - not asked again.
async function _paintBadge(known) {
  const b = $('mv3-queue');
  if (!b) return;
  const n = known != null ? known : ((await _get(true)).waiting || 0);
  let dot = b.querySelector('.mv3-qbadge');
  if (!n) { if (dot) dot.remove(); return; }
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'mv3-qbadge';
    // on the side menu's tile, as Alerts' count
    (b.querySelector('.sn-ico') || b).appendChild(dot);
  }
  dot.textContent = String(n);
}

function _close() {
  _asking = false;
  if (_pop) { _pop.remove(); _pop = null; }
  if (_layer) { Layers.close(_layer); _layer = null; }
  // the button lit while its panel is open, as Alerts'
  const b = $('mv3-queue');
  if (b) b.classList.remove('is-on');
  clearInterval(_timer);
  _timer = 0;
}

const _mmss = (v) => {
  const m = Math.floor(v / 60), s = Math.round(v - m * 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
};

// A row says three things: what it is, what it is made of, and where it has got to. The
// middle one is why the rows are tall: two projects named by the same date tell you nothing
// apart, and the composition is what actually distinguishes them.
function _row(it, refresh) {
  const el = document.createElement('div');
  el.className = 'mv3-qrow is-' + it.status;

  const main = document.createElement('div');
  main.className = 'mv3-qrow-m';

  const top = document.createElement('div');
  top.className = 'mv3-qrow-top';
  const nm = document.createElement('span');
  nm.className = 'mv3-qrow-t';
  nm.textContent = it.title;
  nm.title = it.error || it.title;
  top.appendChild(nm);

  const st = document.createElement('span');
  st.className = 'mv3-qrow-s';
  // Four states, said plainly: queued (yours, not started), in line (started, the encoder
  // is on something else), rendering (with the number when there is one), and the two ends.
  const running = it.status === 'running';
  const named = it.phase === 'normalizing' ? t('preparing clips…')
              : it.phase === 'speeding' ? t('speeding up…')
              : it.phase === 'poster' ? t('finishing…')
              : null;
  st.textContent = it.status === 'done' ? t('ready')
                 : running
                     ? (named || ((it.percent ? it.percent + '%' : t('rendering…'))
                        + (it.remain != null ? ' · ' + t('{time} left', { time: _mmss(it.remain) }) : '')))
                 : it.status === 'failed' ? t('failed')
                 : it.armed ? (t('in line') + ' · ' + (it.ahead ? t('{n} ahead', { n: it.ahead }) : t('next')))
                 // Stopped by a closed or restarted app: Render all starts it over.
                 : it.interrupted ? t('interrupted · Render all starts it over')
                 : t('queued');
  top.appendChild(st);
  main.appendChild(top);

  const sub = document.createElement('div');
  sub.className = 'mv3-qrow-sub';
  sub.textContent = (it.hl ? t('fragment') : t('blank')) + ' · ' + (it.summary || '');
  main.appendChild(sub);

  // The bar, only while the encoder is on this one. Indeterminate when the phase reports no
  // number - a stripe that moves says "working" where a bar stuck at 0% says "stuck".
  if (running) {
    const bar = document.createElement('div');
    const known = !named && it.percent > 0;
    bar.className = 'mv3-qbar' + (known ? '' : ' is-indet');
    const fill = document.createElement('i');
    if (known) fill.style.width = it.percent + '%';
    bar.appendChild(fill);
    main.appendChild(bar);
  }

  if (it.status === 'failed' && it.error) {
    const e = document.createElement('div');
    e.className = 'mv3-qrow-e';
    e.textContent = it.error;
    main.appendChild(e);
  }
  el.appendChild(main);

  const acts = document.createElement('div');
  acts.className = 'mv3-qrow-acts';

  // A ready render opens in the Library's viewer - Rename and Delete there - not in a tab.
  if (it.status === 'done' && it.url) {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'mv3-c-btn mv3-qrow-a u-btn is-s';
    a.textContent = t('Open');
    a.title = t('Watch it in the Library\'s viewer - Rename and Delete are there');
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      _close();
      _viewerCss();
      openRender(it.url);
    });
    acts.appendChild(a);
  }
  // Try again puts the SAME job back in the line, which is the only thing that deserves the
  // name: rebuilding it from the project would render something else.
  if (it.status === 'failed') {
    const r = document.createElement('button');
    // the icon, its words in the title
    r.type = 'button'; r.className = 'mv3-qx u-btn is-s is-icon is-quiet'; r.appendChild(iconEl('refresh-cw', 14));
    r.title = t('Try this one again');
    r.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch('/api/mv3q/retry/' + encodeURIComponent(it.id), { method: 'POST' });
      refresh();
    });
    acts.appendChild(r);
  }
  if (it.status !== 'running') {
    const x = document.createElement('button');
    // the one ✕ - "take out of a row", red under the pointer
    x.type = 'button'; x.className = 'mv3-qx u-btn is-s is-icon is-quiet is-del u-x';
    x.title = t('Remove from the queue');
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch('/api/mv3q/' + encodeURIComponent(it.id), { method: 'DELETE' });
      refresh();
    });
    acts.appendChild(x);
  }
  // The one under the encoder is stopped here as in Export's window (POST
  // /api/mv3q/stop/:id): its encode cut off, nothing of it kept - in its finishing passes it is not stopped and stays.
  // A highlights project's renders keep their own stop on the project bar.
  if (running && !it.hl) {
    const s = document.createElement('button');
    s.type = 'button'; s.className = 'mv3-c-btn mv3-qstop u-btn is-s is-danger'; s.textContent = t('Stop');
    s.title = it.phase ? t('Finishing its file - it is kept') : t('Stop this render - nothing of it is kept');
    s.disabled = !!it.phase;
    s.addEventListener('click', async (e) => {
      e.stopPropagation();
      s.disabled = true;
      try { await fetch('/api/mv3q/stop/' + encodeURIComponent(it.id), { method: 'POST' }); } catch (er) { /* the next read says */ }
      refresh();
    });
    acts.appendChild(s);
  }
  el.appendChild(acts);
  return el;
}

// Clearing with work still waiting is the one press here that cannot be undone, so it asks
// rather than guesses - and it offers the harmless half as its own answer, because "just tidy
// away the finished ones" is what is usually meant.
// Right UNDER the row with Render all and Clear - where the press was -, not at the end of
// the list.
function _askClear(head, waiting, onDone) {
  if (_asking) return;
  _asking = true;
  const box = document.createElement('div');
  box.className = 'mv3-qask u-ask';                // the shared question, in the list
  const q = document.createElement('b');
  q.className = 'mv3-qask-t';
  q.textContent = tn(waiting, '{n} project has not been rendered yet.', '{n} projects have not been rendered yet.');
  box.appendChild(q);

  const row = document.createElement('div');
  row.className = 'mv3-qask-r u-ask-r';
  const mk = (label, cls, mode) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-c-btn u-btn is-s' + (cls ? ' ' + cls : '') + (cls === 'danger' ? ' is-danger is-armed' : '');
    b.textContent = label;
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (mode) {
        await fetch('/api/mv3q/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                         body: JSON.stringify({ mode }) });
      }
      box.remove();
      _asking = false;
      onDone();
    });
    return b;
  };
  row.append(mk(t('Cancel'), '', null), mk(t('Finished only'), '', 'done'), mk(t('Everything'), 'danger', 'all'));
  box.appendChild(row);
  head.after(box);
}

async function _paintList() {
  if (!_pop || _asking) return;
  const d = await _get();
  if (!_pop) return;
  // A read that fails is not an empty queue: what is shown stays and the popup says why, once;
  // with nothing shown yet, "did not load" and Try again.
  if (!d || !d.success) {
    if (!_failing) showError(t('The render queue did not load: {why}', { why: (d && d.error) || t('the app did not answer') }));
    _failing = true;
    if (!_pop.querySelector('.mv3-qhead')) _pop.replaceChildren(failedEl(t('The render queue'), () => _paintList()));
    return;
  }
  _failing = false;
  _pop.textContent = '';

  // A panel at its button: the frame's edges, its head row - the title, Render all, the quiet
  // Clear, the 28 px ✕ that closes it as Escape does -, no backdrop
  const head = document.createElement('div');
  head.className = 'mv3-qhead u-win-head';
  const ttl = document.createElement('span');
  ttl.className = 'u-win-title';
  ttl.textContent = t('Render queue');
  head.appendChild(ttl);
  const sp = document.createElement('span');
  sp.className = 'sp';
  head.appendChild(sp);

  const all = document.createElement('button');
  all.type = 'button';
  // The app's own buttons - `mv3-btn` has no look in Merge, and they drew as the browser's.
  all.className = 'mv3-c-btn mv3-x-go u-btn is-s is-main';
  all.textContent = t('Render all');
  // Yours that have not been started. Once started they are in line whatever the encoder is
  // doing, so the button has nothing left to do for them.
  const waiting = (d.items || []).filter(x => x.status === 'queued' && !x.armed).length;
  const inLine = (d.items || []).some(x => x.status === 'running' || (x.status === 'queued' && x.armed));
  all.disabled = !waiting;
  all.title = waiting ? t('Start everything of yours that is queued, one after another')
            : inLine ? t('Yours are started and in line') : t('Nothing queued');
  all.addEventListener('click', async (e) => {
    e.stopPropagation();
    await fetch('/api/mv3q/run', { method: 'POST' });
    _paintList();
  });
  head.appendChild(all);

  const clr = document.createElement('button');
  clr.type = 'button';
  clr.className = 'mv3-c-btn u-btn is-s is-quiet';
  clr.textContent = t('Clear');
  clr.addEventListener('click', async (e) => {
    e.stopPropagation();
    const left = (d.items || []).filter(x => x.status === 'queued').length;
    if (left) return _askClear(head, left, () => { _paintList(); _paintBadge(); });
    await fetch('/api/mv3q/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                     body: JSON.stringify({ mode: 'done' }) });
    _paintList(); _paintBadge();
  });
  head.appendChild(clr);
  const shut = document.createElement('button');
  shut.type = 'button';
  shut.className = 'mv3-qclose u-btn is-icon is-quiet u-x';
  shut.title = t('Close (Esc)');
  shut.addEventListener('click', (e) => { e.stopPropagation(); _close(); });
  head.appendChild(shut);
  _pop.appendChild(head);

  const list = document.createElement('div');
  list.className = 'mv3-qlist';
  if (!(d.items || []).length) {
    list.appendChild(emptyEl(t('Nothing queued. Add a project from its render window.'), { icon: 'list' }));
  } else {
    const again = () => { _paintList(); _paintBadge(); };
    // A highlights project's entries are one row, where its first one stands.
    const groups = new Map();
    for (const it of d.items) {
      if (!it.hl) continue;
      if (!groups.has(it.hl.id)) groups.set(it.hl.id, []);
      groups.get(it.hl.id).push(it);
    }
    const drawn = new Set();
    for (const it of d.items) {
      if (!it.hl) { list.appendChild(_row(it, again)); continue; }
      if (drawn.has(it.hl.id)) continue;
      drawn.add(it.hl.id);
      list.appendChild(_group(it.hl.id, groups.get(it.hl.id), again));
    }
  }
  _pop.appendChild(list);
  _paintBadge(d.waiting || 0);
}

// ── A highlights project's row ──────────────────────────────────────────────
// Which projects' rows are open - kept while the panel repaints on its beat.
const _openGroups = new Set();

// THE PROJECT'S WAY ALONG is its LAST press of Render - the entries of its last batch, as
// lib/highlights-render.js viewOf counts them -, each fragment weighed by its length: a rendered one whole, the one rendering
// by its share, the rest nothing - so the bar does not go to 100% and back for each fragment.
const _secsOf = (x) => (+x.dur > 0 ? +x.dur : 30);
function _lastBatch(items) {
  const last = items.filter(x => x.batch).map(x => String(x.batch)).sort().pop() || '';
  return last ? items.filter(x => String(x.batch || '') === last) : items;
}
// Seconds of encoding a second of film, as the project's own renders took it (the median of its last ones) - 0.3 before any.
function _ratio(items) {
  const r = items.filter(x => x.status === 'done' && x.tookMs > 0 && x.dur > 0).slice(-7)
    .map(x => x.tookMs / 1000 / x.dur).sort((a, b) => a - b);
  return r.length ? r[Math.floor(r.length / 2)] : 0.3;
}
function _batchWay(items) {
  const batch = _lastBatch(items);
  const ratio = _ratio(items);
  let all = 0, made = 0, left = 0;
  for (const x of batch) {
    const s = _secsOf(x);
    const pc = Math.max(0, Math.min(100, +x.percent || 0));
    all += s;
    if (x.status === 'done') made += s;
    else if (x.status === 'running') {
      made += s * pc / 100;
      left += x.remain != null ? +x.remain : s * ratio * (1 - pc / 100);
    } else if (x.status === 'queued' && x.armed) left += s * ratio;
  }
  return { batch, frac: all > 0 ? made / all : 0, left: Math.round(left) };
}

function _group(id, items, refresh) {
  const wrap = document.createElement('div');
  wrap.className = 'mv3-qgrp';
  const n = items.length;
  const done = items.filter(x => x.status === 'done').length;
  const running = items.find(x => x.status === 'running') || null;
  const inLine = items.filter(x => x.status === 'queued' && x.armed).length;
  const cut = items.filter(x => x.status === 'queued' && !x.armed).length;
  const failed = items.filter(x => x.status === 'failed').length;
  const open = _openGroups.has(id);
  const way = _batchWay(items);

  const el = document.createElement('div');
  el.className = 'mv3-qrow mv3-qgrp-row' + (running ? ' is-running' : '');
  const main = document.createElement('div');
  main.className = 'mv3-qrow-m';
  const top = document.createElement('div');
  top.className = 'mv3-qrow-top';
  const nm = document.createElement('span');
  nm.className = 'mv3-qrow-t';
  nm.textContent = (open ? '▾ ' : '▸ ') + (items[0].hlName || t('highlights'));
  nm.title = open ? t('Close its fragments') : t('Show its fragments');
  top.appendChild(nm);
  const st = document.createElement('span');
  st.className = 'mv3-qrow-s';
  // Its way along, all together: what is going - counted in its last batch -, then what is made and what was cut off or failed.
  const live = running || inLine;
  const bn = way.batch.length;
  const bdone = way.batch.filter(x => x.status === 'done').length;
  st.textContent = live
    ? t('rendering {k} of {n}', { k: Math.min(bn, bdone + 1), n: bn }) + (way.left ? ' · ' + t('{time} left', { time: _mmss(way.left) }) : '')
    : [done ? t('{n} rendered', { n: done }) : '', cut ? t('{n} interrupted', { n: cut }) : '', failed ? t('{n} failed', { n: failed }) : ''].filter(Boolean).join(' · ') || t('queued');
  top.appendChild(st);
  main.appendChild(top);
  const sub = document.createElement('div');
  sub.className = 'mv3-qrow-sub';
  sub.textContent = t('highlights') + ' · ' + tn(n, '{n} fragment', '{n} fragments');
  main.appendChild(sub);
  if (live) {
    const bar = document.createElement('div');
    const known = way.frac > 0;
    bar.className = 'mv3-qbar' + (known ? '' : ' is-indet');
    const fill = document.createElement('i');
    if (known) fill.style.width = Math.min(100, Math.round(way.frac * 1000) / 10) + '%';
    bar.appendChild(fill);
    main.appendChild(bar);
  }
  el.appendChild(main);

  const acts = document.createElement('div');
  acts.className = 'mv3-qrow-acts';
  // Only its own interrupted and failed ones go on - nobody else's waiting renders start.
  if (cut || failed) {
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'mv3-c-btn mv3-qrow-a u-btn is-s';
    go.textContent = t('Continue');
    go.title = t('Render this project\'s interrupted and failed fragments - nothing else in the queue starts');
    go.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch('/api/mv3q/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hl: id }) });
      refresh();
    });
    acts.appendChild(go);
  }
  el.appendChild(acts);
  el.addEventListener('click', () => { if (open) _openGroups.delete(id); else _openGroups.add(id); refresh(); });
  wrap.appendChild(el);

  if (open) {
    const kids = document.createElement('div');
    kids.className = 'mv3-qgrp-kids';
    for (const it of items) kids.appendChild(_row(it, refresh));
    wrap.appendChild(kids);
  }
  return wrap;
}

function _open() {
  _close();
  const btn = $('mv3-queue');
  if (!btn) return;
  _pop = document.createElement('div');
  _pop.className = 'mv3-qpop u-win is-float';
  document.body.appendChild(_pop);
  // the side menu's tile: right of the folded menu, at the tile's height; the 3D Studio's strip: under the button
  if (!placeBeside(btn, _pop)) {
    const r = btn.getBoundingClientRect();
    _pop.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 470))) + 'px';
    _pop.style.top = Math.round(r.bottom + 6) + 'px';
  }
  // A panel, not a window: Escape closes it, the page keeps its shortcuts.
  _layer = Layers.open(_pop, { modal: false, name: 'queue', onEsc: _close });
  btn.classList.add('is-on');
  _failing = false;
  _paintList();
  // While it is open it follows the queue: a render finishing behind it should show, not wait
  // for the panel to be closed and opened again.
  _timer = setInterval(_paintList, 1500);
  setTimeout(() => document.addEventListener('mousedown', _away), 0);
}

function _away(e) {
  if (_pop && !_pop.contains(e.target) && !e.target.closest('#mv3-queue')) {
    _close();
    document.removeEventListener('mousedown', _away);
  }
}

/** Put the open project into the queue. Called by Merge's render window (export-b.js). */
export async function addCurrent(adv) {
  const Store = await import('./store.js');   // Merge's own, loaded already there
  const tl = Store.timeline();
  if (!tl || !Store.hasProject()) return { success: false, error: 'no project open' };
  const body = { kind: 'blank', key: Store.key(), title: Store.title(), timeline: tl, dur: Store.duration(), adv: adv || Store.adv() || null };
  const d = await fetch('/api/mv3q/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json());
  _paintBadge();
  return d;
}

export function initQueue() {
  const b = $('mv3-queue');
  if (b) b.addEventListener('click', (e) => { e.stopPropagation(); _pop ? _close() : _open(); });
  _paintBadge();
  // Another page or the server may add to it, so the badge is refreshed on a slow beat rather than
  // only when this page does something.
  setInterval(_paintBadge, 5000);
}
