/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — A HIGHLIGHTS PROJECT's own view of the Library panel (phase V33.1; the owner 2026-10-20: "вместо крошек
   (scenarios / Library / generate image / generate video / captions) появляется одна крошка highligts ... в highlight
   поле отображается столько плиток, сколько заявил пользователь и у каждой свой прогресс ... в левом верхнем углу плиток
   галочка ... в правом столбце поля плиток будет отображаться информация по отдельным фрагментам").

   In a highlights project - its own timeline hl_<id> or a fragment's hl_<id>_<n> - the crumbs are "highlights / Library"
   (Library stays - music and B-roll for a fragment, the owner's (х15)) and, since phase V49 (the owner's (пр4)), "generate image /
   generate video / generate audio" - overlays for a fragment's lanes above main. The chats talk in ONE conversation per project
   (lib-views.js chatKey: a fragment's key is the home's), so pressing a tile never brings a chat forward over the tiles; with no
   fragment open their results are not laid on the home (chat-shell.js refuseHome). The view is one of lib-views.js's bases, as
   the scenarios view is, and it is what the project opens on. It holds:
     the top      the video, what is happening (the server's words, as the row in Alerts says them), the cross that
                  stops it (twice: "really?"), "retry" (one press when it costs nothing, two - "spend again?" - when it
                  does), and "select all";
     the panel    (phase V40) until the agent has answered, ONE panel the field's width: the way's steps as rows - ✓ done
                  with its size and time, ● going with the server's words, ○ to come -, one bar and "0:48 · ~3:10 left";
     the tiles    vertical, one per moment found, each with its own way along while it is cut;
     the card     on the right: the moment pressed - its name, how complete its theme is (0-100), its length, the time of
                  each of its pieces in the video, the hook, why it would work, all its words; several ticked - how many.
   A project with no video yet shows "add video", which opens the popup (hl-popup.js) - as "+ new project -> highlights"
   does at once.

   The record is the server's (GET /api/highlights/:id): read when the project opens and every 1.5 s while it is at work
   (not while the window is hidden), and again when its row is retried in Alerts.

   RENDERING THE TICKED (phase V33.4, the owner's (х38)-(х44)): the project bar's render button is this view's while a
   highlights project is open (export-b.js setRenderTarget) - "Render 3" for the ticked ones, dim while none is ticked, "✕
   stop" (twice: "really?") while any of the project's renders is in line; "select all" / "select none" left of it (the
   field has no box of its own). Its window is Export's, for N fragments (openMany); the server puts them in the render
   queue (lib/highlights-render.js). Each tile says where its render is - in line, rendering with its bar, interrupted
   ("go on in Queue"), failed with "render again" - and a rendered one wears "rendered" (pale "changed since" when its
   timeline was edited after) and lets go of its tick by itself; the top says "rendering 2 of 5 · ~1:30 left"; the card names the file and plays it.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Views from './lib-views.js';
import { setOpenColumn, roomForWork } from './layout.js';
import { openPopup, closePopup } from './hl-popup.js';
import * as Layers from '../layers.js';
import { presetName, presetStyle, editedKeys, keepMotion } from '../captions/preset-use.js';
import { LOOK_KEYS, mixOf, pairOf } from '../captions/style.js';
import { deal, newSeed } from '../captions/mix.js';
import { setSubsStyle } from './timeline-b.js';
import { putTitle, titleLaneOf } from '../captions/title.js';
import { setRenderTarget, paintExportButton, openMany } from './export-b.js';
import { showResult } from './render-result.js';

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
let _rStart = 0;              // (V33.4) when this page first saw the project's renders going - 0 when they are not
const _renderSeen = new Map(); // (V33.4) project -> Map(n -> its render's time as this page last saw it)

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
    // (phase V33.4) The open fragment edited after its render: "changed since" at once, as it is saved.
    if (n && _changedSig() !== _changedShown) _paint();
    _crumbs();
    return;
  }
  _openShown = _openN();
  // Another project: what was shown of the last one goes.
  _pid = pid;
  _rec = null; _prog = null; _live = false; _retry = ''; _stages = null; _sel = _openN(); _checked.clear(); _err = ''; _multi = false;
  _rStart = 0;
  _stopPoll();
  closePopup();
  // (phase V33.4) The project bar's render button is this view's while a highlights project is open.
  setRenderTarget(pid ? TARGET : null);
  _paintBar();
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
  // (V49) Other fragments ticked: what was picked with Shift for the ones before is let go.
  const ticks = _ticked().map((f) => f.n).join(',');
  if (ticks !== _tickSig) { _tickSig = ticks; _hlMix = []; _hlAnims = []; }
  if (sig !== _multiSig) { _multiSig = sig; Views.altChanged(); }
}
let _multiSig = '';
let _tickSig = '';

