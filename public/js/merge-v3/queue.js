/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the render queue, as the page sees it.

   Shared by both workflows on purpose, unlike the timeline, the preview and the render:
   a queue that only knew about one of them would be two queues, and the whole point is one
   place to leave work and come back to it.

   The list is the SERVER'S. This module shows it and asks it to do things; it holds no copy
   worth trusting, because a second tab is allowed to add to the same queue and a browser
   copy would quietly be wrong.

   A finished entry STAYS. It is the record of what was rendered and where the file went, and
   the runner never looks at it again. The list shrinks only when somebody says so - and when
   they say so with things still waiting, they are asked which they meant, because "clear"
   over unrendered work is the one press here that cannot be taken back.

   Render all starts what is waiting. The encoder does one at a time, so a started entry may
   still stand in line - the row says how many are ahead.

   A HIGHLIGHTS PROJECT IS ONE ROW (phase V33.4, the owner's (х44), (х44а)): its fragments' entries under "▸ <project> ·
   highlights · 5 fragments" with their way along all together ("rendering 2 of 5 · 1:30 left", "3 rendered · 2
   interrupted"); a press opens its fragments' rows, as any. Its own "▶ go on" starts only ITS interrupted and failed
   renders (POST /api/mv3q/run { hl }) - Render all, as always, starts everything waiting.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import { showResult } from './render-result.js';

let _pop = null;
let _layer = null;
let _timer = 0;
// The panel refreshes on a beat, and a refresh rebuilds it wholesale. While a question is on
// screen that would erase the question mid-read - which it did: the confirm appeared and was
// gone before it could be answered. So the beat waits.
let _asking = false;

const $ = (id) => document.getElementById(id);

async function _get() {
  try { return await fetch('/api/mv3q').then(r => r.json()); }
  catch (e) { return { success: false, items: [], waiting: 0 }; }
}

// The badge counts what is still to happen - queued and running - not the whole history.
// A number that only grows is not something anybody acts on.
async function _paintBadge() {
  const b = $('mv3-queue');
  if (!b) return;
  const d = await _get();
  const n = d.waiting || 0;
  let dot = b.querySelector('.mv3-qbadge');
  if (!n) { if (dot) dot.remove(); return; }
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'mv3-qbadge';
    b.appendChild(dot);
  }
  dot.textContent = String(n);
}

function _close() {
  _asking = false;
  if (_pop) { _pop.remove(); _pop = null; }
  if (_layer) { Layers.close(_layer); _layer = null; }
  clearInterval(_timer);
  _timer = 0;
}

const _mmss = (v) => {
  const m = Math.floor(v / 60), s = Math.round(v - m * 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
};

// A row says three things: what it is, what it is made of, and where it has got to. The
// middle one is why the rows are tall: two projects called "2026-08-19" tell you nothing
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
  const named = it.phase === 'normalizing' ? 'preparing clips…'
              : it.phase === 'speeding' ? 'speeding up…'
              : it.phase === 'tail' ? 'adding the black tail…'
              : it.phase === 'poster' ? 'finishing…'
              : null;
  st.textContent = it.status === 'done' ? 'ready'
                 : running
                     ? (named || ((it.percent ? it.percent + '%' : 'rendering…')
                        + (it.remain != null ? ' · ' + _mmss(it.remain) + ' left' : '')))
                 : it.status === 'failed' ? 'failed'
                 : it.armed ? ('in line' + (it.ahead ? ' · ' + it.ahead + ' ahead' : ' · next'))
                 // (phase V23) Stopped by a closed or restarted app: Render all starts it over.
                 : it.interrupted ? 'interrupted · Render all starts it over'
                 : 'queued';
  top.appendChild(st);
  main.appendChild(top);

  const sub = document.createElement('div');
  sub.className = 'mv3-qrow-sub';
  sub.textContent = (it.hl ? 'fragment' : it.kind === 'blank' ? 'blank' : 'scenario') + ' · ' + (it.summary || '');
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

  // A ready render opens in the result window - playable, named, kept, sent - not in a tab.
  if (it.status === 'done' && it.url) {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'mv3-qrow-a';
    a.textContent = 'open';
    a.title = 'Play it, name it, save and download it, send it';
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      _close();
      showResult({ url: it.url, title: it.title, key: it.key, queueId: it.id, fresh: false });
    });
    acts.appendChild(a);
  }
  // Try again puts the SAME job back in the line, which is the only thing that deserves the
  // name: rebuilding it from the project would render something else.
  if (it.status === 'failed') {
    const r = document.createElement('button');
    r.type = 'button'; r.className = 'mv3-qx'; r.textContent = '↻';
    r.title = 'Try this one again';
    r.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch('/api/mv3q/retry/' + encodeURIComponent(it.id), { method: 'POST' });
      refresh();
    });
    acts.appendChild(r);
  }
  if (it.status !== 'running') {
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'mv3-qx'; x.textContent = '×';
    x.title = 'Remove from the queue';
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch('/api/mv3q/' + encodeURIComponent(it.id), { method: 'DELETE' });
      refresh();
    });
    acts.appendChild(x);
  }
  el.appendChild(acts);
  return el;
}

