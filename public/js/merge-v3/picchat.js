/* ════════════════════════════════════════════════════════════════════════════
   MERGE — making pictures, as a conversation, IN THE LIBRARY PANEL (phase J, the owner 2026-10-02).

   It used to be a window over the whole page. Now the Library panel has two views: the shelf, and this
   chat - "LIBRARY / generate image" in the panel's header, a press on "Library" back to the shelf, and
   while the open project has a conversation a pale "/ generate image" beside the title on the shelf,
   back to it in one press. Which view a project was left on is remembered per project; so is what was
   being written and attached, so leaving for the shelf, another project or a reload loses nothing.

   ── Why a thread and not a form ─────────────────────────────────────────────
   Making pictures is iterative. You say a thing, look at it, then say "the same but at night" - and the
   second sentence only means anything because the first one is still there. The conversation belongs
   to the PROJECT (data/mv3-chat.json, the pictures in data/mv3-gens.json and on the Images shelf).

   ── The server sends ────────────────────────────────────────────────────────
   A press is one request (`POST /api/mv3/img/send`): the server writes the person's turn, a record and
   an Alerts row for every picture asked for and the turn that answers - and then the analyst, the
   hosting and the asking go on behind it, the rows saying which in words. This page only READS the
   thread: every countdown is drawn from its record's real age, so it survives leaving and reloading,
   and its cross lets go of the row. Up to five messages are drawn at once per project.

   ── The attachment row is the whole of the rule ─────────────────────────────
   Whatever sits above the input goes as a reference. A picture that lands is put there automatically -
   the next thing anybody says is about it - unless the row was changed by hand since the message was
   sent; visibly, with a number and a cross.

   ── The layout ──────────────────────────────────────────────────────────────
   Three columns when the panel is wide: what to make it WITH (model, quality, shape, price), the
   conversation, and a narrow column of everything to point at (this project's pictures, or any Images
   category) behind a sash. Narrower than 700px, the settings fold into one row above the input.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { setOpenColumn, panelRoom } from './layout.js';
import { startInlineProgress } from '../progress.js';
import { openViewer } from '../library/viewer.js';
import { askDelete, closeAsk, note } from './ask.js';

const POLL_MS = 4000;
const IDLE_MS = 20000;             // nothing running: an eye on what Alerts may start again
const MAX_ATTS = 5;
const NARROW = 700;
// Only the first guess. startInlineProgress keeps a running average per key, so each model learns its
// own pace after one picture - and they differ by a factor of ten.
const ETA_MS = 40000;
const LS_LAST = 'mv3-imagen-last';       // the model choice - the key the window this replaced used
const LS_VIEW = 'mv3_pc_view_v1';        // { projectKey: 'chat' } - which view each project was left on
const LS_DRAFT = 'mv3_pc_draft_v1';      // { projectKey: { text, atts } }
const LS_WRITE = 'mv3_pc_write_v1';
const LS_STRIP = 'mv3-ig-strip-w';
const STRIP_DEF = 170, STRIP_MIN = 110, STRIP_MAX = 520;

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const thumbOf = (p, v) => '/api/thumb?src=' + encodeURIComponent(p) + '&v=' + (v || 'strip');
const money = (v) => '$' + (+(+v).toFixed(4));
const ratioOf = (ar) => {
  const p = String(ar || '9:16').split(':');
  return (+p[0] || 1) / (+p[1] || 1);
};
// A library record carries its size; without one a square is wrong by less than anything else.
function arOf(i) {
  const w = +(i.w || (i.meta || {}).w || 0);
  const h = +(i.h || (i.meta || {}).h || 0);
  return (w > 0 && h > 0) ? (w + ':' + h) : '1:1';
}
const _json = (url, opts) => fetch(url, opts).then(r => r.json()).catch(() => null);
const _store = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || '') || fb; } catch (e) { return fb; } };
const _keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };

// ── State ───────────────────────────────────────────────────────────────────
let _ui = null;            // the chat, built the first time it is shown
let _table = null;         // the model table, once per page
let _tableErr = '';
let _set = null;           // the settings' own controls
let _chat = false;         // the panel shows the chat
let _key = null;           // whose conversation this is - '' before a project exists
let _thread = [];
let _feed = [];            // the right column
let _cat = '';             // its category; '' = this project's pictures
let _timer = 0;
let _seq = 0;
let _sending = false;
let _n = 1;
let _write = _store(LS_WRITE, true) !== false;
let _atts = [];            // [{ path, name }]
let _attSeq = 0;           // moves whenever the row is changed by hand
const _sendSeq = new Map();   // a send -> the row as it was at the press
let _pending = new Set();     // pictures still being made at the last read
let _landedNow = new Set();   // ...and those that landed since the read before it
const _nodes = new Map();     // message id -> { el, sig, progs: Map(genId -> countdown), away }
let _talk = false;            // the open project has a conversation (the pale crumb)
let _adopt = false;           // a project is being made for a send from "no project"
let _draftT = 0;
// Per project, what "the result becomes the reference" needs across a trip to another project: the
// pictures still being made at the last read there, and the row's hand-change counter.
const _memo = new Map();
let _uploading = null;        // the upload in flight - a send waits for it
let _made = false;            // something landed or was added while the chat showed - the shelf reads again

// ── The two views ───────────────────────────────────────────────────────────
export const isChat = () => _chat;

/** Every way in: the generate menu, "+" on the Images shelf, the lane's right-click, ?open=pictures. */
export async function openPictures() {
  setOpenColumn('library');
  await _show(true);
}

/** Back to the shelf - when the Library is asked to show something on it. */
export function showShelf() {
  if (_chat) _show(false);
}

async function _show(on) {
  _chat = !!on;
  const views = _store(LS_VIEW, {});
  if (_chat) views[_key || ''] = 'chat'; else delete views[_key || ''];
  _keep(LS_VIEW, views);
  _paintHead();
  if (!_chat) {
    _stop();
    peekHide();
    // The arrangement there was before the chat (phase J7).
    panelRoom(false);
    for (const n of _nodes.values()) n.away = true;
    // The shelf was read before the chat came forward: what was made or added since is not on it yet.
    if (_made) { _made = false; window.dispatchEvent(new CustomEvent('mv3:lib-reload')); }
    return;
  }
  _build();
  // The corner goes as far left and down as it can (phase J7, the owner). A frame later: a talking head
  // taken to its timeline step lays the page out on the next frame (workshop.js, roomForTimeline), and
  // the chat's room comes after that, not before.
  requestAnimationFrame(() => { if (_chat) panelRoom(true); });
  _fit();
  _loadTable();
  _loadCats();
  await _reload(true);
  if (_chat && _ui) _ui.ta.focus();
}

