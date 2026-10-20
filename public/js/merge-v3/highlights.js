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
import * as Layers from '../layers.js';
import { presetName, presetStyle, editedKeys } from '../captions/preset-use.js';
import { setSubsStyle } from './timeline-b.js';
import { putTitle, titleLaneOf } from '../captions/title.js';

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
// The fragment whose timeline is open (its n), 0 for the project's own.
const _openN = () => { const m = KEY_RE.exec(String(Store.key() || '')); return m && m[2] ? Number(m[2]) : 0; };
let _openShown = 0;           // the open fragment the tiles were last drawn for

function _onStore() {
  if (!Store.isReady()) return;
  const pid = projectOf(Store.key());
  Views.setHighlights(!!pid);
  const crumb = $('mv3-lib-hl');
  if (crumb) crumb.hidden = !pid;
  if (pid === _pid) {
    // A fragment's timeline opened (its tile, a reload) or left: its tile is lit or not, and its card shows.
    const n = _openN();
    if (n !== _openShown) { _openShown = n; if (n) _sel = n; _paint(); }
    // (phase V33.3) The open fragment's captions given another look: its card says it at once.
    else if (n && n === _sel && _capSig() !== _capShown) _paintCard();
    _crumbs();
    return;
  }
  _openShown = _openN();
  // Another project: what was shown of the last one goes.
  _pid = pid;
  _rec = null; _prog = null; _live = false; _retry = ''; _sel = _openN(); _checked.clear(); _err = ''; _multi = false;
  _stopPoll();
  closePopup();
  if (pid) { _show(true); _load(); }
  else if (_shown) _show(false);
  _crumbs();
}

// ── The captions crumb (phase V33.3, the owner's (х33)) ─────────────────────
// "/ captions" shows in a highlights project while a fragment is open or ticked; what it opens is lib-views.js's and the
// inspector's, as in any project - the open fragment's subtitle lane picked.
function _crumbs() {
  const lib = $('mv3-library');
  if (lib) lib.classList.toggle('is-hl-cap', !!_pid && (_openN() > 0 || _ticked().length > 0));
  // The ticks changed under the captions of several: they follow (and go when none is ticked any more).
  const sig = _multi ? _ticked().map((f) => f.n + ':' + ((_capOfFrag(f) || {}).preset || '')).join(',') : '';
  if (sig !== _multiSig) { _multiSig = sig; Views.altChanged(); }
}
let _multiSig = '';

// The open fragment's caption style, from its timeline as it is now - { preset, name, edited }; the server says it for the
// others (GET /api/highlights/:id `cap`), read from theirs: the style lives in one place, the fragment's timeline.
function _capOpen() {
  const lane = (((Store.timeline() || {}).tracks) || []).find((t) => t && t.kind === 'subs');
  const st = (lane && lane.style) || {};
  const id = String(st.preset || '');
  const name = id ? presetName(id) : '';
  return name ? { preset: id, name, edited: editedKeys(st).length > 0 } : { preset: '', name: '', edited: false };
}
const _capSig = () => { const c = _capOpen(); return c.preset + '|' + c.edited + '|' + !!titleLaneOf(Store.timeline()); };
let _capShown = '';