// Clearing with work still waiting is the one press here that cannot be undone, so it asks
// rather than guesses - and it offers the harmless half as its own answer, because "just tidy
// away the finished ones" is what is usually meant.
function _askClear(host, waiting, onDone) {
  _asking = true;
  const box = document.createElement('div');
  box.className = 'mv3-qask';
  const t = document.createElement('div');
  t.className = 'mv3-qask-t';
  t.textContent = waiting + (waiting === 1 ? ' project has' : ' projects have') + ' not been rendered yet.';
  box.appendChild(t);

  const row = document.createElement('div');
  row.className = 'mv3-qask-r';
  const mk = (label, cls, mode) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-btn sm' + (cls ? ' ' + cls : '');
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
  row.append(mk('Cancel', '', null), mk('Finished only', '', 'done'), mk('Everything', 'danger', 'all'));
  box.appendChild(row);
  host.appendChild(box);
}

async function _paintList() {
  if (!_pop || _asking) return;
  const d = await _get();
  _pop.textContent = '';

  const head = document.createElement('div');
  head.className = 'mv3-qhead';
  const ttl = document.createElement('span');
  ttl.textContent = 'Render queue';
  head.appendChild(ttl);
  const sp = document.createElement('span');
  sp.className = 'sp';
  head.appendChild(sp);

  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'mv3-btn sm primary';
  all.textContent = 'Render all';
  // Yours that have not been started. Once started they are in line whatever the encoder is
  // doing, so the button has nothing left to do for them.
  const waiting = (d.items || []).filter(x => x.status === 'queued' && !x.armed).length;
  const inLine = (d.items || []).some(x => x.status === 'running' || (x.status === 'queued' && x.armed));
  all.disabled = !waiting;
  all.title = waiting ? 'Start everything of yours that is queued, one after another'
            : inLine ? 'Yours are started and in line' : 'Nothing queued';
  all.addEventListener('click', async (e) => {
    e.stopPropagation();
    await fetch('/api/mv3q/run', { method: 'POST' });
    _paintList();
  });
  head.appendChild(all);

  const clr = document.createElement('button');
  clr.type = 'button';
  clr.className = 'mv3-btn sm';
  clr.textContent = 'Clear';
  clr.addEventListener('click', async (e) => {
    e.stopPropagation();
    const left = (d.items || []).filter(x => x.status === 'queued').length;
    if (left) return _askClear(_pop, left, () => { _paintList(); _paintBadge(); });
    await fetch('/api/mv3q/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                     body: JSON.stringify({ mode: 'done' }) });
    _paintList(); _paintBadge();
  });
  head.appendChild(clr);
  _pop.appendChild(head);

  const list = document.createElement('div');
  list.className = 'mv3-qlist';
  if (!(d.items || []).length) {
    const e = document.createElement('div');
    e.className = 'mv3-qempty';
    e.textContent = 'Nothing queued. Add a project from its render window.';
    list.appendChild(e);
  } else {
    const again = () => { _paintList(); _paintBadge(); };
    // A highlights project's entries are one row, where its first one stands (phase V33.4).
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
  _paintBadge();
}

// ── A highlights project's row (phase V33.4) ────────────────────────────────
// Which projects' rows are open - kept while the panel repaints on its beat.
const _openGroups = new Set();

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

  const el = document.createElement('div');
  el.className = 'mv3-qrow mv3-qgrp-row' + (running ? ' is-running' : '');
  const main = document.createElement('div');
  main.className = 'mv3-qrow-m';
  const top = document.createElement('div');
  top.className = 'mv3-qrow-top';
  const nm = document.createElement('span');
  nm.className = 'mv3-qrow-t';
  nm.textContent = (open ? '▾ ' : '▸ ') + (items[0].hlName || 'highlights');
  nm.title = open ? 'Close its fragments' : 'Show its fragments';
  top.appendChild(nm);
  const st = document.createElement('span');
  st.className = 'mv3-qrow-s';
  // Its way along, all together: what is going, then what is made and what was cut off or failed.
  const live = running || inLine;
  let left = 0;
  if (running) left += running.remain != null ? running.remain : 0;
  st.textContent = live
    ? 'rendering ' + Math.min(n, done + 1) + ' of ' + n + (left ? ' · ' + _mmss(left) + ' left' : '')
    : [done ? done + ' rendered' : '', cut ? cut + ' interrupted' : '', failed ? failed + ' failed' : ''].filter(Boolean).join(' · ') || 'queued';
  top.appendChild(st);
  main.appendChild(top);
  const sub = document.createElement('div');
  sub.className = 'mv3-qrow-sub';
  sub.textContent = 'highlights · ' + n + (n === 1 ? ' fragment' : ' fragments');
  main.appendChild(sub);
  if (running) {
    const bar = document.createElement('div');
    const known = !running.phase && running.percent > 0;
    bar.className = 'mv3-qbar' + (known ? '' : ' is-indet');
    const fill = document.createElement('i');
    if (known) fill.style.width = running.percent + '%';
    bar.appendChild(fill);
    main.appendChild(bar);
  }
  el.appendChild(main);

  const acts = document.createElement('div');
  acts.className = 'mv3-qrow-acts';
  // Only its own interrupted and failed ones go on - nobody else's waiting renders start (the owner's (х44)).
  if (cut || failed) {
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'mv3-qrow-a';
    go.textContent = '▶ go on';
    go.title = 'Render this project\'s interrupted and failed fragments - nothing else in the queue starts';
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
  _pop.className = 'mv3-qpop';
  document.body.appendChild(_pop);
  const r = btn.getBoundingClientRect();
  _pop.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 470))) + 'px';
  _pop.style.top = Math.round(r.bottom + 6) + 'px';
  // A panel, not a window: Escape closes it, the page keeps its shortcuts.
  _layer = Layers.open(_pop, { modal: false, name: 'queue', onEsc: _close });
  _paintList();
  // While it is open it follows the queue: a render finishing behind it should show, not wait
  // for the panel to be closed and opened again.
  _timer = setInterval(_paintList, 1500);
  setTimeout(() => document.addEventListener('mousedown', _away), 0);
}

function _away(e) {
  if (_pop && !_pop.contains(e.target) && e.target.id !== 'mv3-queue') {
    _close();
    document.removeEventListener('mousedown', _away);
  }
}

/** Put the open project into the queue. Called by the render window of either workflow. */
export async function addCurrent(adv) {
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
  // Someone else's tab may be rendering, so the badge is refreshed on a slow beat rather than
  // only when this page does something.
  setInterval(_paintBadge, 5000);
}
