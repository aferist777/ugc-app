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
   waiting for. A source being added is (phase V28.1): its download, transcription and topics are
   minutes of work the person was let go from, and its row is where they come back to it. Its
   window flies into the button on the way (flyToAlerts), with a swoosh, and the button answers.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from './layers.js';
import { showToast } from './notice.js';
import { MS } from './really.js';
import { emptyEl } from './ui-state.js';

const POLL_MS = 4000;
const TOAST_MS = 5000;
const KIND_MARK = { image: '▣', video: '▶', music: '♪', source: '↓', highlights: '✂' };

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
// (phase V73 block 2) The 3D Studio's page keeps its look (б1-13а): there the empty list keeps its own line.
const OLD_LOOK = () => !!document.querySelector('link[href="css/studio3d.css"]');

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

// THE SWOOSH (phase V28.1): a window handed over to Alerts flies into the button with it - noise through a
// band-pass sweeping down, made here like the bell. Quiet; never a failure of the hand-over.
function _swoosh() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _audio = _audio || new Ctx();
    if (_audio.state === 'suspended') _audio.resume();
    const now = _audio.currentTime;
    const dur = 0.42;
    const buf = _audio.createBuffer(1, Math.ceil(_audio.sampleRate * dur), _audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = _audio.createBufferSource();
    src.buffer = buf;
    const band = _audio.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.1;
    band.frequency.setValueAtTime(2800, now);
    band.frequency.exponentialRampToValueAtTime(320, now + dur);
    const gain = _audio.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(band);
    band.connect(gain);
    gain.connect(_audio.destination);
    src.start(now);
    src.stop(now + dur);
  } catch (e) { /* no sound is not a failure of the hand-over */ }
}

// THE TELEGRAM CHIME (phase TG, the owner 2026-10-21: "добавим новый звук при добавлении медиа через телеграм") - a post
// the bot brought in landed in REFERENCES: three quick rising notes, brighter than the bell, so the two are told apart.
function _tgChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _audio = _audio || new Ctx();
    if (_audio.state === 'suspended') _audio.resume();
    const now = _audio.currentTime;
    for (const [hz, at] of [[1046.5, 0], [1318.5, 0.085], [1568, 0.17], [2093, 0.255]]) {
      const gain = _audio.createGain();
      gain.connect(_audio.destination);
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.09, now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.32);
      const osc = _audio.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(hz, now + at);
      osc.connect(gain);
      osc.start(now + at);
      osc.stop(now + at + 0.34);
    }
  } catch (e) { /* no sound is not a failure of the news */ }
}