function _paintHead() {
  const panel = $('mv3-library');
  if (panel) panel.classList.toggle('is-chat', _chat);
  const t = $('mv3-lib-title');
  if (t) {
    t.classList.toggle('is-link', _chat);
    t.title = _chat ? 'Back to the Library' : '';
  }
  const g = $('mv3-lib-gen');
  if (g) {
    g.hidden = !(_chat || _talk);
    g.classList.toggle('is-on', _chat);
    g.title = _chat ? '' : 'Back to the conversation about pictures';
  }
  const h = $('mv3-pc-head');
  if (h) h.hidden = !_chat;
}

// ── The project the conversation belongs to ────────────────────────────────
function _onStore() {
  // Not before the store has read what is open: "nothing yet" is not "no project".
  if (!Store.isReady()) return;
  const k = Store.key() || '';
  if (_ui) _ui.stripP.textContent = Store.title() || (k ? k : 'no project');
  if (k === _key) return;
  const was = _key;
  if (was !== null) {
    _saveDraft(was);
    _memo.set(was, { pending: _pending, attSeq: _attSeq });
  }
  // A send from "no project" made this project: what was being written comes along, and so does the chat.
  const adopt = _adopt && was === '';
  _adopt = false;
  if (adopt) {
    const d = _store(LS_DRAFT, {});
    if (d['']) { d[k] = d['']; delete d['']; _keep(LS_DRAFT, d); }
  }
  _key = k;
  _thread = [];
  const m = _memo.get(k);
  _pending = m ? m.pending : new Set();
  for (const n of _nodes.values()) { _dropProgs(n, false); n.el.remove(); }
  _nodes.clear();
  if (_ui) { const e = _ui.thread.querySelector('.mv3-ig-empty'); if (e) e.remove(); }
  _loadDraft(k, m);
  _talk = false;
  // The project's own shape is the dot among the shapes.
  if (_set) { _set.fmt = (Store.timeline() || {}).format || '9:16'; _paintAspects(); }
  // This project's pictures are another project's; a category of Images is the same whatever is open.
  if (!_cat) _feed = [];
  else if (_chat) _loadStrip();
  const want = adopt || (_store(LS_VIEW, {})[k] === 'chat');
  if (adopt) { const v = _store(LS_VIEW, {}); v[k] = 'chat'; delete v['']; _keep(LS_VIEW, v); }
  if (want !== _chat) _show(want);
  else if (_chat) _reload(true);
  // Left on a chat by an earlier visit that never came back to the shelf: the arrangement is put back.
  else panelRoom(false);
  if (!_chat) _probeTalk(k);
  _paintHead();
}

// Whether the project has anything to come back to - the pale "/ generate image" on the shelf.
async function _probeTalk(k) {
  if (!k) { _talk = false; _paintHead(); return; }
  const d = await _json('/api/mv3/chat?project=' + encodeURIComponent(k) + '&kind=image');
  if (k !== _key) return;
  _talk = !!(d && d.success && (d.items || []).length);
  _paintHead();
}

// A message from "no project" starts one, named for the day - the person came to make a picture, and a
// dialog about naming things is not what they came for.
async function _ensureProject() {
  if (Store.key()) return;
  const today = new Date().toISOString().slice(0, 10);
  let d = null;
  for (let n = 1; n <= 40 && !(d && d.success); n++) {
    d = await _json('/api/mv3/timeline/new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: today + ' - untitled' + (n > 1 ? ' ' + n : ''), kind: Store.BLANK_KIND }),
    });
    if (d && !d.success && !/already exists/i.test(String(d.error || ''))) break;
  }
  if (!d || !d.success) throw new Error((d && d.error) || 'could not start a project for this');
  await Store.open(d.key);
}

// ── What was being written, per project ─────────────────────────────────────
function _saveDraft(k) {
  const d = _store(LS_DRAFT, {});
  const text = _ui ? _ui.ta.value : ((d[k] || {}).text || '');
  if (text.trim() || _atts.length) d[k] = { text, atts: _atts.slice(0, MAX_ATTS) };
  else delete d[k];
  _keep(LS_DRAFT, d);
}
function _draftLater() {
  clearTimeout(_draftT);
  _draftT = setTimeout(() => _saveDraft(_key || ''), 600);
}
function _loadDraft(k, memo) {
  const d = _store(LS_DRAFT, {})[k] || {};
  _atts = (Array.isArray(d.atts) ? d.atts : []).filter(a => a && a.path).slice(0, MAX_ATTS);
  // The row as it was left there is not a change by hand: the counter comes back with it.
  _attSeq = memo ? memo.attSeq : _attSeq + 1;
  if (_ui) {
    _ui.ta.value = String(d.text || '');
    _grow();
    _paintAtts();
  }
}

// ── The model table, read through the current choice ───────────────────────
async function _loadTable() {
  if (_table) { _paintSet(); return; }
  const d = await _json('/api/mv3/img/matrix');
  if (d && d.success) { _table = d; _tableErr = ''; }
  else _tableErr = (d && d.error) || 'could not read the model table';
  _paintSet();
  _paintAtts();
}

const _engine = () => (_table.engines.find(e => e.id === (_set && _set.eng.value)) || _table.engines[0]);

// Who can serve this model, at this quality, with this many references - all three are per pairing.
function _rungs(e, q, n) {
  return (e.rows || []).filter(r => (n ? (r.i2i && r.maxRefs >= n) : r.t2i) && (r.tiers || e.tiers).includes(q));
}
function _houses(e, n) {
  return (e.rows || []).filter(r => (n ? (r.i2i && r.maxRefs >= n) : r.t2i));
}
const _usable = (n) => _table.engines.filter(e => e.tiers.some(t => _rungs(e, t, n).length));
// THE PAIRING THAT WILL ACTUALLY RUN: the aggregator named, or the first that can do the job.
function _rowOf(e, n) {
  const can = _houses(e, n);
  return can.find(r => r.provider === (_set && _set.prov.value)) || can[0] || null;
}
const _dir = (n) => (n ? 'i2i' : 't2i');

// One kind, and how many is the PAIRING's business: kie takes five pictures for grok, Replicate one.
function _room() {
  if (!_table || !_table.engines.length) return MAX_ATTS;
  const e = _engine();
  const rows = (e.rows || []).filter(r => r.i2i);
  const mine = rows.find(r => r.provider === (_set && _set.prov.value));
  const most = (mine ? mine.maxRefs : Math.max(1, ...rows.map(r => r.maxRefs || 1))) || 0;
  return Math.min(MAX_ATTS, most);
}