// The open fragment's caption style, from its timeline as it is now - { preset, name, edited }; the server says it for the
// others (GET /api/highlights/:id `cap`), read from theirs: the style lives in one place, the fragment's timeline.
function _capOpen() {
  const lane = (((Store.timeline() || {}).tracks) || []).find((t) => t && t.kind === 'subs');
  const st = (lane && lane.style) || {};
  const id = String(st.preset || '');
  // (V49) Several presets on its lane: their names, as the server says them for the others (highlights-cut.js capOf).
  const mix = mixOf(st);
  if (mix) return { preset: id, name: 'mix: ' + mix.map((e) => presetName(e.preset)).filter(Boolean).join(', '), edited: false };
  const name = id ? presetName(id) : '';
  return name ? { preset: id, name, edited: editedKeys(st).length > 0 } : { preset: '', name: '', edited: false };
}
const _capSig = () => { const c = _capOpen(); return c.preset + '|' + c.edited + '|' + !!titleLaneOf(Store.timeline()); };
let _capShown = '';

// ── The captions of SEVERAL (phase V33.3, block 2; the owner's (х33), (х34)) ─
// Ticked fragments are what the captions crumb gives a style to - all at once, by the server on their timelines (they are
// not open), the open one among them too; with nothing ticked, or only the open one, it is the open fragment's lane, as in
// any project. No undo for several (х34): another style is another press.
// (phase V49, the owner's (пр17), (пр21)) Shift picks several presets - every ticked fragment the same set, each its own deal page by
// page - and the "animation" tab puts a pair on them, or several with Shift. What was picked is kept while the same fragments stay
// ticked (_crumbs lets it go).
let _multi = false;
let _hlMix = [];
let _hlAnims = [];
const _toggle = (list, x, shift) => (!shift ? [x] : list.includes(x) ? list.filter((y) => y !== x) : list.concat([x]));
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
    return { preset: ps.size === 1 ? [...ps][0] : '', presets: _hlMix.length > 1 ? _hlMix.slice() : null, edited: false,
      apply: _restyle, readOnly: _applying, anims: _hlAnims.slice(), anim: _reanimate };
  },
});

// The open fragment's subtitle lane, and the ticked ones that are not open - the page's and the server's (see _restyle).
const _openLane = () => (((Store.timeline() || {}).tracks) || []).find((t) => t && t.kind === 'subs') || null;
async function _toServer(rest, open, body, said) {
  if (!rest.length) { _say(said); _paintCard(); Views.altChanged(); return; }
  _applying = true;
  Views.altChanged();
  try {
    const d = await _api('/api/highlights/' + encodeURIComponent(_pid) + '/style', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ ns: rest.map((f) => f.n) }, body)) });
    const n = d.n + (open ? 1 : 0);
    _say('captions of ' + n + (n === 1 ? ' fragment' : ' fragments') + ': ' + (d.name || said.replace(/^captions: /, '')));
  } catch (e) { _say(e.message, true); }
  _applying = false;
  await _load();
  Views.altChanged();
}

async function _restyle(presetId, o) {
  const list = _ticked();
  if (!list.length || _applying || !presetId) return;
  // (V49, (пр21)) Shift: the preset joins those picked, or leaves them; without Shift it alone.
  _hlMix = _toggle(_hlMix, presetId, !!(o && o.shift));
  if (!_hlMix.length) { Views.altChanged(); return; }
  const first = _hlMix[0];
  const many = _hlMix.length > 1;
  // The OPEN one among them is the page's: a tile on its lane, as anywhere (its save, its one step of the timeline's undo) - a
  // server's write under an open timeline reads to the page as somebody else's edit. The others are the server's.
  const open = list.find((f) => f.n === _openN());
  const rest = list.filter((f) => f !== open);
  if (open) {
    const lane = _openLane();
    const st = presetStyle(first);
    if (lane && st) {
      // (V49, (пр20)) Its In and Out stay; several presets are its lane's mix, dealt as it is cut again; one is one again.
      const look = (id) => { const p = presetStyle(id) || {}; const e = { preset: id }; for (const k of LOOK_KEYS) e[k] = p[k]; return e; };
      setSubsStyle(lane.id, Object.assign(keepMotion(st, lane.style || {}), many ? { mix: _hlMix.map(look), mixSeed: newSeed() } : { mix: [] }), true);
    }
  }
  await _toServer(rest, open, { preset: first, ...(many ? { mix: _hlMix.slice() } : {}) },
    'captions: ' + (many ? _hlMix.length + ' presets' : presetName(first) || first));
}

