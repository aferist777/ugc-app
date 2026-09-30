/* ════════════════════════════════════════════════════════════════════════════
   ALERTS — the button in the top bar, on every page.

   What is being generated right now, and what came of what was generated before
   (docs/local-app/PLAN.md, "Alerts"). The work itself is the server's: it waits for every
   generation, files the result and writes the answer into the journal (lib/gen-jobs.js). This is
   only the window onto that journal, which is why it can sit on a page that started none of it.

   WHAT THE BUTTON SAYS. A red count of what is still running. A green dot when something finished
   while you were looking elsewhere - it goes out when the list is opened. And, once per finished
   generation across all pages, a toast for five seconds with a short bell: the server marks it
   announced, so walking from one page to another does not ring twice for the same picture.

   Voices are not here. A read takes seconds, and a list of them would bury the things worth
   waiting for.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from './layers.js';

const POLL_MS = 4000;
const TOAST_MS = 5000;
const KIND_MARK = { image: '▣', video: '▶', music: '♪' };

let _btn = null;
let _menu = null;
let _layer = null;
let _timer = null;
let _tick = null;
let _items = [];
let _counts = { running: 0, unseen: 0 };
let _wait = null;                           // the chip that says how long is left (X3)
let _armed = null;                          // the retry waiting for a second press
let _audio = null;

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const _json = (url, opt) => fetch(url, opt).then(r => r.json()).catch(() => null);

// ── the bell ────────────────────────────────────────────────────────────────
// Made here rather than shipped as a file: two short tones and a decay are a smaller thing to
// write than to fetch, and nothing else in the app plays a sound. In the app's own window this
// plays without anybody clicking first; in a browser tab the first click on the page unlocks it.
function _ding() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _audio = _audio || new Ctx();
    if (_audio.state === 'suspended') _audio.resume();
    const now = _audio.currentTime;
    const gain = _audio.createGain();
    gain.connect(_audio.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    for (const [hz, at] of [[880, 0], [1320, 0.12]]) {
      const osc = _audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(hz, now + at);
      osc.connect(gain);
      osc.start(now + at);
      osc.stop(now + 1);
    }
  } catch (e) { /* no sound is not a failure of the news */ }
}

// ── what a row knows about itself ───────────────────────────────────────────
function _ago(iso) {
  const t = Date.parse(iso || '');
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + 's';
  const m = Math.round(s / 60);
  return m < 60 ? m + ' min' : Math.round(m / 60) + ' h';
}

const _running = (r) => r.state === 'running';
const _canOpen = (r) => r.state === 'done' && r.result && r.result.path;

// WHERE A ROW TAKES YOU: back to where it was started - except a picture from Merge's pictures
// window that has landed, which is shown on its shelf in the Library, lit (phase L4, the owner
// 2026-09-23; js/merge-v3/main.js, ?reveal=). While it runs, or when it failed, the window is still
// the place: that is where it is waited for, or asked again.
function _hrefOf(rec) {
  const w = rec.where || {};
  const spot = w.spot || {};
  const path = (rec.result || {}).path || '';
  if (rec.state === 'done' && path && spot.view === 'pictures' && spot.key) {
    return '/merge?p=' + encodeURIComponent(spot.key) + '&reveal=' + encodeURIComponent(path);
  }
  // A 4K sheet made on the Characters shelf (phase H): once it is drawn, the row leads to the character
  // itself, selected on the shelf; while it runs, or when it failed, back into the making area.
  if (rec.state === 'done' && rec.what === 'sheet' && spot.view === 'chmake' && spot.key) {
    return '/library?shelf=characters&sel=' + encodeURIComponent(spot.key);
  }
  return w.href || '';
}

// ── HOW LONG IS LEFT (phase X3, the owner 2026-09-22) ───────────────────────
// A chip to the left of the button, whenever something is running. What it says is the wait: the
// LONGEST of what is still going, not the sum, because generations run side by side - ten clips
// started a second apart are done when the slowest is done, not ten times later.
//
// It does not guess. The journal keeps what finished, with the moment each started and the moment
// it landed, so the average of the last few of the SAME kind is what a new one of that kind is
// expected to take. Only before there is any history at all does a built-in number stand in, and it
// is replaced the first time something of that kind finishes. Every poll recomputes it, so it ticks
// down by itself and jumps the moment a fragment lands.
const KEEP_FOR_AVERAGE = 6;
const GUESS_MS = { clip: 5 * 60000, frame: 90000, lookbook: 60000, environment: 60000, music: 2 * 60000 };
const GUESS_OTHER_MS = 2 * 60000;

