/* ════════════════════════════════════════════════════════════════════════════
   MERGE — a chat IN THE LIBRARY PANEL: the shell (phase V1, docs/local-app/PLAN.md "V-A").

   The pictures chat (phase J) was one module; the video chat (phase V3) is the same conversation with other
   settings and other results, so what they share lives here and each is `createChat(DESCRIPTION)` -
   picchat.js and (V3) vidchat.js. A copy would have meant every later change made twice.

   ── What the shell does ─────────────────────────────────────────────────────
   The views (the shelf or this chat - lib-views.js holds the base, the room and the view each project was
   left on), following the open project, what was being written and attached per project, the thread read
   from the server every few seconds with each countdown drawn from its record's real age and its cross
   letting go of the row, "the result becomes the reference", sending (a project started for a send from
   "no project"), the attachment row, bringing files in, the right column of things to point at behind a
   sash - or, for a description that says where its attachments come from (`pick`, the video chat since
   phase V13), no column and a picker behind every "+" of the zone (chat-pick.js) -, the hover peek, and
   the narrow layout.

   ── What a description says ─────────────────────────────────────────────────
   Its name and kind, its element ids and storage keys, its words, the settings column (`settings`: load,
   paint, how many attachments fit, what goes into the send), how a finished result is drawn and opened, and
   where the right column reads from (`feed`, `cats`) or the picker's sources (`pick`). `createChat(make)`
   calls `make(ctx)` with the shell's handles (ctx below), so a description keeps its own state in its own
   closure.

   ── Why a thread and not a form ─────────────────────────────────────────────
   Making things is iterative. You say a thing, look at it, then say "the same but at night" - and the
   second sentence only means anything because the first one is still there. The conversation belongs to
   the PROJECT (data/mv3-chat.json by kind, the results in their own store and on their shelf).

   ── The server sends ────────────────────────────────────────────────────────
   A press is one request: the server writes the person's turn, a record and an Alerts row for every result
   asked for and the turn that answers - and the work goes on behind it, the rows saying which in words.
   This page only READS the thread, so a countdown survives leaving and reloading.

   ── The attachment row is the whole of the rule ─────────────────────────────
   Whatever sits above the input goes as a reference. A result that lands is put there automatically - the
   next thing anybody says is about it - unless the row was changed by hand since the message was sent;
   visibly, with a number and a cross.

   ── The layout ──────────────────────────────────────────────────────────────
   Three columns when the panel is wide: what to make it WITH, the conversation, and a narrow column of
   everything to point at behind a sash (two with a picker: the conversation takes the column's width).
   Narrower than 700px, the settings fold into one row above the input.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { setOpenColumn } from './layout.js';
import * as Views from './lib-views.js';
import * as Pick from './chat-pick.js';
import { startInlineProgress } from '../progress.js';
import { askDelete, closeAsk, note } from './ask.js';

const POLL_MS = 4000;
const IDLE_MS = 20000;             // nothing running: an eye on what Alerts may start again
const NARROW = 700;
const STRIP_DEF = 170, STRIP_MIN = 110, STRIP_MAX = 520;

const $ = (id) => document.getElementById(id);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export const thumbOf = (p, v) => '/api/thumb?src=' + encodeURIComponent(p) + '&v=' + (v || 'strip');
// A clip's poster where the shelves keep it - thumbs/<name>_thumb.jpg beside it (lib/video-thumb.js thumbUrlFor).
export const posterOf = (p) => {
  const c = String(p || '').split('?')[0];
  const i = c.lastIndexOf('/');
  return c.slice(0, i) + '/thumbs/' + c.slice(i + 1).replace(/\.[^.]+$/, '') + '_thumb.jpg';
};
// One attachment of a message as it went: a picture's miniature, a clip's poster or a sound's note, its number - per
// kind, the way the prompt names them - and for a clip or a sound the seconds of it that went (phase V7). `peek` is
// the chat's enlarged view ({ show, hide }).
export function refCell(a, k, n, peek) {
  const c = el('div', 'mv3-ig-msg-ref' + (k !== 'image' ? ' is-' + k : ''));
  if (k === 'image' || k === 'video') {
    const src = k === 'image' ? a.path : posterOf(a.path);
    const img = document.createElement('img');
    img.src = thumbOf(src, 'strip');
    img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    c.appendChild(img);
    if (peek) {
      c.addEventListener('mouseenter', () => peek.show(thumbOf(src, 'main'), c));
      c.addEventListener('mouseleave', peek.hide);
    }
  }
  if (k !== 'image') {
    c.appendChild(el('span', 'ic', k === 'audio' ? '♪' : '▶'));
    const secs = Math.max(0, (+a.out || 0) - (+a.in || 0));
    if (secs) c.appendChild(el('span', 'dur', secs.toFixed(1) + 's'));
  }
  c.appendChild(el('span', 'n', String(n)));
  return c;
}
export const money = (v) => '$' + (+(+v).toFixed(4));
const ratioOf = (ar) => {
  const p = String(ar || '9:16').split(':');
  return (+p[0] || 1) / (+p[1] || 1);
};
export const json = (url, opts) => fetch(url, opts).then(r => r.json()).catch(() => null);
export const stored = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || '') || fb; } catch (e) { return fb; } };
export const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };
const _gensOf = (m) => ((m.gens && m.gens.length) ? m.gens : (m.gen ? [m.gen] : []));

/**
 * One chat. `make(ctx)` returns its description; the answer is { open, isOpen, init }.
 */