// (V49, (пр17)) A pair of In and Out on the ticked fragments - several with Shift, each its own deal; the lanes are not cut again.
async function _reanimate(pair, o) {
  const list = _ticked();
  if (!list.length || _applying || !pair) return;
  _hlAnims = _toggle(_hlAnims, pair, !!(o && o.shift));
  const open = list.find((f) => f.n === _openN());
  const rest = list.filter((f) => f !== open);
  if (open) {
    const lane = _openLane();
    const patch = _hlAnims.length >= 2 ? { anims: _hlAnims.slice(), mixSeed: newSeed() } : Object.assign(pairOf(_hlAnims[0] || 'at-once|none'), { anims: [] });
    if (lane) setSubsStyle(lane.id, patch, false, (t) => deal(t.clips, t.style));
  }
  await _toServer(rest, open, { anims: _hlAnims.length ? _hlAnims.slice() : ['at-once|none'] },
    'animation: ' + (_hlAnims.length > 1 ? _hlAnims.length + ' pairs' : _hlAnims[0] || 'none'));
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden && _pid && _busy() && !_timer) _load(); });
  // (phase V33.4) "select all" / "select none" in the project bar, left of the render button (the owner's (х38), (х38а)).
  const all = $('mv3-hl-all');
  if (all) all.addEventListener('click', () => {
    const frags = _frags();
    if (frags.length && frags.every((f) => _checked.has(f.n))) _checked.clear();
    else for (const f of frags) _checked.add(f.n);
    _paint();
  });
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

/** "+ new project -> highlights": a new project, opened, and its popup at once. `opts` (phase TG, block 5c): { url } written
 *  into the popup, `onStarted()` once the server took the press - a long video of REFERENCES sent "to highlights". */