function _paintSet() {
  if (!_ui) return;
  const host = _ui.left;
  if (!_table || !_table.engines.length) {
    host.textContent = '';
    host.appendChild(el('div', 'mv3-ig-fall', _tableErr || (_table ? 'No picture model is available - check the API keys in Admin.' : 'reading the models…')));
    _set = null;
    return;
  }
  if (!_set) {
    host.textContent = '';
    const last = _store(LS_LAST, {});
    const tl = Store.timeline();
    const row = (label, ctl, cls) => {
      const r = el('div', 'mv3-ig-row' + (cls ? ' ' + cls : ''));
      const l = el('label', null, label);
      l.htmlFor = ctl.id;
      r.append(l, ctl);
      host.appendChild(r);
    };
    const prov = document.createElement('select');
    prov.id = 'mv3-pc-prov';
    prov.title = 'Who is asked';
    row('aggregator', prov, 'is-prov');
    const eng = document.createElement('select');
    eng.id = 'mv3-pc-eng';
    eng.title = 'The model';
    row('model', eng);
    const q = document.createElement('select');
    q.id = 'mv3-pc-q';
    q.title = 'Quality';
    row('quality', q);
    // The shape twice: buttons in the wide column, a dropdown in the folded row (the owner's answer 3).
    const arSel = document.createElement('select');
    arSel.id = 'mv3-pc-ar';
    arSel.title = 'Shape';
    row('shape', arSel, 'is-arsel');
    host.appendChild(el('div', 'mv3-ig-sep', 'shape'));
    const arWrap = el('div', 'mv3-ig-ar-row');
    host.appendChild(arWrap);
    const cost = el('div', 'mv3-ig-cost');
    host.appendChild(cost);
    const fall = el('div', 'mv3-ig-fall');
    host.appendChild(fall);
    const fmt = (tl && tl.format) || '9:16';
    // Last time's choice is what the empty lists are filled towards the first time (a select with no
    // options cannot hold a value, so it is kept here until they exist).
    _set = { prov, eng, q, arSel, arWrap, cost, fall, fmt, ar: _table.aspects.includes(last.aspect) ? last.aspect : fmt,
             want: { provider: last.provider || '', engine: last.engine || '', quality: last.quality || '' } };
    // The whole chat, not just this column: the pairing decides how many references fit.
    prov.addEventListener('change', () => { _paintEngines(); _paintAtts(); });
    eng.addEventListener('change', () => { _paintEngines(); _paintAtts(); });
    q.addEventListener('change', _paintPrice);
    arSel.addEventListener('change', () => { _set.ar = arSel.value; _paintAspects(); _paintPrice(); });
    _paintAspects();
  }
  _paintEngines();
}

function _paintEngines() {
  if (!_set) return;
  const n = _atts.length;
  const had = _set.eng.value;
  const want = had || _set.want.engine;
  const list = _usable(n).slice().sort((a, b) => a.label.localeCompare(b.label));
  _set.eng.innerHTML = '';
  for (const e of list) {
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.label + ' · ' + _dir(n);
    o.selected = e.id === want;
    _set.eng.appendChild(o);
  }
  // The chosen one cannot take what is attached: SAID, rather than swapped silently.
  if (want && !list.some(e => e.id === want)) {
    const was = (_table.engines.find(e => e.id === want) || {}).label || want;
    _set.eng.value = (list[0] || {}).id || '';
    if (had) _say(was + ' cannot take ' + n + (n === 1 ? ' reference' : ' references') + ' — using ' + ((list[0] || {}).label || 'nothing'));
  }
  _paintProviders();
  _paintQuality();
  _set.want = {};                 // remembered choice used once, on the first fill
}

function _paintProviders() {
  const e = _engine();
  const can = _houses(e, _atts.length);
  const want = _set.prov.value || _set.want.provider;
  _set.prov.innerHTML = '';
  for (const r of can) {
    const o = document.createElement('option');
    o.value = r.provider; o.textContent = r.label;
    o.selected = r.provider === want;
    _set.prov.appendChild(o);
  }
  if (want && !can.some(r => r.provider === want) && can.length) _set.prov.value = can[0].provider;
  _set.prov.disabled = can.length < 2;
}

function _paintQuality() {
  const e = _engine();
  const want = _set.q.value || _set.want.quality;
  const row = _rowOf(e, _atts.length);
  const tiers = (row && row.tiers && row.tiers.length) ? row.tiers : e.tiers;
  _set.q.innerHTML = '';
  for (const t of tiers) {
    const o = document.createElement('option');
    o.value = t; o.textContent = t;
    o.selected = (t === want) || (!tiers.includes(want) && t === (tiers.includes(e.def) ? e.def : tiers[0]));
    _set.q.appendChild(o);
  }
  _paintPrice();
}

function _paintPrice() {
  if (!_set) return;
  const e = _engine();
  const q = _set.q.value;
  const n = _atts.length;
  const chosen = _rowOf(e, n);
  const val = chosen ? (chosen.price || {})[q] : null;
  const box = _set.cost;
  if (val == null) {
    box.className = 'mv3-ig-cost is-unknown';
    box.innerHTML = '<b>&mdash;</b><span>no published price for this one</span>';
  } else {
    box.className = 'mv3-ig-cost';
    box.innerHTML = '<b>' + (chosen.approx ? '≈' : '') + money(val) + '</b>'
      + '<span>per picture' + (_n > 1 ? ' · ' + money(val * _n) + ' for ' + _n : '') + '</span>';
  }
  // WHO CATCHES A REFUSAL, and what that would cost - known before it happens rather than after.
  const others = _houses(e, n).filter(r => r !== chosen && (r.price || {})[q] != null);
  _set.fall.innerHTML = others.length
    ? 'if it refuses: ' + others.map(x => '<b>' + x.label + '</b> ' + money(x.price[q])).join(', ')
    : '';
  _keep(LS_LAST, { engine: e.id, provider: _set.prov.value, quality: q, aspect: _set.ar });
}

