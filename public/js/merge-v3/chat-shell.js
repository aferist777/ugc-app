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
    atts: () => _atts,
    n: () => _n,
    say: (t) => _say(t),
    paintAtts: () => _paintAtts(),
    attach: (path, name) => _attach(path, name),
    place: (item, anchor) => _place(item, anchor),
    peekShow: (src, anchor) => peekShow(src, anchor),
    peekHide: () => peekHide(),
    // (phase V3) The words in the box - a description may put its standard prompt there - and its hint.
    text: () => (_ui ? _ui.ta.value : ''),
    setText: (v) => { if (!_ui) return; _ui.ta.value = String(v || ''); _grow(); _draftLater(); },
    placeholder: (v) => { if (_ui) _ui.ta.placeholder = String(v || T.placeholder); },
    // (phase V3) The line above the thread - what the chosen model does and what to attach. Empty hides it.
    banner: (v) => { if (!_ui) return; _ui.banner.textContent = String(v || ''); _ui.banner.hidden = !v; },
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
    if (text.trim() || _atts.length) d[k] = { text, atts: _atts.slice(0, S.maxAtts) };
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
  }

  function _say(t) { if (_ui) _ui.said.textContent = t || ''; }

  // ── The attachment row ────────────────────────────────────────────────────
  function _attach(path, name) {
    if (!path || _atts.some(a => a.path === path)) return;
    const room = set.room();
    if (_atts.length >= room) {
      _say(room ? 'This model takes ' + room + ' ' + (room === 1 ? S.noun.one : S.noun.many) + '.' : 'This model takes no ' + S.noun.many + '.');
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
      img.addEventListener('error', () => { _detach(a.path); _say('A ' + S.noun.one + ' in the row is not in the library any more.'); }, { once: true });
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

  async function _uploadNow(files) {
    const list = [...(files || [])].filter(f => f && S.upload.ok(f));
    if (!list.length) { _say(T.onlyFiles); return; }
    _made = true;
    _say('adding ' + list.length + ' ' + (list.length === 1 ? S.noun.one : S.noun.many) + '…');
    let bad = '';
    for (const f of list.slice(0, S.maxAtts)) {
      const fd = new FormData();
      fd.append(S.upload.field, f);
      fd.append('name', String(f.name || S.noun.one).replace(/\.[^.]+$/, ''));
      fd.append('project', _key || '');
      const d = await json(S.upload.url, { method: 'POST', body: fd });
      if (d && d.success && d.item) _attach(d.item.imagePath, d.item.name);
      else bad = (d && d.error) || 'it could not be added';
    }
    _say(bad ? 'Not added: ' + bad : '');
    _loadCats();
  }

  // ── The thread ────────────────────────────────────────────────────────────
  function _stageWords(g) {
    if (g.error && !g.stage) return g.error.slice(0, 60) + ' — trying the next…';
    return g.stage ? g.stage + '…' : S.busyWord + '…';
  }

  const _sig = (m) => [m.text || ''].concat(_gensOf(m).map(g => g.id + ':' + g.state + ':'
    + (g.state === 'done' ? _path(g) : g.state === 'failed' ? g.error : ''))).join('|');

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
    const busy = _pending.size || _feed.some(x => x.state === 'pending');
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
        body: JSON.stringify(Object.assign({ project: key, text, refs: _atts.map(a => a.path) }, set.body(), {
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
  async function _loadCats() {
    if (!_ui) return;
    const d = await json(S.cats.url);
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
    const d = await json(S.cats.url + '&cat=' + encodeURIComponent(k));
    if (k !== _cat) return;
    _feed = (d && d.success ? d.items || [] : []).filter(i => i && i.media).map(S.cats.map);
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
    b.title = T.plus;
    b.addEventListener('click', () => _ui.file.click());
    return b;
  }

  function _tile(it) {
    const t = el('div', 'mv3-ig-card'
      + (it.state === 'pending' ? ' is-busy' : it.state === 'failed' ? ' is-fail' : '')
      + (_atts.some(a => a.path === it.path) ? ' on' : ''));
    t.style.aspectRatio = String(it.aspect || '1:1').replace(':', '/');
    t.title = it.name || '';
    if (it.state === 'done' && it.kind === 'video' && it.video) return _clipTile(t, it);
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
      img.alt = it.name || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      t.appendChild(img);
    }
    t.appendChild(el('span', 'mv3-ig-play', '▶'));
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
    t.addEventListener('click', () => { peekHide(); if (S.openTile) S.openTile(it); });
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
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = S.upload.accept;
    file.multiple = true;
    file.hidden = true;
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
    chat.append(banner, thread, atts, file, bar);

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

    _ui = { root, set: setBox, left, said, chat, banner, thread, atts, file, ta, pen, nBtn, go, stripBox, stripP, count, cat, list, narrow: null };
    _wireStripSash(sash, stripBox);

    file.addEventListener('change', () => { const f = [...(file.files || [])]; file.value = ''; _upload(f); });
    cat.addEventListener('change', () => { _cat = cat.value || ''; _feed = []; _paintStrip(); _loadStrip(); });
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
    pen.addEventListener('click', () => { _write = !_write; keep(S.keys.write, _write); paintPen(); });
    paintPen();
    go.addEventListener('click', () => _send());
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); _send(); }
    });
    ta.addEventListener('input', () => { _grow(); _draftLater(); });
    // A file pasted into the box is attached.
    ta.addEventListener('paste', (ev) => {
      const files = [...((ev.clipboardData && ev.clipboardData.files) || [])].filter(f => S.upload.ok(f));
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
  }

  function init() {
    // "Library" in the header leaves the chat; the pale crumb on the shelf opens it; another chat coming
    // forward lets this one go (lib-views wires all three).
    Views.registerChat(S.name, {
      root: S.ids.root, head: S.ids.head, crumb: S.ids.crumb, crumbTitle: T.crumb,
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