// ── The captions of SEVERAL (phase V33.3, block 2; the owner's (х33), (х34)) ─
// Ticked fragments are what the captions crumb gives a style to - all at once, by the server on their timelines (they are
// not open), the open one among them too; with nothing ticked, or only the open one, it is the open fragment's lane, as in
// any project. No undo for several (х34): another style is another press.
let _multi = false;
const _ticked = () => _frags().filter((f) => _checked.has(f.n) && f.state === 'ready' && f.key);
const _multiWanted = () => !!_pid && _ticked().length > 0 && !(_checked.size === 1 && _checked.has(_openN()));
function _capOfFrag(f) { return f.n === _openN() ? _capOpen() : (f.cap || null); }
let _applying = false;
Views.captionsAlt({
  wants: _multiWanted,
  open: () => { _multi = true; },
  active: () => _multi && _multiWanted(),
  release: () => { _multi = false; },
  render: (host) => {
    const list = _ticked();
    host.appendChild(_el('div', 'mv3-ins-title', 'Captions of ' + list.length + (list.length === 1 ? ' fragment' : ' fragments')));
    const ul = _el('ul', 'mv3-hl-list');
    for (const f of list) {
      const c = _capOfFrag(f);
      const li = _el('li', null, f.title);
      if (c && c.name) li.appendChild(_el('span', 'mv3-hl-cap-of', ' · ' + c.name + (c.edited ? ' (edited)' : '')));
      ul.appendChild(li);
    }
    host.appendChild(ul);
    host.appendChild(_el('p', 'mv3-ins-note', _applying ? 'Putting the style on them…'
      : 'A preset pressed is put on all of them at once - their subtitle lanes, the heard lines cut again; lines typed or corrected stay. '
      + 'There is no undo for several: another style is another press. One fragment open and none ticked - its own lane, with all its settings.'));
    const ps = new Set(list.map((f) => { const c = _capOfFrag(f); return c ? c.preset : ''; }));
    return { preset: ps.size === 1 ? [...ps][0] : '', edited: false, apply: _restyle, readOnly: _applying };
  },
});

async function _restyle(presetId) {
  const list = _ticked();
  if (!list.length || _applying || !presetId) return;
  // The OPEN one among them is the page's: a tile on its lane, as anywhere (its save, its one step of the timeline's undo) - a
  // server's write under an open timeline reads to the page as somebody else's edit. The others are the server's.
  const open = list.find((f) => f.n === _openN());
  const rest = list.filter((f) => f !== open);
  if (open) {
    const lane = (((Store.timeline() || {}).tracks) || []).find((t) => t && t.kind === 'subs');
    const st = presetStyle(presetId);
    if (lane && st) setSubsStyle(lane.id, st, true);
  }
  if (!rest.length) { _say('captions: ' + (presetName(presetId) || presetId)); _paintCard(); Views.altChanged(); return; }
  _applying = true;
  Views.altChanged();
  try {
    const d = await _api('/api/highlights/' + encodeURIComponent(_pid) + '/style', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ns: rest.map((f) => f.n), preset: presetId }) });
    const n = d.n + (open ? 1 : 0);
    _say('captions of ' + n + (n === 1 ? ' fragment' : ' fragments') + ': ' + (d.name || presetId));
  } catch (e) { _say(e.message, true); }
  _applying = false;
  await _load();
  Views.altChanged();
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
    onBack: () => _show(false), onYield: () => { _shown = false; },
    // From the captions view too (phase V33.3): the captions let go of - the pick released - and the tiles are back.
    onCrumb: () => { Views.toBase(); setOpenColumn('library'); _show(true); _load(); },
  });
  Store.onChange(_onStore);
  _onStore();
  // A row retried in Alerts: read again at once (alerts-bell.js).
  window.addEventListener('ugc:alert-retried', () => { if (_pid) _load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && _pid && _live && !_timer) _load(); });
  // CTRL+Z IN THE FIELD brings the deleted fragments back, one by one, the last first (the owner's (х19а)) - "in the field":
  // the last press of the mouse was in this view. Anywhere else Ctrl+Z is the timeline's (bar.js): taken before it here, in
  // the capture phase, and only then.
  document.addEventListener('pointerdown', (e) => { const r = $('mv3-hl'); _inField = !!(r && r.contains(e.target)); }, true);
  document.addEventListener('keydown', (e) => {
    if (!_inField || !_shown || !_pid || Layers.blocked()) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    const key = String(e.key || '').toLowerCase();
    if (!(key === 'z' || (!/^[a-z]$/.test(key) && e.code === 'KeyZ'))) return;
    e.preventDefault();
    e.stopPropagation();
    _restore();
  }, true);
}
let _inField = false;

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
  _armT = setTimeout(() => { _armed = ''; _armT = 0; _paint(); }, 3000);
  _paint();
}