function _typical(what) {
  const past = [];
  for (const r of _items) {
    if (r.what !== what || r.state !== 'done' || !r.doneAt) continue;
    const ms = Date.parse(r.doneAt) - Date.parse(r.startedAt);
    if (ms > 0) past.push(ms);
    if (past.length >= KEEP_FOR_AVERAGE) break;
  }
  if (!past.length) return GUESS_MS[what] || GUESS_OTHER_MS;
  return past.reduce((a, x) => a + x, 0) / past.length;
}

// The wait, in milliseconds, or 0 when nothing is running.
function _leftMs() {
  const now = Date.now();
  let most = 0;
  for (const r of _items) {
    if (!_running(r)) continue;
    const left = _typical(r.what) - (now - (Date.parse(r.startedAt) || now));
    most = Math.max(most, left);
  }
  return Math.max(0, most);
}

// Rounded the way somebody reads a wait: seconds while it is seconds, then minutes.
function _leftSays(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return '~' + Math.max(5, Math.round(s / 5) * 5) + 's left';
  const m = Math.round(s / 60);
  if (m < 60) return '~' + m + ' min left';
  return '~' + Math.floor(m / 60) + ' h ' + (m % 60) + ' min left';
}

function _paintWait() {
  if (!_wait) return;
  const n = _counts.running || 0;
  if (!n) { _wait.hidden = true; _wait.textContent = ''; return; }
  const ms = _leftMs();
  _wait.hidden = false;
  _wait.textContent = ms ? _leftSays(ms) : 'any moment now';
  _wait.title = n + (n === 1 ? ' generation is running' : ' generations are running side by side')
    + '. The wait is the longest of them, from how long the last ones of the same kind took.';
}

// ── the button ──────────────────────────────────────────────────────────────
function _paintButton() {
  if (!_btn) return;
  _btn.querySelector('.sv3-al-count').textContent = _counts.running ? String(_counts.running) : '';
  _btn.classList.toggle('has-running', !!_counts.running);
  _btn.classList.toggle('has-done', !_counts.running && !!_counts.unseen);
  _btn.title = _counts.running
    ? _counts.running + ' generation' + (_counts.running === 1 ? '' : 's') + ' running'
    : (_counts.unseen ? 'Something finished' : 'What is being generated');
}

// ── the list ────────────────────────────────────────────────────────────────
function _row(rec) {
  const row = _el('div', 'sv3-al-row' + (rec.state === 'failed' ? ' is-failed' : ''));
  row.appendChild(_el('span', 'sv3-al-mark', KIND_MARK[rec.kind] || '▣'));

  const main = _el('span', 'sv3-al-main');
  main.appendChild(_el('span', 'sv3-al-title', rec.title || rec.what || 'generation'));
  // Under the title: what went wrong, or - while it runs and says so - what it is doing right now.
  // A clip spends half a minute having the place and the fragment looked at before anything is
  // sent to a renderer, and a row that only said "Clip - fragment 3" looked stuck (the owner,
  // 2026-09-22). Otherwise, where it was started from.
  const stage = _running(rec) ? String(rec.stage || '') : '';
  const under = rec.state === 'failed'
    ? (rec.error || 'it did not come')
    : (stage || (rec.where && rec.where.label) || '');
  main.appendChild(_el('span', 'sv3-al-where' + (stage ? ' is-stage' : ''), under));
  row.appendChild(main);

  row.appendChild(_el('span', 'sv3-al-state',
    _running(rec) ? _ago(rec.startedAt) : (rec.state === 'done' ? _ago(rec.doneAt) + ' ago' : '')));

  const acts = _el('span', 'sv3-al-acts');
  if (_canOpen(rec)) {
    const open = _el('button', 'sv3-al-act', 'open');
    open.type = 'button';
    open.title = 'Look at what came out';
    open.addEventListener('click', (e) => { e.stopPropagation(); _open(rec); });
    acts.appendChild(open);
  }
  if (rec.state === 'failed' && rec.retryable) {
    const again = _el('button', 'sv3-al-act' + (_armed === rec.id ? ' is-armed' : ''),
      _armed === rec.id ? 'spend again?' : 'retry');
    again.type = 'button';
    again.title = 'Ask for it again - this spends credits';
    again.addEventListener('click', (e) => {
      e.stopPropagation();
      // Asked before it spends, and the question is the button itself: a second press inside a
      // few seconds is the answer.
      if (_armed !== rec.id) {
        _armed = rec.id;
        _paintMenu();
        setTimeout(() => { if (_armed === rec.id) { _armed = null; _paintMenu(); } }, 4000);
        return;
      }
      _armed = null;
      _json('/api/alerts/' + encodeURIComponent(rec.id) + '/retry', { method: 'POST' }).then(_poll);
    });
    acts.appendChild(again);
  }
  row.appendChild(acts);

  // The row itself is the way back to where it was started - or, for a picture, to the picture.
  const href = _hrefOf(rec);
  if (href) {
    row.classList.add('is-linked');
    row.title = /[?&]reveal=/.test(href) ? 'Show it in the Library' : 'Go to where this was started';
    row.addEventListener('click', () => { _close(); _goTo(href); });
  }
  return row;
}