export async function createHighlights(opts = {}) {
  const d = await _api('/api/highlights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  await Store.open(d.key);
  roomForWork();
  setOpenColumn('library');
  _show(true);
  await _load();
  _popup(opts);
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
  _stages = Array.isArray(d.stages) ? d.stages : null;
  // A moment gone (deleted, a new run) lets go of its card and its tick.
  const have = new Set((_rec.fragments || []).filter((f) => !f.deletedAt).map((f) => f.n));
  if (_sel && !have.has(_sel)) _sel = 0;
  for (const n of [..._checked]) if (!have.has(n)) _checked.delete(n);
  // (phase V33.4, the owner 2026-10-21) A fragment whose render has just been made lets go of its tick by itself: its render
  // is newer than the one this page last saw. One that failed or was stopped keeps it. The first read of a project only looks.
  const first = !_renderSeen.has(pid);
  if (first) _renderSeen.set(pid, new Map());
  const seen = _renderSeen.get(pid);
  for (const f of (_rec.fragments || [])) {
    const at = (f.rendered && f.rendered.at) || '';
    if (!first && at && seen.get(f.n) !== at) _checked.delete(f.n);
    seen.set(f.n, at);
  }
  // (phase V33.4) The project's renders: followed while they go; when they are over, how many were made is said.
  if (_rec.rendering && !_rStart) _rStart = Date.now();
  else if (!_rec.rendering && _rStart) {
    const made = _frags().filter((f) => f.rendered && Date.parse(f.rendered.at || '') >= _rStart - 5000).length;
    _rStart = 0;
    if (made && !_stoppedNow) _say(made + (made === 1 ? ' fragment rendered' : ' fragments rendered') + ' - Library -> Renders, or the card');
    _stoppedNow = false;
  }
  _paint();
  _stopPoll();
  if (_busy()) _timer = setTimeout(() => { _timer = 0; if (!document.hidden) _load(); }, POLL_MS);
}
function _stopPoll() { if (_timer) { clearTimeout(_timer); _timer = 0; } }
// At work - finding, cutting - or rendering: the record is read again on a beat.
const _busy = () => !!(_live || (_rec && _rec.rendering));
let _stoppedNow = false;

function _popup(opts = {}) {
  if (!_pid || !_rec) return;
  openPopup(_pid, _rec, { url: opts.url || '', sourceId: opts.sourceId || '', onStarted: (...a) => {
    _load();
    if (typeof opts.onStarted === 'function') { try { opts.onStarted(...a); } catch (e) { /* the caller's */ } }
  } });
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
// (V43) How many parts the video came to - a part deleted since keeps its number.
const _whole = () => !!(_rec && _rec.ask && _rec.kinds && _rec.kinds[_rec.ask.kind] && _rec.kinds[_rec.ask.kind].whole);
const _partsFound = () => (_rec && _rec.agent && +_rec.agent.found) || ((_rec && _rec.fragments) || []).length;

function _arm(what) {
  _armed = what;
  if (_armT) clearTimeout(_armT);
  _armT = setTimeout(() => { _armed = ''; _armT = 0; _paint(); }, 3000);
  _paint();
}

function _paint() {
  _crumbs();
  _paintBar();
  _changedShown = _changedSig();
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
  // (phase V33.6) And the kind of video, when one other than auto was chosen.
  // (phase V33.8) Auto - what the agent found the video to be.
  const kindSaid = r.ask && r.ask.kind && r.ask.kind !== 'auto' && r.kinds && r.kinds[r.ask.kind] ? ' · ' + r.kinds[r.ask.kind].label
    : (r.ask && r.agent && r.agent.kind ? ' · auto → ' + r.agent.kind : '');
  // (phase V33.8, H3) And the background music asked for.
  const nm = r.ask && Array.isArray(r.ask.music) ? r.ask.music.length : 0;
  const musicSaid = nm ? ' · music: ' + (nm === 1 ? r.ask.music[0].title : nm + ' tracks') : '';
  // (phase V43) fragmentation: its own lengths, no count - "1-2 min parts" - and what was cut out of the video.
  const K = r.ask && r.kinds ? r.kinds[r.ask.kind] : null;
  const L = (K && K.whole && K.lengths) || r.lengths;
  const lenSaid = L && r.ask && L[r.ask.length] ? L[r.ask.length].label : (r.ask ? r.ask.length : '');
  const cut = K && K.whole && r.agent && Array.isArray(r.agent.skipped) && r.agent.skipped.length
    ? ' · cut out: ' + [...new Set(r.agent.skipped.map((x) => x.skip))].join(', ') : '';
  if (r.ask) what.appendChild(_el('span', 'mv3-hl-meta', (K && K.whole ? lenSaid + ' parts' : lenSaid + ' · ' + r.ask.count + ' asked') + kindSaid + musicSaid + cut));
  top.appendChild(what);

  const state = _el('div', 'mv3-hl-state');
  const w = r.work || {};
  if (_live) {
    // (phase V40) Before the moments are found the field's panel says the way in full: here only what is going.
    const panel = !_frags().length;
    state.appendChild(_el('span', 'mv3-hl-words', _prog && !panel ? _prog.words
      : (STEP[(_prog && _prog.step) || w.step] || w.step || 'at work')));
    const x = _el('button', 'mv3-c-btn danger' + (_armed === 'stop' ? ' is-armed' : ''), _armed === 'stop' ? 'really?' : '✕ stop');
    x.type = 'button';
    x.title = 'Stop it - what was paid for is kept; a video not heard yet is let go of';
    x.addEventListener('click', () => { if (_armed !== 'stop') { _arm('stop'); return; } _armed = ''; _stop(); });
    state.appendChild(x);
  } else if (w.state === 'failed') {
    state.appendChild(_el('span', 'mv3-hl-words is-err', w.error === 'stopped' ? 'stopped' : (w.error || 'it failed')));
    // (phase V43, the owner's (ё17а)) Its video stays on the disk and was moved or deleted: pointed at again here (the same file -
    // its print says so - its words its own); deleting its source is the Library's (Scenarios -> its source).
    if (/not where it was/i.test(String(w.error || '')) && r.video && r.video.sourceId) state.appendChild(_relinkButton(r.video.sourceId));
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
    // (V43) fragmentation asked for no count: as many parts as the video came to.
    const want = r.ask && r.ask.count ? r.ask.count : found;
    const made = _frags().filter((f) => f.state === 'ready').length;
    const whole = !!(r.ask && r.kinds && r.kinds[r.ask.kind] && r.kinds[r.ask.kind].whole);
    const what = whole ? (n === 1 ? ' part' : ' parts') : made === n && n ? (n === 1 ? ' short' : ' shorts') : (n === 1 ? ' moment' : ' moments');
    state.appendChild(_el('span', 'mv3-hl-words', found >= want ? n + what : 'found ' + found + ' of ' + want));
  }
  // (phase V33.4) The project's renders: "rendering 2 of 5 · ~1:30 left"; what was cut off or failed, and where to go on.
  const rd = r.rendering;
  if (rd) {
    const k = Math.min(rd.of, rd.done + 1);
    state.appendChild(_el('span', 'mv3-hl-words', 'rendering ' + k + ' of ' + rd.of + (rd.left > 0 ? ' · ~' + _clock(rd.left) + ' left' : '')));
  }
  const tr = r.renderTrouble || {};
  if (tr.interrupted) state.appendChild(_el('span', 'mv3-hl-meta', tr.interrupted + ' interrupted - go on in Queue'));
  if (tr.failed) state.appendChild(_el('span', 'mv3-hl-meta is-err', tr.failed + ' not rendered'));
  // The project's renders folder, once one is made: Explorer on it (the owner's (х40)).
  const one = _frags().find((f) => f.rendered && f.rendered.url);
  const dir = one ? String(one.rendered.url).replace(/[^/]+$/, '') : '';
  const sf = dir ? _showInFolder(dir, 'Open the folder of this project\'s renders in Explorer') : null;
  if (sf) state.appendChild(sf);
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
  top.appendChild(state);
}

// ── The project bar: "select all" and the render button (phase V33.4) ───────
function _paintBar() {
  const all = $('mv3-hl-all');
  if (all) {
    const frags = _pid ? _frags() : [];
    all.hidden = !_pid;
    const every = frags.length > 0 && frags.every((f) => _checked.has(f.n));
    all.textContent = every ? 'select none' : 'select all';
    all.title = every ? 'Untick every fragment' : 'Tick every fragment - for the render beside, and for their captions';
    all.disabled = !frags.length;
  }
  paintExportButton();
}

// What the render button is in a highlights project (export-b.js setRenderTarget).
const TARGET = {
  state() {
    if (_rec && _rec.rendering) {
      const armed = _armed === 'rstop';
      return { label: armed ? 'really?' : '✕ stop', stop: true, armed, enabled: true,
        title: 'Stop rendering this project\'s fragments - all of them; the ones made stay' };
    }
    const n = _checked.size;
    return { label: n ? 'Render ' + n : 'Render', enabled: n > 0,
      title: n ? 'Render the ' + n + ' ticked ' + (n === 1 ? 'fragment' : 'fragments') + ' - one after another, with one set of settings'
        : 'Tick the fragments to render (or "select all" on the left)' };
  },
  click() {
    // "really?" pressed just as the last render ended: the press meant "stop", not a new render.
    if (_armed === 'rstop' && !(_rec && _rec.rendering)) { _armed = ''; _paint(); return; }
    if (_rec && _rec.rendering) {
      if (_armed !== 'rstop') { _arm('rstop'); return; }
      _armed = '';
      _stopRenders();
      return;
    }
    _renderTicked();
  },
};

// The ticked ones, with one set of settings - Export's window for N (the owner's (х39)).
function _renderTicked() {
  const pid = _pid;
  const list = _frags().filter((f) => _checked.has(f.n));
  if (!pid || !list.length) return;
  const secs = list.reduce((a, f) => a + (+(f.length || f.seconds) || 0), 0);
  openMany({
    count: list.length, seconds: secs, adv: (_rec && _rec.renderAdv) || null,
    go: async (adv) => {
      // The open one among them goes as it is on the screen: its last edits saved first.
      const open = list.find((f) => f.n === _openN());
      if (open) { try { await Store.flush(); } catch (e) { /* the server's copy is rendered */ } }
      try {
        const d = await _api('/api/highlights/' + encodeURIComponent(pid) + '/render', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ns: list.map((f) => f.n), adv }) });
        if (open && (d.queued || []).includes(open.n)) Store.setAdv(adv);
        const q = (d.queued || []).length;
        const sk = d.skipped || [];
        _say((q ? q + (q === 1 ? ' fragment' : ' fragments') + ' in line to render' : 'nothing to render')
          + (sk.length ? ' - left out: ' + sk.map((s) => '«' + s.title + '» (' + s.why + ')').join(', ') : ''), !q);
      } catch (e) { _say(e.message, true); }
      _rStart = 0;
      await _load();
      return null;
    },
  });
}