function _paint() {
  _crumbs();
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
    const found = (r.fragments || []).length;           // deleted ones too: what the agent found
    const want = r.ask ? r.ask.count : n;
    const made = _frags().filter((f) => f.state === 'ready').length;
    const what = made === n && n ? (n === 1 ? ' short' : ' shorts') : (n === 1 ? ' moment' : ' moments');
    state.appendChild(_el('span', 'mv3-hl-words', found >= want ? n + what : 'found ' + found + ' of ' + want));
  }
  const gone = ((r.fragments || []).filter((f) => f.deletedAt)).length;
  if (gone) state.appendChild(_el('span', 'mv3-hl-meta', gone + ' deleted - Ctrl+Z here brings back'));
  if (_said || _err) state.appendChild(_el('span', 'mv3-hl-said' + ((_said && _said.err) || (!_said && _err) ? ' is-err' : ''), _said ? _said.text : _err));
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
  const cutting = (_prog && _prog.fragments) || {};
  const open = _openN();
  for (const f of frags) {
    // Its own way along (block 3): waiting its turn, being cut, made - its first frame -, or not made.
    const ready = f.state === 'ready';
    const failed = f.state === 'failed';
    const now = cutting[f.n] || null;
    const t = _el('div', 'mv3-hl-tile' + (_sel === f.n ? ' is-sel' : '') + (open === f.n ? ' is-open' : '') + (_checked.has(f.n) ? ' is-checked' : '')
      + (ready ? ' is-ready' : ' is-making') + (failed ? ' is-failed' : ''));
    t.title = f.title + (ready ? '\nPress to open its timeline' : failed ? '\n' + (f.error || 'not made') : '\nBeing made - press for its card');
    const fr = _el('div', 'mv3-hl-frame');
    const pic = (ready && f.thumb) || r.poster;
    if (pic) fr.style.backgroundImage = 'url("' + pic + '")';
    t.appendChild(fr);
    const cb = _el('input', 'mv3-hl-check');
    cb.type = 'checkbox';
    cb.checked = _checked.has(f.n);
    cb.title = 'Tick it - for the captions of several and for rendering them together';
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => { if (cb.checked) _checked.add(f.n); else _checked.delete(f.n); _paint(); });
    t.appendChild(cb);
    // The cross in the corner, twice ("really?"): the fragment goes - Ctrl+Z in the field brings it back until the app
    // is started again (the owner's (х19), (х19а)).
    const armed = _armed === 'del' + f.n;
    const x = _el('button', 'mv3-hl-x' + (armed ? ' is-armed' : ''), armed ? 'really?' : '✕');
    x.type = 'button';
    x.title = 'Delete this fragment - Ctrl+Z here brings it back';
    x.addEventListener('click', (e) => { e.stopPropagation(); if (!armed) { _arm('del' + f.n); return; } _armed = ''; _delete(f); });
    t.appendChild(x);
    t.appendChild(_el('span', 'mv3-hl-score', String(f.score)));
    if ((f.pieces || []).length > 1) t.appendChild(_el('span', 'mv3-hl-pieces', f.pieces.length + ' pieces'));
    const foot = _el('div', 'mv3-hl-foot');
    foot.appendChild(_el('div', 'mv3-hl-name', f.title));
    if (!ready && now) {
      const bar = _el('div', 'mv3-hl-bar');
      const fill = _el('div', 'mv3-hl-fill');
      fill.style.width = Math.round(Math.max(0.02, now.pct || 0) * 100) + '%';
      bar.appendChild(fill);
      foot.appendChild(bar);
      foot.appendChild(_el('div', 'mv3-hl-step', now.words || 'cutting'));
    } else if (failed) {
      foot.appendChild(_el('div', 'mv3-hl-step is-err', 'not made' + (!_live && _retry ? ' - retry above' : '')));
    } else foot.appendChild(_el('div', 'mv3-hl-step', ready ? _secs(f.length || f.seconds) : (_live ? 'waiting its turn' : 'not cut yet')));
    t.appendChild(foot);
    t.addEventListener('click', () => {
      _sel = f.n;
      _paint();
      // Made: its timeline opens - the preview shows it, the timeline its cut (the owner: "кликнуть на него для просмотра
      // фрагмента в превью и отображения нарезки на таймлайне").
      if (ready && f.key && Store.key() !== f.key) Store.open(f.key).catch((e) => { _err = e.message; _paintTop(); });
    });
    grid.appendChild(t);
  }
  field.appendChild(grid);
}