function _paintAspects() {
  _set.arWrap.textContent = '';
  _set.arSel.textContent = '';
  for (const a of _table.aspects) {
    const b = el('button', 'mv3-ig-ar-b' + (a === _set.ar ? ' on' : ''));
    b.type = 'button';
    b.textContent = a;
    if (a === _set.fmt) {
      b.appendChild(el('span', 'dot', ' •'));
      b.title = "the project's own shape";
    }
    b.addEventListener('click', () => { _set.ar = a; _paintAspects(); _paintPrice(); });
    _set.arWrap.appendChild(b);
    const o = document.createElement('option');
    o.value = a; o.textContent = a + (a === _set.fmt ? ' •' : '');
    _set.arSel.appendChild(o);
  }
  _set.arSel.value = _set.ar;
}

function _say(t) { if (_ui) _ui.said.textContent = t || ''; }

// ── The attachment row ──────────────────────────────────────────────────────
function _attach(path, name) {
  if (!path || _atts.some(a => a.path === path)) return;
  const room = _room();
  if (_atts.length >= room) {
    _say(room ? 'This model takes ' + room + (room === 1 ? ' picture.' : ' pictures.') : 'This model takes no pictures.');
    return;
  }
  _say('');
  _atts.push({ path, name: name || '' });
  _attSeq++;
  _paintAtts();
  _paintStrip();
  _draftLater();
}

function _detach(path) {
  _atts = _atts.filter(a => a.path !== path);
  _attSeq++;
  _paintAtts();
  _paintStrip();
  _draftLater();
}

function _paintAtts() {
  if (!_ui) return;
  const host = _ui.atts;
  host.textContent = '';
  _atts.forEach((a, i) => {
    const cell = el('div', 'mv3-ig-att');
    const img = document.createElement('img');
    img.src = thumbOf(a.path, 'strip');
    img.loading = 'lazy';
    img.decoding = 'async';
    // Gone from the library since it was attached: it goes from the row, and the row says so.
    img.addEventListener('error', () => { _detach(a.path); _say('A picture in the row is not in the library any more.'); }, { once: true });
    cell.appendChild(img);
    // The NUMBER is the point: with more than one reference the message has to say which is which.
    cell.appendChild(el('span', 'n', String(i + 1)));
    const x = el('button', 'x', '✕');
    x.type = 'button';
    x.title = 'Not this one';
    x.addEventListener('click', () => _detach(a.path));
    cell.appendChild(x);
    cell.addEventListener('mouseenter', () => peekShow(thumbOf(a.path, 'main'), cell));
    cell.addEventListener('mouseleave', peekHide);
    host.appendChild(cell);
  });
  // The empty places are the invitation - as many as the model takes, five at most.
  const room = _room();
  for (let i = _atts.length; i < room; i++) {
    const slot = el('button', 'mv3-ig-att-slot', '+');
    slot.type = 'button';
    slot.title = 'A picture to work from - from this computer, or press one on the right';
    slot.addEventListener('click', () => _ui.file.click());
    host.appendChild(slot);
  }
  if (_atts.length >= 2) host.appendChild(el('span', 'mv3-ig-att-note', 'Say which one you mean by its number.'));
  if (_set) _paintEngines();
}

// ── Bringing pictures in from this computer ────────────────────────────────
// Through Merge's own door: the picture is filed on the Images shelf under the PROJECT's category - the
// thread keeps a path, never the bytes - and goes straight into the row. Nothing else uploads it: the
// Library's own drop stands down while the chat shows, or one drop would file the picture twice.
function _upload(files) {
  const run = _uploadNow(files);
  const all = Promise.all([_uploading, run]);
  _uploading = all;
  all.finally(() => { if (_uploading === all) _uploading = null; });
  return run;
}