async function _stopRenders() {
  try {
    await _api('/api/highlights/' + encodeURIComponent(_pid) + '/render/stop', { method: 'POST' });
    _stoppedNow = true;
    _say('rendering stopped - the ones made stay');
  } catch (e) { _say(e.message, true); }
  _load();
}

// A failed render tried again - the same job, its settings (the queue's ↻).
async function _renderAgain(f) {
  const id = f.rq && f.rq.queueId;
  if (!id) return;
  try {
    const r = await fetch('/api/mv3q/retry/' + encodeURIComponent(id), { method: 'POST' });
    if (!r.ok) throw new Error('the queue did not take it back');
    _say('«' + f.title + '» in line again');
  } catch (e) { _say(e.message, true); }
  _load();
}

// Whether a fragment's render is behind its timeline: the server says it for every one; the OPEN one is the page's - its
// timeline's rev as the page last saved it (Store.version()) against the rev it was rendered at.
function _changed(f) {
  const rd = f && f.rendered;
  if (!rd) return false;
  if (f.n === _openN() && Store.version() >= 0) return Store.version() > (Number(rd.rev) || 0);
  return !!rd.changed;
}
const _changedSig = () => { const f = _frags().find((x) => x.n === _openN()); return f ? String(_changed(f)) : ''; };
let _changedShown = '';