// ── REFERENCES: a post landed (phase TG) ─────────────────────────────────────
// Read with the journal. A post newer than the last one this window knew of (kept across pages, so walking from one
// page to the next does not ring again) chimes, says where it went, and tells the page: `ugc-references` on window -
// the Library and Merge read their tree and gallery again.
const LS_REFS = 'ugc_refs_seen_v1';
let _refsSeen = null;
async function _pollRefs() {
  const d = await _json('/api/references/stamp');
  if (!d || !d.success) return;
  if (_refsSeen === null) {
    try { _refsSeen = localStorage.getItem(LS_REFS); } catch (e) { _refsSeen = ''; }
    if (_refsSeen == null) { _refsSeen = d.latest || ''; _keepRefs(); return; }
  }
  const was = _refsSeen;
  if ((d.latest || '') === was) return;
  _refsSeen = d.latest || '';
  _keepRefs();
  try { window.dispatchEvent(new CustomEvent('ugc-references', { detail: d })); } catch (e) { /* an old page */ }
  if (d.latest && d.latest > was) {
    _tgChime();
    showToast({ mark: '✈', title: d.title || 'a post', where: 'from Telegram · REFERENCES · ' + (d.where || ''),
      onClick: () => _goTo('/library?shelf=media'), ms: TOAST_MS });
  }
}
function _keepRefs() { try { localStorage.setItem(LS_REFS, _refsSeen || ''); } catch (e) { /* a private window */ } }

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
  // (phase V64 block 4, the owner's (зг12): "вариант А. ведет в library в ту папку куда файл сгенерировался") A picture or a
  // clip made in a chat's window on the LIBRARY page: once it is filed, the Library - the folder it lies in, it outlined
  // (?reveal=), the window open again (?open=); while it runs, or when it failed, the window over IMAGES / VIDEO (w.href).
  if (rec.state === 'done' && path && w.page === 'library' && (spot.view === 'pictures' || spot.view === 'videos')) {
    return '/library?shelf=media&reveal=' + encodeURIComponent(path) + '&open=' + spot.view;
  }
  // (phase V64, fix (д), the owner 2026-11-01: "если сгенерировано что-то в merge, то вести в библиотеку merge и обвести золотом")
  // Music and sounds of Merge's sound window, an environment or a lookbook made from Merge: once filed, Merge's Library panel -
  // the folder it lies in, every file of the press outlined gold (?reveal=, several for Suno's two tracks).
  if (rec.state === 'done' && path && w.page === 'merge' && ['audio', 'envmake', 'lbmake'].includes(spot.view)) {
    let key = spot.key || '';
    if (!key) { try { key = new URL(w.href || '', location.href).searchParams.get('p') || ''; } catch (e) { key = ''; } }
    const all = ((rec.result || {}).variants || []).filter(Boolean);
    return '/merge?' + (key ? 'p=' + encodeURIComponent(key) + '&' : '') + (all.length ? all : [path]).map(p => 'reveal=' + encodeURIComponent(p)).join('&');
  }
  if (rec.state === 'done' && path && (spot.view === 'pictures' || spot.view === 'videos') && spot.key) {
    return '/merge?p=' + encodeURIComponent(spot.key) + '&reveal=' + encodeURIComponent(path);
  }
  // A 4K sheet (phase H): once it is drawn, the row leads to the character itself, selected on the
  // shelf - the row carries it in where.spot.key; while it runs, or when it failed, where it was asked.
  if (rec.state === 'done' && rec.what === 'sheet' && spot.key) {
    return '/library?shelf=characters&sel=' + encodeURIComponent(spot.key);
  }
  // An environment or a lookbook made from the Library (phase I's chats; phase V58 the generators' window, js/gen-window.js,
  // with the same place): once it is made, the row leads to it, outlined - (phase V56) in IMAGES -> Environments / Lookbooks
  // on Media, the shelves having gone; its id there is its file name. While it runs, or when it failed, to the generator.
  if (rec.state === 'done' && path && w.page === 'library' && (spot.view === 'envmake' || spot.view === 'lbmake')) {
    return '/library?shelf=media&kind=' + (spot.view === 'envmake' ? 'environments' : 'lookbooks')
      + '&sel=' + encodeURIComponent(path.split('/').pop());
  }
  // (phase V59, the owner 2026-10-29: "клик по alerts будет вести не в окно попап, а в папку с выделением сгенерированного
  // файла музыки") Music made in the Library's window (js/library/music-window.js; since phase V64 the sound window, js/sound/sound-window.js - a
  // sound's row leads to SFX → My sounds → Generated the same way): the folder under Music its tracks went into
  // (`spot.key` - the tree's key), both tracks outlined once they are filed (the result's `ids`, lib/audio-gens.js); while it
  // runs, or when it failed, that folder alone.
  if (w.page === 'library' && spot.view === 'musicmake') {
    const ids = rec.state === 'done' ? ((rec.result || {}).ids || []).filter(Boolean) : [];
    // (phase V64, (зг12)) ...and the sound window open again over it.
    return '/library?shelf=media&kind=' + encodeURIComponent(spot.key || 'music') + ids.map(id => '&sel=' + encodeURIComponent(id)).join('') + '&open=audio';
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
//
// BY MODEL (phase V23, V-F): a Seedance clip and a Grok one, a nano-banana picture and a gpt one, are not one kind of
// wait. The last few of the same kind AND the same model (`engine`, the aggregator after " @ " left off) first, then
// of the kind, then the built-in number. The MIDDLE of them, not the mean: one row resumed after the app was closed
// for an hour would pull a mean of six far out. A row of the fake aggregator ("FAKE ·" in its title) is twenty
// seconds of nothing and is not counted.
const KEEP_FOR_AVERAGE = 6;
const GUESS_MS = { clip: 5 * 60000, video: 5 * 60000, frame: 90000, picture: 75000, lookbook: 60000, environment: 60000, music: 2 * 60000,
  highlights: 10 * 60000 };
const GUESS_OTHER_MS = 2 * 60000;

const _model = (r) => String((r && r.engine) || '').split(' @ ')[0].trim();
const _fake = (r) => /(^|·\s*)FAKE\s*·/.test(String((r && r.title) || ''));
function _median(list) {
  const s = list.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function _past(match) {
  const past = [];
  for (const r of _items) {
    if (r.state !== 'done' || !r.doneAt || _fake(r) || !match(r)) continue;
    const ms = Date.parse(r.doneAt) - Date.parse(r.startedAt);
    if (ms > 0) past.push(ms);
    if (past.length >= KEEP_FOR_AVERAGE) break;
  }
  return past;
}
function _typical(what, model) {
  const same = model ? _past(r => r.what === what && _model(r) === model) : [];
  if (same.length) return _median(same);
  const kind = _past(r => r.what === what);
  if (kind.length) return _median(kind);
  return GUESS_MS[what] || GUESS_OTHER_MS;
}

// The wait, in milliseconds, or 0 when nothing is running. A row that knows when it is expected to end (`etaAt`,
// phase V28.1: a source being added - its download says what is left) is taken at its word.
function _leftMs() {
  const now = Date.now();
  let most = 0;
  for (const r of _items) {
    if (!_running(r)) continue;
    const eta = Date.parse(r.etaAt || '');
    const left = eta ? eta - now : _typical(r.what, _model(r)) - (now - (Date.parse(r.startedAt) || now));
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
  _wait.title = n + (n === 1 ? ' thing is running' : ' things are running side by side')
    + '. The wait is the longest of them, from how long the last ones of the same kind took.';
}

// ── the button ──────────────────────────────────────────────────────────────
function _paintButton() {
  if (!_btn) return;
  _btn.querySelector('.sv3-al-count').textContent = _counts.running ? String(_counts.running) : '';
  _btn.classList.toggle('has-running', !!_counts.running);
  _btn.classList.toggle('has-done', !_counts.running && !!_counts.unseen);
  _btn.title = _counts.running
    ? _counts.running + ' running'
    : (_counts.unseen ? 'Something finished' : 'What is being generated or added');
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
  // A finished row may say what came of it in a word (a source: "12 topics").
  const note = rec.state === 'done' && rec.result && rec.result.note ? String(rec.result.note) : '';
  const under = rec.state === 'failed'
    ? (rec.error || 'it did not come')
    : (stage || note || (rec.where && rec.where.label) || '');
  main.appendChild(_el('span', 'sv3-al-where' + (stage ? ' is-stage' : ''), under));
  row.appendChild(main);

  row.appendChild(_el('span', 'sv3-al-state',
    _running(rec) ? _ago(rec.startedAt) : (rec.state === 'done' ? _ago(rec.doneAt) + ' ago' : '')));

  const acts = _el('span', 'sv3-al-acts');
  if (_canOpen(rec)) {
    const open = _el('button', 'sv3-al-act u-btn is-s', 'open');
    open.type = 'button';
    open.title = 'Look at what came out';
    open.addEventListener('click', (e) => { e.stopPropagation(); _open(rec); });
    acts.appendChild(open);
  }
  if (rec.state === 'failed' && rec.retryable) {
    const again = _el('button', 'sv3-al-act u-btn is-s' + (_armed === rec.id ? ' is-armed' : ''),
      _armed === rec.id ? 'spend again?' : 'retry');
    again.type = 'button';
    again.title = rec.retryFree ? 'Go on from where it stopped - this costs nothing' : 'Ask for it again - this spends credits';
    again.addEventListener('click', (e) => {
      e.stopPropagation();
      // Asked before it spends, and the question is the button itself: a second press inside a
      // few seconds is the answer. A retry that costs nothing (a download going on) is one press.
      if (!rec.retryFree && _armed !== rec.id) {
        _armed = rec.id;
        _paintMenu();
        setTimeout(() => { if (_armed === rec.id) { _armed = null; _paintMenu(); } }, MS);
        return;
      }
      _armed = null;
      // Said to the page as well (phase I): a panel that shows this row's end - the Library's chats -
      // reads itself again, because nothing of its own was waiting any more.
      _json('/api/alerts/' + encodeURIComponent(rec.id) + '/retry', { method: 'POST' })
        .then(() => { try { window.dispatchEvent(new CustomEvent('ugc:alert-retried', { detail: { id: rec.id } })); } catch (e) { /* only a hint */ } })
        .then(_poll);
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
  const clear = _el('button', 'sv3-al-clear u-btn is-s is-quiet', 'clear');
  clear.type = 'button';
  clear.title = 'Forget the finished ones. What is still running stays.';
  clear.addEventListener('click', () => { _json('/api/alerts/clear', { method: 'POST' }).then(_poll); });
  head.appendChild(clear);
  _menu.appendChild(head);

  const list = _el('div', 'sv3-al-list');
  // (phase V73 block 2) the shared empty part (js/ui-state.js); `sv3-al-empty` its place in the menu
  const none = 'Nothing yet. Pictures, video and music show up here while they are made, and sources while they are added.';
  if (!_items.length) list.appendChild(OLD_LOOK() ? _el('div', 'sv3-al-empty', none) : emptyEl(none, { icon: 'bell', cls: 'sv3-al-empty' }));
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
  _menu = _el('div', 'sv3-al-menu u-menu');
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
// In the corner of popups (js/notice.js, phase V49.1): it goes by itself, and has a ✕ too.
function _announce(rec) {
  const href = _hrefOf(rec);
  showToast({
    mark: KIND_MARK[rec.kind] || '▣', failed: rec.state === 'failed',
    title: rec.title || rec.what || 'generation',
    where: rec.state === 'failed' ? (rec.error || 'it did not come') : 'ready',
    act: _canOpen(rec) ? { label: 'open', run: () => _open(rec) } : null,
    onClick: href ? () => _goTo(href) : null,
    ms: TOAST_MS,
  });
  // A failure is said in red and without the bell: it is news, but not good news.
  if (rec.state !== 'failed') _ding();
}

// ── reading the journal ─────────────────────────────────────────────────────
// ONE READ AT A TIME (phase V58, the owner's "two popups from one task"): the journal is read from several places - the
// timer, a window handed over (pulseAlerts), the list opened, a retry - and two reads going at once both saw a finished
// row before either had marked it announced, so it popped up twice. A read asked for while one goes is made once after
// it (any number of asks - one more read), and the page remembers what it announced: a row is never announced twice
// here, even when the mark did not reach the server (a row asked again and ended again is news again).
let _reading = null;                        // the read going on - its promise
let _again = false;                         // asked for again while it went
const _told = new Set();                    // the ends this page announced: id + when it ended (a retried row ends again)
const _endOf = (r) => r.id + '|' + (r.doneAt || '');

function _poll() {
  if (_reading) { _again = true; return _reading; }
  _reading = (async () => {
    try {
      do { _again = false; await _readOnce(); } while (_again);
    } finally { _reading = null; }
  })();
  return _reading;
}

async function _readOnce() {
  const d = await _json('/api/alerts');
  if (!d || !d.success) return;
  _items = d.items || [];
  _counts = d.counts || { running: 0, unseen: 0 };
  _paintButton();
  _paintWait();
  if (_menu) _paintMenu();

  const fresh = _items.filter(r => r.state !== 'running' && !r.notified && !_told.has(_endOf(r)));
  if (!fresh.length) return;
  for (const rec of fresh) _told.add(_endOf(rec));
  for (const rec of fresh.slice(0, 3)) _announce(rec);
  await _json('/api/alerts/notified', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: fresh.map(r => r.id) }),
  });
}

// ── a window handed over (phase V28.1) ──────────────────────────────────────
/** The button answers: a little bigger for a moment, and two blinks - this is where to look later. The journal is
 *  read at once, so the new row's count is on it. */
export function pulseAlerts() {
  if (!_btn) return;
  _btn.classList.remove('is-caught');
  void _btn.offsetWidth;                    // the animation runs again on a second hand-over
  _btn.classList.add('is-caught');
  setTimeout(() => { if (_btn) _btn.classList.remove('is-caught'); }, 1000);
  _poll();
}

/** `el` - a window - shrinks and flies into the button with a swoosh, and the button answers. Resolves when it has
 *  landed; the caller then takes the window away. Without the button (a page with no top bar) it only resolves. */
export function flyToAlerts(el) {
  return new Promise((resolve) => {
    if (!_btn || !el || !el.getBoundingClientRect) { pulseAlerts(); resolve(); return; }
    _swoosh();
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduce = false; }
    if (reduce) { pulseAlerts(); resolve(); return; }
    const a = el.getBoundingClientRect();
    const b = _btn.getBoundingClientRect();
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    el.style.transformOrigin = '50% 50%';
    el.style.willChange = 'transform, opacity';
    el.style.transition = 'transform .46s cubic-bezier(.55,.05,.85,.35), opacity .46s ease-in, border-radius .46s ease-in';
    let landed = false;
    const land = () => { if (landed) return; landed = true; pulseAlerts(); resolve(); };
    // The start is made to count (a reflow), so the transition runs from where the window is now.
    void el.offsetWidth;
    el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px) scale(.04)`;
    el.style.opacity = '.2';
    el.style.borderRadius = '48px';
    el.addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') land(); });
    setTimeout(land, 650);
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
  _pollRefs();
  _timer = setInterval(() => { _poll(); _pollRefs(); }, POLL_MS);
  // The journal is read every few seconds; the wait is recomputed every second from what was read,
  // so it counts down smoothly instead of stepping.
  _tick = setInterval(_paintWait, 1000);
  // A window that is not looked at still has work going on in it; the app keeps polling on
  // purpose (desktop/main.js turns background throttling off for the same reason).
  window.addEventListener('beforeunload', () => { clearInterval(_timer); clearInterval(_tick); });
}