async function _uploadNow(files) {
  const list = [...(files || [])].filter(f => f && /^image\//.test(f.type || ''));
  if (!list.length) { _say('Only pictures can be attached here.'); return; }
  _made = true;
  _say('adding ' + list.length + (list.length === 1 ? ' picture…' : ' pictures…'));
  let bad = '';
  for (const f of list.slice(0, MAX_ATTS)) {
    const fd = new FormData();
    fd.append('image', f);
    fd.append('name', String(f.name || 'picture').replace(/\.[^.]+$/, ''));
    fd.append('project', _key || '');
    const d = await _json('/api/mv3/img/upload', { method: 'POST', body: fd });
    if (d && d.success && d.item) _attach(d.item.imagePath, d.item.name);
    else bad = (d && d.error) || 'it could not be added';
  }
  _say(bad ? 'Not added: ' + bad : '');
  _loadCats();
}

// ── The thread ──────────────────────────────────────────────────────────────
const _gensOf = (m) => ((m.gens && m.gens.length) ? m.gens : (m.gen ? [m.gen] : []));

function _stageWords(g) {
  if (g.error && !g.stage) return g.error.slice(0, 60) + ' — trying the next…';
  return g.stage ? g.stage + '…' : 'drawing…';
}

const _sig = (m) => [m.text || ''].concat(_gensOf(m).map(g => g.id + ':' + g.state + ':'
  + (g.state === 'done' ? g.imagePath : g.state === 'failed' ? g.error : ''))).join('|');

function _dropProgs(n, landed) {
  for (const [id, p] of n.progs) {
    // Timed only when it was seen landing - one that landed while the chat was hidden would teach the
    // countdown the time it was away.
    if (landed && landed.has(id) && !n.away) p.finish(); else p.detach();
  }
  n.progs = new Map();
}

async function _reload(toEnd) {
  if (!_chat || !_ui) return;
  const mine = ++_seq;
  const k = _key || '';
  const [d, f] = k
    ? await Promise.all([
      _json('/api/mv3/chat?project=' + encodeURIComponent(k) + '&kind=image'),
      _cat ? null : _json('/api/mv3/img/feed?project=' + encodeURIComponent(k)),
    ])
    : [{ success: true, items: [] }, _cat ? null : { success: true, items: [] }];
  if (mine !== _seq || k !== (_key || '') || !_chat) return;
  if (d && d.success) {
    _thread = d.items || [];
    _talk = !!_thread.length;
    _paintHead();
  }
  // A category of Images is read when it is chosen, not on every tick.
  if (f && f.success && !_cat) {
    _feed = (f.items || []).map(g => ({ path: g.imagePath, aspect: g.aspect, state: g.state, name: g.prompt || '', error: g.error }));
  }
  _landed();
  _paintThread(toEnd);
  _paintStrip();
  _schedule();
}

// THE RESULT BECOMES THE REFERENCE - for a message sent from this page while the row was left alone.
function _landed() {
  const now = new Set();
  const landed = new Set();
  for (const m of _thread) {
    for (const g of _gensOf(m)) {
      if (g.state === 'pending') now.add(g.id);
      else if (_pending.has(g.id) && g.state === 'done' && g.imagePath) {
        landed.add(g.id);
        _made = true;
        const at = _sendSeq.get(m.id);
        if (at != null && at === _attSeq && _room() > 0) {
          const was = _attSeq;
          _atts = [{ path: g.imagePath, name: (g.prompt || '').slice(0, 60) }];
          _attSeq++;
          // The other sends that were waiting on the same row keep their claim on it.
          for (const [s, v] of _sendSeq) if (v === was) _sendSeq.set(s, _attSeq);
          _sendSeq.delete(m.id);
          _paintAtts();
          _draftLater();
        }
      }
    }
  }
  _pending = now;
  _landedNow = landed;
}

function _paintThread(toEnd) {
  const host = _ui.thread;
  const atEnd = toEnd || host.scrollTop + host.clientHeight >= host.scrollHeight - 40;
  const ids = new Set(_thread.map(m => m.id));
  for (const [id, n] of _nodes) {
    if (ids.has(id)) continue;
    _dropProgs(n, null);
    n.el.remove();
    _nodes.delete(id);
  }
  let empty = host.querySelector('.mv3-ig-empty');
  if (!_thread.length) {
    if (!empty) { empty = el('div', 'mv3-ig-empty'); host.appendChild(empty); }
    empty.textContent = _key
      ? 'Describe a picture. What comes back stays in this project — and in the Library.'
      : 'Describe a picture. A project is started for it with the first message.';
  } else if (empty) empty.remove();

  let prev = null;
  for (const m of _thread) {
    let n = _nodes.get(m.id);
    const sig = _sig(m);
    if (!n || n.sig !== sig) {
      if (n) _dropProgs(n, _landedNow);
      const progs = new Map();
      const b = _bubble(m, progs);
      if (n) n.el.replaceWith(b);
      n = { el: b, sig, progs, away: false };
      _nodes.set(m.id, n);
    } else {
      n.away = false;
      for (const g of _gensOf(m)) { const p = n.progs.get(g.id); if (p) p.say(_stageWords(g)); }
    }
    const want = prev ? prev.nextSibling : host.firstChild;
    if (n.el !== want) host.insertBefore(n.el, want);
    prev = n.el;
  }
  if (atEnd) host.scrollTop = host.scrollHeight;
}

function _bubble(m, progs) {
  const b = el('div', 'mv3-ig-msg is-' + (m.role === 'user' ? 'user' : 'agent'));
  if (m.text) b.appendChild(el('div', 'mv3-ig-text', m.text));
  if (m.role === 'user' && (m.refs || []).length) {
    const row = el('div', 'mv3-ig-msg-refs');
    m.refs.forEach((p, i) => {
      const c = el('div', 'mv3-ig-msg-ref');
      const img = document.createElement('img');
      img.src = thumbOf(p, 'strip');
      img.loading = 'lazy'; img.decoding = 'async';
      c.appendChild(img);
      c.appendChild(el('span', 'n', String(i + 1)));
      c.addEventListener('mouseenter', () => peekShow(thumbOf(p, 'main'), c));
      c.addEventListener('mouseleave', peekHide);
      row.appendChild(c);
    });
    b.appendChild(row);
  }
  // ONE TURN, EVERY PICTURE IT SPEAKS FOR, each in whatever state it is actually in.
  const gens = _gensOf(m);
  if (gens.length) {
    const wrap = el('div', 'mv3-ig-shots' + (gens.length > 1 ? ' is-many' : ''));
    for (const g of gens) wrap.appendChild(_shot(g, progs));
    b.appendChild(wrap);
    b.appendChild(_facts(gens[0]));
  }
  return b;
}

function _shot(g, progs) {
  const cell = el('div', 'mv3-ig-shot-wrap');
  if (g.state === 'done' && g.imagePath) {
    const img = document.createElement('img');
    img.className = 'mv3-ig-shot';
    // A miniature in the thread: hovering shows it properly, a press opens it over everything.
    img.src = thumbOf(g.imagePath, 'strip');
    img.alt = g.prompt || '';
    img.loading = 'lazy'; img.decoding = 'async';
    img.style.aspectRatio = String(g.aspect || '9:16').replace(':', '/');
    img.title = 'Open it large';
    img.addEventListener('mouseenter', () => peekShow(thumbOf(g.imagePath, 'main'), img));
    img.addEventListener('mouseleave', peekHide);
    img.addEventListener('click', () => { peekHide(); _view(g); });
    cell.appendChild(img);
    const acts = el('div', 'mv3-ig-acts');
    const use = el('button', 'mv3-c-btn', 'to reference');
    use.type = 'button';
    use.title = 'Put it in the row above the message box and carry on from it';
    use.addEventListener('click', () => _attach(g.imagePath, (g.prompt || '').slice(0, 60)));
    const add = el('button', 'mv3-c-btn', 'to timeline');
    add.type = 'button';
    add.title = 'Puts it on the lane above main video, at the playhead.';
    add.addEventListener('click', () => _place(g, add));
    const anim = el('button', 'mv3-c-btn', 'animate');
    anim.type = 'button';
    anim.title = 'Make a clip from this picture.';
    anim.addEventListener('click', async () => {
      try {
        const A = await import('./animate.js');
        await A.openAnimate({ src: g.imagePath, name: (g.prompt || '').slice(0, 60) });
      } catch (err) {
        note(anim, 'Could not open Animate.', String((err && err.message) || err).slice(0, 120));
      }
    });
    acts.append(use, add, anim);
    cell.appendChild(acts);
    // Taken off the shelf since: said, instead of a broken picture, and nothing builds on it.
    img.addEventListener('error', () => {
      const gone = el('div', 'mv3-ig-gone', 'not in the Library any more');
      gone.style.aspectRatio = img.style.aspectRatio;
      img.replaceWith(gone);
      use.disabled = true; add.disabled = true; anim.disabled = true;
    }, { once: true });
  } else if (g.state === 'pending') {
    const ghost = el('div', 'mv3-ig-shot is-busy');
    ghost.style.aspectRatio = String(g.aspect || '9:16').replace(':', '/');
    cell.appendChild(ghost);
    const strip = el('div', 'mv3-ig-prog');
    cell.appendChild(strip);
    progs.set(g.id, startInlineProgress(strip, {
      label: _stageWords(g), key: 'mv3-imagen-' + (g.engine || ''), estimateMs: ETA_MS,
      startedAt: Date.parse(g.at) || 0,
      onCancel: g.alertId ? () => _letGo(g) : null,
    }));
  } else {
    cell.appendChild(el('div', 'mv3-ig-bad', g.error || 'nothing came back'));
    if (!g.cancelled && g.alertId && !/question instead/.test(g.error || '')) cell.appendChild(el('div', 'mv3-ig-note', 'Alerts can try it again'));
  }
  return cell;
}

// The technical half, folded away - including what was actually sent, which is the only way a picture
// that came out wrong can be argued with.
function _facts(g) {
  const wrap = el('div', 'mv3-ig-more');
  const btn = el('button', 'mv3-ig-more-b', 'read more');
  btn.type = 'button';
  const body = el('div', 'mv3-ig-more-body');
  body.hidden = true;
  const rows = [
    ['model', (g.engine || '') + ' · ' + (g.provider || '?') + ' · ' + (g.quality || '')],
    ['asked as', g.model || ''],
    ['shape', (g.aspect || '') + ((g.w && g.h) ? ' · ' + g.w + '×' + g.h : '')],
    ['took', g.secs ? g.secs + 's' : ''],
    ['references', (g.refs || []).length ? String(g.refs.length) : ''],
    ['writer', g.fell ? 'sent as typed - ' + g.fell : (g.writer || '')],
    ['sent as', (g.prompt && g.said && g.prompt !== g.said) ? g.prompt : ''],
  ];
  for (const [k, v] of rows) {
    if (!v || v === ' · ? · ') continue;
    const r = el('div', 'mv3-ig-more-row');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v', String(v)));
    body.appendChild(r);
  }
  btn.addEventListener('click', () => {
    body.hidden = !body.hidden;
    btn.textContent = body.hidden ? 'read more' : 'less';
  });
  wrap.append(btn, body);
  return wrap;
}

// Every picture this thread finished, in the Library's viewer - drawn from the 2048px tier, never the
// 4K original (phase J4).
function _view(g) {
  const done = _thread.flatMap(_gensOf).filter(x => x && x.state === 'done' && x.imagePath);
  openViewer(
    done.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: x.prompt || '', meta: { date: x.at } })),
    Math.max(0, done.findIndex(x => x.id === g.id)),
    { showSrc: (it) => thumbOf(it.media, 'main') });
}