function _paintCard() {
  const card = _ui.card;
  // The name being typed is not drawn over by the next read of the record.
  const a = document.activeElement;
  if (a && card.contains(a) && a.classList.contains('mv3-hl-card-name') && Number(card.dataset.n) === _sel) return;
  card.dataset.n = String(_sel || 0);
  card.textContent = '';
  const frags = _frags();
  if (_checked.size > 1) {
    card.appendChild(_el('div', 'mv3-hl-card-h', _checked.size + ' selected'));
    const ul = _el('ul', 'mv3-hl-list');
    for (const f of frags) if (_checked.has(f.n)) ul.appendChild(_el('li', null, f.title));
    card.appendChild(ul);
    card.appendChild(_el('p', 'mv3-hl-note', 'Their captions: the captions crumb above puts one style on all of them at once. Rendering them together comes with the next step.'));
    return;
  }
  const f = frags.find((x) => x.n === _sel);
  if (!f) {
    card.appendChild(_el('p', 'mv3-hl-note', frags.length ? 'Press a tile to read its moment.' : (_live ? 'The moments come when the agent has read the video.' : '')));
    return;
  }
  // Its name is edited here (the owner's (х20)): the card's, and its timeline's - the name of the render file after it.
  const name = _el('input', 'mv3-hl-card-h mv3-hl-card-name');
  name.type = 'text';
  name.value = f.title;
  name.maxLength = 80;
  name.title = 'The fragment\'s name - its timeline\'s and its render\'s. Enter to keep it, Escape to put it back.';
  let kept = false;
  const keep = () => { if (kept) return; kept = true; const v = name.value.trim(); if (v && v !== f.title) _rename(f, v); else name.value = f.title; };
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); keep(); name.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); kept = true; name.value = f.title; name.blur(); }
  });
  name.addEventListener('blur', keep);
  card.appendChild(name);
  if (f.state === 'failed' && f.error) card.appendChild(_el('p', 'mv3-hl-note is-err', 'Not made: ' + f.error));
  // (phase V33.2) Its faces could not be counted (no app window): framed from the middle - the clip's Framing switch can do it later.
  if (f.state === 'ready' && f.faceNote) card.appendChild(_el('p', 'mv3-hl-note', f.faceNote + ' - Framing on its clip can follow the face later.'));
  const facts = _el('div', 'mv3-hl-facts');
  const score = _el('span', 'mv3-hl-fact');
  score.appendChild(_el('b', null, String(f.score)));
  score.appendChild(document.createTextNode(' / 100 · how complete the theme is'));
  facts.appendChild(score);
  facts.appendChild(_el('span', 'mv3-hl-fact', _secs(f.seconds)));
  card.appendChild(facts);
  // (phase V33.3) The style its captions wear - the open one's as its timeline is now, the others' as the server read them.
  const cap = f.state !== 'ready' ? null : (f.n === _openN() ? _capOpen() : f.cap);
  _capShown = f.n === _openN() ? _capSig() : '';
  if (cap) {
    const line = _el('div', 'mv3-hl-cap');
    line.appendChild(document.createTextNode('captions: '));
    line.appendChild(_el('b', null, cap.name || 'a style of its own'));
    if (cap.name && cap.edited) line.appendChild(_el('span', 'mv3-hl-cap-ed', ' · edited'));
    line.title = f.n === _openN() ? 'Another style: the captions crumb above, or the subtitle lane on the timeline'
      : 'Open the fragment (press its tile) or tick it - then the captions crumb above gives it another style';
    card.appendChild(line);
    // (phase V33.3) The title on top (the owner's (х35)): said when it is there, "add title" when it is not - a fragment made before,
    // or with the popup's box taken off.
    const open = f.n === _openN();
    const lane = open ? titleLaneOf(Store.timeline()) : null;
    const titled = open ? !!lane : !!(f.cap && f.cap.titled);
    const tl = _el('div', 'mv3-hl-cap');
    if (titled) {
      tl.appendChild(document.createTextNode('title on top: '));
      const said = lane ? String(((lane.clips || []).find((c) => (+c.start || 0) < 0.05) || {}).name || '') : '';
      tl.appendChild(_el('b', null, said || 'yes'));
      tl.title = 'A text line at the top for the first seconds - edit, move or delete it on the timeline';
    } else {
      const add = _el('button', 'mv3-c-btn mv3-hl-addtitle', 'add title');
      add.type = 'button';
      add.title = 'Its headline at the top for the first three seconds: «' + (f.headline || f.title) + '»';
      add.addEventListener('click', () => _addTitle(f));
      tl.appendChild(add);
    }
    card.appendChild(tl);
  }
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