function _paintMenu() {
  if (!_menu) return;
  _menu.textContent = '';

  const head = _el('div', 'sv3-al-head');
  head.appendChild(_el('span', 'sv3-al-h', 'Alerts'));
  head.appendChild(_el('span', 'sp'));
  const clear = _el('button', 'sv3-al-clear', 'clear');
  clear.type = 'button';
  clear.title = 'Forget the finished ones. What is still running stays.';
  clear.addEventListener('click', () => { _json('/api/alerts/clear', { method: 'POST' }).then(_poll); });
  head.appendChild(clear);
  _menu.appendChild(head);

  const list = _el('div', 'sv3-al-list');
  if (!_items.length) list.appendChild(_el('div', 'sv3-al-empty', 'Nothing yet. Pictures, video and music show up here while they are made.'));
  for (const rec of _items) list.appendChild(_row(rec));
  _menu.appendChild(list);
}

function _place() {
  if (!_menu || !_btn) return;
  const r = _btn.getBoundingClientRect();
  const w = _menu.offsetWidth || 340;
  _menu.style.top = Math.round(r.bottom + 6) + 'px';
  _menu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))) + 'px';
}

function _open(rec) {
  const path = (rec.result || {}).path || '';
  if (!path) return;
  // The Library's viewer, brought in on the first press: most visits to a page never open one.
  if (!document.querySelector('link[href$="lib-viewer.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/lib-viewer.css';
    document.head.appendChild(link);
  }
  import('./library/viewer.js').then(({ openViewer }) => {
    openViewer([{
      id: rec.id, name: rec.title || path.split('/').pop(), kind: rec.what || '', media: path,
      meta: { date: rec.doneAt || rec.startedAt },
    }], 0);
  }).catch(() => { window.open(path, '_blank'); });
}

// The address of a place is read when its page loads (js/merge-v3/workshop.js and wk-setup.js),
// so standing on that address already and pressing the row means: go there again. The page is
// asked first: one that can show the place where it stands takes the event and nothing is loaded
// again (Merge, for a picture of the project it has open - js/merge-v3/main.js).
function _goTo(href) {
  const ask = new CustomEvent('ugc:goto', { detail: { href }, cancelable: true });
  if (!window.dispatchEvent(ask)) return;
  if (href === location.pathname + location.search) location.reload();
  else location.href = href;
}

function _toggle() {
  if (_menu) return _close();
  _menu = _el('div', 'sv3-al-menu');
  document.body.appendChild(_menu);
  _paintMenu();
  _place();
  _layer = Layers.open(_menu, { modal: false, name: 'alerts', onEsc: _close });
  document.addEventListener('mousedown', _away, true);
  window.addEventListener('resize', _place);
  _btn.classList.add('is-on');
  // Opening the list is looking at it: the green dot goes out.
  if (_counts.unseen) _json('/api/alerts/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(_poll);
  _poll();
}

function _away(e) {
  if (!_menu) return;
  if (_menu.contains(e.target) || (_btn && _btn.contains(e.target))) return;
  _close();
}

function _close() {
  if (!_menu) return;
  _menu.remove();
  _menu = null;
  _armed = null;
  document.removeEventListener('mousedown', _away, true);
  window.removeEventListener('resize', _place);
  if (_layer) { Layers.close(_layer); _layer = null; }
  if (_btn) _btn.classList.remove('is-on');
}

// ── a finished generation announces itself ──────────────────────────────────
function _toasts() {
  let box = document.querySelector('.sv3-toasts');
  if (!box) {
    box = _el('div', 'sv3-toasts');
    document.body.appendChild(box);
  }
  return box;
}

function _announce(rec) {
  const t = _el('div', 'sv3-toast' + (rec.state === 'failed' ? ' is-failed' : ''));
  t.appendChild(_el('span', 'sv3-toast-mark', KIND_MARK[rec.kind] || '▣'));
  const main = _el('span', 'sv3-al-main');
  main.appendChild(_el('span', 'sv3-al-title', rec.title || rec.what || 'generation'));
  main.appendChild(_el('span', 'sv3-al-where', rec.state === 'failed' ? (rec.error || 'it did not come') : 'ready'));
  t.appendChild(main);
  if (_canOpen(rec)) {
    const open = _el('button', 'sv3-al-act', 'open');
    open.type = 'button';
    open.addEventListener('click', (e) => { e.stopPropagation(); _open(rec); });
    t.appendChild(open);
  }
  const href = _hrefOf(rec);
  if (href) t.addEventListener('click', () => _goTo(href));
  _toasts().appendChild(t);
  setTimeout(() => { t.classList.add('is-going'); setTimeout(() => t.remove(), 300); }, TOAST_MS);
  // A failure is said in red and without the bell: it is news, but not good news.
  if (rec.state !== 'failed') _ding();
}

// ── reading the journal ─────────────────────────────────────────────────────
async function _poll() {
  const d = await _json('/api/alerts');
  if (!d || !d.success) return;
  _items = d.items || [];
  _counts = d.counts || { running: 0, unseen: 0 };
  _paintButton();
  _paintWait();
  if (_menu) _paintMenu();

  const fresh = _items.filter(r => r.state !== 'running' && !r.notified);
  if (!fresh.length) return;
  for (const rec of fresh.slice(0, 3)) _announce(rec);
  await _json('/api/alerts/notified', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: fresh.map(r => r.id) }),
  });
}

