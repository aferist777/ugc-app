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
   sash, the hover peek, and the narrow layout.

   ── What a description says ─────────────────────────────────────────────────
   Its name and kind, its element ids and storage keys, its words, the settings column (`settings`: load,
   paint, how many attachments fit, what goes into the send), how a finished result is drawn and opened, and
   where the right column reads from. `createChat(make)` calls `make(ctx)` with the shell's handles (ctx
   below), so a description keeps its own state in its own closure.

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
   everything to point at behind a sash. Narrower than 700px, the settings fold into one row above the input.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { setOpenColumn } from './layout.js';
import * as Views from './lib-views.js';
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
  let _atts = [];            // [{ path, name }]
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
    // In the order their numbers count (phase V6: per part of the zone, per slot of a recipe, then the rest).
    atts: () => _ordered(),
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
    // (phase V6) The right column shows this: '' this project, 'shelf:<id>' a shelf of the description's, 'images'
    // the Images category last chosen (or the project's own), or an Images category id.
    column: (id) => _setCat(id),
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
      // A sound playing in the column stops with it, and the description lets go of what floats over the chat.
      if (_sounding) { try { _sounding.audio.pause(); } catch (e) { /* gone */ } _sounding = null; }
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
    _atts = (Array.isArray(d.atts) ? d.atts : []).filter(a => a && a.path).slice(0, S.maxAtts);
    // The row as it was left there is not a change by hand: the counter comes back with it.
    _attSeq = memo ? memo.attSeq : _attSeq + 1;
    if (_ui) {
      _ui.ta.value = String(d.text || '');
      _grow();
      _paintAtts();
    }
    if (typeof set.draftLoad === 'function') set.draftLoad(d.extra || null);
  }

  function _say(t) { if (_ui) _ui.said.textContent = t || ''; }

  // ── The attachment row ────────────────────────────────────────────────────
  // (phase V6, the owner 2026-10-06) A description may lay it out as a ZONE - set.zone(): { parts: [{ kind, word, room,
  // off, none, slots }] }, the video chat's pictures, clips and sounds side by side. A part shows ONE empty place, and
  // the next appears beside it as things are attached, up to what the model takes - thirty places are never drawn at
  // once - and scrolls sideways. With a recipe a part holds its SLOTS: every cell wears the slot's name, a slot shows one
  // empty place at a time up to its most, and "other" closes the part for what the recipe did not ask for. A slot's
  // empty place pressed is ARMED - the next tile or file goes into it, and the right column turns to what suits it;
  // pressed again, it asks this computer for a file. Without a zone it is the one row it always was.
  let _armed = null;            // { kind, slot } - the slot the next attachment goes into
  let _grew = '';               // the part something was just attached to - its row comes to its end
  const _kindOf = (a) => (a && (a.kind === 'video' || a.kind === 'audio') ? a.kind : 'image');
  const _zone = () => (typeof set.zone === 'function' ? set.zone() : null);
  const _keysOf = (p) => (p.slots || []).map(s => s.key);

  // The attachments in the order their numbers count - per part, per slot, then the rest.
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

  function _attach(path, name, o) {
    if (!path || _atts.some(a => a.path === path)) return;
    const kind = (o && (o.kind === 'video' || o.kind === 'audio')) ? o.kind : 'image';
    const z = _zone();
    let slot = '';
    if (z) {
      const p = z.parts.find(x => x.kind === kind);
      if (!p || !p.room || p.off) { _say((p && (p.off || p.none)) || 'This model takes no ' + kind + '.'); return; }
      const n = _atts.filter(a => _kindOf(a) === kind).length;
      if (n >= p.room) { _say(p.full || ('This model takes ' + p.room + ' ' + (p.room === 1 ? p.one : p.word) + '.')); return; }
      slot = _slotFor(p);
    } else {
      const room = set.room();
      if (_atts.length >= room) {
        _say(room ? 'This model takes ' + room + ' ' + (room === 1 ? S.noun.one : S.noun.many) + '.' : 'This model takes no ' + S.noun.many + '.');
        return;
      }
    }
    _say('');
    // (phase V7) A clip or a sound comes with its poster, its length and the part of it that goes (in/out).
    const att = { path, name: name || '', kind, slot };
    for (const k of ['poster', 'dur', 'in', 'out']) if (o && o[k] != null && o[k] !== '') att[k] = o[k];
    _atts.push(att);
    _grew = kind;
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

  function _detach(path) {
    _atts = _atts.filter(a => a.path !== path);
    _attSeq++;
    _paintAtts();
    _paintStrip();
    _draftLater();
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

  // A recipe came or went: what lies in no slot of it finds one, in the order it was attached.
  function _reslot(o) {
    _armed = null;
    const z = _zone();
    if (z) {
      const keep = [];
      const loose = [];
      for (const a of _atts) {
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
    const c = _ui.atts.querySelector('.mv3-ig-cell.is-empty[data-kind="' + kind + '"][data-slot="' + CSS.escape(slot || '') + '"]');
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
  }

  // One part of the zone: its word and count, then its cells in a row that scrolls sideways.
  function _part(p, num) {
    const box = el('div', 'mv3-ig-part is-' + p.kind);
    const mine = _atts.filter(a => _kindOf(a) === p.kind);
    const head = el('div', 'mv3-ig-part-h', p.word);
    if (p.room && !p.off) head.appendChild(el('b', null, mine.length + ' / ' + p.room));
    box.appendChild(head);
    const row = el('div', 'mv3-ig-part-row');
    if (!p.room || p.off) {
      // Nothing taken here - or not yet: the recipe's cells stand dimmed so it is clear what it wanted.
      const why = !p.room ? p.none : p.off;
      box.title = why || '';
      box.classList.add('is-off');
      if (mine.length) {
        // (phase V7) Attached under a model that took them: they stay in sight, each with its cross, until taken off
        // or another model takes them again - the send says why it will not go with them.
        for (const a of mine) row.appendChild(_cell(_filled(a, num(a)), '', ''));
      } else if (p.slots && p.slots.length) {
        for (const s of p.slots) row.appendChild(_empty(p, s, true));
      } else row.appendChild(el('span', 'mv3-ig-part-off', !p.room ? 'none' : 'next step'));
      box.appendChild(row);
      return box;
    }
    // (phase V7) A clip let go over this part of the zone - from a lane of the timeline - is attached here, the part
    // of its file the timeline plays (timeline-b.js asks for [data-drop-kind]; the description takes 'mv3:clip-out').
    if (p.kind !== 'image') box.dataset.dropKind = p.kind;
    if (p.slots) {
      for (const s of p.slots) {
        const inS = mine.filter(a => a.slot === s.key);
        for (const a of inS) row.appendChild(_cell(_filled(a, num(a)), s.label || s.key, s.hint));
        if (inS.length < s.max && mine.length < p.room) row.appendChild(_empty(p, s, false, inS.length < (s.min || 0)));
      }
      const keys = _keysOf(p);
      for (const a of mine.filter(x => !keys.includes(x.slot))) row.appendChild(_cell(_filled(a, num(a)), 'other', ''));
      if (mine.length < p.room) row.appendChild(_empty(p, { key: '', label: 'other', hint: p.other || '' }, false, false));
    } else {
      for (const a of mine) row.appendChild(_cell(_filled(a, num(a)), '', ''));
      if (mine.length < p.room) row.appendChild(_empty(p, null, false, false));
    }
    _sideways(row);
    box.appendChild(row);
    // The place that just appeared is where the eye goes: after an attachment its row comes to its end.
    if (_grew === p.kind) { _grew = ''; requestAnimationFrame(() => { row.scrollLeft = row.scrollWidth; }); }
    return box;
  }

  // An attached thing: its picture, its NUMBER - with more than one, the message has to say which is which - and a cross.
  // (phase V7) A clip shows its poster and a sound a note, each with the seconds of it that go; pressed, the
  // description opens the part that goes (S.trimFor).
  function _filled(a, n) {
    const kind = _kindOf(a);
    const cell = el('div', 'mv3-ig-att' + (kind === 'video' ? ' is-clip' : kind === 'audio' ? ' is-sound' : ''));
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
      if (secs) cell.appendChild(el('span', 'dur' + (st.cut ? ' is-cut' : ''), secs.toFixed(1) + 's'));
      if (st.bad) { cell.classList.add('is-bad'); cell.title = st.bad; }
      else cell.title = (a.name || '') + (secs ? ' · ' + (st.cut ? secs.toFixed(1) + ' s of ' + (+a.dur).toFixed(1) + ' go' : 'all ' + secs.toFixed(1) + ' s go')
        + ' - press to choose the part' : '');
      cell.addEventListener('click', (ev) => {
        if (ev.target.closest('.x')) return;
        peekHide();
        if (typeof S.trimFor === 'function') S.trimFor(a, cell);
      });
    }
    cell.appendChild(el('span', 'n', String(n)));
    const x = el('button', 'x', '✕');
    x.type = 'button';
    x.title = 'Not this one';
    x.addEventListener('click', () => _detach(a.path));
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

  // An empty place: with a recipe it is a slot's - pressed, it is armed; pressed again (or without a recipe), a file
  // from this computer.
  function _empty(p, s, dim, must) {
    const key = s ? s.key : '';
    const armed = !!(s && _armed && _armed.kind === p.kind && _armed.slot === key);
    const b = el('button', 'mv3-ig-att-slot', '+');
    b.type = 'button';
    b.title = (s && s.hint) || (p.slots ? '' : T.slot) || T.slot;
    const c = _cell(b, s ? (s.label || s.key) : '', s && s.hint);
    c.classList.add('is-empty');
    c.dataset.kind = p.kind;
    c.dataset.slot = key;
    if (must) c.classList.add('is-req');
    if (armed) c.classList.add('is-armed');
    if (dim) { c.classList.add('is-off'); b.disabled = true; return c; }
    b.addEventListener('click', () => {
      if (s && p.slots && !armed) {
        _armed = { kind: p.kind, slot: key };
        _paintAtts();
        if (typeof S.shelfFor === 'function') _setCat(S.shelfFor(p.kind, s));
        return;
      }
      const input = _fileOf(p.kind);
      if (input) input.click();
    });
    return c;
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
    const all = [...(files || [])].filter(f => f && _kindOfFile(f));
    if (!all.length) { _say(T.onlyFiles); return; }
    // A kind the model takes none of is not brought in at all - it would land on its shelf and go nowhere.
    const z = _zone();
    const partOf = (k) => (z ? z.parts.find(p => p.kind === k) : null);
    const takes = (k) => !z || !!(partOf(k) && partOf(k).room && !partOf(k).off);
    const list = all.filter(f => takes(_kindOfFile(f)));
    if (!list.length) { const p = partOf(_kindOfFile(all[0])); _say((p && (p.off || p.none)) || T.onlyFiles); return; }
    _made = true;
    _say('adding ' + list.length + ' ' + (list.length === 1 ? 'file' : 'files') + '…');
    let bad = list.length < all.length ? ((partOf(_kindOfFile(all.find(f => !list.includes(f)))) || {}).none || '') : '';
    for (const f of list.slice(0, S.maxAtts)) {
      const k = _kindOfFile(f);
      const U = _U(k);
      const fd = new FormData();
      fd.append(U.field, f);
      fd.append('name', String(f.name || S.noun.one).replace(/\.[^.]+$/, ''));
      fd.append('project', _key || '');
      const d = await json(U.url, { method: 'POST', body: fd });
      if (d && d.success && d.item) {
        const a = typeof U.att === 'function' ? U.att(d.item) : { path: d.item.imagePath, name: d.item.name };
        _attach(a.path, a.name, Object.assign({}, a, { kind: k }));
      } else bad = (d && d.error) || 'it could not be added';
    }
    _say(bad ? 'Not added: ' + bad : '');
    _loadCats();
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
    const [d, f] = k
      ? await Promise.all([
        json('/api/mv3/chat?project=' + encodeURIComponent(k) + '&kind=' + S.kind),
        _cat ? null : json(S.feed.url(k)),
      ])
      : [{ success: true, items: [] }, _cat ? null : { success: true, items: [] }];
    if (mine !== _seq || k !== (_key || '') || !_chat) return;
    if (d && d.success) {
      _thread = d.items || [];
      _talk = !!_thread.length;
      _paintHead();
    }
    // A category is read when it is chosen, not on every tick.
    if (f && f.success && !_cat) _feed = (f.items || []).map(S.feed.map);
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
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      ta.classList.add('is-bad');
      setTimeout(() => ta.classList.remove('is-bad'), 900);
      return;
    }
    const why = set.ready();
    if (why) { note(_ui.go, why[0], why[1]); return; }
    _sending = true;
    _ui.go.disabled = true;
    try {
      // A file still on its way into the row goes with this message, not after it.
      if (_uploading) { _say('waiting for the ' + S.noun.one + ' to be added…'); await _uploading.catch(() => {}); _say(''); }
      if (!Store.key()) {
        _adopt = true;
        try { await _ensureProject(); }
        catch (e) { _adopt = false; note(_ui.go, 'Could not start a project.', String(e.message || e).slice(0, 120)); return; }
      }
      const key = Store.key();
      const d = await json(S.sendUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ project: key, text, refs: _ordered().map(a => a.path) }, set.body(), {
          n: _n, write: _write,
          // Where it was asked from, for Alerts (js/alerts-bell.js): the project, and this chat in it.
          where: {
            page: 'merge', href: '/merge?p=' + encodeURIComponent(key) + '&open=' + S.name,
            label: 'Merge · ' + (Store.title() || 'project') + ' · ' + S.name,
            spot: { key, view: S.name },
          },
        })),
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

  // ── The right column ──────────────────────────────────────────────────────
  // This project's own, or a category of the Library's Images - and (phase V6) the shelves a description adds (the video
  // chat's characters and looks, environments, lookbooks), which an armed slot of a recipe turns the column to.
  let _cats = [];               // the Images categories, as last read
  let _lastImgCat = '';         // the Images category last shown - where 'images' goes back to
  // (phase V7) More shelves with categories a description shows - the video chat's B-roll, Uploads and Sounds:
  // `S.moreCats` [{ key, label, url, map }]; their places in the dropdown are 'grp:<key>:<category>'.
  let _more = {};
  async function _loadCats() {
    if (!_ui) return;
    const groups = S.moreCats || [];
    const [d, ...reads] = await Promise.all([json(S.cats.url)].concat(groups.map(g => json(g.url).catch(() => null))));
    _cats = (d && d.success) ? (d.cats || []).filter(c => c && c.id) : [];
    _more = {};
    groups.forEach((g, i) => { const r = reads[i]; _more[g.key] = (r && r.success) ? (r.cats || []).filter(c => c && c.id) : []; });
    const sel = _ui.cat;
    sel.innerHTML = '';
    const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
    sel.appendChild(opt('', 'this project'));
    const shelves = S.shelves || [];
    let host = sel;
    if (shelves.length || groups.length) {
      if (shelves.length) {
        const g = document.createElement('optgroup');
        g.label = 'Library';
        for (const s of shelves) g.appendChild(opt('shelf:' + s.id, s.label));
        sel.appendChild(g);
      }
      host = document.createElement('optgroup');
      host.label = 'Images';
      sel.appendChild(host);
    }
    for (const c of _cats) host.appendChild(opt(c.id, c.label || c.name || c.id));
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g.label;
      og.appendChild(opt('grp:' + g.key + ':', 'all of ' + g.label));
      for (const c of _more[g.key]) og.appendChild(opt('grp:' + g.key + ':' + c.id, c.label || c.name || c.id));
      sel.appendChild(og);
    }
    sel.value = [...sel.options].some(o => o.value === _cat) ? _cat : '';
    if (sel.value !== _cat) { _cat = ''; _reload(); }
  }
  // A shelf of `S.moreCats` at the project's own category when it has one, else the whole shelf.
  function _grpOwn(key) {
    const title = String(Store.title() || '').trim().toLowerCase();
    // By the bare name - the label carries the count ("Project · 4").
    const own = title ? (_more[key] || []).find(c => String(c.name || c.label || '').trim().toLowerCase() === title) : null;
    return 'grp:' + key + ':' + (own ? own.id : '');
  }

  // The column turned to `id` - by its dropdown, or by an armed slot ('images': the category last shown, else the
  // project's own, else the first).
  function _setCat(id) {
    if (!_ui) return;
    let v = String(id || '');
    if (v === 'images') {
      const title = String(Store.title() || '').trim().toLowerCase();
      const own = _cats.find(c => String(c.name || '').trim().toLowerCase() === title);
      v = (_lastImgCat && _cats.some(c => c.id === _lastImgCat)) ? _lastImgCat : own ? own.id : (_cats[0] ? _cats[0].id : '');
    }
    if (/^grp:[^:]+$/.test(v)) v = _grpOwn(v.slice(4));
    if (v && !v.startsWith('shelf:') && !v.startsWith('grp:')) _lastImgCat = v;
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
    let items = [];
    if (k.startsWith('shelf:')) {
      const sh = (S.shelves || []).find(s => 'shelf:' + s.id === k);
      items = sh ? await sh.load().catch(() => []) : [];
    } else if (k.startsWith('grp:')) {
      const [, key, cat] = k.match(/^grp:([^:]+):(.*)$/) || [];
      const g = (S.moreCats || []).find(x => x.key === key);
      const d = g ? await json(g.url + (cat ? '&cat=' + encodeURIComponent(cat) : '')) : null;
      items = g ? (d && d.success ? d.items || [] : []).filter(i => i && i.media).map(g.map) : [];
    } else {
      const d = await json(S.cats.url + '&cat=' + encodeURIComponent(k));
      items = (d && d.success ? d.items || [] : []).filter(i => i && i.media).map(S.cats.map);
    }
    if (k !== _cat) return;
    _feed = items;
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
      const none = el('div', 'mv3-ig-none', _cat.startsWith('shelf:') ? 'Nothing on this shelf.' : _cat ? 'Nothing in this category.' : 'Nothing made in this project yet.');
      host.replaceChildren(none, _plusTile());
    }
  }

  function _plusTile() {
    const b = el('button', 'mv3-ig-card is-plus', '+');
    b.type = 'button';
    // (phase V7) A file of the kind the column shows: a clip where it shows clips, a sound where it shows sounds.
    const k = typeof S.plusKind === 'function' ? S.plusKind(_cat) : 'image';
    b.title = (S.plusWords && S.plusWords[k]) || T.plus;
    b.addEventListener('click', () => { const input = _fileOf(k) || _ui.file; if (input) input.click(); });
    return b;
  }

  function _tile(it) {
    const t = el('div', 'mv3-ig-card'
      + (it.state === 'pending' ? ' is-busy' : it.state === 'failed' ? ' is-fail' : '')
      + (_atts.some(a => a.path === it.path) ? ' on' : ''));
    if (it.aspect) t.style.aspectRatio = String(it.aspect).replace(':', '/');
    t.title = it.name || '';
    if (it.state === 'done' && it.kind === 'video' && it.video) return _clipTile(t, it);
    if (it.state === 'done' && it.kind === 'audio' && it.path) return _soundTile(t, it);
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

  // A CLIP in the right column (phase V3): its poster, dragged onto a lane as the clip it is, a press opens it. A clip
  // is not an attachment until references take clips (phase V7).
  function _clipTile(t, it) {
    if (it.poster) {
      const img = document.createElement('img');
      img.src = thumbOf(it.poster, 'strip');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      // A poster gone from the library leaves the tile plain, never a broken picture with its name over it.
      img.addEventListener('error', () => img.remove(), { once: true });
      t.appendChild(img);
    }
    // (phase V7) Where the model takes clips, a press ATTACHES it - a second takes it back off - and ▶ plays it; where it
    // takes none, a press plays it as before.
    const play = el('button', 'mv3-ig-play is-btn', '▶');
    play.type = 'button';
    play.title = 'Play it';
    play.addEventListener('click', (ev) => { ev.stopPropagation(); peekHide(); if (S.openTile) S.openTile(it); });
    t.appendChild(play);
    if (it.dur) t.appendChild(el('span', 'mv3-ig-dur', (+it.dur).toFixed(1) + 's'));
    t.draggable = true;
    t.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData(Store.DRAG_TYPE, JSON.stringify({
        libId: it.libId || '', src: it.video, thumb: it.poster || '',
        name: (it.name || '').slice(0, 60), group: it.group || 'birols', dur: +it.dur || 0,
      }));
      t.classList.add('is-dragging');
    });
    t.addEventListener('dragend', () => t.classList.remove('is-dragging'));
    if (it.poster) {
      t.addEventListener('mouseenter', () => peekShow(thumbOf(it.poster, 'main'), t));
      t.addEventListener('mouseleave', peekHide);
    }
    t.addEventListener('click', () => {
      peekHide();
      if (typeof S.takes === 'function' && S.takes('video')) {
        if (_atts.some(a => a.path === it.video)) _detach(it.video);
        else _attach(it.video, it.name, { kind: 'video', poster: it.poster || '', dur: +it.dur || 0 });
        _paintStrip();
      } else if (S.openTile) S.openTile(it);
    });
    return t;
  }

  // A SOUND in the right column (phase V7): its name and length; ▶ plays it here, a press attaches it.
  let _sounding = null;
  function _soundTile(t, it) {
    t.classList.add('is-sound');
    t.appendChild(el('span', 'snd', '♪'));
    t.appendChild(el('span', 'nm', it.name || 'sound'));
    if (it.dur) t.appendChild(el('span', 'mv3-ig-dur', (+it.dur).toFixed(1) + 's'));
    const play = el('button', 'mv3-ig-play is-btn', '▶');
    play.type = 'button';
    play.title = 'Listen';
    play.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (_sounding && _sounding.src === it.path && !_sounding.audio.paused) { _sounding.audio.pause(); return; }
      if (_sounding) _sounding.audio.pause();
      const audio = new Audio(it.path);
      _sounding = { src: it.path, audio };
      play.textContent = '■';
      audio.addEventListener('pause', () => { play.textContent = '▶'; }, { once: true });
      audio.addEventListener('ended', () => { play.textContent = '▶'; }, { once: true });
      audio.play().catch(() => { play.textContent = '▶'; });
    });
    t.appendChild(play);
    t.title = it.name || '';
    t.addEventListener('click', () => {
      if (!(typeof S.takes === 'function' && S.takes('audio'))) { _say('This model takes no sounds.'); return; }
      if (_atts.some(a => a.path === it.path)) _detach(it.path);
      else _attach(it.path, it.name, { kind: 'audio', dur: +it.dur || 0 });
      _paintStrip();
    });
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
    setBox.append(left, said);

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
    // (phase V6) The thread's foot: a description's own step, kept the last thing in the thread.
    const foot = el('div', 'mv3-ig-foot');
    thread.appendChild(foot);
    chat.append(banner, thread, atts, over, ...Object.values(files), bar);

    const sash = el('div', 'mv3-sash is-v mv3-ig-sash');
    sash.title = 'Drag to resize · double-click to reset';
    const stripBox = el('div', 'mv3-ig-strip');
    const sHead = el('div', 'mv3-ig-strip-head');
    const stripP = el('span', 'p', Store.title() || Store.key() || 'no project');
    const count = el('span', 'n', '0');
    sHead.append(stripP, count);
    const cat = document.createElement('select');
    cat.className = 'mv3-ig-cat';
    cat.title = T.cat;
    const list = el('div', 'mv3-ig-strip-list');
    stripBox.append(sHead, cat, list);
    root.append(setBox, chat, sash, stripBox);

    // The panel header's own buttons while the chat shows.
    const head = $(S.ids.head);
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
    _wireStripSash(sash, stripBox);

    for (const input of Object.values(files)) {
      input.addEventListener('change', () => { const f = [...(input.files || [])]; input.value = ''; _upload(f); });
    }
    cat.addEventListener('change', () => _setCat(cat.value || ''));
    nBtn.addEventListener('click', () => {
      const i = S.counts.indexOf(_n);
      _n = S.counts[(i + 1) % S.counts.length];
      nBtn.textContent = '×' + _n;
      set.onCount();
    });
    const paintPen = () => {
      pen.classList.toggle('on', _write);
      pen.title = _write
        ? 'The writer is on: your message is rewritten into the shape this model wants. Press to send your words exactly as typed.'
        : 'Sending your words exactly as typed. Press to let the writer shape them for this model.';
    };
    pen.addEventListener('click', () => { _write = !_write; keep(S.keys.write, _write); paintPen(); if (typeof set.onPen === 'function') set.onPen(_write); });
    paintPen();
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