export function createChat(make) {
  // ── State ─────────────────────────────────────────────────────────────────
  let _ui = null;            // the chat, built the first time it is shown
  let _chat = false;         // the panel shows this chat
  let _key = null;           // whose conversation this is - '' before a project exists
  let _thread = [];
  let _feed = [];            // the right column
  let _cat = '';             // its category; '' = this project's own
  let _timer = 0;
  let _seq = 0;
  let _sending = false;
  let _n = 1;
  let _write = true;
  let _atts = [];            // [{ path, name }] - in the zone also an empty numbered place, { hole, kind, slot, id }
  let _attSeq = 0;           // moves whenever the row is changed by hand
  const _sendSeq = new Map();   // a send -> the row as it was at the press
  let _pending = new Set();     // results still being made at the last read
  let _landedNow = new Set();   // ...and those that landed since the read before it
  const _nodes = new Map();     // message id -> { el, sig, progs: Map(genId -> countdown), away }
  let _talk = false;            // the open project has a conversation (the pale crumb)
  let _adopt = false;           // a project is being made for a send from "no project"
  let _draftT = 0;
  // Per project, what "the result becomes the reference" needs across a trip to another project: the
  // results still being made at the last read there, and the row's hand-change counter.
  const _memo = new Map();
  let _uploading = null;        // the upload in flight - a send waits for it
  let _made = false;            // something landed or was added while the chat showed - the shelf reads again

  // ── What the description works with ───────────────────────────────────────
  const ctx = {
    ui: () => _ui,
    key: () => _key,
    // In the order their numbers count (phase V6: per part of the zone, per slot of a recipe, then the rest) - what goes:
    // the empty numbered places (phase V15) left out.
    atts: () => _real(),
    // (phase V15) Why a send cannot go yet - an empty numbered place, blinking -, or null.
    holeWhy: () => _holeWhy(),
    // (phase V16) Whether anything attached answers `fn` - read without laying out the zone, so the zone's own words (a
    // part's note) can ask it.
    anyAtt: (fn) => _atts.some(a => !a.hole && fn(a)),
    // (phase V16) The zone replaced by these attachments ({ path, kind, role, label, in, out }) - a message's, put back
    // for the next variant; [] empties it.
    useAtts: (list) => _useAtts(list),
    n: () => _n,
    say: (t) => _say(t),
    paintAtts: () => _paintAtts(),
    attach: (path, name, o) => _attach(path, name, o),
    // (phase V7) An attachment changed by its description - the part of a clip or a sound that goes, its length once
    // measured (a value of null or '' takes the field away) - or taken back off.
    setAtt: (path, patch) => _setAtt(path, patch),
    detach: (path) => _detach(path),
    // Whether the chat is what the panel shows.
    shown: () => _chat,
    // (phase V6) A recipe came or went: what is attached finds its slots again, and nothing stays armed.
    reslot: (o) => _reslot(o),
    // (phase V6) A slot that must be filled, blinking - the send was refused for it.
    flash: (kind, slot) => _flash(kind, slot),
    place: (item, anchor) => _place(item, anchor),
    peekShow: (src, anchor) => peekShow(src, anchor),
    peekHide: () => peekHide(),
    // (phase V3) The words in the box - a description may put its standard prompt there - and its hint.
    text: () => (_ui ? _ui.ta.value : ''),
    setText: (v) => { if (!_ui) return; _ui.ta.value = String(v || ''); _grow(); _draftLater(); },
    placeholder: (v) => { if (_ui) _ui.ta.placeholder = String(v || T.placeholder); },
    // (phase V3) The line above the thread. Empty hides it. (phase V6) The video chat fills it itself - the recipe in
    // use - through bannerBox().
    banner: (v) => { if (!_ui) return; _ui.banner.textContent = String(v || ''); _ui.banner.hidden = !v; },
    bannerBox: () => (_ui ? _ui.banner : null),
    // (phase V5) The row just above the box that a description fills (the video chat: its catalog and the skill in
    // use), and whether the writer is on.
    over: () => (_ui ? _ui.over : null),
    writing: () => _write,
    // (phase V15) The writer switched from the description's own control (the video chat's column).
    setWriting: (v) => _setWriting(v),
    saveDraft: () => _draftLater(),
    // (phase V6) The video chat's builder: the thread's FOOT - its own step, the last thing in the thread -, the input
    // line shown or hidden, the thread as read, read again, a project for a press made from "no project", and the
    // results of a message drawn the shell's way inside a card the description draws.
    foot: () => (_ui ? _ui.foot : null),
    bar: (show) => { if (_ui) _ui.bar.hidden = !show; },
    thread: () => _thread,
    reload: (toEnd) => _reload(toEnd),
    ensureProject: async () => {
      if (Store.key()) return Store.key();
      _adopt = true;
      try { await _ensureProject(); } catch (e) { _adopt = false; throw e; }
      return Store.key();
    },
    shots: (m, progs) => _shots(m, progs),
    // What a countdown of a result says - its stage in words - for a description that keeps its clips fresh itself.
    stageWords: (g) => _stageWords(g),
    footChanged: () => { if (_ui) _paintThread(true); },
  };
  const S = make(ctx);
  const T = S.text;
  const set = S.settings;
  _write = stored(S.keys.write, true) !== false;
  const _path = (g) => S.resultPath(g);

  // ── The two views ─────────────────────────────────────────────────────────
  /** Every way in: the generate menu, "+" on the shelf, the lane's right-click, ?open=<name>. */
  async function open() {
    Views.toBase();
    setOpenColumn('library');
    await _show(true);
  }

  // `remember` is false when another chat took the base (onYield): this chat's _key may still be the project
  // being LEFT - the other chat's store listener can run first - and its mark there must stay.
  async function _show(on, remember = true) {
    _chat = !!on;
    if (remember) Views.rememberView(_key || '', _chat ? S.name : null, S.name);
    _paintHead();
    if (!_chat) {
      _stop();
      peekHide();
      // The picker goes with the chat, and the description lets go of what floats over it.
      if (_picking) Pick.closePick();
      if (typeof S.onHide === 'function') S.onHide();
      // The arrangement there was before the chat (phase J7) comes back by itself: the room is lib-views'.
      for (const n of _nodes.values()) n.away = true;
      // The shelf was read before the chat came forward: what was made or added since is not on it yet.
      if (_made) { _made = false; window.dispatchEvent(new CustomEvent('mv3:lib-reload')); }
      return;
    }
    _build();
    // The corner goes as far left and down as it can (phase J7, the owner) - only while the chat can be
    // SEEN: lib-views takes the room for it, and gives it back when the Library folds (K6b).
    _fit();
    set.load();
    _loadCats();
    await _reload(true);
    if (_chat && _ui) _ui.ta.focus();
  }

  // The header, the panel's class and the room are lib-views' (K6b): it is told the base and the crumb.
  function _paintHead() {
    Views.setBase(S.name, _chat, _talk);
  }

  // ── The project the conversation belongs to ──────────────────────────────
  function _onStore() {
    // Not before the store has read what is open: "nothing yet" is not "no project".
    if (!Store.isReady()) return;
    const k = Store.key() || '';
    if (_ui && _ui.stripP) _ui.stripP.textContent = Store.title() || (k ? k : 'no project');
    if (k === _key) return;
    const was = _key;
    // The picker was for a place of the project being left.
    if (_picking) Pick.closePick();
    if (was !== null) {
      _saveDraft(was);
      _memo.set(was, { pending: _pending, attSeq: _attSeq });
    }
    // A send from "no project" made this project: what was being written comes along, and so does the chat.
    const adopt = _adopt && was === '';
    _adopt = false;
    if (adopt) {
      const d = stored(S.keys.draft, {});
      if (d['']) { d[k] = d['']; delete d['']; keep(S.keys.draft, d); }
    }
    _key = k;
    _armed = null;
    _thread = [];
    const m = _memo.get(k);
    _pending = m ? m.pending : new Set();
    for (const n of _nodes.values()) { _dropProgs(n, false); n.el.remove(); }
    _nodes.clear();
    if (_ui) { const e = _ui.thread.querySelector('.mv3-ig-empty'); if (e) e.remove(); }
    _loadDraft(k, m);
    _talk = false;
    set.onProject();
    // This project's own results are another project's; a category is the same whatever is open.
    if (!_cat) _feed = [];
    else if (_chat) _loadStrip();
    if (adopt) { Views.rememberView(k, S.name); Views.rememberView('', null, S.name); }
    const want = adopt || Views.viewOf(k) === S.name;
    if (want !== _chat) _show(want);
    else if (_chat) _reload(true);
    // Left on a chat by an earlier visit that never came back to the shelf: the arrangement is put back.
    else Views.sync();
    if (!_chat) _probeTalk(k);
    _paintHead();
  }

  // Whether the project has anything to come back to - the pale crumb on the shelf.
  async function _probeTalk(k) {
    if (!k) { _talk = false; _paintHead(); return; }
    const d = await json('/api/mv3/chat?project=' + encodeURIComponent(k) + '&kind=' + S.kind);
    if (k !== _key) return;
    _talk = !!(d && d.success && (d.items || []).length);
    _paintHead();
  }

  // A message from "no project" starts one, named for the day - the person came to make something, and a
  // dialog about naming things is not what they came for.
  async function _ensureProject() {
    if (Store.key()) return;
    const today = new Date().toISOString().slice(0, 10);
    let d = null;
    for (let n = 1; n <= 40 && !(d && d.success); n++) {
      d = await json('/api/mv3/timeline/new', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: today + ' - untitled' + (n > 1 ? ' ' + n : ''), kind: Store.BLANK_KIND }),
      });
      if (d && !d.success && !/already exists/i.test(String(d.error || ''))) break;
    }
    if (!d || !d.success) throw new Error((d && d.error) || 'could not start a project for this');
    await Store.open(d.key);
  }

  // ── What was being written, per project ───────────────────────────────────
  function _saveDraft(k) {
    const d = stored(S.keys.draft, {});
    const text = _ui ? _ui.ta.value : ((d[k] || {}).text || '');
    // What the description keeps of its own with the draft (phase V5: the video chat's skill in use).
    const extra = typeof set.draftExtra === 'function' ? set.draftExtra() : null;
    if (text.trim() || _atts.length || extra) d[k] = Object.assign({ text, atts: _atts.slice(0, S.maxAtts) }, extra ? { extra } : {});
    else delete d[k];
    keep(S.keys.draft, d);
  }
  function _draftLater() {
    clearTimeout(_draftT);
    _draftT = setTimeout(() => _saveDraft(_key || ''), 600);
  }
  function _loadDraft(k, memo) {
    const d = stored(S.keys.draft, {})[k] || {};
    // (phase V15) Its empty numbered places too.
    _atts = (Array.isArray(d.atts) ? d.atts : []).filter(a => a && (a.path || a.hole)).slice(0, S.maxAtts);
    // The row as it was left there is not a change by hand: the counter comes back with it.
    _attSeq = memo ? memo.attSeq : _attSeq + 1;
    if (_ui) {
      _ui.ta.value = String(d.text || '');
      _grow();
      _paintAtts();
    }
    if (typeof set.draftLoad === 'function') set.draftLoad(d.extra || null);
  }

  // What the chat says - in the picker too while it is open, which covers the column it is written in.
  function _say(t) {
    if (_ui) _ui.said.textContent = t || '';
    if (_picking) Pick.pickSay(t);
  }

  // ── The attachment row ────────────────────────────────────────────────────
  // (phase V6, the owner 2026-10-06) A description may lay it out as a ZONE - set.zone(): { parts: [{ kind, word, room,
  // off, none, slots }] }, the video chat's pictures, clips and sounds side by side. A part shows ONE empty place, and
  // the next appears beside it as things are attached, up to what the model takes - thirty places are never drawn at
  // once - and scrolls sideways. With a recipe a part holds its SLOTS: every cell wears the slot's name, a slot shows one
  // empty place at a time up to its most, and "other" closes the part for what the recipe did not ask for. An empty
  // place pressed opens the picker on it (phase V13) - its slot ARMED while the picker is open, so whatever is pressed
  // or brought in there goes into it. Without a zone it is the one row it always was.
  //
  // (phase V15, the owner 2026-10-07) A thing taken out of the zone leaves its NUMBERED PLACE EMPTY, so the numbers
  // after it - and the prompt that names them - stay: picture 1 taken off to put another person in is still picture 1.
  // An empty place - a hole, { hole, kind, slot, id } in the row - is filled by the next thing for its part or slot,
  // opens the picker on itself when pressed, and closes with its cross: then the numbers after it move up. One at the
  // END of its part's numbers holds nothing up and goes by itself. A send waits while one is open (ctx.holeWhy). A thing
  // in the zone pressed opens the picker on ITS place, on it - another pressed there takes its place and its number; a
  // clip's or a sound's seconds open the part that goes. The pictures chat has no zone: its row takes a thing out.
  let _armed = null;            // { kind, slot } - the slot the next attachment goes into, while the picker is open
  let _grew = '';               // the part something was just attached to - its row comes to its end
  let _holeSeq = 0;
  const _kindOf = (a) => (a && (a.kind === 'video' || a.kind === 'audio') ? a.kind : 'image');
  const _zone = () => (typeof set.zone === 'function' ? set.zone() : null);
  const _keysOf = (p) => (p.slots || []).map(s => s.key);
  const _cap = (t) => String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1);

  // The attachments in the order their numbers count - per part, per slot, then the rest. Empty places count too: they
  // keep their numbers.
  function _ordered() {
    const z = _zone();
    if (!z) return _atts;
    const out = [];
    for (const p of z.parts) {
      const mine = _atts.filter(a => _kindOf(a) === p.kind);
      const keys = _keysOf(p);
      for (const k of keys) out.push(...mine.filter(a => a.slot === k));
      out.push(...mine.filter(a => !keys.includes(a.slot)));
    }
    // A kind no part has (cannot happen with the video chat's three) keeps its place at the end.
    for (const a of _atts) if (!out.includes(a)) out.push(a);
    return out;
  }
  // What goes - the empty places left out.
  const _real = () => _ordered().filter(a => !a.hole);
  const _numOf = (a) => _ordered().filter(x => _kindOf(x) === _kindOf(a)).indexOf(a) + 1;

  // Which slot of its part an attachment goes into: the armed one while it has room, else the first that MUST still
  // be filled, else the first that may, else "other" ('').
  function _slotFor(p) {
    if (!p.slots) return '';
    const inSlot = (k) => _atts.filter(a => _kindOf(a) === p.kind && a.slot === k).length;
    if (_armed && _armed.kind === p.kind) {
      if (_armed.slot === '') return '';
      const s = p.slots.find(x => x.key === _armed.slot);
      if (s && inSlot(s.key) < s.max) return s.key;
    }
    const must = p.slots.find(s => inSlot(s.key) < (s.min || 0));
    if (must) return must.key;
    const may = p.slots.find(s => inSlot(s.key) < s.max);
    return may ? may.key : '';
  }

  // (phase V15) The place a new thing of this kind goes into, when it is not a new one at the end: the one the picker is
  // open on, else the first empty numbered place it fits (in the armed slot, with a recipe).
  function _placeFor(kind) {
    if (_pickAt && _pickAt.target) {
      const t = _pickAt.target;
      return _pickAt.kind === kind && !_pickAt.filled && _atts.includes(t) ? t : null;
    }
    const slot = _armed && _armed.kind === kind ? _armed.slot : null;
    return _ordered().find(a => a.hole && _kindOf(a) === kind && (slot == null || a.slot === slot)) || null;
  }

  function _attach(path, name, o) {
    if (!path || _atts.some(a => a.path === path)) return;
    const kind = (o && (o.kind === 'video' || o.kind === 'audio')) ? o.kind : 'image';
    const z = _zone();
    let slot = '';
    let into = null;
    if (z) {
      const p = z.parts.find(x => x.kind === kind);
      if (!p || !p.room || p.off) { _say((p && (p.off || p.none)) || 'This model takes no ' + kind + '.'); return; }
      // `atEnd` (phase V15): a new place after the others - the storyboard is the last picture.
      into = o && o.atEnd ? null : _placeFor(kind);
      if (into) slot = into.slot != null ? into.slot : _slotFor(p);
      else {
        // Its places - the empty ones too - are as many as the model takes.
        const n = _atts.filter(a => _kindOf(a) === kind).length;
        if (n >= p.room) { _say(p.full || ('This model takes ' + p.room + ' ' + (p.room === 1 ? p.one : p.word) + '.')); return; }
        slot = _slotFor(p);
      }
    } else {
      const room = set.room();
      if (_atts.length >= room) {
        _say(room ? 'This model takes ' + room + ' ' + (room === 1 ? S.noun.one : S.noun.many) + '.' : 'This model takes no ' + S.noun.many + '.');
        return;
      }
    }
    _say('');
    // (phase V7) A clip or a sound comes with its poster, its length and the part of it that goes (in/out); (phase V15)
    // a thing that says what it is for - a voice from the picker's voices - with its role and its name.
    const att = { path, name: name || '', kind, slot };
    for (const k of ['poster', 'dur', 'in', 'out', 'role', 'label']) if (o && o[k] != null && o[k] !== '') att[k] = o[k];
    if (into) {
      // Its place and its number: what stood there - empty, or the thing the picker was opened on - is replaced.
      _atts[_atts.indexOf(into)] = att;
      if (_pickAt && _pickAt.target === into) { _pickAt.target = att; _pickAt.filled = true; }
    } else {
      _atts.push(att);
      _grew = kind;
    }
    if (typeof S.onAttach === 'function') S.onAttach(att);
    // An armed slot that is full now lets go.
    if (z && _armed && _armed.kind === kind && _armed.slot === slot && slot) {
      const p = z.parts.find(x => x.kind === kind);
      const s = (p.slots || []).find(x => x.key === slot);
      if (!s || _atts.filter(a => _kindOf(a) === kind && a.slot === slot).length >= s.max) _armed = null;
    }
    _attSeq++;
    _paintAtts();
    _paintStrip();
    _draftLater();
  }

  // Taken out: in the zone its place stays, empty and numbered (phase V15) - unless nothing comes after it.
  function _detach(path) {
    const i = _atts.findIndex(a => a.path === path);
    if (i < 0) return;
    if (_zone()) {
      const was = _atts[i];
      const hole = { hole: true, kind: _kindOf(was), slot: was.slot, id: 'h' + Date.now().toString(36) + (++_holeSeq) };
      _atts[i] = hole;
      if (_pickAt && _pickAt.target === was) { _pickAt.target = hole; _pickAt.filled = false; }
      _trimHoles();
    } else _atts.splice(i, 1);
    _attSeq++;
    _paintAtts();
    _paintStrip();
    _draftLater();
  }

  // (phase V16) Everything in the zone replaced: a message's attachments put back, or none at all.
  function _useAtts(list) {
    _atts = [];
    _armed = null;
    for (const a of list || []) {
      if (!a || !a.path) continue;
      _attach(a.path, a.name || a.label || '', { kind: a.kind, role: a.role, label: a.label, in: a.in, out: a.out, atEnd: true });
    }
    _attSeq++;
    _paintAtts();
    _paintStrip();
    _draftLater();
  }

  // An empty place closed by its cross: the numbers after it move up.
  function _closeHole(h) {
    const i = _atts.indexOf(h);
    if (i < 0) return;
    _atts.splice(i, 1);
    _trimHoles();
    _attSeq++;
    _paintAtts();
    _draftLater();
  }

  // Empty places at the end of a part's numbers hold nothing up: they go - all but the one the picker is open on.
  function _trimHoles() {
    const z = _zone();
    if (!z) return false;
    const keep = _pickAt && _pickAt.target;
    let cut = false;
    for (const p of z.parts) {
      const mine = _ordered().filter(a => _kindOf(a) === p.kind);
      for (let i = mine.length - 1; i >= 0 && mine[i].hole && mine[i] !== keep; i--) {
        _atts.splice(_atts.indexOf(mine[i]), 1);
        cut = true;
      }
    }
    return cut;
  }

  // (phase V15) Why a send cannot go yet: the first empty numbered place of a part that takes things - the numbers in
  // the prompt would move under it. It blinks; null when there is none.
  function _holeWhy() {
    const z = _zone();
    if (!z) return null;
    for (const p of z.parts) {
      if (!p.room || p.off) continue;
      const mine = _ordered().filter(a => _kindOf(a) === p.kind);
      const h = mine.find(a => a.hole);
      if (!h) continue;
      const s = p.slots ? p.slots.find(x => x.key === h.slot) : null;
      _flashCell(_ui && _ui.atts.querySelector('.mv3-ig-cell.is-hole[data-hole="' + CSS.escape(h.id) + '"]'));
      return [_cap(s ? (s.label || s.key) : p.one) + ' ' + (mine.indexOf(h) + 1) + ' is empty.',
        'Put one in its place, or close the place with its ✕ - the numbers after it move up.'];
    }
    return null;
  }

  function _setAtt(path, patch) {
    const a = _atts.find(x => x.path === path);
    if (!a) return;
    for (const [k, v] of Object.entries(patch || {})) {
      if (k === 'path' || k === 'kind' || k === 'slot') continue;
      if (v == null || v === '') delete a[k]; else a[k] = v;
    }
    _attSeq++;
    _paintAtts();
    _draftLater();
  }

  // A recipe came or went: what lies in no slot of it finds one, in the order it was attached. The numbers are counted
  // anew - its empty places go.
  function _reslot(o) {
    _armed = null;
    const z = _zone();
    if (z) {
      const keep = [];
      const loose = [];
      for (const a of _atts) {
        if (a.hole) continue;
        const p = z.parts.find(x => x.kind === _kindOf(a));
        const placed = o && o.unplaced ? a.slot !== undefined : (p && _keysOf(p).includes(a.slot));
        if (placed) keep.push(a); else loose.push(a);
      }
      _atts = keep;
      for (const a of loose) {
        const p = z.parts.find(x => x.kind === _kindOf(a));
        _atts.push(Object.assign({}, a, { slot: p ? _slotFor(p) : '' }));
      }
    }
    _paintAtts();
    _draftLater();
  }

  function _flash(kind, slot) {
    if (!_ui) return;
    _flashCell(_ui.atts.querySelector('.mv3-ig-cell.is-empty[data-kind="' + kind + '"][data-slot="' + CSS.escape(slot || '') + '"]'));
  }
  function _flashCell(c) {
    if (!c) return;
    c.classList.remove('is-flash');
    void c.offsetWidth;
    c.classList.add('is-flash');
    c.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setTimeout(() => c.classList.remove('is-flash'), 1200);
  }

  function _paintAtts() {
    if (!_ui) return;
    const host = _ui.atts;
    host.textContent = '';
    const z = _zone();
    host.classList.toggle('is-zone', !!z);
    if (!z) {
      _atts.forEach((a, i) => host.appendChild(_filled(a, i + 1)));
      // The empty places are the invitation - as many as the model takes, a description's most at most.
      const room = set.room();
      for (let i = _atts.length; i < room; i++) {
        const slot = el('button', 'mv3-ig-att-slot', '+');
        slot.type = 'button';
        slot.title = T.slot;
        slot.addEventListener('click', () => _ui.file.click());
        host.appendChild(slot);
      }
      if (_atts.length >= 2) host.appendChild(el('span', 'mv3-ig-att-note', 'Say which one you mean by its number.'));
      set.onAtts();
      return;
    }
    const order = _ordered();
    const num = (a) => order.filter(x => _kindOf(x) === _kindOf(a)).indexOf(a) + 1;
    for (const p of z.parts) host.appendChild(_part(p, num));
    set.onAtts();
    if (_picking) Pick.pickChanged();
  }

  // One part of the zone: its word and count, then its cells in a row that scrolls sideways.
  function _part(p, num) {
    const box = el('div', 'mv3-ig-part is-' + p.kind);
    // Its places in order - empty ones too (phase V15).
    const mine = _ordered().filter(a => _kindOf(a) === p.kind);
    const real = mine.filter(a => !a.hole);
    const head = el('div', 'mv3-ig-part-h', p.word);
    if (p.room && !p.off) head.appendChild(el('b', null, real.length + ' / ' + p.room));
    // (phase V16) A part's own word on its head line - the video chat's frames going as references.
    if (p.note && p.room && !p.off) {
      const nt = el('span', 'mv3-ig-part-note', p.note);
      nt.title = p.noteLong || p.note;
      head.appendChild(nt);
    }
    box.appendChild(head);
    const row = el('div', 'mv3-ig-part-row');
    if (!p.room || p.off) {
      // Nothing taken here - or not yet: the recipe's cells stand dimmed so it is clear what it wanted.
      const why = !p.room ? p.none : p.off;
      box.title = why || '';
      box.classList.add('is-off');
      if (real.length) {
        // (phase V7) Attached under a model that took them: they stay in sight, each with its cross, until taken off
        // or another model takes them again - the send says why it will not go with them.
        for (const a of real) row.appendChild(_cell(_filled(a, num(a)), '', ''));
      } else if (p.slots && p.slots.length) {
        for (const s of p.slots) row.appendChild(_empty(p, s, true));
      } else row.appendChild(el('span', 'mv3-ig-part-off', !p.room ? 'none' : 'next step'));
      box.appendChild(row);
      return box;
    }
    // (phase V7) A clip let go over this part of the zone - from a lane of the timeline - is attached here, the part
    // of its file the timeline plays (timeline-b.js asks for [data-drop-kind]; the description takes 'mv3:clip-out').
    if (p.kind !== 'image') box.dataset.dropKind = p.kind;
    // A thing, or its empty place, in a cell wearing its slot's name. A slot or a part with an empty place offers no
    // other: that place is where the next one goes.
    // (phase V15) A voice and a storyboard wear their word, so the message can say what each is by its number.
    const tag = (a) => (a.role === 'voice' || a.role === 'storyboard' ? a.role : '');
    const put = (a, s, must) => row.appendChild(a.hole ? _holeCell(p, a, num(a), s, must)
      : _cell(_filled(a, num(a), p, s), tag(a) || (s ? (s.label || s.key) : ''),
        a.role === 'voice' ? a.label : a.role === 'storyboard' ? 'The storyboard - the video follows it panel by panel' : s && s.hint));
    if (p.slots) {
      for (const s of p.slots) {
        const inS = mine.filter(a => a.slot === s.key);
        const must = inS.filter(a => !a.hole).length < (s.min || 0);
        for (const a of inS) put(a, s, must);
        if (!inS.some(a => a.hole) && inS.length < s.max && mine.length < p.room) row.appendChild(_empty(p, s, false, must));
      }
      const keys = _keysOf(p);
      const other = { key: '', label: p.otherLabel || 'other', hint: p.other || '' };
      const rest = mine.filter(x => !keys.includes(x.slot));
      for (const a of rest) put(a, other, false);
      // "other" only where the room is more than the recipe's own places can still take (phase V7.5: Kling's one clip
      // is the recipe's "moves" - an "other" beside it offered a second clip the model does not take).
      const open = p.slots.reduce((n, s) => n + Math.max(0, s.max - mine.filter(a => a.slot === s.key).length), 0);
      if (!rest.some(a => a.hole) && mine.length < p.room && p.room - mine.length > open) row.appendChild(_empty(p, other, false, false));
    } else {
      for (const a of mine) put(a, null, false);
      if (!mine.some(a => a.hole) && mine.length < p.room) row.appendChild(_empty(p, null, false, false));
    }
    _sideways(row);
    box.appendChild(row);
    // The place that just appeared is where the eye goes: after an attachment its row comes to its end.
    if (_grew === p.kind) { _grew = ''; requestAnimationFrame(() => { row.scrollLeft = row.scrollWidth; }); }
    return box;
  }

  // An attached thing: its picture, its NUMBER - with more than one, the message has to say which is which - and a cross.
  // (phase V7) A clip shows its poster and a sound a note, each with the seconds of it that go. (phase V15) In the zone
  // (`p` given, with a picker) a press opens the picker on its place, on it; a clip's or a sound's seconds open the part
  // that goes (S.trimFor).
  function _filled(a, n, p, s) {
    const kind = _kindOf(a);
    const swap = !!(p && S.pick);
    const cell = el('div', 'mv3-ig-att' + (kind === 'video' ? ' is-clip' : kind === 'audio' ? ' is-sound' : '') + (swap ? ' is-swap' : ''));
    cell.dataset.path = a.path;
    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = thumbOf(a.path, 'strip');
      img.loading = 'lazy';
      img.decoding = 'async';
      // Gone from the library since it was attached: it goes from the row, and the row says so.
      img.addEventListener('error', () => { _detach(a.path); _say('A ' + S.noun.one + ' in the row is not in the library any more.'); }, { once: true });
      cell.appendChild(img);
      cell.addEventListener('mouseenter', () => peekShow(thumbOf(a.path, 'main'), cell));
      cell.addEventListener('mouseleave', peekHide);
      cell.title = (a.name || '') + (swap ? (a.name ? ' - ' : '') + 'press to put another in its place' : '');
      // (phase V16) A picture that does not go as things are - dimmed, its cross kept, the reason on it (the video
      // chat: one beyond the frames' places).
      const st = (typeof S.attState === 'function' ? S.attState(a) : null) || {};
      if (st.off) { cell.classList.add('is-dim'); cell.title = st.off; }
    } else {
      if (kind === 'video' && a.poster) {
        const img = document.createElement('img');
        img.src = thumbOf(a.poster, 'strip');
        img.loading = 'lazy';
        img.decoding = 'async';
        cell.appendChild(img);
        cell.addEventListener('mouseenter', () => peekShow(thumbOf(a.poster, 'main'), cell));
        cell.addEventListener('mouseleave', peekHide);
      } else cell.appendChild(el('span', 'ic', kind === 'audio' ? '♪' : '▶'));
      const secs = (+a.out > +a.in) ? (+a.out - +a.in) : 0;
      // What the description says of it: `bad` - it cannot go like this, and why; `cut` - only a part of it goes.
      const st = (typeof S.attState === 'function' ? S.attState(a) : null) || {};
      if (secs || +a.dur > 0) {
        const d = el('button', 'dur' + (st.cut ? ' is-cut' : ''), secs.toFixed(1) + 's');
        d.type = 'button';
        d.title = (st.cut ? secs.toFixed(1) + ' s of ' + (+a.dur).toFixed(1) + ' go' : 'all ' + secs.toFixed(1) + ' s go') + ' - press to choose the part';
        d.addEventListener('click', (ev) => {
          ev.stopPropagation();
          peekHide();
          if (typeof S.trimFor === 'function') S.trimFor(a, cell);
        });
        cell.appendChild(d);
      }
      if (st.bad) { cell.classList.add('is-bad'); cell.title = st.bad; }
      else cell.title = (a.name || '') + (swap ? (a.name ? ' - ' : '') + 'press to put another in its place, its seconds to choose the part' : '');
    }
    if (swap) {
      cell.addEventListener('click', (ev) => {
        if (ev.target.closest('.x, .dur')) return;
        peekHide();
        _openPick(p, s, a);
      });
    }
    cell.appendChild(el('span', 'n', String(n)));
    const x = el('button', 'x', '✕');
    x.type = 'button';
    x.title = swap ? 'Not this one - its place stays, empty, and keeps its number' : 'Not this one';
    x.addEventListener('click', (ev) => { ev.stopPropagation(); _detach(a.path); });
    cell.appendChild(x);
    return cell;
  }

  // A cell of the zone: the thing (or its empty place) and, with a recipe, the slot's name under it.
  function _cell(inner, label, hint) {
    const c = el('div', 'mv3-ig-cell');
    c.appendChild(inner);
    if (label) {
      const l = el('span', 'lab', label);
      if (hint) l.title = hint;
      c.appendChild(l);
    }
    return c;
  }

  // An empty place - a slot's, with a recipe: pressed, the picker opens on it (phase V13), or - for a description
  // without one - this computer is asked for a file.
  function _empty(p, s, dim, must) {
    const key = s ? s.key : '';
    const b = el('button', 'mv3-ig-att-slot', '+');
    b.type = 'button';
    b.title = (s && s.hint) || T.slot;
    const c = _cell(b, s ? (s.label || s.key) : '', s && s.hint);
    c.classList.add('is-empty');
    c.dataset.kind = p.kind;
    c.dataset.slot = key;
    if (must) c.classList.add('is-req');
    if (dim) { c.classList.add('is-off'); b.disabled = true; return c; }
    b.addEventListener('click', () => {
      if (S.pick) { _openPick(p, s); return; }
      const input = _fileOf(p.kind);
      if (input) input.click();
    });
    return c;
  }

  // (phase V15) An empty NUMBERED place - a thing taken out: its number stays, "+" opens the picker on it, the cross
  // closes it (the numbers after it move up).
  function _holeCell(p, h, n, s, must) {
    const box = el('div', 'mv3-ig-att is-hole');
    const go = el('button', 'go', '+');
    go.type = 'button';
    const what = s && s.key ? (s.label || s.key) : p.one;
    go.title = _cap(what) + ' ' + n + ' is empty - press to put one in its place; the prompt still calls it ' + n;
    go.addEventListener('click', () => {
      if (S.pick) { _openPick(p, s, h); return; }
      const input = _fileOf(p.kind);
      if (input) input.click();
    });
    box.appendChild(go);
    box.appendChild(el('span', 'n', String(n)));
    const x = el('button', 'x', '✕');
    x.type = 'button';
    x.title = 'Close this place - the numbers after it move up';
    x.addEventListener('click', () => _closeHole(h));
    box.appendChild(x);
    const c = _cell(box, s ? (s.label || s.key) : '', s && s.hint);
    c.classList.add('is-empty', 'is-hole');
    if (must) c.classList.add('is-req');
    c.dataset.kind = p.kind;
    c.dataset.slot = (s && s.key) || '';
    c.dataset.hole = h.id;
    return c;
  }

  // ── The picker (phase V13, the owner 2026-10-07) ──────────────────────────
  // For ONE place: its part, and with a recipe its slot - "other" ('') for what the recipe did not ask for, null for a
  // part without slots. The slot is armed while the window is open; the window closes by itself once the place is full.
  // (phase V15) `target`: a place that is there - a thing in the zone, or an empty numbered place. The window opens on
  // the thing's shelf, on it, and what is pressed there takes that place and its number.
  let _picking = false;
  let _pickAt = null;           // { kind, slot, target, filled } of the place the picker is open on
  function _openPick(p, s, target) {
    const P = S.pick;
    const kind = p.kind;
    const slot = s ? s.key : null;
    _armed = p.slots ? { kind, slot: slot || '' } : null;
    _picking = true;
    _pickAt = { kind, slot, target: target || null, filled: false };
    if (typeof P.onOpen === 'function') P.onOpen();
    peekHide();
    const U = _U(kind);
    const label = s ? (s.label || s.key || '') : '';
    const n = target ? _numOf(target) : 0;
    Pick.openPick({
      kind,
      title: p.word + (n ? ' · ' + (label || p.one) + ' ' + n : label ? ' · ' + label : ''),
      hint: (s && s.hint) || '',
      project: { key: _key || '', title: Store.title() || '' },
      sources: P.sources(kind),
      start: P.start(kind, s),
      first: (P.first || {})[kind] || '',
      select: target && target.path && typeof P.sourceOf === 'function' ? { srcs: P.sourceOf(target.path, kind), path: target.path } : null,
      left: _pickLeft,
      room: () => (!_pickAt || !_pickAt.target || _pickAt.filled ? ''
        : _pickAt.target.hole ? 'its place is empty - one goes here' : 'press another to put it in its place'),
      mark: _markOf,
      press: (it) => {
        const here = _atts.find(a => a.path === it.path);
        if (here) {
          // Opened on another place: one place per file - it stays where it is.
          if (_pickAt && _pickAt.target && _pickAt.target !== here) { _say(_cap(_markOf(it.path)) + ' is this one already - one place per file.'); return; }
          _detach(it.path);
          return;
        }
        _attach(it.path, it.name, kind === 'image' ? {} : { kind, poster: it.poster || '', dur: +it.dur || 0, role: it.role || '', label: it.label || '' });
      },
      why: (it) => P.why(it, kind),
      computer: {
        word: p.word, hint: (P.upWords || {})[kind] || '',
        open: () => { const input = _fileOf(kind); if (input) input.click(); },
        accepts: (f) => !!(U && U.ok(f)),
        drop: (files) => _upload(files),
      },
      onClose: () => {
        _picking = false;
        _pickAt = null;
        _armed = null;
        const cut = _trimHoles();
        if (_ui) _paintAtts();
        if (cut) _draftLater();
      },
    });
  }

  // How many more go into the place the picker is open on: one into a place that is there, until it is filled.
  function _pickLeft() {
    if (!_pickAt) return 0;
    if (_pickAt.target) return _pickAt.filled ? 0 : 1;
    return _leftIn(_pickAt.kind, _pickAt.slot);
  }

  // How many more go into a place: its part's room, less - for a slot - what the slot has, and for "other" the places
  // the recipe's own slots still hold. An empty numbered place there is one more that goes (it is filled first).
  function _leftIn(kind, slot) {
    const z = _zone();
    const p = z && z.parts.find(x => x.kind === kind);
    if (!p || !p.room || p.off) return 0;
    const mine = _atts.filter(a => _kindOf(a) === kind);
    const free = p.room - mine.length;
    if (!p.slots || slot == null) return mine.filter(a => a.hole).length + Math.max(0, free);
    const inS = (k) => mine.filter(a => a.slot === k).length;
    if (slot === '') {
      const keys = _keysOf(p);
      const holes = mine.filter(a => a.hole && !keys.includes(a.slot)).length;
      return holes + Math.max(0, free - p.slots.reduce((n, x) => n + Math.max(0, x.max - inS(x.key)), 0));
    }
    const s = p.slots.find(x => x.key === slot);
    const holes = mine.filter(a => a.hole && a.slot === slot).length;
    return s ? holes + Math.max(0, Math.min(free, s.max - inS(slot))) : 0;
  }

  // What a thing is in the zone, as the picker marks it: its place and its number ("person 1", "picture 2").
  function _markOf(path) {
    const a = _atts.find(x => x.path === path);
    if (!a) return '';
    const k = _kindOf(a);
    const n = _numOf(a);
    const z = _zone();
    const p = z && z.parts.find(x => x.kind === k);
    const s = p && p.slots ? p.slots.find(x => x.key === a.slot) : null;
    return (s ? (s.label || s.key) : p && p.slots ? 'other' : (p && p.one) || S.noun.one) + ' ' + n;
  }

  // A row too long for its part scrolls sideways - the wheel too, while it has somewhere to go.
  function _sideways(row) {
    row.addEventListener('wheel', (e) => {
      if (row.scrollWidth <= row.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  // ── Bringing files in from this computer ──────────────────────────────────
  // Through the chat's own door: the file is filed on its shelf under the PROJECT's category - the thread
  // keeps a path, never the bytes - and goes straight into the row. Nothing else uploads it: the Library's
  // own drop stands down while a chat shows, or one drop would file it twice.
  function _upload(files) {
    const run = _uploadNow(files);
    const all = Promise.all([_uploading, run]);
    _uploading = all;
    all.finally(() => { if (_uploading === all) _uploading = null; });
    return run;
  }

  // (phase V7) What a description takes from this computer, by kind: `S.uploads` { image, video, audio } - each its own
  // door ({ url, field, accept, ok(file), att(item) }) - or the one `S.upload` for pictures.
  const _U = (k) => (S.uploads ? S.uploads[k] || null : (k === 'image' ? S.upload : null));
  const _kindOfFile = (f) => ['image', 'video', 'audio'].find(k => _U(k) && _U(k).ok(f)) || '';
  const _fileOf = (k) => (_ui && _ui.files ? _ui.files[k] || null : null);

  async function _uploadNow(files) {
    let all = [...(files || [])].filter(f => f && _kindOfFile(f));
    // (phase V13) While the picker is open, files are for its place: its kind only, and no more than the place has room
    // for - the rest would spill into the other slots of the part.
    let note = '';
    if (_picking && _pickAt) {
      const U = _U(_pickAt.kind);
      const mine = all.filter(f => U && U.ok(f));
      const room = _pickLeft();
      if (mine.length > room) note = 'Only ' + room + ' more ' + (room === 1 ? 'goes' : 'go') + ' here - the rest were not added.';
      else if (mine.length < all.length) note = 'Only files of this kind go here - the others were not added.';
      all = mine.slice(0, room);
    }
    if (!all.length) { _say(note || T.onlyFiles); return; }
    // A kind the model takes none of is not brought in at all - it would land on its shelf and go nowhere.
    const z = _zone();
    const partOf = (k) => (z ? z.parts.find(p => p.kind === k) : null);
    const takes = (k) => !z || !!(partOf(k) && partOf(k).room && !partOf(k).off);
    const list = all.filter(f => takes(_kindOfFile(f)));
    if (!list.length) { const p = partOf(_kindOfFile(all[0])); _say((p && (p.off || p.none)) || T.onlyFiles); return; }
    _made = true;
    _say('adding ' + list.length + ' ' + (list.length === 1 ? 'file' : 'files') + '…');
    let bad = list.length < all.length ? ((partOf(_kindOfFile(all.find(f => !list.includes(f)))) || {}).none || '') : '';
    const filed = new Set();
    for (const f of list.slice(0, S.maxAtts)) {
      const k = _kindOfFile(f);
      const U = _U(k);
      const fd = new FormData();
      fd.append(U.field, f);
      fd.append('name', String(f.name || S.noun.one).replace(/\.[^.]+$/, ''));
      fd.append('project', _key || '');
      const d = await json(U.url, { method: 'POST', body: fd });
      if (d && d.success && d.item) {
        filed.add(k);
        const a = typeof U.att === 'function' ? U.att(d.item) : { path: d.item.imagePath, name: d.item.name };
        _attach(a.path, a.name, Object.assign({}, a, { kind: k }));
      } else bad = (d && d.error) || 'it could not be added';
    }
    // (review V7) What the attaching said of a file that came in ("…the first 15 s go", why it was not taken) stays: only
    // the "adding…" line goes, or the words of what was not added stand in its place.
    if (bad) _say('Not added: ' + bad);
    else if (note) _say(note);
    else if (_ui && /^adding \d+ /.test(_ui.said.textContent || '')) _say('');
    _loadCats();
    // The shelf a file was filed on shows it in the picker.
    if (_picking) for (const k of filed) Pick.pickRefresh(((S.pick || {}).lands || {})[k] || '');
  }

  // ── The thread ────────────────────────────────────────────────────────────
  function _stageWords(g) {
    if (g.error && !g.stage) return g.error.slice(0, 60) + ' — trying the next…';
    return g.stage ? g.stage + '…' : S.busyWord + '…';
  }

  // (phase V6) A card is drawn again when what it IS changes - never for the text being typed into it; its clips are
  // its description's to keep fresh in place (the owner, 2026-10-06: a made card stays a field to edit and make again
  // from, and a clip landing must not rebuild it under the typing).
  const _sig = (m) => ((m.card && typeof S.cardSig === 'function') ? [m.text || '', S.cardSig(m)]
    : [m.text || ''].concat(_gensOf(m).map(g => g.id + ':' + g.state + ':'
      + (g.state === 'done' ? _path(g) : g.state === 'failed' ? g.error : '')))).join('|');

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
    // The column's own results are read with the thread - when there is a column, and it shows this project's own.
    const own = !!_ui.list && !_cat;
    const [d, f] = k
      ? await Promise.all([
        json('/api/mv3/chat?project=' + encodeURIComponent(k) + '&kind=' + S.kind),
        own ? json(S.feed.url(k)) : null,
      ])
      : [{ success: true, items: [] }, own ? { success: true, items: [] } : null];
    if (mine !== _seq || k !== (_key || '') || !_chat) return;
    if (d && d.success) {
      _thread = d.items || [];
      _talk = !!_thread.length;
      _paintHead();
    }
    // A category is read when it is chosen, not on every tick.
    if (f && f.success && own) _feed = (f.items || []).map(S.feed.map);
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
        else if (_pending.has(g.id) && g.state === 'done' && _path(g)) {
          landed.add(g.id);
          _made = true;
          const at = _sendSeq.get(m.id);
          if (S.landAsRef !== false && at != null && at === _attSeq && set.room() > 0) {
            const was = _attSeq;
            _atts = [{ path: _path(g), name: (g.prompt || '').slice(0, 60) }];
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
    // (phase V6) The description lays its foot for the thread as it is now - before the empty line is decided.
    if (typeof S.onThread === 'function') S.onThread(_thread);
    const ids = new Set(_thread.map(m => m.id));
    for (const [id, n] of _nodes) {
      if (ids.has(id)) continue;
      _dropProgs(n, null);
      n.el.remove();
      _nodes.delete(id);
    }
    let empty = host.querySelector('.mv3-ig-empty');
    // (phase V6) The foot - a description's own step at the end of the thread (the video chat's recipe card) - stands
    // for the conversation too: with it there is no "describe a clip".
    const footed = !!(_ui.foot && _ui.foot.childNodes.length);
    if (!_thread.length && !footed) {
      if (!empty) { empty = el('div', 'mv3-ig-empty'); host.insertBefore(empty, _ui.foot); }
      empty.textContent = _key ? T.empty : T.emptyNoProject;
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
    // The foot stays the last thing in the thread.
    if (_ui.foot && host.lastChild !== _ui.foot) host.appendChild(_ui.foot);
    if (atEnd) host.scrollTop = host.scrollHeight;
  }

  // (phase V6) What a message's results look like - the shots, their countdowns and the facts - for a description that
  // draws the rest of the bubble itself (the video chat's prompt card).
  function _shots(m, progs) {
    const gens = _gensOf(m);
    if (!gens.length) return null;
    const box = document.createDocumentFragment();
    const wrap = el('div', 'mv3-ig-shots' + (gens.length > 1 ? ' is-many' : ''));
    for (const g of gens) wrap.appendChild(_shot(g, progs));
    box.append(wrap, _facts(gens[0]));
    return box;
  }

  function _bubble(m, progs) {
    // (phase V6) A card is the description's to draw.
    if (m.card && typeof S.cardBubble === 'function') {
      const c = S.cardBubble(m, progs);
      if (c) return c;
    }
    const b = el('div', 'mv3-ig-msg is-' + (m.role === 'user' ? 'user' : 'agent'));
    if (m.text) b.appendChild(el('div', 'mv3-ig-text', m.text));
    // What the turn pointed at: by kind where the message says (the video chat's `media`), else its pictures.
    const sent = (m.media || []).length ? m.media : (m.refs || []).map(p => ({ path: p, kind: 'image' }));
    if (m.role === 'user' && sent.length) {
      const row = el('div', 'mv3-ig-msg-refs');
      const count = { image: 0, video: 0, audio: 0 };
      for (const a of sent) {
        const k = count[a.kind] != null ? a.kind : 'image';
        count[k]++;
        row.appendChild(refCell(a, k, count[k], { show: peekShow, hide: peekHide }));
      }
      b.appendChild(row);
    }
    // ONE TURN, EVERY RESULT IT SPEAKS FOR, each in whatever state it is actually in.
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
    if (g.state === 'done' && _path(g)) {
      // The description draws a finished one - and a press on it opens the thread's finished ones large.
      S.shot(g, cell, () => _view(g));
    } else if (g.state === 'pending') {
      const ghost = el('div', 'mv3-ig-shot is-busy');
      ghost.style.aspectRatio = String(g.aspect || '9:16').replace(':', '/');
      cell.appendChild(ghost);
      const strip = el('div', 'mv3-ig-prog');
      cell.appendChild(strip);
      progs.set(g.id, startInlineProgress(strip, {
        label: _stageWords(g), key: S.progressKey(g), estimateMs: S.eta,
        startedAt: Date.parse(g.at) || 0,
        onCancel: g.alertId ? () => _letGo(g) : null,
      }));
    } else {
      cell.appendChild(el('div', 'mv3-ig-bad', g.error || 'nothing came back'));
      if (!g.cancelled && g.alertId && !/question instead/.test(g.error || '')) cell.appendChild(el('div', 'mv3-ig-note', 'Alerts can try it again'));
    }
    return cell;
  }

  // The technical half, folded away - including what was actually sent, which is the only way a result
  // that came out wrong can be argued with.
  function _facts(g) {
    const wrap = el('div', 'mv3-ig-more');
    const btn = el('button', 'mv3-ig-more-b', 'read more');
    btn.type = 'button';
    const body = el('div', 'mv3-ig-more-body');
    body.hidden = true;
    for (const [k, v] of S.facts(g)) {
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

  // Every result this thread finished, large - the description says how.
  function _view(g) {
    peekHide();
    const done = _thread.flatMap(_gensOf).filter(x => x && x.state === 'done' && _path(x));
    S.view(done, Math.max(0, done.findIndex(x => x.id === g.id)));
  }

  // On the lane above main video, at the playhead (js/merge-v3/timeline-b.js placeAbove).
  async function _place(item, anchor) {
    const Tl = await import('./timeline-b.js');
    // Not picked on the timeline: a picked clip slides its settings over the Library - over this chat.
    // A clip (the video chat) goes with its length and its sound; a picture as a still.
    const r = item && item.clip ? Tl.placeClipAbove(item, { select: false }) : Tl.placeAbove(item, { select: false });
    if (!r.ok) { note(anchor, 'Not added.', r.why); return; }
    note(anchor, 'Added to ' + r.lane + '.', 'At the playhead, ' + r.at.toFixed(1) + 's.');
    setTimeout(() => closeAsk(), 2400);
  }

  // The cross on a countdown: the row is let go of - what was asked for is paid for, and it says so.
  async function _letGo(g) {
    await json('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', { method: 'POST' });
    _reload();
  }

  function _schedule() {
    clearTimeout(_timer);
    _timer = 0;
    if (!_chat) return;
    const busy = _pending.size || _feed.some(x => x.state === 'pending')
      // (phase V6) A description's own waiting in the thread - the video chat's card being written.
      || (typeof S.busy === 'function' && S.busy(_thread));
    _timer = setTimeout(() => { _timer = 0; if (_chat && !document.hidden) _reload(); else _schedule(); }, busy ? POLL_MS : IDLE_MS);
  }
  function _stop() { clearTimeout(_timer); _timer = 0; }

  // ── Sending ───────────────────────────────────────────────────────────────
  async function _send() {
    if (_sending || !_ui) return;
    const ta = _ui.ta;
    const at = _ui.go;
    // (phase V7.3) A description may stand in for an empty box - Kling motion control's standard prompt.
    const text = ta.value.trim() || (typeof S.emptyText === 'function' ? String(S.emptyText() || '').trim() : '');
    // (phase V16) A description may let the box go empty - the video chat's writer makes a clip from the attachments.
    if (!text && !(typeof S.emptyOk === 'function' && S.emptyOk())) {
      ta.focus();
      ta.classList.add('is-bad');
      setTimeout(() => ta.classList.remove('is-bad'), 900);
      return;
    }
    // (phase V15) An empty numbered place first: the numbers in the prompt would move under it.
    const why = _holeWhy() || set.ready();
    if (why) { note(at, why[0], why[1]); return; }
    _sending = true;
    _ui.go.disabled = true;
    try {
      // A file still on its way into the row goes with this message, not after it.
      if (_uploading) { _say('waiting for the ' + S.noun.one + ' to be added…'); await _uploading.catch(() => {}); _say(''); }
      if (!Store.key()) {
        _adopt = true;
        try { await _ensureProject(); }
        catch (e) { _adopt = false; note(at, 'Could not start a project.', String(e.message || e).slice(0, 120)); return; }
      }
      const key = Store.key();
      const d = await json(S.sendUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ project: key, text, refs: _real().map(a => a.path) }, set.body(), {
          n: _n, write: _write,
          // Where it was asked from, for Alerts (js/alerts-bell.js): the project, and this chat in it.
          where: {
            page: 'merge', href: '/merge?p=' + encodeURIComponent(key) + '&open=' + S.name,
            label: 'Merge · ' + (Store.title() || 'project') + ' · ' + S.name,
            spot: { key, view: S.name },
          },
        })),
      });
      if (!d || !d.success) { note(at, 'Not sent.', (d && d.error) || 'the server did not answer'); return; }
      ta.value = '';
      _grow();
      // (phase V16) What the description does once a send is in (the video chat: the zone emptied - its attachments are
      // packed into the writer's message).
      if (typeof S.afterSend === 'function') S.afterSend(d);
      _saveDraft(_key || '');
      if (d.send) _sendSeq.set(d.send, _attSeq);
      await _reload(true);
    } finally {
      _sending = false;
      if (_ui) { _ui.go.disabled = false; _ui.ta.focus(); }
    }
  }

  // The writer on or off - the pen in the bar, or (phase V15) the description's own switch through ctx.setWriting.
  function _paintPen() {
    const pen = _ui && _ui.pen;
    if (!pen) return;
    pen.classList.toggle('on', _write);
    pen.title = _write
      ? 'The writer is on: your message is rewritten into the shape this model wants. Press to send your words exactly as typed.'
      : 'Sending your words exactly as typed. Press to let the writer shape them for this model.';
  }
  function _setWriting(v) {
    _write = !!v;
    keep(S.keys.write, _write);
    _paintPen();
    if (typeof set.onPen === 'function') set.onPen(_write);
  }

  function _grow() {
    const ta = _ui.ta;
    // Empty, it is one line - measured, the placeholder of a box not laid out yet would make it tall.
    if (!ta.value) { ta.style.height = ''; return; }
    ta.style.height = 'auto';
    ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
  }

  // ── The right column ──────────────────────────────────────────────────────
  // This project's own, or a category of the Library's Images - the pictures chat's. A description with a picker (the
  // video chat, phase V13) has none of it: `_ui.list` is null there, and everything here stands down.
  let _cats = [];               // the Images categories, as last read
  async function _loadCats() {
    if (!_ui || !_ui.cat) return;
    const d = await json(S.cats.url);
    _cats = (d && d.success) ? (d.cats || []).filter(c => c && c.id) : [];
    const sel = _ui.cat;
    sel.innerHTML = '';
    const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
    sel.appendChild(opt('', 'this project'));
    for (const c of _cats) sel.appendChild(opt(c.id, c.label || c.name || c.id));
    sel.value = [...sel.options].some(o => o.value === _cat) ? _cat : '';
    if (sel.value !== _cat) { _cat = ''; _reload(); }
  }

  // The column turned to a category by its dropdown ('' - this project's own).
  function _setCat(id) {
    if (!_ui || !_ui.cat) return;
    const v = String(id || '');
    if (v === _cat) return;
    _cat = v;
    _ui.cat.value = [..._ui.cat.options].some(o => o.value === _cat) ? _cat : '';
    _feed = [];
    _paintStrip();
    _loadStrip();
  }

  async function _loadStrip() {
    if (!_cat) return _reload();
    const k = _cat;
    const d = await json(S.cats.url + '&cat=' + encodeURIComponent(k));
    const items = (d && d.success ? d.items || [] : []).filter(i => i && i.media).map(S.cats.map);
    if (k !== _cat) return;
    _feed = items;
    _paintStrip();
  }

  // Mixed shapes, stacked in columns: each tile keeps its own shape and goes into the shorter column.
  function _paintStrip() {
    if (!_ui || !_ui.list) return;
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
    b.title = T.plus;
    b.addEventListener('click', () => { if (_ui.file) _ui.file.click(); });
    return b;
  }

  function _tile(it) {
    const t = el('div', 'mv3-ig-card'
      + (it.state === 'pending' ? ' is-busy' : it.state === 'failed' ? ' is-fail' : '')
      + (_atts.some(a => a.path === it.path) ? ' on' : ''));
    if (it.aspect) t.style.aspectRatio = String(it.aspect).replace(':', '/');
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
          name: (it.name || '').slice(0, 60), group: S.cats.group, dur: 0,
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
    try { saved = parseInt(localStorage.getItem(S.keys.strip) || '', 10); } catch (e) { saved = 0; }
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
        try { localStorage.setItem(S.keys.strip, String(Math.round(box.getBoundingClientRect().width))); } catch (err) { /* a private window */ }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    sash.addEventListener('dblclick', () => {
      apply(STRIP_DEF);
      try { localStorage.setItem(S.keys.strip, String(STRIP_DEF)); } catch (e) { /* a private window */ }
    });
  }

  // ── Hover peek ────────────────────────────────────────────────────────────
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

  // ── Narrow or wide ────────────────────────────────────────────────────────
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

  // ── Building it ───────────────────────────────────────────────────────────
  function _build() {
    if (_ui) return;
    const root = $(S.ids.root);
    if (!root) return;
    root.textContent = '';

    const setBox = el('div', 'mv3-ig-set');
    const left = el('div', 'mv3-ig-scroll');
    const said = el('div', 'mv3-ig-said');
    // (phase V15) A description's own foot of the column, under everything - the video chat's almanac.
    setBox.append(left, said, ...(typeof S.columnFoot === 'function' ? S.columnFoot() : []));

    const chat = el('div', 'mv3-ig-chat');
    const banner = el('div', 'mv3-ig-banner');
    banner.hidden = true;
    const thread = el('div', 'mv3-ig-thread');
    const atts = el('div', 'mv3-ig-atts');
    const over = el('div', 'mv3-ig-over');
    over.hidden = true;
    // A door from this computer for every kind the description takes (phase V7) - pictures' is `file`, as it was.
    const files = {};
    for (const k of ['image', 'video', 'audio']) {
      const U = _U(k);
      if (!U) continue;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = U.accept;
      input.multiple = true;
      input.hidden = true;
      files[k] = input;
    }
    const file = files.image;
    const bar = el('div', 'mv3-ig-bar');
    const ta = document.createElement('textarea');
    ta.className = 'mv3-ig-say';
    ta.rows = 1;
    ta.placeholder = T.placeholder;
    // THE WRITER: on, the message is rewritten into the shape the chosen model wants; off, the words go
    // exactly as typed. (phase V15) A description that keeps its own switch for it in its column has no pen here.
    const pen = S.penInBar === false ? null : el('button', 'pen', '✎');
    if (pen) pen.type = 'button';
    const nBtn = el('button', 'n', '×1');
    nBtn.type = 'button';
    nBtn.title = 'How many to make at once. Each is its own attempt.';
    const go = el('button', 'b', '>');
    go.type = 'button';
    go.title = 'Send (Enter) · a new line is Shift+Enter';
    bar.append(...[ta, pen, nBtn, go].filter(Boolean));
    // (phase V6) The thread's foot: a description's own step, kept the last thing in the thread.
    const foot = el('div', 'mv3-ig-foot');
    thread.appendChild(foot);
    chat.append(banner, thread, atts, over, ...Object.values(files), bar);

    // The right column - unless the description picks its attachments in a window (phase V13).
    let sash = null, stripBox = null, stripP = null, count = null, cat = null, list = null;
    if (!S.pick) {
      sash = el('div', 'mv3-sash is-v mv3-ig-sash');
      sash.title = 'Drag to resize · double-click to reset';
      stripBox = el('div', 'mv3-ig-strip');
      const sHead = el('div', 'mv3-ig-strip-head');
      stripP = el('span', 'p', Store.title() || Store.key() || 'no project');
      count = el('span', 'n', '0');
      sHead.append(stripP, count);
      cat = document.createElement('select');
      cat.className = 'mv3-ig-cat';
      cat.title = T.cat;
      list = el('div', 'mv3-ig-strip-list');
      stripBox.append(sHead, cat, list);
      root.append(setBox, chat, sash, stripBox);
    } else root.append(setBox, chat);

    // The panel header's own buttons while the chat shows.
    const head = $(S.ids.head);
    if (head) {
      head.textContent = '';
      const wipe = el('button', 'mv3-iconbtn', '⌫');
      wipe.type = 'button';
      wipe.title = 'Clear this conversation. Everything made stays in the Library' + (list ? ' and on the right.' : '.');
      wipe.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!_key) return;
        askDelete(wipe, 'Clear this conversation?',
          'Everything made stays — in the Library' + (list ? ' and in the column on the right' : '') + '. Only what was said goes.',
          async () => {
            await json('/api/mv3/chat?project=' + encodeURIComponent(_key) + '&kind=' + S.kind, { method: 'DELETE' });
            _reload(true);
          });
      });
      head.append(wipe, ...S.headButtons());
    }
    // (phase V6) Buttons right beside the chat's crumb - the video chat's catalog.
    const headL = S.ids.headL ? $(S.ids.headL) : null;
    if (headL && typeof S.crumbButtons === 'function') {
      headL.textContent = '';
      headL.append(...S.crumbButtons());
    }

    _ui = { root, set: setBox, left, said, chat, banner, thread, foot, atts, over, file, files, bar, ta, pen, nBtn, go, stripBox, stripP, count, cat, list, narrow: null };
    if (sash) _wireStripSash(sash, stripBox);

    for (const input of Object.values(files)) {
      input.addEventListener('change', () => { const f = [...(input.files || [])]; input.value = ''; _upload(f); });
    }
    if (cat) cat.addEventListener('change', () => _setCat(cat.value || ''));
    nBtn.addEventListener('click', () => {
      const i = S.counts.indexOf(_n);
      _n = S.counts[(i + 1) % S.counts.length];
      nBtn.textContent = '×' + _n;
      set.onCount();
    });
    if (pen) {
      pen.addEventListener('click', () => _setWriting(!_write));
      _paintPen();
    }
    go.addEventListener('click', () => _send());
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); _send(); }
    });
    ta.addEventListener('input', () => { _grow(); _draftLater(); });
    // A file pasted into the box is attached.
    ta.addEventListener('paste', (ev) => {
      const files = [...((ev.clipboardData && ev.clipboardData.files) || [])].filter(f => _kindOfFile(f));
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

    const d = stored(S.keys.draft, {})[_key || ''] || {};
    ta.value = String(d.text || '');
    _grow();
    set.paint();
    _paintAtts();
    if (typeof set.draftLoad === 'function') set.draftLoad(d.extra || null);
  }

  function init() {
    // "Library" in the header leaves the chat; the pale crumb on the shelf opens it; another chat coming
    // forward lets this one go (lib-views wires all three).
    Views.registerChat(S.name, {
      root: S.ids.root, head: S.ids.head, headL: S.ids.headL || '', crumb: S.ids.crumb, crumbTitle: T.crumb,
      onBack: () => _show(false), onYield: () => _show(false, false), onCrumb: () => open(),
    });
    // Back from another tab or window: the countdowns catch up at once rather than at the next tick.
    document.addEventListener('visibilitychange', () => { if (!document.hidden && _chat) _reload(); });
    window.addEventListener('beforeunload', () => { if (_key !== null) _saveDraft(_key); });
    Store.onChange(_onStore);
    _paintHead();
  }

  return { open, init, isOpen: () => _chat };
}