// On the lane above main video, at the playhead (js/merge-v3/timeline-b.js placeAbove).
async function _place(g, anchor) {
  const T = await import('./timeline-b.js');
  // Not picked on the timeline: a picked clip slides its settings over the Library - over this chat.
  const r = T.placeAbove({ src: g.imagePath, thumb: g.imagePath, libId: g.imageId || '', name: (g.prompt || '').slice(0, 60) }, { select: false });
  if (!r.ok) { note(anchor, 'Not added.', r.why); return; }
  note(anchor, 'Added to ' + r.lane + '.', 'At the playhead, ' + r.at.toFixed(1) + 's.');
  setTimeout(() => closeAsk(), 2400);
}

// The cross on a countdown: the row is let go of - what was asked for is paid for, and it says so.
async function _letGo(g) {
  await _json('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', { method: 'POST' });
  _reload();
}

function _schedule() {
  clearTimeout(_timer);
  _timer = 0;
  if (!_chat) return;
  const busy = _pending.size || _feed.some(x => x.state === 'pending');
  _timer = setTimeout(() => { _timer = 0; if (_chat && !document.hidden) _reload(); else _schedule(); }, busy ? POLL_MS : IDLE_MS);
}
function _stop() { clearTimeout(_timer); _timer = 0; }

// ── Sending ─────────────────────────────────────────────────────────────────
async function _send() {
  if (_sending || !_ui) return;
  const ta = _ui.ta;
  const text = ta.value.trim();
  if (!text) {
    ta.focus();
    ta.classList.add('is-bad');
    setTimeout(() => ta.classList.remove('is-bad'), 900);
    return;
  }
  if (!_set) { note(_ui.go, 'No picture model.', _tableErr || 'Check the API keys in Admin.'); return; }
  _sending = true;
  _ui.go.disabled = true;
  try {
    // A picture still on its way into the row goes with this message, not after it.
    if (_uploading) { _say('waiting for the picture to be added…'); await _uploading.catch(() => {}); _say(''); }
    if (!Store.key()) {
      _adopt = true;
      try { await _ensureProject(); }
      catch (e) { _adopt = false; note(_ui.go, 'Could not start a project.', String(e.message || e).slice(0, 120)); return; }
    }
    const key = Store.key();
    const e = _engine();
    const d = await _json('/api/mv3/img/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: key, text, refs: _atts.map(a => a.path),
        engine: e.id, provider: _set.prov.value, quality: _set.q.value, aspect: _set.ar,
        n: _n, write: _write,
        // Where it was asked from, for Alerts (js/alerts-bell.js): the project, and this chat in it.
        where: {
          page: 'merge', href: '/merge?p=' + encodeURIComponent(key) + '&open=pictures',
          label: 'Merge · ' + (Store.title() || 'project') + ' · pictures',
          spot: { key, view: 'pictures' },
        },
      }),
    });
    if (!d || !d.success) { note(_ui.go, 'Not sent.', (d && d.error) || 'the server did not answer'); return; }
    ta.value = '';
    _grow();
    _saveDraft(_key || '');
    if (d.send) _sendSeq.set(d.send, _attSeq);
    await _reload(true);
  } finally {
    _sending = false;
    if (_ui) { _ui.go.disabled = false; _ui.ta.focus(); }
  }
}

function _grow() {
  const ta = _ui.ta;
  // Empty, it is one line - measured, the placeholder of a box not laid out yet would make it tall.
  if (!ta.value) { ta.style.height = ''; return; }
  ta.style.height = 'auto';
  ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
}

// ── The right column ────────────────────────────────────────────────────────
async function _loadCats() {
  if (!_ui) return;
  const d = await _json('/api/library/shelf/media?filter=images');
  const cats = (d && d.success) ? (d.cats || []) : [];
  const sel = _ui.cat;
  sel.innerHTML = '';
  const mine = document.createElement('option');
  mine.value = ''; mine.textContent = 'this project';
  sel.appendChild(mine);
  for (const c of cats) {
    if (!c || !c.id) continue;
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.label || c.name || c.id;
    sel.appendChild(o);
  }
  sel.value = [...sel.options].some(o => o.value === _cat) ? _cat : '';
  if (sel.value !== _cat) { _cat = ''; _reload(); }
}