/** Put the button in the top bar, left of Library, and start reading the journal. */
export function mountAlerts(nav) {
  if (!nav || _btn) return;
  _btn = _el('button', 'sv3-alerts');
  _btn.type = 'button';
  _btn.appendChild(_el('span', null, 'Alerts'));
  _btn.appendChild(_el('span', 'sv3-al-count'));
  _btn.addEventListener('click', _toggle);
  // ANCHORED ON ADMIN (phase R): Admin is the last thing in the strip on every page and is put
  // there before this runs (initNav), so the bell lands at the right-hand end wherever it is. It
  // used to hang off the Library link, which is on the LEFT of the strip since phase R - and on
  // the Character page there was none, so the bell ended up after Admin.
  const at = nav.querySelector('a[href="/admin"]');
  // The wait stands to the LEFT of the button, so the two read as one thing: what is running, and
  // how long it has to go (the owner, 2026-09-22).
  _wait = _el('span', 'sv3-al-wait');
  _wait.hidden = true;
  nav.insertBefore(_wait, at);
  nav.insertBefore(_btn, at);
  _paintButton();
  _poll();
  _timer = setInterval(_poll, POLL_MS);
  // The journal is read every few seconds; the wait is recomputed every second from what was read,
  // so it counts down smoothly instead of stepping.
  _tick = setInterval(_paintWait, 1000);
  // A window that is not looked at still has work going on in it; the app keeps polling on
  // purpose (desktop/main.js turns background throttling off for the same reason).
  window.addEventListener('beforeunload', () => { clearInterval(_timer); clearInterval(_tick); });
}