// ── The title on top added to a made fragment (phase V33.3) ────────────────
async function _addTitle(f) {
  const text = f.headline || f.title;
  if (f.n === _openN()) {
    // The open one is the page's: one step of its timeline's undo, its own save.
    let ok = false;
    Store.mutate((tl) => { ok = putTitle(tl, text, f.length || f.seconds, () => 'ht' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)); });
    // Ctrl+Z next is the timeline's - it takes the title away - not the field's, which brings back deleted fragments.
    if (ok) _inField = false;
    _say(ok ? 'the title is on top - Ctrl+Z takes it away' : 'it has a title already, or two text lanes', !ok);
    _paintCard();
    return;
  }
  try {
    await _api('/api/highlights/' + encodeURIComponent(_pid) + '/fragments/' + f.n + '/title-on-top', { method: 'POST' });
    _say('the title is on top of «' + f.title + '»');
  } catch (e) { _say(e.message, true); }
  _load();
}

// ── A fragment deleted, brought back, renamed ───────────────────────────────
async function _delete(f) {
  try {
    await _api('/api/highlights/' + encodeURIComponent(_pid) + '/fragments/' + f.n + '/delete', { method: 'POST' });
    // Its timeline open: the project's own takes its place.
    if (Store.key() === f.key) await Store.open('hl_' + _pid);
    if (_sel === f.n) _sel = 0;
    _checked.delete(f.n);
    _say('deleted «' + f.title + '» - Ctrl+Z here brings it back');
  } catch (e) { _say(e.message, true); }
  _load();
}

async function _restore() {
  try {
    const d = await _api('/api/highlights/' + encodeURIComponent(_pid) + '/fragments/restore',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    _say(d.n ? 'brought back' : 'nothing deleted to bring back');
    if (d.n) _sel = d.n;
  } catch (e) { _say(e.message, true); }
  _load();
}

async function _rename(f, title) {
  try {
    await _api('/api/highlights/' + encodeURIComponent(_pid) + '/fragments/' + f.n + '/title',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    // Its timeline open: the store's name follows (the picker shows the project, the strip and the render the fragment).
    if (Store.key() === f.key) Store.setTitle(title);
  } catch (e) { _say(e.message, true); }
  _load();
}

// A word in the top for a few seconds: what was just done, or why not.
let _said = null;
let _saidT = 0;
function _say(text, err) {
  _said = text ? { text, err: !!err } : null;
  if (_saidT) clearTimeout(_saidT);
  if (text) _saidT = setTimeout(() => { _said = null; _saidT = 0; _paintTop(); }, 5000);
  _paintTop();
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