async function _loadStrip() {
  if (!_cat) return _reload();
  const k = _cat;
  const d = await _json('/api/library/shelf/media?filter=images&cat=' + encodeURIComponent(k));
  if (k !== _cat) return;
  _feed = (d && d.success ? d.items || [] : []).filter(i => i && i.media)
    .map(i => ({ path: i.media, aspect: arOf(i), state: 'done', name: i.name || '', libId: i.id || '' }));
  _paintStrip();
}

// Mixed shapes, stacked in columns: each tile keeps its own shape and goes into the shorter column.
function _paintStrip() {
  if (!_ui) return;
  const host = _ui.list;
  const wide = host.clientWidth - 16;
  const cols = wide >= 330 ? 3 : wide >= 150 ? 2 : 1;
  const H = new Array(cols).fill(0);
  const boxes = [];
  for (let i = 0; i < cols; i++) boxes.push(el('div', 'mv3-ig-col'));
  boxes[0].appendChild(_plusTile());
  H[0] += 0.5;
  for (const it of _feed) {
    let k = 0;
    for (let j = 1; j < cols; j++) if (H[j] < H[k]) k = j;
    H[k] += 1 / ratioOf(it.aspect);
    boxes[k].appendChild(_tile(it));
  }
  host.replaceChildren(...boxes);
  _ui.count.textContent = String(_feed.length);
  if (!_feed.length) {
    const none = el('div', 'mv3-ig-none', _cat ? 'Nothing in this category.' : 'Nothing made in this project yet.');
    host.replaceChildren(none, _plusTile());
  }
}

function _plusTile() {
  const b = el('button', 'mv3-ig-card is-plus', '+');
  b.type = 'button';
  b.title = 'Add a picture from this computer. It goes into Images and straight into the row above the message box.';
  b.addEventListener('click', () => _ui.file.click());
  return b;
}

function _tile(it) {
  const t = el('div', 'mv3-ig-card'
    + (it.state === 'pending' ? ' is-busy' : it.state === 'failed' ? ' is-fail' : '')
    + (_atts.some(a => a.path === it.path) ? ' on' : ''));
  t.style.aspectRatio = String(it.aspect || '1:1').replace(':', '/');
  t.title = it.name || '';
  if (it.state === 'done' && it.path) {
    const img = document.createElement('img');
    img.src = thumbOf(it.path, 'strip');
    img.alt = it.name || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    t.appendChild(img);
    t.draggable = true;
    // The library's own payload, so a tile can be dragged onto a lane like anything on the shelf.
    t.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData(Store.DRAG_TYPE, JSON.stringify({
        libId: it.libId || '', src: it.path, thumb: it.path,
        name: (it.name || '').slice(0, 60), group: 'images', dur: 0,
      }));
      t.classList.add('is-dragging');
    });
    t.addEventListener('dragend', () => t.classList.remove('is-dragging'));
    t.addEventListener('mouseenter', () => peekShow(thumbOf(it.path, 'main'), t));
    t.addEventListener('mouseleave', peekHide);
    // A press ATTACHES, and a second one takes it back off.
    t.addEventListener('click', () => {
      peekHide();
      if (_atts.some(a => a.path === it.path)) _detach(it.path);
      else _attach(it.path, it.name);
    });
  } else if (it.state === 'pending') {
    t.appendChild(el('span', 'sp', 'making…'));
  } else {
    t.appendChild(el('span', 'sp', String(it.error || 'failed').slice(0, 70)));
  }
  return t;
}

