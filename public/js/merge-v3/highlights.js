/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — A HIGHLIGHTS PROJECT's own view of the Library panel (phase V33.1; the owner 2026-10-20: "вместо крошек
   (scenarios / Library / generate image / generate video / captions) появляется одна крошка highligts ... в highlight
   поле отображается столько плиток, сколько заявил пользователь и у каждой свой прогресс ... в левом верхнем углу плиток
   галочка ... в правом столбце поля плиток будет отображаться информация по отдельным фрагментам").

   In a highlights project - its own timeline hl_<id> or a fragment's hl_<id>_<n> - the crumbs are "highlights / Library"
   (Library stays - music and B-roll for a fragment, the owner's (х15)); the view is one of lib-views.js's bases, as the
   scenarios view is, and it is what the project opens on. It holds:
     the top      the video, what is happening (the server's words, as the row in Alerts says them), the cross that
                  stops it (twice: "really?"), "retry" (one press when it costs nothing, two - "spend again?" - when it
                  does), and "select all";
     the tiles    vertical, as many as were asked for: until the agent has answered they all show the SAME way along -
                  downloading, hearing 12 / 73 min, finding the moments -, then one per moment found;
     the card     on the right: the moment pressed - its name, how complete its theme is (0-100), its length, the time of
                  each of its pieces in the video, the hook, why it would work, all its words; several ticked - how many.
   A project with no video yet shows "add video", which opens the popup (hl-popup.js) - as "+ new project -> highlights"
   does at once.

   The record is the server's (GET /api/highlights/:id): read when the project opens and every 1.5 s while it is at work
   (not while the window is hidden), and again when its row is retried in Alerts.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Views from './lib-views.js';
import { setOpenColumn, roomForWork } from './layout.js';
import { openPopup, closePopup } from './hl-popup.js';

const NAME = 'highlights';
const POLL_MS = 1500;
const $ = (id) => document.getElementById(id);
const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const KEY_RE = /^hl_([a-z0-9]+)(?:_(\d+))?$/;
/** The highlights project of a timeline's key: its id, or ''. */
export const projectOf = (key) => { const m = KEY_RE.exec(String(key || '')); return m ? m[1] : ''; };
/** The project's own timeline, for any of its keys ('' for a key of no highlights project). */
export const homeOf = (key) => { const id = projectOf(key); return id ? 'hl_' + id : ''; };

const _clock = (s) => {
  s = Math.max(0, +s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
};
const _secs = (s) => (Math.round((+s || 0) * 10) / 10) + ' s';

let _pid = '';                // the project shown
let _shown = false;
let _rec = null;              // its record, as the server last said it
let _prog = null;             // { step, words, pct, leftMs } while at work
let _live = false;
let _retry = '';              // the step a retry would go on with ('' - none)
let _retryFree = false;
let _sel = 0;                 // the fragment whose card shows (its n)
const _checked = new Set();   // the fragments ticked (their n)
let _timer = 0;
let _seq = 0;
let _armed = '';              // 'stop' | 'retry' - the button waiting for its second press
let _armT = 0;
let _ui = null;
let _err = '';

const _api = async (url, opt) => {
  let r = null, d = null;
  try { r = await fetch(url, opt); d = await r.json(); } catch (e) { d = null; }
  if (!r || !d || !d.success) throw new Error((d && d.error) || 'The app did not answer - try again in a moment.');
  return d;
};

// ── Where the view is ───────────────────────────────────────────────────────
function _onStore() {
  if (!Store.isReady()) return;
  const pid = projectOf(Store.key());
  Views.setHighlights(!!pid);
  const crumb = $('mv3-lib-hl');
  if (crumb) crumb.hidden = !pid;
  if (pid === _pid) return;
  // Another project: what was shown of the last one goes.
  _pid = pid;
  _rec = null; _prog = null; _live = false; _retry = ''; _sel = 0; _checked.clear(); _err = '';
  _stopPoll();
  closePopup();
  if (pid) { _show(true); _load(); }
  else if (_shown) _show(false);
}

function _show(on) {
  _shown = !!on;
  Views.setBase(NAME, _shown);
  if (_shown) { _build(); _paint(); }
}

export function initHighlights() {
  Views.registerChat(NAME, {
    root: 'mv3-hl', crumb: 'mv3-lib-hl',
    crumbTitle: 'The fragments of this video - and the card of the one pressed',
    onBack: () => _show(false), onYield: () => { _shown = false; }, onCrumb: () => { setOpenColumn('library'); _show(true); _load(); },
  });
  Store.onChange(_onStore);
  _onStore();
  // A row retried in Alerts: read again at once (alerts-bell.js).
  window.addEventListener('ugc:alert-retried', () => { if (_pid) _load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && _pid && _live && !_timer) _load(); });
}

/** "+ new project -> highlights": a new project, opened, and its popup at once. */
export async function createHighlights() {
  const d = await _api('/api/highlights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  await Store.open(d.key);
  roomForWork();
  setOpenColumn('library');
  _show(true);
  await _load();
  _popup();
}

// ── The record ──────────────────────────────────────────────────────────────
async function _load() {
  const pid = _pid;
  if (!pid) return;
  const seq = ++_seq;
  let d = null;
  try { d = await _api('/api/highlights/' + encodeURIComponent(pid)); _err = ''; }
  catch (e) { if (seq === _seq && pid === _pid) { _err = e.message; _paint(); } return; }
  if (seq !== _seq || pid !== _pid) return;
  _rec = d.project;
  _prog = d.progress || null;
  _live = !!d.live;
  _retry = d.retry || '';
  _retryFree = !!d.retryFree;
  // A moment gone (deleted, a new run) lets go of its card and its tick.
  const have = new Set((_rec.fragments || []).filter((f) => !f.deletedAt).map((f) => f.n));
  if (_sel && !have.has(_sel)) _sel = 0;
  for (const n of [..._checked]) if (!have.has(n)) _checked.delete(n);
  _paint();
  _stopPoll();
  if (_live) _timer = setTimeout(() => { _timer = 0; if (!document.hidden) _load(); }, POLL_MS);
}
function _stopPoll() { if (_timer) { clearTimeout(_timer); _timer = 0; } }

function _popup() {
  if (!_pid || !_rec) return;
  openPopup(_pid, _rec, { onStarted: () => { _load(); } });
}

// ── The view ────────────────────────────────────────────────────────────────
function _build() {
  if (_ui) return;
  const root = $('mv3-hl');
  if (!root) return;
  const top = _el('div', 'mv3-hl-top');
  const body = _el('div', 'mv3-hl-body');
  const field = _el('div', 'mv3-hl-field');
  const card = _el('div', 'mv3-hl-card');
  body.append(field, card);
  root.append(top, body);
  _ui = { root, top, field, card };
}

const _frags = () => ((_rec && _rec.fragments) || []).filter((f) => !f.deletedAt).sort((a, b) => (a.rank || 0) - (b.rank || 0));

function _arm(what) {
  _armed = what;
  if (_armT) clearTimeout(_armT);
  _armT = setTimeout(() => { _armed = ''; _armT = 0; _paintTop(); }, 3000);
  _paintTop();
}

function _paint() {
  if (!_ui || !_shown) return;
  _paintTop();
  _paintField();
  _paintCard();
}

const STEP = { download: 'downloading', copy: 'copying', hear: 'hearing', find: 'finding the moments', fragments: 'cutting' };

function _paintTop() {
  if (!_ui) return;
  const top = _ui.top;
  top.textContent = '';
  const r = _rec;
  const what = _el('div', 'mv3-hl-what');
  if (!r) { what.appendChild(_el('span', 'mv3-hl-note' + (_err ? ' is-err' : ''), _err || 'reading the project…')); top.appendChild(what); return; }
  const v = r.video;
  what.appendChild(_el('b', 'mv3-hl-title', v ? (v.title || 'the video') : 'no video yet'));
  if (v && v.seconds) what.appendChild(_el('span', 'mv3-hl-meta', _clock(v.seconds)));
  if (r.ask) what.appendChild(_el('span', 'mv3-hl-meta', (r.lengths && r.lengths[r.ask.length] ? r.lengths[r.ask.length].label : r.ask.length) + ' · ' + r.ask.count + ' asked'));
  top.appendChild(what);

  const state = _el('div', 'mv3-hl-state');
  const w = r.work || {};
  if (_live) {
    state.appendChild(_el('span', 'mv3-hl-words', _prog ? _prog.words : (STEP[w.step] || w.step || 'at work')));
    const x = _el('button', 'mv3-c-btn danger' + (_armed === 'stop' ? ' is-armed' : ''), _armed === 'stop' ? 'really?' : '✕ stop');
    x.type = 'button';
    x.title = 'Stop it - what was paid for is kept; a video not heard yet is let go of';
    x.addEventListener('click', () => { if (_armed !== 'stop') { _arm('stop'); return; } _armed = ''; _stop(); });
    state.appendChild(x);
  } else if (w.state === 'failed') {
    state.appendChild(_el('span', 'mv3-hl-words is-err', w.error === 'stopped' ? 'stopped' : (w.error || 'it failed')));
    if (_retry) {
      const armed = _armed === 'retry';
      const b = _el('button', 'mv3-c-btn' + (armed ? ' is-armed' : ''), armed ? 'spend again?' : 'retry');
      b.type = 'button';
      b.title = _retryFree ? 'Go on from where it stopped - nothing is paid for' : 'Go on from where it stopped - this step is paid for again';
      b.addEventListener('click', () => {
        if (!_retryFree && !armed) { _arm('retry'); return; }
        _armed = '';
        _retryNow();
      });
      state.appendChild(b);
    }
  } else if (w.state === 'done') {
    const n = _frags().length;
    const want = r.ask ? r.ask.count : n;
    state.appendChild(_el('span', 'mv3-hl-words', n >= want ? n + (n === 1 ? ' moment' : ' moments') : 'found ' + n + ' of ' + want));
  }
  if (!v && !_live) {
    const add = _el('button', 'mv3-c-btn mv3-hl-add', '+ add video');
    add.type = 'button';
    add.title = 'A link, a file, or a source of the Library - and how long and how many';
    add.addEventListener('click', _popup);
    state.appendChild(add);
  }
  const frags = _frags();
  if (frags.length) {
    const lab = _el('label', 'mv3-hl-all');
    const cb = _el('input');
    cb.type = 'checkbox';
    cb.checked = frags.every((f) => _checked.has(f.n));
    cb.indeterminate = !cb.checked && frags.some((f) => _checked.has(f.n));
    cb.addEventListener('change', () => {
      if (cb.checked) for (const f of frags) _checked.add(f.n); else _checked.clear();
      _paint();
    });
    lab.append(cb, document.createTextNode('select all'));
    state.appendChild(lab);
  }
  top.appendChild(state);
}

function _paintField() {
  const field = _ui.field;
  field.textContent = '';
  const r = _rec;
  if (!r) return;
  const frags = _frags();
  // No video yet: the field is the way in, and there is no card to show.
  _ui.root.classList.toggle('is-empty', !r.video && !_live);
  if (!r.video && !_live) {
    const empty = _el('div', 'mv3-hl-empty');
    empty.appendChild(_el('p', null, 'A long video in, vertical shorts out: the agent finds its best moments, and each becomes a fragment with its own timeline.'));
    const add = _el('button', 'mv3-c-btn mv3-hl-add is-big', '+ add video');
    add.type = 'button';
    add.addEventListener('click', _popup);
    empty.appendChild(add);
    field.appendChild(empty);
    return;
  }
  const grid = _el('div', 'mv3-hl-grid');
  if (!frags.length) {
    // Until the agent has answered no tile knows its moment: all of them show the same way along.
    const n = r.ask ? r.ask.count : 0;
    const failed = !_live && (r.work || {}).state === 'failed';
    for (let k = 0; k < n; k++) {
      const t = _el('div', 'mv3-hl-tile is-ph' + (failed ? ' is-failed' : ''));
      const fr = _el('div', 'mv3-hl-frame');
      if (r.poster) fr.style.backgroundImage = 'url("' + r.poster + '")';
      t.appendChild(fr);
      const foot = _el('div', 'mv3-hl-foot');
      if (_live && _prog) {
        const bar = _el('div', 'mv3-hl-bar');
        const fill = _el('div', 'mv3-hl-fill');
        fill.style.width = Math.round(Math.max(0.02, _prog.pct) * 100) + '%';
        bar.appendChild(fill);
        foot.appendChild(bar);
        foot.appendChild(_el('div', 'mv3-hl-step', _prog.words));
      } else foot.appendChild(_el('div', 'mv3-hl-step', failed ? 'not made' : 'waiting'));
      t.appendChild(foot);
      grid.appendChild(t);
    }
    field.appendChild(grid);
    return;
  }
  for (const f of frags) {
    const t = _el('div', 'mv3-hl-tile' + (_sel === f.n ? ' is-sel' : '') + (_checked.has(f.n) ? ' is-checked' : ''));
    t.title = f.title + '\nPress for its card';
    const fr = _el('div', 'mv3-hl-frame');
    const pic = f.thumb || r.poster;
    if (pic) fr.style.backgroundImage = 'url("' + pic + '")';
    t.appendChild(fr);
    const cb = _el('input', 'mv3-hl-check');
    cb.type = 'checkbox';
    cb.checked = _checked.has(f.n);
    cb.title = 'Tick it - for the captions of several and for rendering them together';
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => { if (cb.checked) _checked.add(f.n); else _checked.delete(f.n); _paint(); });
    t.appendChild(cb);
    t.appendChild(_el('span', 'mv3-hl-score', String(f.score)));
    if ((f.pieces || []).length > 1) t.appendChild(_el('span', 'mv3-hl-pieces', f.pieces.length + ' pieces'));
    const foot = _el('div', 'mv3-hl-foot');
    foot.appendChild(_el('div', 'mv3-hl-name', f.title));
    foot.appendChild(_el('div', 'mv3-hl-step', _secs(f.seconds)));
    t.appendChild(foot);
    t.addEventListener('click', () => { _sel = f.n; _paint(); });
    grid.appendChild(t);
  }
  field.appendChild(grid);
}

function _paintCard() {
  const card = _ui.card;
  card.textContent = '';
  const frags = _frags();
  if (_checked.size > 1) {
    card.appendChild(_el('div', 'mv3-hl-card-h', _checked.size + ' selected'));
    const ul = _el('ul', 'mv3-hl-list');
    for (const f of frags) if (_checked.has(f.n)) ul.appendChild(_el('li', null, f.title));
    card.appendChild(ul);
    card.appendChild(_el('p', 'mv3-hl-note', 'The style of their captions and rendering them together come with the next steps.'));
    return;
  }
  const f = frags.find((x) => x.n === _sel);
  if (!f) {
    card.appendChild(_el('p', 'mv3-hl-note', frags.length ? 'Press a tile to read its moment.' : (_live ? 'The moments come when the agent has read the video.' : '')));
    return;
  }
  card.appendChild(_el('div', 'mv3-hl-card-h', f.title));
  const facts = _el('div', 'mv3-hl-facts');
  const score = _el('span', 'mv3-hl-fact');
  score.appendChild(_el('b', null, String(f.score)));
  score.appendChild(document.createTextNode(' / 100 · how complete the theme is'));
  facts.appendChild(score);
  facts.appendChild(_el('span', 'mv3-hl-fact', _secs(f.seconds)));
  card.appendChild(facts);
  // Each piece, in the fragment's order, with its time in the video: a hook taken from later is said so.
  const pcs = _el('div', 'mv3-hl-pcs');
  (f.pieces || []).forEach((p, k) => {
    const later = k === 0 && (f.pieces || []).length > 1 && p.start > f.pieces[1].start;
    pcs.appendChild(_el('span', 'mv3-hl-pc' + (later ? ' is-hook' : ''), (later ? 'hook ' : '') + _clock(p.start) + '–' + _clock(p.end)));
  });
  card.appendChild(pcs);
  const sec = (label, text) => {
    if (!text) return;
    card.appendChild(_el('div', 'mv3-x-hdr', label));
    card.appendChild(_el('p', 'mv3-hl-text', text));
  };
  sec('hook', f.hook);
  sec('why it would work', f.why);
  sec('what is said', f.text);
}

// ── Stop and retry ──────────────────────────────────────────────────────────
async function _stop() {
  try { await _api('/api/highlights/' + encodeURIComponent(_pid) + '/stop', { method: 'POST' }); }
  catch (e) { _err = e.message; }
  _load();
}

async function _retryNow() {
  try { await _api('/api/highlights/' + encodeURIComponent(_pid) + '/retry', { method: 'POST' }); }
  catch (e) { _err = e.message; }
  _load();
}