const _hhmm = (iso) => {
  const d = new Date(iso || '');
  if (isNaN(d)) return '';
  const two = (n) => String(n).padStart(2, '0');
  const today = new Date().toDateString() === d.toDateString();
  return (today ? '' : d.getDate() + '.' + two(d.getMonth() + 1) + ' ') + two(d.getHours()) + ':' + two(d.getMinutes());
};
const _fileOf = (url) => { try { return decodeURIComponent(String(url).split('/').pop()); } catch (e) { return String(url).split('/').pop(); } };

function _paintField() {
  const field = _ui.field;
  field.textContent = '';
  const wasShown = _prepShown;
  _prepShown = false;
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
    // (phase V40, the owner 2026-10-24: "10 одинаковых плиток говорят только «ждите»") Until the agent has answered no tile knows
    // its moment: ONE panel the field's width says the way - its steps, one bar for the whole of it and the time. The moments
    // found, it goes and the tiles stand, each with its own way along.
    const stages = (_live && _prog && _prog.stages) || _stages;
    if (stages && stages.length) { field.appendChild(_prepPanel(stages, !wasShown)); _prepShown = true; }
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
    // (phase V43, (ё9)) fragmentation's parts have no score: their place in the video instead - "3 / 38".
    t.appendChild(_el('span', 'mv3-hl-score', Number.isFinite(f.score) ? String(f.score) : f.rank + ' / ' + _partsFound()));
    if ((f.pieces || []).length > 1) t.appendChild(_el('span', 'mv3-hl-pieces', f.pieces.length + ' pieces'));
    // (phase V33.4) Rendered: a mark on its frame - pale, "changed since", when its timeline was edited after.
    if (ready && f.rendered) {
      const ch = _changed(f);
      const mark = _el('span', 'mv3-hl-rendered' + (ch ? ' is-changed' : ''), ch ? 'changed since' : '▶ rendered');
      mark.title = 'Rendered: ' + _fileOf(f.rendered.url) + (ch ? ' - its timeline was edited after; Render again to bring it up to date' : '');
      t.appendChild(mark);
    }
    const foot = _el('div', 'mv3-hl-foot');
    foot.appendChild(_el('div', 'mv3-hl-name', f.title));
    const rq = ready ? f.rq : null;
    if (!ready && now) {
      const bar = _el('div', 'mv3-hl-bar');
      const fill = _el('div', 'mv3-hl-fill');
      fill.style.width = Math.round(Math.max(0.02, now.pct || 0) * 100) + '%';
      bar.appendChild(fill);
      foot.appendChild(bar);
      foot.appendChild(_el('div', 'mv3-hl-step', now.words || 'cutting'));
    } else if (failed) {
      foot.appendChild(_el('div', 'mv3-hl-step is-err', 'not made' + (!_live && _retry ? ' - retry above' : '')));
    } else if (rq && rq.state === 'running') {
      // (phase V33.4) Its render, where it is (the owner's (х42)).
      const bar = _el('div', 'mv3-hl-bar');
      const fill = _el('div', 'mv3-hl-fill is-render');
      fill.style.width = Math.max(2, rq.percent || 0) + '%';
      bar.appendChild(fill);
      foot.appendChild(bar);
      foot.appendChild(_el('div', 'mv3-hl-step', rq.phase ? 'finishing…'
        : 'rendering ' + (rq.percent || 0) + '%' + (rq.remain != null ? ' · ' + _clock(rq.remain) : '')));
    } else if (rq && rq.state === 'line') {
      foot.appendChild(_el('div', 'mv3-hl-step', 'in line · ' + (rq.ahead ? rq.ahead + ' ahead' : 'next')));
    } else if (rq && rq.state === 'interrupted') {
      foot.appendChild(_el('div', 'mv3-hl-step is-warn', 'interrupted - go on in Queue'));
    } else if (rq && rq.state === 'failed') {
      const st = _el('div', 'mv3-hl-step is-err', 'render failed');
      st.title = rq.error || '';
      foot.appendChild(st);
      const again = _el('button', 'mv3-hl-again', 'render again');
      again.type = 'button';
      again.title = (rq.error ? rq.error + '\n' : '') + 'Put it back in line with the same settings';
      again.addEventListener('click', (e) => { e.stopPropagation(); _renderAgain(f); });
      foot.appendChild(again);
    } else foot.appendChild(_el('div', 'mv3-hl-step', ready ? _secs(f.length || f.seconds) : (_live ? 'waiting its turn' : 'not cut yet')));
    t.appendChild(foot);
    t.addEventListener('click', () => {
      // (phase V33.4, the owner 2026-10-21: "повторный клик на плитку должен снимать выделение и отключать превью с этим фрагментом")
      // The tile pressed again lets go: no card, and its timeline gives way to the project's own, empty one - the preview stops
      // showing it. The ticks stay as they are.
      if (_sel === f.n) {
        _sel = 0;
        _paint();
        if (f.key && Store.key() === f.key) Store.open('hl_' + _pid).catch((e) => { _err = e.message; _paintTop(); });
        return;
      }
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

// THE PREPARATION PANEL (phase V40, the owner's (о5)): the way, a row a step - ✓ done (its size, its time), ● going (what it
// is doing now, the server's words), ○ still to come, ✕ where a run stopped -, ONE bar for the whole way and "0:48 · ~3:10
// left". It pops up once, not at every read of the record (the field is drawn again every 1.5 s).
let _prepShown = false;        // the panel was there at the last paint
let _stages = null;            // the steps as the record left them, while nothing is at work (GET /api/highlights/:id `stages`)
const _mb = (b) => (b >= 1e9 ? (Math.round(b / 1e8) / 10) + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB');
const _min = (s) => Math.max(1, Math.round((+s || 0) / 60)) + ' min';
function _stageSaid(s) {
  if (s.state === 'now' && _prog && _prog.words) return _prog.words;
  const done = s.state === 'done';
  switch (s.key) {
    case 'download': return done ? (s.had ? 'in the Library already' : 'downloaded' + (s.bytes ? ' ' + _mb(s.bytes) : '')) : 'downloading the video';
    case 'copy': return done ? 'copied' + (s.bytes ? ' ' + _mb(s.bytes) : '') : 'copying the video';
    case 'hear': return done ? (s.kept ? 'its words were in already' : 'heard' + (s.seconds ? ' ' + _min(s.seconds) : '')
      + (s.engine === 'local' ? ' on this computer' : s.engine === 'groq' ? ' by Groq' : '')) : 'hearing the words';
    case 'find': return _whole() ? (done ? 'split into parts' : 'splitting the video into parts') : (done ? 'moments found' : 'finding the moments');
    case 'fragments': return _whole() ? 'cutting the parts' : s.count ? 'cutting ' + s.count + (s.count === 1 ? ' fragment' : ' fragments') : 'cutting the fragments';
    default: return s.key;
  }
}
function _prepPanel(stages, fresh) {
  const live = !!(_live && _prog);
  const box = _el('div', 'mv3-hl-prep' + (fresh ? ' is-new' : ''));
  const list = _el('ol', 'mv3-hl-stages');
  for (const s of stages) {
    const li = _el('li', 'mv3-hl-stage is-' + s.state);
    li.appendChild(_el('i', 'mv3-hl-stage-m', s.state === 'done' ? '✓' : s.state === 'now' ? '●' : s.state === 'failed' ? '✕' : '○'));
    li.appendChild(_el('span', 'mv3-hl-stage-w', _stageSaid(s) + (s.state === 'failed' ? ' - stopped here' : '')));
    if (s.state === 'done' && s.took) li.appendChild(_el('span', 'mv3-hl-stage-t', _clock(s.took / 1000)));
    list.appendChild(li);
  }
  box.appendChild(list);
  if (live) {
    const bar = _el('div', 'mv3-hl-prep-bar');
    const fill = _el('i');
    fill.style.width = Math.max(1, Math.round((+_prog.pct || 0) * 1000) / 10) + '%';
    bar.appendChild(fill);
    box.appendChild(bar);
    const left = +_prog.leftMs || 0;
    box.appendChild(_el('div', 'mv3-hl-prep-t', _clock((+_prog.elapsedMs || 0) / 1000) + (left > 1500 ? ' · ~' + _clock(left / 1000) + ' left' : '')));
  }
  return box;
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
    card.appendChild(_el('p', 'mv3-hl-note', 'Their captions: the captions crumb above puts one style on all of them at once. '
      + 'Rendering them: Render on the right of the project bar - one after another, with one set of settings.'));
    return;
  }
  const f = frags.find((x) => x.n === _sel);
  if (!f) {
    card.appendChild(_el('p', 'mv3-hl-note', frags.length ? (_whole() ? 'Press a tile to read its part.' : 'Press a tile to read its moment.') : (_live ? (_whole() ? 'The parts come when the agent has read the video.' : 'The moments come when the agent has read the video.') : '')));
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
  if (Number.isFinite(f.score)) {
    score.appendChild(_el('b', null, String(f.score)));
    score.appendChild(document.createTextNode(' / 100 · how complete the theme is'));
  } else {
    // (phase V43, (ё9)) A part of fragmentation: no score - its place in the video and its key moments (where it punches in).
    score.appendChild(_el('b', null, 'part ' + f.rank + ' of ' + _partsFound()));
    const k = (f.keys || []).length;
    if (k) score.appendChild(document.createTextNode(' · ' + k + (k === 1 ? ' key moment' : ' key moments')));
  }
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
    // (phase V33.3) The title on top (the owner's (х35)): said when it is there, "add title" when it is not - since V40 (the owner's
    // (о4)) a new fragment has none: this button is the way to put the agent's headline on top.
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
  // (phase V33.8, H3) Its background music - the track dealt to it, on "audio 2"; or why it was made without.
  if (f.music) {
    const ml = _el('div', 'mv3-hl-cap');
    ml.appendChild(document.createTextNode('music: '));
    ml.appendChild(_el('b', null, f.music.title || 'a track'));
    if (f.state === 'ready' && f.musicNote) ml.appendChild(_el('span', 'mv3-hl-cap-ed', ' · ' + f.musicNote));
    ml.title = 'On the "audio 2" lane, quiet, from the part of the track where it has opened up - move, trim or delete it on the timeline';
    card.appendChild(ml);
  }
  // (phase V33.4) Its render: the file, how long, when; "▶ play" opens it in the result window (as the queue's "open").
  if (f.state === 'ready') card.appendChild(_renderLine(f));
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

// "show in folder" (phase V33.4, the owner's (х40)): Explorer on a library file or folder - only in the app's window
// (desktop/preload.js reveal); a browser has none, and no button.
function _showInFolder(url, title) {
  const w = window.ugcWindow;
  if (!url || !w || typeof w.reveal !== 'function') return null;
  const b = _el('button', 'mv3-c-btn', 'show in folder');
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', async () => {
    let ok = false;
    try { ok = await w.reveal(url); } catch (e) { ok = false; }
    if (!ok) _say('that file is not in the library any more', true);
  });
  return b;
}

// The card's line about the fragment's render (phase V33.4, the owner's (х42)).
function _renderLine(f) {
  const line = _el('div', 'mv3-hl-cap mv3-hl-rline');
  const rd = f.rendered;
  const rq = f.rq;
  if (rd) {
    line.appendChild(document.createTextNode('render: '));
    const name = _el('b', null, _fileOf(rd.url));
    name.title = rd.url;
    line.appendChild(name);
    const bits = [rd.seconds ? _secs(rd.seconds) : '', _hhmm(rd.at), rd.srt ? '+ .srt' : ''].filter(Boolean);
    if (bits.length) line.appendChild(_el('span', 'mv3-hl-cap-of', ' · ' + bits.join(' · ')));
    if (_changed(f)) {
      const ch = _el('span', 'mv3-hl-cap-ed', ' · changed since');
      ch.title = 'Its timeline was edited after the render - tick it and Render again';
      line.appendChild(ch);
    }
    const acts = _el('div', 'mv3-hl-racts');
    const play = _el('button', 'mv3-c-btn', '▶ play');
    play.type = 'button';
    play.title = 'Play the render - the result window, as Queue opens it';
    play.addEventListener('click', () => showResult({ url: rd.url, title: f.title, key: f.key, fresh: false }));
    acts.appendChild(play);
    const shown = _showInFolder(rd.url, 'Show this file in its folder - Explorer, the file picked');
    if (shown) acts.appendChild(shown);
    line.appendChild(acts);
  } else {
    line.appendChild(document.createTextNode('render: '));
    line.appendChild(_el('span', null, !rq ? 'not yet - tick it and Render'
      : rq.state === 'running' ? 'rendering ' + (rq.percent || 0) + '%'
      : rq.state === 'line' ? 'in line' + (rq.ahead ? ' · ' + rq.ahead + ' ahead' : ' · next')
      : rq.state === 'interrupted' ? 'interrupted - go on in Queue'
      : 'failed' + (rq.error ? ': ' + rq.error : '')));
  }
  return line;
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

// (phase V43, (ё17а)) "point at the file…": the video of a source that stays on the disk, moved - the app's window hands the
// file's path over (desktop/preload.js pathOf), the server checks it is the same video (its print) and the work goes on.
function _relinkButton(sourceId) {
  const b = _el('button', 'mv3-c-btn', 'point at the file…');
  b.type = 'button';
  b.title = 'The video was moved or renamed: show where it is now - the same file, its words are kept';
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'video/*';
  inp.hidden = true;
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0];
    const pathOf = window.ugcWindow && window.ugcWindow.pathOf;
    let where = '';
    try { where = f && typeof pathOf === 'function' ? String(pathOf(f) || '') : ''; } catch (e) { where = ''; }
    if (!where) { _err = 'Pointing at a file works in the app\'s own window - it hands the file over.'; _paintTop(); return; }
    try {
      await _api('/api/sources/' + encodeURIComponent(sourceId) + '/relink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: where }) });
      _err = '';
      await _retryNow();
    } catch (e) { _err = e.message; _paintTop(); }
  });
  b.addEventListener('click', () => inp.click());
  const wrap = _el('span', null);
  wrap.append(b, inp);
  return wrap;
}