// The column's width: narrow by default, dragged and remembered, a double press for the default.
function _wireStripSash(sash, box) {
  const apply = (w) => {
    const v = Math.max(STRIP_MIN, Math.min(STRIP_MAX, Math.round(w)));
    box.style.flexBasis = v + 'px';
    _paintStrip();
    return v;
  };
  let saved = 0;
  try { saved = parseInt(localStorage.getItem(LS_STRIP) || '', 10); } catch (e) { saved = 0; }
  apply(saved || STRIP_DEF);
  sash.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const from = e.clientX;
    const base = box.getBoundingClientRect().width;
    document.body.classList.add('mv3-resize-v');
    // The column is on the right: dragging LEFT makes it bigger.
    const move = (ev) => apply(base - (ev.clientX - from));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-resize-v');
      try { localStorage.setItem(LS_STRIP, String(Math.round(box.getBoundingClientRect().width))); } catch (err) { /* a private window */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  sash.addEventListener('dblclick', () => {
    apply(STRIP_DEF);
    try { localStorage.setItem(LS_STRIP, String(STRIP_DEF)); } catch (e) { /* a private window */ }
  });
}

// ── Hover peek ──────────────────────────────────────────────────────────────
// ONE PLACE, ALWAYS THE SAME: the bottom right of the conversation, over the thread - learnt once.
// It closes itself the moment the pointer is anywhere but what opened it, or that thing is repainted
// away; a wheel and a press close it too.
let _peek = null;
let _peekOn = null;
let _peekOff = null;

function peekShow(src, anchor) {
  peekHide();
  if (!_ui) return;
  const box = el('div', 'mv3-ig-peek');
  const img = document.createElement('img');
  img.src = src;
  box.appendChild(img);
  document.body.appendChild(box);
  _peek = box;
  const t = _ui.thread.getBoundingClientRect();
  const w = Math.max(120, Math.min(400, t.width - 24));
  const h = Math.max(120, Math.min(520, t.height - 16));
  box.style.width = w + 'px';
  box.style.maxHeight = h + 'px';
  img.style.maxHeight = (h - 8) + 'px';
  box.style.left = Math.round(Math.max(8, t.right - w - 12)) + 'px';
  box.style.bottom = Math.round(Math.max(8, window.innerHeight - t.bottom + 8)) + 'px';
  _peekOn = anchor;
  _peekOff = (e) => {
    const a = _peekOn;
    if (!a || !a.isConnected) return peekHide();
    const tg = e && e.target;
    if (!tg || !(a === tg || a.contains(tg))) peekHide();
  };
  document.addEventListener('mousemove', _peekOff, true);
  document.addEventListener('wheel', peekHide, true);
  document.addEventListener('mousedown', peekHide, true);
}

function peekHide() {
  if (_peekOff) {
    document.removeEventListener('mousemove', _peekOff, true);
    document.removeEventListener('wheel', peekHide, true);
    document.removeEventListener('mousedown', peekHide, true);
    _peekOff = null;
  }
  _peekOn = null;
  if (_peek) { _peek.remove(); _peek = null; }
}

// ── Narrow or wide ──────────────────────────────────────────────────────────
// Narrower than 700px, the settings column folds into one row above the input (the owner's answer 3).
function _fit() {
  if (!_ui) return;
  const w = _ui.root.clientWidth;
  const narrow = w > 0 && w < NARROW;
  if (narrow !== _ui.narrow) {
    _ui.narrow = narrow;
    _ui.root.classList.toggle('is-narrow', narrow);
    if (narrow) _ui.chat.insertBefore(_ui.set, _ui.atts);
    else _ui.root.insertBefore(_ui.set, _ui.chat);
  }
  _grow();
  _paintStrip();
}

// ── Building it ─────────────────────────────────────────────────────────────
function _build() {
  if (_ui) return;
  const root = $('mv3-pc');
  if (!root) return;
  root.textContent = '';

  const set = el('div', 'mv3-ig-set');
  const left = el('div', 'mv3-ig-scroll');
  const said = el('div', 'mv3-ig-said');
  set.append(left, said);

  const chat = el('div', 'mv3-ig-chat');
  const thread = el('div', 'mv3-ig-thread');
  const atts = el('div', 'mv3-ig-atts');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.multiple = true;
  file.hidden = true;
  const bar = el('div', 'mv3-ig-bar');
  const ta = document.createElement('textarea');
  ta.className = 'mv3-ig-say';
  ta.rows = 1;
  ta.placeholder = 'Describe a picture, or say what to change.';
  // THE WRITER: on, the message is rewritten into the shape the chosen model wants; off, the words go
  // exactly as typed.
  const pen = el('button', 'pen', '✎');
  pen.type = 'button';
  const nBtn = el('button', 'n', '×1');
  nBtn.type = 'button';
  nBtn.title = 'How many to make at once. Each is its own attempt.';
  const go = el('button', 'b', '>');
  go.type = 'button';
  go.title = 'Send (Enter) · a new line is Shift+Enter';
  bar.append(ta, pen, nBtn, go);
  chat.append(thread, atts, file, bar);

  const sash = el('div', 'mv3-sash is-v mv3-ig-sash');
  sash.title = 'Drag to resize · double-click to reset';
  const stripBox = el('div', 'mv3-ig-strip');
  const sHead = el('div', 'mv3-ig-strip-head');
  const stripP = el('span', 'p', Store.title() || Store.key() || 'no project');
  const count = el('span', 'n', '0');
  sHead.append(stripP, count);
  const cat = document.createElement('select');
  cat.className = 'mv3-ig-cat';
  cat.title = 'This project\'s pictures, or a category of the Library\'s Images';
  const list = el('div', 'mv3-ig-strip-list');
  stripBox.append(sHead, cat, list);
  root.append(set, chat, sash, stripBox);

  // The panel header's own two buttons while the chat shows.
  const head = $('mv3-pc-head');
  if (head) {
    head.textContent = '';
    const wipe = el('button', 'mv3-iconbtn', '⌫');
    wipe.type = 'button';
    wipe.title = 'Clear this conversation. Everything made stays in the Library and on the right.';
    wipe.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!_key) return;
      askDelete(wipe, 'Clear this conversation?',
        'Everything made stays — in the Library and in the column on the right. Only what was said goes.',
        async () => {
          await _json('/api/mv3/chat?project=' + encodeURIComponent(_key) + '&kind=image', { method: 'DELETE' });
          _reload(true);
        });
    });
    const gear = el('button', 'mv3-iconbtn', '⚙');
    gear.type = 'button';
    gear.title = 'The almanac - how each model wants to be asked - and who reads your message';
    gear.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      gear.disabled = true;
      try { const G = await import('./gear.js'); await G.openGear(); }
      catch (err) { note(gear, 'Could not open the settings.', String((err && err.message) || err).slice(0, 120)); }
      finally { gear.disabled = false; }
    });
    head.append(wipe, gear);
  }

  _ui = { root, set, left, said, chat, thread, atts, file, ta, pen, nBtn, go, stripBox, stripP, count, cat, list, narrow: null };
  _wireStripSash(sash, stripBox);

  file.addEventListener('change', () => { const f = [...(file.files || [])]; file.value = ''; _upload(f); });
  cat.addEventListener('change', () => { _cat = cat.value || ''; _feed = []; _paintStrip(); _loadStrip(); });
  nBtn.addEventListener('click', () => {
    _n = _n === 1 ? 2 : _n === 2 ? 4 : 1;
    nBtn.textContent = '×' + _n;
    _paintPrice();
  });
  const paintPen = () => {
    pen.classList.toggle('on', _write);
    pen.title = _write
      ? 'The writer is on: your message is rewritten into the shape this model wants. Press to send your words exactly as typed.'
      : 'Sending your words exactly as typed. Press to let the writer shape them for this model.';
  };
  pen.addEventListener('click', () => { _write = !_write; _keep(LS_WRITE, _write); paintPen(); });
  paintPen();
  go.addEventListener('click', () => _send());
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); _send(); }
  });
  ta.addEventListener('input', () => { _grow(); _draftLater(); });
  // A picture pasted into the box is attached.
  ta.addEventListener('paste', (ev) => {
    const files = [...((ev.clipboardData && ev.clipboardData.files) || [])].filter(f => /^image\//.test(f.type || ''));
    if (!files.length) return;
    ev.preventDefault();
    _upload(files);
  });
  // A file dropped anywhere on the chat is an attachment - and only that (library.js stands down).
  root.addEventListener('dragover', (ev) => {
    if (!ev.dataTransfer || ![...ev.dataTransfer.types].includes('Files')) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  });
  root.addEventListener('drop', (ev) => {
    if (!ev.dataTransfer || !ev.dataTransfer.files || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    ev.stopPropagation();
    _upload(ev.dataTransfer.files);
  });
  // The panel is its own size: the sashes of the page move it, not the window.
  if (window.ResizeObserver) {
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(_fit); }).observe(root);
  }

  const d = _store(LS_DRAFT, {})[_key || ''] || {};
  ta.value = String(d.text || '');
  _grow();
  _paintSet();
  _paintAtts();
}

export function initPicChat() {
  const title = $('mv3-lib-title');
  if (title) title.addEventListener('click', (e) => { if (!_chat) return; e.stopPropagation(); _show(false); });
  const gen = $('mv3-lib-gen');
  if (gen) gen.addEventListener('click', (e) => { e.stopPropagation(); if (!_chat) openPictures(); });
  // Back from another tab or window: the countdowns catch up at once rather than at the next tick.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && _chat) _reload(); });
  window.addEventListener('beforeunload', () => { if (_key !== null) _saveDraft(_key); });
  Store.onChange(_onStore);
  _paintHead();
}
