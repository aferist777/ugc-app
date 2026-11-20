/* ════════════════════════════════════════════════════════════════════════════
   MERGE — a chat in its window: the shell.

   The pictures chat and the video chat are the same conversation with other
   settings and other results, so what they share lives here and each is `createChat(DESCRIPTION)` -
   picchat.js and vidchat.js. A copy would mean every change made twice.

   ── What the shell does ─────────────────────────────────────────────────────
   Following the open project, what was being written and attached per project, the thread read
   from the server every few seconds with each countdown drawn from its record's real age and its cross
   letting go of the row, "the result becomes the reference", sending (a project started for a send from
   "no project"), the attachment row, bringing files in, the right column of things to point at behind a
   sash (`column`: the folder column, js/folder-column.js - the pictures chat's and the video chat's), the picker behind
   every "+" of the zone for a description that says where its attachments come from (`pick`, chat-pick.js - the
   window with the tree), the zone's enlarged view under the pointer, and the narrow layout.

   A press on a picture or a clip - a result in the thread, a message's attachment, a thing in the zone - does nothing; a picture has ⤢ in its
   top-right corner that opens it large, a clip ▶ in its middle that plays it in the Library's viewer, and the pointer
   resting on a clip plays it in place without its sound. The right column's press attaches. Only the zone
   shows a thing larger under the pointer (peekShow).

   Every chat lives in a generation's window - the frames chat, the pictures chat and the video chat (chat-window.js):
   no view is remembered per project; the window shows and hides it, and its conversation is the open project's - in
   the Library THE draft's, the unbound one: whose it is, chat-owner.js says (the store's words, either way).

   ── What a description says ─────────────────────────────────────────────────
   Its name and kind, its element ids and storage keys, its words, the settings column (`settings`: load,
   paint, how many attachments fit, what goes into the send), how a finished result is drawn and opened, and
   where the right column reads from (`feed`, `cats`) or the picker's sources (`pick`). `createChat(make)`
   calls `make(ctx)` with the shell's handles (ctx below), so a description keeps its own state in its own
   closure.

   ── Why a thread and not a form ─────────────────────────────────────────────
   Making things is iterative. You say a thing, look at it, then say "the same but at night" - and the
   second sentence only means anything because the first one is still there. The conversation belongs to
   the PROJECT (data/mv3-chat.json by kind, the results in their own store and on their shelf) - a highlights
   project's is ONE for its home and all its fragments, kept under the home's key (lib-views.js chatKey).

   ── The server sends ────────────────────────────────────────────────────────
   A press is one request: the server writes the person's turn, a record and an Alerts row for every result
   asked for and the turn that answers - and the work goes on behind it, the rows saying which in words.
   This page only READS the thread, so a countdown survives leaving and reloading.

   ── The attachment row is the whole of the rule ─────────────────────────────
   Whatever sits above the input goes as a reference. A result that lands is put there automatically - the
   next thing anybody says is about it - unless the row was changed by hand since the message was sent;
   visibly, with a number and a cross.

   ── The layout ──────────────────────────────────────────────────────────────
   Three columns when the window is wide: what to make it WITH, the conversation, and a narrow column of
   everything to point at behind a sash (two with a picker: the conversation takes the column's width).
   Narrower than 700px, the settings fold into one row above the input.
   ════════════════════════════════════════════════════════════════════════════ */

// Whose conversation it is - the open project in Merge, the unbound draft's in the Library.
import * as Store from './chat-owner.js';
import * as Views from './lib-views.js';
import * as Pick from './chat-pick.js';
import { createFolderColumn } from '../folder-column.js';
import { startInlineProgress } from '../progress.js';
import * as LK from '../library/links.js';
import { note } from '../ask.js';
import { twoPress } from '../really.js';
// The empty conversation - the shared "nothing here".
import { emptyEl } from '../ui-state.js';
import { markField, markText } from './image-words.js';
import { icon } from '../icons.js';
import { hoverPlayer } from './hover-play.js';
import { openViewer } from '../library/viewer.js';
import * as KG from '../key-gate.js';
// The interface's words (`t` is a tile and a rectangle here and `T` the description's own words, so the module's are I18N.t).
import * as I18N from '../i18n/t.js';

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

// ── A chat's pictures and clips ─────────────
// A press on the thing itself does nothing (the right column's attaches): ⤢ in a picture's top-right corner opens it large,
// ▶ in a clip's middle plays it in the Library's viewer, and the pointer resting on a clip plays it in place without its
// sound - one at a time, the poster again the moment the pointer leaves (hover-play.js).
const _hp = hoverPlayer('mv3-ig-hvid', { grace: 0 });

/** The round button on a chat's picture ('image': ⤢, its top-right corner) or clip ('video': ▶, its middle): `open()` on its
 *  press, the clip playing in a tile stopped first. */
export function mediaBtn(kind, open) {
  const clip = kind === 'video';
  const b = el('button', 'mv3-ig-mb ' + (clip ? 'is-play' : 'is-big'), clip ? '▶' : '⤢');
  b.type = 'button';
  b.title = clip ? I18N.t('Play full screen') : I18N.t('Open large');
  b.draggable = false;
  b.addEventListener('click', (e) => { e.stopPropagation(); _hp.stop(); open(); });
  return b;
}
/** A clip's tile plays `src` in place, without its sound, while the pointer rests on it - on a layer under what the tile
 *  shows over it (its ▶, its seconds, its number). */
export function hoverClip(tile, src) {
  if (!tile || !src) return;
  const layer = el('span', 'mv3-ig-hbox');
  tile.insertBefore(layer, tile.firstChild);
  tile.addEventListener('pointerenter', () => _hp.on(tile, layer, src));
  tile.addEventListener('pointerleave', () => _hp.off(tile));
  tile.addEventListener('dragstart', () => _hp.stop());
}
/** Pictures ({ path, name }) large in the Library's viewer, from the 2048px tier, arrows between them - on the one at `path`. */
export function viewPictures(list, path) {
  const items = (list || []).filter(x => x && x.path).map(x => ({ id: x.path, kind: 'images', media: x.path, thumb: x.path, name: x.name || '' }));
  openViewer(items, Math.max(0, items.findIndex(x => x.media === path)), { showSrc: (it) => thumbOf(it.media, 'main') });
}
/** One clip played in the Library's viewer. */
export function viewClip(path, name, thumb) {
  if (path) openViewer([{ id: path, kind: 'birols', media: path, thumb: thumb || path, name: name || '' }], 0);
}

// One attachment of a message as it went: a picture's miniature, a clip's poster or a sound's note, its number - per
// kind, the way the prompt names them - and for a clip or a sound the seconds of it that went. `all` - the
// message's attachments: given, a picture has ⤢ (the message's pictures large, from this one) and a clip ▶ in its middle,
// playing in place under the pointer; one not in this library has neither.
export function refCell(a, k, n, all) {
  const c = el('div', 'mv3-ig-msg-ref' + (k !== 'image' ? ' is-' + k : ''));
  const live = !!(all && a.path && !a.gone);
  if (k === 'image' || k === 'video') {
    const src = k === 'image' ? a.path : posterOf(a.path);
    const img = document.createElement('img');
    img.src = thumbOf(src, 'strip');
    img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    c.appendChild(img);
  }
  if (k === 'image') {
    if (live) c.appendChild(mediaBtn('image', () => viewPictures(all.filter(x => x && (x.kind || 'image') === 'image' && !x.gone), a.path)));
  } else {
    if (k === 'video' && live) {
      c.appendChild(mediaBtn('video', () => viewClip(a.path, a.name || a.label || '', posterOf(a.path))));
      hoverClip(c, a.path);
    } else c.appendChild(el('span', 'ic', k === 'audio' ? '♪' : '▶'));
    const secs = Math.max(0, (+a.out || 0) - (+a.in || 0));
    if (secs) c.appendChild(el('span', 'dur', I18N.t('{n}s', { n: secs.toFixed(1) })));
  }
  c.appendChild(el('span', 'n', String(n)));
  return c;
}
export const money = (v) => '$' + (+(+v).toFixed(4));
// a label in sentence case - its first letter capital; the word itself stays (it makes sentences elsewhere)
const capWord = (w) => { const s = String(w || ''); return s.charAt(0).toUpperCase() + s.slice(1); };
/** A switch of a chat's column (the writer, the storyboard): the shared toggle (.u-switch, on is green) and
 *  its word in one <label> - the word pressed switches it too. onChange(on) after each press. */
export function switchRow(word, on, off, onChange) {
  const row = el('label', 'mv3-vc-check');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'u-switch';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', on ? 'true' : 'false');
  b.disabled = !!off;
  b.addEventListener('click', () => {
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', v ? 'true' : 'false');
    onChange(v);
  });
  row.append(b, el('span', null, word));
  return row;
}
/** The almanac of a chat that has none yet, at the foot of the column: the video chat's gold button, blurred and dimmed
 *  as the strip's 3D Studio entry (css/app-nav.css .is-soon), not pressed, "In development" under the pointer. */
export function almanacSoon() {
  const b = el('button', 'mv3-vc-almanac u-btn is-l is-gen is-soon', I18N.t('Almanac'));
  b.type = 'button';
  b.title = I18N.t('In development');
  b.setAttribute('aria-disabled', 'true');
  b.tabIndex = -1;
  return b;
}
/** A shape ('9:16') as width over height. */
export const ratioOf = (ar) => {
  const p = String(ar || '9:16').split(':');
  return (+p[0] || 1) / (+p[1] || 1);
};
/**
 * A chat's result is not laid on a highlights project's own timeline - nothing on it is rendered:
 * a drag (its `dragstart` event, cancelled) says "open a fragment" in the corner of
 * popups with "to highlights" (lib-views.js noFragment), as a drop on the home's lanes does. True when refused. `anchor` is
 * kept for the callers; the popup does not stand at it.
 */
export function refuseHome(anchor, ev) {
  if (!Views.isHlHome(Store.key())) return false;
  if (ev) ev.preventDefault();
  Views.noFragment();
  return true;
}
export const json = (url, opts) => fetch(url, opts).then(r => r.json()).catch(() => null);
// `??`, not `||`: a stored false (the writer switched off) is an answer, not a missing value.
export const stored = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? fb; } catch (e) { return fb; } };
export const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };
const _gensOf = (m) => ((m.gens && m.gens.length) ? m.gens : (m.gen ? [m.gen] : []));
// What a model takes none of, and how many it takes, by the kind of the thing - each a whole sentence.
const _takesNo = (kind) => (kind === 'video' ? I18N.t('This model takes no video.')
  : kind === 'audio' ? I18N.t('This model takes no audio.') : I18N.t('This model takes no image.'));
const _takesN = (kind, n) => (kind === 'video' ? I18N.tn(n, 'This model takes {n} clip.', 'This model takes {n} clips.')
  : kind === 'audio' ? I18N.tn(n, 'This model takes {n} sound.', 'This model takes {n} sounds.')
    : I18N.tn(n, 'This model takes {n} picture.', 'This model takes {n} pictures.'));

/**
 * One chat. `make(ctx)` returns its description; the answer is { open, isOpen, init }.
 */
// What every draft keeps of the chats in this browser, under one key - as the drafts' conversation is one.
const DRAFT_LK = 'draft';

export function createChat(make) {
  // ── State ─────────────────────────────────────────────────────────────────
  let _ui = null;            // the chat, built the first time it is shown
  let _chat = false;         // this chat shows (its window is open)
  let _key = null;           // whose conversation this is - '' before a project exists
  let _thread = [];
  let _feed = [];            // this project's own results - the right column's "this project"
  let _col = null;           // the right column - js/folder-column.js; null for a chat without one
  let _timer = 0;
  let _seq = 0;
  let _sending = false;
  // The message drawn at the press, until the answer it was sent for takes its place: { el, id }.
  let _pend = null;
  let _n = 1;
  let _write = true;
  let _atts = [];            // [{ path, name }] - in the zone also an empty numbered place, { hole, kind, slot, id }
  let _attSeq = 0;           // moves whenever the row is changed by hand
  const _sendSeq = new Map();   // a send -> the row as it was at the press
  let _pending = new Set();     // results still being made at the last read
  let _landedNow = new Set();   // ...and those that landed since the read before it
  const _nodes = new Map();     // message id -> { el, sig, progs: Map(genId -> countdown), away }
  let _adopt = false;           // a project is being made for a send from "no project"
  // The open project is the draft: what is kept here per project - the words and attachments being
  // written - is the drafts' own (DRAFT_LK), as their conversation is.
  let _draftHere = false;
  let _draftT = 0;
  // Per project, what "the result becomes the reference" needs across a trip to another project: the
  // results still being made at the last read there, and the row's hand-change counter.
  const _memo = new Map();
  let _uploading = null;        // the upload in flight - a send waits for it
  // The lines said while a file comes in ("adding 2 files…", "downloading the picture…") - the last of each, so its end
  // knows whether it still stands over the box.
  let _addingSaid = '';
  let _fetchingSaid = '';
  let _made = false;            // something landed or was added while the chat showed - the shelf reads again
  // The page's own word at the end of the thread - what came in from the timeline and how to change
  // it: never kept, never sent; it goes with the next send or another project.
  let _notice = '';

  // ── What the description works with ───────────────────────────────────────
  const ctx = {
    ui: () => _ui,
    key: () => _key,
    // In the order their numbers count (per part of the zone, per slot of the part, then the rest) - what goes:
    // the empty numbered places left out.
    atts: () => _real(),
    // The zone as it is laid out - its empty numbered places too, each with its slot.
    zoneAtts: () => _ordered().slice(),
    // Why a send cannot go yet - an empty numbered place, blinking -, or null.
    holeWhy: () => _holeWhy(),
    // Whether anything attached answers `fn` - read without laying out the zone, so the zone's own words (a
    // part's note) can ask it.
    anyAtt: (fn) => _atts.some(a => !a.hole && fn(a)),
    // The zone replaced by these attachments ({ path, kind, role, label, in, out }) - a message's, put back
    // for the next variant; [] empties it.
    useAtts: (list) => _useAtts(list),
    n: () => _n,
    say: (t) => _say(t),
    paintAtts: () => _paintAtts(),
    // the column's price box, read into the bar beside the send
    priceFrom: (box) => _priceFrom(box),
    attach: (path, name, o) => _attach(path, name, o),
    // An attachment changed by its description - the part of a clip or a sound that goes, its length once
    // measured (a value of null or '' takes the field away) - or taken back off.
    setAtt: (path, patch) => _setAtt(path, patch),
    detach: (path) => _detach(path),
    // Whether the chat shows.
    shown: () => _chat,
    // The zone's slots changed (the video chat's "pictures are"): what is attached finds its slots again, and
    // nothing stays armed.
    reslot: (o) => _reslot(o),
    // A slot that must be filled, blinking - the send was refused for it.
    flash: (kind, slot) => _flash(kind, slot),
    // The words in the box - a description may put its standard prompt there - and its hint.
    text: () => (_ui ? _ui.ta.value : ''),
    setText: (v) => { if (!_ui) return; _ui.ta.value = String(v || ''); _grow(); _draftLater(); },
    placeholder: (v) => { if (_ui) _ui.ta.placeholder = String(v || T.placeholder); },
    // Whether the writer is on - never while no agent of the ladder can be asked (js/key-gate.js).
    writing: () => _writeOn(),
    // The writer switched from the description's own control (the video chat's column).
    setWriting: (v) => _setWriting(v),
    saveDraft: () => _draftLater(),
    // The thread read again - a card the description draws changed on the server.
    reload: (toEnd) => _reload(toEnd),
    // A result's "read more" on its own, and every finished one of the thread large from it - for a description
    // that lays its result out itself (the video chat's field at a message's head).
    facts: (g) => _facts(g),
    view: (g) => _view(g),
    // What a countdown of a result says - its stage in words - for a description that keeps its clips fresh itself.
    stageWords: (g) => _stageWords(g),
    // What the right column offers may have changed - the video chat's model takes no clips, or shorter ones:
    // it is read again when its description's `sig` says so.
    columnChanged: () => _columnChanged(),
    // The page's word at the end of the thread (above); '' takes it away.
    notice: (t) => { _notice = String(t || ''); if (_ui && _chat) _paintThread(true); },
  };
  const S = make(ctx);
  const T = S.text;
  const set = S.settings;
  _write = stored(S.keys.write, true) !== false;
  const _path = (g) => S.resultPath(g);

  // ── Shown and hidden ──────────────────────────────────────────────────────
  /**
   * Every way in - a root's "generate", the gallery's "+", the lane's right-click, ?open=<name> - opens the chat's window
   * (chat-window.js), which shows the chat here.
   */
  async function open() {
    if (_chat) return;
    await _show(true);
  }

  async function _show(on) {
    _chat = !!on;
    _paintHead();
    if (!_chat) {
      _stop();
      peekHide();
      _hp.stop();
      // The picker goes with the chat, and the description lets go of what floats over it.
      if (_picking) Pick.closePick();
      if (_col) _col.close();
      _hearStop();
      if (typeof S.onHide === 'function') S.onHide();
      // Every message is away while the chat is hidden: what lands meanwhile does not time its countdown.
      for (const n of _nodes.values()) n.away = true;
      // The shelf was read before the chat came forward: what was made or added since is not on it yet.
      if (_made) { _made = false; window.dispatchEvent(new CustomEvent('mv3:lib-reload')); }
      return;
    }
    _build();
    // Laid out for its width (narrow or not) only once the chat can be SEEN.
    _fit();
    // The settings and the thread are asked first, the right column after them: the server
    // answers one request at a time and the column's reading is the long one - asked together, the conversation would wait
    // behind it. The video chat's column follows its models, so it waits for them too and is read once (`_colWait`); never more
    // than a second.
    const mine = ++_opens;
    _colWait = true;
    const settings = set.load();
    const thread = _reload(true);
    Promise.race([Promise.all([settings, thread]).catch(() => null), new Promise(r => setTimeout(r, 1000))]).then(() => {
      if (mine !== _opens) return;
      _colWait = false;
      if (_chat) _loadColumn();
    });
    await thread;
    if (_chat && _ui) _ui.ta.focus();
  }

  // The root shows while the chat does - in its window.
  function _paintHead() {
    const r = $(S.ids.root);
    if (r) r.classList.toggle('is-shown', _chat);
  }

  // ── The project the conversation belongs to ──────────────────────────────
  function _onStore() {
    // Not before the store has read what is open: "nothing yet" is not "no project".
    if (!Store.isReady()) return;
    // A highlights project talks in ONE conversation: its fragments' keys are its home's, so
    // pressing another fragment is no project switch here - the thread, the view and what is being written stay.
    const k = Views.chatKey(Store.key());
    // The draft saved under a name: its own from now on - the words in the box go with it (the drafts' keep
    // none of them), and its conversation is read again (the project's copy).
    if (k && k === _key && _draftHere && !Store.isDraft()) {
      _draftHere = false;
      const d = stored(S.keys.draft, {});
      if (d[DRAFT_LK]) { d[k] = d[DRAFT_LK]; delete d[DRAFT_LK]; keep(S.keys.draft, d); }
      if (_chat) _reload(true);
      return;
    }
    if (k === _key) return;
    const was = _key;
    // The picker was for a place of the project being left; so was the page's word.
    if (_picking) Pick.closePick();
    _notice = '';
    if (was !== null) {
      _saveDraft(was);
      _memo.set(was, { pending: _pending, attSeq: _attSeq });
    }
    // A send from "no project" made this project: what was being written comes along.
    const adopt = _adopt && was === '';
    _adopt = false;
    if (adopt) {
      const d = stored(S.keys.draft, {});
      if (d['']) { d[k] = d['']; delete d['']; keep(S.keys.draft, d); }
    }
    _key = k;
    _draftHere = !!Store.isDraft();
    _armed = null;
    _thread = [];
    const m = _memo.get(k);
    _pending = m ? m.pending : new Set();
    for (const n of _nodes.values()) { _dropProgs(n, false); n.el.remove(); }
    _nodes.clear();
    if (_ui) { const e = _ui.thread.querySelector('.mv3-ig-empty'); if (e) e.remove(); }
    _loadDraft(k, m);
    set.onProject();
    // This project's own results are another project's; a folder is the same whatever is open.
    _feed = [];
    if (_col) _col.setOwn([]);
    // The chat stays as it was: its window shows it for the project it holds.
    if (_chat) _reload(true);
    _paintHead();
  }

  // No project is the draft - Merge opens it by itself; this is for the rare page that could not.
  async function _ensureProject() {
    if (Store.key()) return;
    await Store.openBlank();
    if (!Store.key()) throw new Error(I18N.t('could not open the draft for this'));
  }

  // ── What was being written, per project ───────────────────────────────────
  // The key it is kept under: the drafts' own while the project is the draft.
  const _lk = (k) => (k === _key && _draftHere ? DRAFT_LK : (k || ''));
  function _saveDraft(k0) {
    const k = _lk(k0);
    const d = stored(S.keys.draft, {});
    const text = _ui ? _ui.ta.value : ((d[k] || {}).text || '');
    // What the description keeps of its own with the draft (the frames chat's shot and its choices).
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
    const d = stored(S.keys.draft, {})[_lk(k)] || {};
    // Its empty numbered places too.
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
  // A description may lay it out as a ZONE - set.zone(): { parts: [{ kind, word, room,
  // off, none, slots }] }, the video chat's pictures, clips and sounds side by side. A part shows ONE empty place, and
  // the next appears beside it as things are attached, up to what the model takes - thirty places are never drawn at
  // once - and scrolls sideways. A part may hold SLOTS (the video chat's first and last frames, the frames chat's person,
  // place and products): every cell wears the slot's name, a slot shows one empty place at a time up to its most, and
  // "other" closes the part for what no slot asks for. An empty
  // place pressed opens the picker on it - its slot ARMED while the picker is open, so whatever is pressed
  // or brought in there goes into it. Without a zone it is one row.
  //
  // A thing taken out of the zone leaves its NUMBERED PLACE EMPTY, so the numbers
  // after it - and the prompt that names them - stay: picture 1 taken off to put another person in is still picture 1.
  // An empty place - a hole, { hole, kind, slot, id } in the row - is filled by the next thing for its part or slot,
  // opens the picker on itself when pressed, and closes with its cross: then the numbers after it move up. One at the
  // END of its part's numbers holds nothing up and goes by itself. A send waits while one is open (ctx.holeWhy). A thing
  // in the zone pressed does nothing - another in its place is its cross, then the "+" of the place that stays; a
  // clip's or a sound's seconds open the part that goes. The pictures chat's zone has one part and no slots.
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

  // The place a new thing of this kind goes into, when it is not a new one at the end: the one the picker is
  // open on, else the first empty numbered place it fits (in the armed slot, while one is armed).
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
      if (!p || !p.room || p.off) { _say((p && (p.off || p.none)) || _takesNo(kind)); return; }
      // A slot named by the description - the frames chat puts the character and the place into their own:
      // its empty numbered place when it has one, else a new place in it while the slot and the part have room.
      const named = o && typeof o.slot === 'string' && p.slots ? p.slots.find(s => s.key === o.slot) : null;
      // `atEnd`: a new place after the others - the storyboard is the last picture.
      into = named ? (_atts.find(a => a.hole && _kindOf(a) === kind && a.slot === named.key) || null)
        : o && o.atEnd ? null : _placeFor(kind);
      if (named) {
        slot = named.key;
        const inS = _atts.filter(a => _kindOf(a) === kind && a.slot === named.key && !a.hole).length;
        if (!into && (inS >= named.max || _atts.filter(a => _kindOf(a) === kind).length >= p.room)) {
          _say(I18N.t('{what} has no more room.', { what: _cap(named.label || named.key) }));
          return;
        }
      } else if (into) slot = into.slot != null ? into.slot : _slotFor(p);
      else {
        // Its places - the empty ones too - are as many as the model takes.
        const n = _atts.filter(a => _kindOf(a) === kind).length;
        if (n >= p.room) { _say(p.full || _takesN(p.kind, p.room)); return; }
        slot = _slotFor(p);
      }
    } else {
      const room = set.room();
      if (_atts.length >= room) {
        // Every chat's noun is the picture (`S.noun`), so the sentences are the pictures' own.
        _say(room ? _takesN('image', room) : I18N.t('This model takes no pictures.'));
        return;
      }
    }
    // A place that takes only some things says why, whichever way the thing came (the picker, a file).
    const refused = typeof S.refuseAt === 'function' ? S.refuseAt(slot, path) : '';
    if (refused) { _say(refused); if (_picking) Pick.pickSay(refused); return; }
    _say('');
    // A clip or a sound comes with its poster, its length and the part of it that goes (in/out);
    // a thing that says what it is for - a voice from the picker's voices - with its role and its name.
    const att = { path, name: name || '', kind, slot };
    for (const k of ['poster', 'dur', 'in', 'out', 'role', 'label']) if (o && o[k] != null && o[k] !== '') att[k] = o[k];
    if (into) {
      // Its place and its number: the empty numbered place that stood there is filled.
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

  // Taken out: in the zone its place stays, empty and numbered - unless nothing comes after it.
  function _detach(path) {
    const i = _atts.findIndex(a => a.path === path);
    if (i < 0) return;
    // The description hears what was taken out - the frames chat puts the person and the place back when
    // the frame it was changing goes.
    const gone = _atts[i];
    if (typeof S.onDetach === 'function' && S.onDetach(gone) === true) return;
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

  // Everything in the zone replaced: a message's attachments put back, or none at all.
  function _useAtts(list) {
    _atts = [];
    _armed = null;
    for (const a of list || []) {
      if (!a || !a.path) continue;
      _attach(a.path, a.name || a.label || '', { kind: a.kind, role: a.role, label: a.label, in: a.in, out: a.out, atEnd: true, slot: a.slot });
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

  // Why a send cannot go yet: the first empty numbered place of a part that takes things - the numbers in
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
      return [I18N.t('{what} {n} is empty.', { what: _cap(s ? (s.label || s.key) : p.one), n: mine.indexOf(h) + 1 }),
        I18N.t('Put one in its place, or close the place with its ✕ - the numbers after it move up.')];
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

  // The zone's slots changed: what lies in no slot of them finds one, in the order it was attached. The numbers are
  // counted anew - the empty places go.
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
    _linkShown = false;
    KG.lock(host, 'attach', { line: true });
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
      if (_atts.length >= 2) host.appendChild(el('span', 'mv3-ig-att-note', I18N.t('Say which one you mean by its number.')));
      set.onAtts();
      return;
    }
    const order = _ordered();
    const num = (a) => order.filter(x => _kindOf(x) === _kindOf(a)).indexOf(a) + 1;
    for (const p of z.parts) host.appendChild(_part(p, num));
    set.onAtts();
    if (_picking) Pick.pickChanged();
  }

  // A part laid out as GROUPS of its slots - the frames chat's two fields, the person and the place, and
  // what else goes - each a box of its own with its word and count; the numbers still count across the whole part.
  function _groupBox(p, g, num) {
    const box = el('div', 'mv3-ig-part is-' + p.kind + ' is-group' + (g.cls ? ' ' + g.cls : ''));
    const all = _ordered().filter(a => _kindOf(a) === p.kind);
    const keys = g.slots.map(x => x.key);
    const mine = all.filter(a => keys.includes(a.slot));
    const head = el('div', 'mv3-ig-part-h', capWord(g.word));
    head.appendChild(el('b', null, mine.filter(a => !a.hole).length + ' / ' + g.slots.reduce((n, x) => n + x.max, 0)));
    if (g.note) { const nt = el('span', 'mv3-ig-part-note', g.note); nt.title = g.noteLong || g.note; head.appendChild(nt); }
    box.appendChild(head);
    const row = el('div', 'mv3-ig-part-row');
    for (const sl of g.slots) {
      const inS = mine.filter(a => a.slot === sl.key);
      const must = inS.filter(a => !a.hole).length < (sl.min || 0);
      const lab = g.labels === false ? '' : (sl.label || sl.key);
      for (const a of inS) row.appendChild(a.hole ? _holeCell(p, a, num(a), sl, must) : _cell(_filled(a, num(a), p), lab, sl.hint));
      if (!inS.some(a => a.hole) && inS.length < sl.max && all.length < p.room) row.appendChild(_empty(p, sl, false, must));
    }
    _sideways(row);
    box.appendChild(row);
    return box;
  }

  // One part of the zone: its word and count, then its cells in a row that scrolls sideways.
  function _part(p, num) {
    if (p.groups && p.room && !p.off) {
      const frag = document.createDocumentFragment();
      for (const g of p.groups) frag.appendChild(_groupBox(p, g, num));
      return frag;
    }
    const box = el('div', 'mv3-ig-part is-' + p.kind);
    // Its places in order - empty ones too.
    const mine = _ordered().filter(a => _kindOf(a) === p.kind);
    const real = mine.filter(a => !a.hole);
    const head = el('div', 'mv3-ig-part-h', capWord(p.word));
    if (p.room && !p.off) head.appendChild(el('b', null, real.length + ' / ' + p.room));
    // A part's own word on its head line - the video chat's frames going as references.
    if (p.note && p.room && !p.off) {
      const nt = el('span', 'mv3-ig-part-note', p.note);
      nt.title = p.noteLong || p.note;
      head.appendChild(nt);
    }
    box.appendChild(head);
    const row = el('div', 'mv3-ig-part-row');
    if (!p.room || p.off) {
      // Nothing taken here - or not yet: the part's slots stand dimmed so it is clear what goes there.
      const why = !p.room ? p.none : p.off;
      box.title = why || '';
      box.classList.add('is-off');
      if (real.length) {
        // Attached under a model that took them: they stay in sight, each with its cross, until taken off
        // or another model takes them again - the send says why it will not go with them.
        for (const a of real) row.appendChild(_cell(_filled(a, num(a)), '', ''));
      } else if (p.slots && p.slots.length) {
        for (const s of p.slots) row.appendChild(_empty(p, s, true));
      } else row.appendChild(el('span', 'mv3-ig-part-off', !p.room ? I18N.t('none') : I18N.t('next step')));
      box.appendChild(row);
      return box;
    }
    // A clip let go over this part of the zone - from a lane of the timeline - is attached here, the part
    // of its file the timeline plays (timeline-b.js asks for [data-drop-kind]; the description takes 'mv3:clip-out').
    if (p.kind !== 'image') box.dataset.dropKind = p.kind;
    // A thing, or its empty place, in a cell wearing its slot's name. A slot or a part with an empty place offers no
    // other: that place is where the next one goes.
    // A voice and a storyboard wear their word, so the message can say what each is by its number.
    const tag = (a) => (a.role === 'voice' ? I18N.t('voice') : a.role === 'storyboard' ? I18N.t('storyboard') : '');
    const put = (a, s, must) => row.appendChild(a.hole ? _holeCell(p, a, num(a), s, must)
      : _cell(_filled(a, num(a), p), tag(a) || (s ? (s.label || s.key) : ''),
        a.role === 'voice' ? a.label : a.role === 'storyboard' ? I18N.t('The storyboard - the video follows it panel by panel') : s && s.hint));
    if (p.slots) {
      for (const s of p.slots) {
        const inS = mine.filter(a => a.slot === s.key);
        const must = inS.filter(a => !a.hole).length < (s.min || 0);
        for (const a of inS) put(a, s, must);
        if (!inS.some(a => a.hole) && inS.length < s.max && mine.length < p.room) row.appendChild(_empty(p, s, false, must));
      }
      const keys = _keysOf(p);
      const other = { key: '', label: p.otherLabel || I18N.t('other'), hint: p.other || '' };
      const rest = mine.filter(x => !keys.includes(x.slot));
      for (const a of rest) put(a, other, false);
      // "other" only where the room is more than the part's own slots can still take - an "other" beside a slot that
      // takes all the room would offer a thing the model does not take.
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
  // A clip shows its poster and a sound a note, each with the seconds of it that go; a clip's or a sound's
  // seconds open the part that goes (S.trimFor). A press on it does nothing - another
  // in its place is its cross, then the "+" of the place that stays with its number -, and it has no buttons but those:
  // the pointer resting on a picture or a clip shows it larger over the chat's field (peekShow), a clip playing there
  // without its sound.
  function _filled(a, n, p) {
    const kind = _kindOf(a);
    const zoned = !!(p && S.pick);
    const cell = el('div', 'mv3-ig-att' + (kind === 'video' ? ' is-clip' : kind === 'audio' ? ' is-sound' : ''));
    cell.dataset.path = a.path;
    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = thumbOf(a.path, 'strip');
      img.loading = 'lazy';
      img.decoding = 'async';
      // Gone from the library since it was attached: it goes from the row, and the row says so.
      img.addEventListener('error', () => { _detach(a.path); _say(I18N.t('A picture in the row is not in the library any more.')); }, { once: true });
      cell.appendChild(img);
      cell.addEventListener('mouseenter', () => peekShow({ img: thumbOf(a.path, 'main') }, cell));
      cell.addEventListener('mouseleave', peekHide);
      cell.title = a.name || '';
      // A picture that does not go as things are - dimmed, its cross kept, the reason on it (the video
      // chat: one beyond the frames' places).
      const st = (typeof S.attState === 'function' ? S.attState(a) : null) || {};
      if (st.off) { cell.classList.add('is-dim'); cell.title = st.off; }
    } else {
      // A clip shows its own still when it has one - Kling's first frame, picked on its slider.
      if (kind === 'video' && (a.still || a.poster)) {
        const img = document.createElement('img');
        img.src = a.still || thumbOf(a.poster, 'strip');
        img.loading = 'lazy';
        img.decoding = 'async';
        cell.appendChild(img);
      } else cell.appendChild(el('span', 'ic', kind === 'audio' ? '♪' : '▶'));
      if (kind === 'video') {
        cell.addEventListener('mouseenter', () => peekShow({ img: a.still || (a.poster ? thumbOf(a.poster, 'main') : ''), clip: a.path }, cell));
        cell.addEventListener('mouseleave', peekHide);
      }
      const secs = (+a.out > +a.in) ? (+a.out - +a.in) : 0;
      // What the description says of it: `bad` - it cannot go like this, and why; `cut` - only a part of it goes.
      const st = (typeof S.attState === 'function' ? S.attState(a) : null) || {};
      if (secs || +a.dur > 0) {
        const d = el('button', 'dur' + (st.cut ? ' is-cut' : ''), I18N.t('{n}s', { n: secs.toFixed(1) }));
        d.type = 'button';
        d.title = st.cut ? I18N.t('{secs} s of {dur} go - press to choose the part', { secs: secs.toFixed(1), dur: (+a.dur).toFixed(1) })
          : I18N.t('all {secs} s go - press to choose the part', { secs: secs.toFixed(1) });
        d.addEventListener('click', (ev) => {
          ev.stopPropagation();
          peekHide();
          if (typeof S.trimFor === 'function') S.trimFor(a, cell);
        });
        cell.appendChild(d);
      }
      if (st.bad) { cell.classList.add('is-bad'); cell.title = st.bad; }
      else cell.title = a.name || '';
    }
    cell.appendChild(el('span', 'n', String(n)));
    const x = el('button', 'x u-onpic is-del u-x', '');
    x.type = 'button';
    x.title = zoned ? I18N.t('Not this one - its place stays, empty, and keeps its number') : I18N.t('Not this one');
    x.addEventListener('click', (ev) => { ev.stopPropagation(); _detach(a.path); });
    cell.appendChild(x);
    return cell;
  }

  // A cell of the zone: the thing (or its empty place) and, in a part with slots, the slot's name under it.
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

  // An empty place - a slot's, in a part with slots: pressed, the picker opens on it, or - for a description
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
    // The place a clip by a link goes into: how far it is, instead of "+".
    if (_linking && !_linkShown && !_linking.target && _linking.kind === p.kind && (_linking.slot == null || _linking.slot === key)) {
      _linkShown = true;
      c.classList.add('is-linking');
      b.textContent = _linking.text;
      b.title = I18N.t('A clip by a link is coming in here');
      b.disabled = true;
      return c;
    }
    b.addEventListener('click', () => {
      if (S.pick) { _openPick(p, s); return; }
      const input = _fileOf(p.kind);
      if (input) input.click();
    });
    return c;
  }

  // An empty NUMBERED place - a thing taken out: its number stays, "+" opens the picker on it, the cross
  // closes it (the numbers after it move up).
  function _holeCell(p, h, n, s, must) {
    const box = el('div', 'mv3-ig-att is-hole');
    const go = el('button', 'go', '+');
    go.type = 'button';
    const what = s && s.key ? (s.label || s.key) : p.one;
    go.title = I18N.t('{what} {n} is empty - press to put one in its place; the prompt still calls it {n}', { what: _cap(what), n });
    go.addEventListener('click', () => {
      if (S.pick) { _openPick(p, s, h); return; }
      const input = _fileOf(p.kind);
      if (input) input.click();
    });
    box.appendChild(go);
    box.appendChild(el('span', 'n', String(n)));
    const x = el('button', 'x u-onpic is-del u-x', '');
    x.type = 'button';
    x.title = I18N.t('Close this place - the numbers after it move up');
    x.addEventListener('click', () => _closeHole(h));
    box.appendChild(x);
    const c = _cell(box, s ? (s.label || s.key) : '', s && s.hint);
    c.classList.add('is-empty', 'is-hole');
    if (must) c.classList.add('is-req');
    c.dataset.kind = p.kind;
    c.dataset.slot = (s && s.key) || '';
    c.dataset.hole = h.id;
    // The numbered place a clip by a link goes into says how far it is.
    if (_linking && _linking.target === h) {
      _linkShown = true;
      c.classList.add('is-linking');
      go.textContent = _linking.text;
      go.title = I18N.t('A clip by a link is coming in here');
      go.disabled = true;
    }
    return c;
  }

  // ── The picker ──────────────────────────
  // For ONE place: its part, and in a part with slots its slot - "other" ('') for what no slot asks for, null for a
  // part without slots. The slot is armed while the window is open; the window closes by itself once the place is full.
  // `target`: an empty numbered place - what is pressed there takes that place and its number. A thing in the zone
  // pressed does not open the window on it: another in its place is its cross, then this "+".
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
      project: { key: _key || '', title: Store.title() || '', plinks: Store.unbound() ? '' : (_key || '') },
      sources: P.sources(kind),
      // The window with the tree - the almanac's size, over the middle of this chat.
      tree: typeof P.tree === 'function' ? P.tree(kind) : null,
      anchor: _ui ? _ui.root : null,
      start: P.start(kind, s),
      first: (P.first || {})[kind] || '',
      left: _pickLeft,
      room: () => (_pickAt && _pickAt.target && !_pickAt.filled ? I18N.t('its place is empty - one goes here') : ''),
      mark: _markOf,
      press: (it) => {
        const here = _atts.find(a => a.path === it.path);
        if (here) {
          // Opened on another place: one place per file - it stays where it is.
          if (_pickAt && _pickAt.target && _pickAt.target !== here) { _say(I18N.t('{what} is this one already - one place per file.', { what: _cap(_markOf(it.path)) })); return; }
          _detach(it.path);
          return;
        }
        _attach(it.path, it.name, kind === 'image' ? {} : { kind, poster: it.poster || '', dur: +it.dur || 0, role: it.role || '', label: it.label || '' });
      },
      // ...and the place it would go into: the frames chat's product place takes only a product of Props.
      why: (it) => P.why(it, kind, slot),
      // A place's own way to make what goes into it - the product place's "+ new prop".
      make: typeof P.make === 'function' ? P.make(kind, slot) : null,
      computer: {
        word: p.word, hint: (P.upWords || {})[kind] || '',
        open: () => { const input = _fileOf(kind); if (input) input.click(); },
        accepts: (f) => !!(U && U.ok(f)),
        drop: (files) => _upload(files),
        // A picture's link let go over the window: downloaded into the folder open there.
        link: kind === 'image' && U ? (url) => _linkPicture(url, { kind, cat: Pick.pickFolder() }) : null,
      },
      // A clip by a link, where the description takes them (`S.links`: { video: true }).
      link: (S.links && S.links[kind]) ? {
        hint: I18N.t('At the best quality there is, without a login - into VIDEO → Uploads itself, and into this place.'),
        add: (url) => _linkIn(url, kind),
      } : null,
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
  // the part's own slots still hold. An empty numbered place there is one more that goes (it is filled first).
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
    return (s ? (s.label || s.key) : p && p.slots ? I18N.t('other') : (p && p.one) || I18N.t('picture')) + ' ' + n;
  }

  // A row too long for its part scrolls sideways - the wheel too, while it has somewhere to go.
  function _sideways(row) {
    row.addEventListener('wheel', (e) => {
      if (row.scrollWidth <= row.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    }, { passive: false });
  }

  // ── A clip by a link ──────────────────────
  // Into the place the picker is open on: the server downloads it (lib/link-queue.js - the best there is, no login) into
  // VIDEO -> Uploads itself, as this chat's own upload files a clip, and it is attached the moment it is in.
  // Meanwhile the empty place it goes into says how far (`_linking`, painted by _empty / _holeCell) and the line over the
  // box the rest; a send waits for it as for an upload. One at a time. Resolves with what to say when it did not come
  // or did not go into its place ('' - it did).
  let _linking = null;          // { kind, slot, target, text } while a link comes in
  let _linkShown = false;       // its place painted already in this paint

  function _linkIn(url, kind) {
    if (_linking) return Promise.resolve(I18N.t('One link is coming in already - wait for it.'));
    if (_picking && _pickAt && _pickLeft() < 1) return Promise.resolve(I18N.t('This place has no room.'));
    const at = _pickAt ? { kind, slot: _pickAt.slot, target: _pickAt.target && _pickAt.target.hole ? _pickAt.target : null }
      : { kind, slot: null, target: null };
    _linking = Object.assign(at, { text: I18N.t('reading…') });
    _made = true;
    _paintAtts();
    const run = (async () => {
      let job = null;
      try {
        const jobs = await LK.addLinks([url], { from: 'chat', project: _key || '' });
        const end = await LK.follow([jobs[0].id], (list) => { if (list[0]) _linkTick(list[0]); });
        job = end[0] || null;
      } catch (e) { job = { state: 'error', error: e.message }; }
      const was = _linking;
      _linking = null;
      if (job && job.state === 'done' && job.items && job.items[0]) {
        const U = _U(kind);
        const it = job.items[0];
        const att = U && typeof U.att === 'function' ? U.att(it) : { path: it.videoPath, name: it.name };
        _say('');
        _attach(att.path, att.name, Object.assign({}, att, { kind }, typeof was.slot === 'string' && was.slot ? { slot: was.slot } : {}));
        _loadColumn();
        if (_picking) Pick.pickRefresh(((S.pick || {}).lands || {})[kind] || '', [att.path], _landAt(kind, it));
        if (_atts.some(a => a.path === att.path)) return '';
        // On the shelf, but the zone did not take it - the model's rules said why, over the box.
        const said = (_ui && _ui.said && _ui.said.textContent) || I18N.t('this place did not take it');
        return I18N.t('In Uploads, but not in its place: {why}', { why: said });
      }
      if (_ui) _paintAtts();
      const why = job && job.state === 'stopped' ? I18N.t('stopped') : ((job && job.error) || I18N.t('it could not be added'));
      _say(I18N.t('Not added: {why}', { why }));
      return I18N.t('Not added: {why}', { why });
    })();
    const all = Promise.all([_uploading, run]);
    _uploading = all;
    all.finally(() => { if (_uploading === all) _uploading = null; });
    return run;
  }

  // How far, in its place (the percent) and over the box (the rest) - the place changed where it is, the zone not
  // painted again every second.
  function _linkTick(j) {
    if (!_linking) return;
    const step = String(j.step || '');
    const pct = /(\d+)%/.exec(step);
    _linking.text = pct ? pct[1] + '%' : /join/i.test(step) ? I18N.t('joining…') : /shelf/i.test(step) ? I18N.t('filing…') : I18N.t('reading…');
    const c = _ui && _ui.atts ? _ui.atts.querySelector('.is-linking .mv3-ig-att-slot, .is-linking .go') : null;
    if (c) c.textContent = _linking.text;
    _say(I18N.t('link: {step}', { step: LK.shortStep(step) }));
  }

  // ── Bringing files in from this computer ──────────────────────────────────
  // Through the chat's own door: the file is filed on its shelf IN THE ROOT OF ITS KIND - IMAGES, VIDEO -> Uploads,
  // SFX -> My sounds - the thread keeps a path, never the bytes - and goes straight into the row. Every way in is this one: the window's "+ from this
  // computer…" and a drop over it, a drop on the chat, the column's "+", a paste into the box. Nothing else uploads it:
  // the Library's own drop stands down while a chat shows, or one drop would file it twice.
  // Through the attachment window and the column's "+" it goes INTO THE FOLDER OPEN there instead, when that is a folder of the person's own
  // (`into` { kind, cat } - chat-pick.js pickFolder; the server has the last word, routes/mv3-img.js `_folderFor`).
  // Resolves with the kinds that came in ({ image: { paths, at }, ... } - `at` the tree's node they went into).
  function _upload(files, into) {
    const run = _uploadNow(files, into);
    const all = Promise.all([_uploading, run]);
    _uploading = all;
    all.finally(() => { if (_uploading === all) _uploading = null; });
    return run;
  }

  // What a description takes from this computer, by kind: `S.uploads` { image, video, audio } - each its own
  // door ({ url, field, accept, ok(file), att(item) }) - or the one `S.upload` for pictures.
  const _U = (k) => (S.uploads ? S.uploads[k] || null : (k === 'image' ? S.upload : null));
  const _kindOfFile = (f) => ['image', 'video', 'audio'].find(k => _U(k) && _U(k).ok(f)) || '';
  const _fileOf = (k) => (_ui && _ui.files ? _ui.files[k] || null : null);

  // The node of the media tree a file of `kind` went into: its folder (`item.categoryId`) under the kind's root - `lands`,
  // which are the roots' keys (images, uploads, sounds) - else the root itself.
  function _landAt(kind, item) {
    const root = ((S.pick || {}).lands || {})[kind] || '';
    const cat = String((item && item.categoryId) || '');
    return root && cat ? root + ':' + cat : root;
  }

  async function _uploadNow(files, into) {
    let all = [...(files || [])].filter(f => f && _kindOfFile(f));
    // While the picker is open, files are for its place: its kind only, and no more than the place has room
    // for - the rest would spill into the other slots of the part.
    let note = '';
    // ...and they go into the folder open in it.
    if (!into && _picking && _pickAt) into = { kind: _pickAt.kind, cat: Pick.pickFolder() };
    if (_picking && _pickAt) {
      const U = _U(_pickAt.kind);
      const mine = all.filter(f => U && U.ok(f));
      const room = _pickLeft();
      if (mine.length > room) note = I18N.tn(room, 'Only {n} more goes here - the rest were not added.', 'Only {n} more go here - the rest were not added.');
      else if (mine.length < all.length) note = I18N.t('Only files of this kind go here - the others were not added.');
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
    _addingSaid = I18N.tn(list.length, 'adding {n} file…', 'adding {n} files…');
    _say(_addingSaid);
    let bad = list.length < all.length ? ((partOf(_kindOfFile(all.find(f => !list.includes(f)))) || {}).none || '') : '';
    const filed = new Map();      // kind -> { paths, at } - what came in, and the node it went into
    for (const f of list.slice(0, S.maxAtts)) {
      const k = _kindOfFile(f);
      const U = _U(k);
      const fd = new FormData();
      fd.append(U.field, f);
      fd.append('name', String(f.name || S.noun.one).replace(/\.[^.]+$/, ''));
      fd.append('project', _key || '');
      if (into && into.kind === k && into.cat) fd.append('categoryId', String(into.cat));
      const d = await json(U.url, { method: 'POST', body: fd });
      if (d && d.success && d.item) {
        const a = typeof U.att === 'function' ? U.att(d.item) : { path: d.item.imagePath, name: d.item.name };
        const was = filed.get(k) || { paths: [], at: '' };
        filed.set(k, { paths: was.paths.concat(a.path), at: _landAt(k, d.item) });
        _attach(a.path, a.name, Object.assign({}, a, { kind: k }));
      } else bad = (d && d.error) || I18N.t('it could not be added');
    }
    // What the attaching said of a file that came in ("…the first 15 s go", why it was not taken) stays: only
    // the "adding…" line goes, or the words of what was not added stand in its place.
    if (bad) _say(I18N.t('Not added: {why}', { why: bad }));
    else if (note) _say(note);
    else if (_ui && (_ui.said.textContent || '') === _addingSaid) _say('');
    _loadColumn();
    // The picker opens the folder a file went into, the file in view.
    if (_picking) for (const [k, got] of filed) Pick.pickRefresh(((S.pick || {}).lands || {})[k] || '', got.paths, got.at);
    return Object.fromEntries(filed);
  }

  // ── A picture by its link ─────────────────
  // A picture dragged from a browser onto the chat or the attachment window: the server downloads it (routes/mv3-img.js
  // POST /api/mv3/img/link - a picture's own address only; a page's is refused in words, nothing is pulled out of pages),
  // makes it sendable as a file from this computer and files it - onto the chat into IMAGES itself, through the window or
  // the column into the folder open there (`into`) -, and it is attached. A picture the browser handed over as data
  // (`data:image/…`) is a file from this computer. Resolves with what to say ('' - it is in).
  async function _linkPicture(url, into) {
    const U = _U('image');
    if (!U) return T.onlyFiles;
    const z = _zone();
    const p = z ? z.parts.find(x => x.kind === 'image') : null;
    if (z && !(p && p.room && !p.off)) { const w = (p && (p.off || p.none)) || I18N.t('This model takes no pictures.'); _say(w); return w; }
    if (_picking && _pickAt && _pickAt.kind !== 'image') { const w = I18N.t('Only pictures of this kind here.'); _say(w); return w; }
    if (/^data:image\//i.test(url)) {
      try {
        const blob = await fetch(url).then(r => r.blob());
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
        await _upload([new File([blob], 'picture.' + ext, { type: blob.type })], into);
        return '';
      } catch (e) {
        const w = I18N.t('Not added: {why}', { why: I18N.t('the picture could not be read') });
        _say(w);
        return w;
      }
    }
    _made = true;
    _fetchingSaid = I18N.t('downloading the picture…');
    _say(_fetchingSaid);
    const run = (async () => {
      const d = await json('/api/mv3/img/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, project: _key || '', categoryId: (into && into.kind === 'image' && into.cat) || '' }),
      });
      if (!d || !d.success || !d.item) {
        const why = (d && d.error) || I18N.t('it could not be downloaded');
        _say(I18N.t('Not added: {why}', { why }));
        return I18N.t('Not added: {why}', { why });
      }
      const a = typeof U.att === 'function' ? U.att(d.item) : { path: d.item.imagePath, name: d.item.name };
      if (_ui && (_ui.said.textContent || '') === _fetchingSaid) _say('');
      _attach(a.path, a.name, Object.assign({}, a, { kind: 'image' }));
      _loadColumn();
      if (_picking) Pick.pickRefresh(((S.pick || {}).lands || {}).image || '', [a.path], _landAt('image', d.item));
      return '';
    })();
    const all = Promise.all([_uploading, run]);
    _uploading = all;
    all.finally(() => { if (_uploading === all) _uploading = null; });
    return run;
  }

  // ── The thread ────────────────────────────────────────────────────────────
  function _stageWords(g) {
    if (g.error && !g.stage) return I18N.t('{error} - trying the next…', { error: g.error.slice(0, 60) });
    return g.stage ? g.stage + '…' : S.busyWord + '…';
  }

  // A card is drawn again when what it IS changes - never for the text being typed into it; its clips are
  // its description's to keep fresh in place (a made card stays a field to edit and make again
  // from, and a clip landing must not rebuild it under the typing).
  // A description may add what else makes a message what it is (`msgSig` - the frames chat's used ideas).
  const _sig = (m) => ((m.card && typeof S.cardSig === 'function') ? [m.text || '', S.cardSig(m)]
    : [m.text || ''].concat(_gensOf(m).map(g => g.id + ':' + g.state + ':'
      + (g.state === 'done' ? _path(g) : g.state === 'failed' ? g.error : '')))).join('|')
    + (typeof S.msgSig === 'function' ? '|' + S.msgSig(m) : '');

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
    const own = !!_col && _col.isOwn();
    const [d, f] = k
      ? await Promise.all([
        json('/api/mv3/chat?project=' + encodeURIComponent(k) + '&kind=' + S.kind),
        own ? json(S.feed.url(k)) : null,
      ])
      : [{ success: true, items: [] }, own ? { success: true, items: [] } : null];
    if (mine !== _seq || k !== (_key || '') || !_chat) return;
    if (d && d.success) _thread = d.items || [];
    // A folder is read when it is opened, not on every tick.
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
    // The description follows the thread as it is now (the video chat: its working messages, painted in place).
    if (typeof S.onThread === 'function') S.onThread(_thread);
    const ids = new Set(_thread.map(m => m.id));
    for (const [id, n] of _nodes) {
      if (ids.has(id)) continue;
      _dropProgs(n, null);
      n.el.remove();
      _nodes.delete(id);
    }
    let empty = host.querySelector('.mv3-ig-empty');
    if (!_thread.length && !_pend && !_notice) {
      // The Library's and Home's chats are on the draft: the description's `emptyDraft` when it has one.
      const said = !_key ? T.emptyNoProject : (Store.unbound() && T.emptyDraft) ? T.emptyDraft : T.empty;
      // The shared part, its icon the chat's (`emptyIcon`, a picture by default); made again only
      // when its words change.
      if (!empty || empty.dataset.said !== said) {
        const e = emptyEl(said, { icon: T.emptyIcon || 'image', cls: 'mv3-ig-empty' });
        e.dataset.said = said;
        if (empty) empty.replaceWith(e); else host.appendChild(e);
        empty = e;
      }
    } else if (empty) empty.remove();

    let prev = null;
    // A description may draw a send as ONE message: the person's turn is not drawn apart (`hidden`), and
    // the answer after it is handed it, to draw what was asked at its head.
    let asked = null;
    const busy = _busyIds();
    for (const m of _thread) {
      if (typeof S.hidden === 'function' && S.hidden(m)) {
        if (m.role === 'user') asked = m;
        continue;
      }
      let n = _nodes.get(m.id);
      const sig = _sig(m);
      if (!n || n.sig !== sig) {
        if (n) _dropProgs(n, _landedNow);
        const progs = new Map();
        const b = _bubble(m, progs, m.role === 'user' ? null : asked);
        const del = _delOn(b, m);
        if (n) n.el.replaceWith(b);
        // The message drawn at the press gives its place to its answer.
        else if (_pend && _pend.id === m.id) { _pend.el.replaceWith(b); _pend = null; }
        n = { el: b, sig, progs, away: false, del };
        _nodes.set(m.id, n);
      } else {
        n.away = false;
        for (const g of _gensOf(m)) { const p = n.progs.get(g.id); if (p) p.say(_stageWords(g)); }
      }
      // Read on every paint: a turn of the person is busy while ITS answers are, and they are other nodes.
      if (n.del) n.del.hidden = busy.has(m.id);
      if (m.role !== 'user') asked = null;
      const want = prev ? prev.nextSibling : host.firstChild;
      if (n.el !== want) host.insertBefore(n.el, want);
      prev = n.el;
    }
    // The page's word after the messages.
    let word = host.querySelector(':scope > .mv3-ig-notice');
    if (!_notice) { if (word) word.remove(); }
    else {
      if (!word || word.dataset.said !== _notice) {
        const w = el('div', 'mv3-ig-msg is-agent mv3-ig-notice');
        for (const line of _notice.split('\n')) if (line.trim()) w.appendChild(el('div', 'mv3-ig-text', line));
        w.dataset.said = _notice;
        if (word) word.replaceWith(w);
        word = w;
      }
      const after = prev ? prev.nextSibling : host.firstChild;
      if (word !== after) host.insertBefore(word, after);
    }
    if (atEnd) host.scrollTop = host.scrollHeight;
  }

  // ── A MESSAGE TAKEN AWAY ─────────────────
  // A faint ✕ in the corner of every message of every chat, brighter under the pointer. The first press asks
  // "really?" in its place and the second takes the message away - with what it was asked with
  // and the records of what it made; the clips and pictures stay on their shelves and on the timeline (the server's
  // lib/mv3-chat.js remove). It goes back to ✕ after 3 s, when the pointer leaves the message, or on Escape.
  function _delOn(b, m) {
    // the shared cross, "Really?" by js/really.js (3 s, Escape and the pointer leaving the message let go)
    const x = el('button', 'mv3-ig-del u-btn is-s is-icon is-quiet is-del u-x', '');
    x.type = 'button';
    x.title = I18N.t('Delete this message - what it made stays on its shelf and on the timeline');
    twoPress(x, { host: b, go: async (e) => {
      e.preventDefault();
      e.stopPropagation();
      x.disabled = true;
      const d = await json('/api/mv3/chat/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: m.id }),
      });
      if (!d || !d.success) {
        x.disabled = false;
        if (x.isConnected) note(x, I18N.t('Not deleted.'), (d && d.error) || I18N.t('the app did not answer'));
        return;
      }
      // Gone at once; the thread read again takes away what went with it.
      _thread = _thread.filter(y => y.id !== m.id);
      _paintThread();
      _reload();
    } });
    b.classList.add('has-del');
    b.appendChild(x);
    return x;
  }

  // What cannot be taken away now: a message with something still being made in it - a clip or a picture on its
  // countdown, a card a writer is writing, a storyboard being drawn - and a turn of the person whose answers have one (the
  // server takes a turn's answers with it).
  function _busyIds() {
    const out = new Set();
    let turn = null;
    for (const m of _thread) {
      if (m.role === 'user') { turn = m; continue; }
      const busy = _gensOf(m).some(g => g && g.state === 'pending') || !!(m.card && m.card.state === 'writing')
        || (m.boards || []).some(g => g && g.state === 'pending');
      if (busy) { out.add(m.id); if (turn) out.add(turn.id); }
    }
    return out;
  }

  function _bubble(m, progs, asked) {
    // A card is the description's to draw.
    // `asked` - the person's turn this answers, when the description hides the turns (`hidden`).
    if (m.card && typeof S.cardBubble === 'function') {
      const c = S.cardBubble(m, progs, asked);
      if (c) return c;
    }
    // Any other message a description draws itself - the frames chat's ideas and its frames.
    if (typeof S.bubble === 'function') {
      const c = S.bubble(m, progs, asked);
      if (c) return c;
    }
    const b = el('div', 'mv3-ig-msg is-' + (m.role === 'user' ? 'user' : 'agent'));
    // What was asked, at the head of the answer - the description draws it.
    if (m.role !== 'user' && typeof S.askedHead === 'function') {
      const h = S.askedHead(m, asked);
      if (h) b.appendChild(h);
    }
    if (m.text) b.appendChild(el('div', 'mv3-ig-text', m.text));
    // What the turn pointed at: by kind where the message says (the video chat's `media`), else its pictures.
    const sent = (m.media || []).length ? m.media : (m.refs || []).map(p => ({ path: p, kind: 'image' }));
    if (m.role === 'user' && sent.length) {
      const row = el('div', 'mv3-ig-msg-refs');
      const count = { image: 0, video: 0, audio: 0 };
      for (const a of sent) {
        const k = count[a.kind] != null ? a.kind : 'image';
        count[k]++;
        row.appendChild(refCell(a, k, count[k], sent));
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
      // The description draws a finished one - its ⤢ or ▶ opens the thread's finished ones large (a press on it does nothing).
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
      cell.appendChild(el('div', 'mv3-ig-bad', g.error || I18N.t('nothing came back')));
      if (!g.cancelled && g.alertId && !/question instead/.test(g.error || '')) cell.appendChild(el('div', 'mv3-ig-note', I18N.t('Alerts can try it again')));
    }
    return cell;
  }

  // The technical half, folded away - including what was actually sent, which is the only way a result
  // that came out wrong can be argued with.
  function _facts(g) {
    const wrap = el('div', 'mv3-ig-more');
    const btn = el('button', 'mv3-ig-more-b', I18N.t('Read more'));
    btn.type = 'button';
    const body = el('div', 'mv3-ig-more-body');
    body.hidden = true;
    for (const [k, v] of S.facts(g)) {
      if (!v || v === ' · ? · ') continue;
      const r = el('div', 'mv3-ig-more-row');
      r.appendChild(el('span', 'k', k));
      r.appendChild(S.markImages ? markText(el('span', 'v'), String(v)) : el('span', 'v', String(v)));
      body.appendChild(r);
    }
    btn.addEventListener('click', () => {
      body.hidden = !body.hidden;
      btn.textContent = body.hidden ? I18N.t('Read more') : I18N.t('Less');
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
      // A description's own waiting in the thread - the video chat's card being written.
      || (typeof S.busy === 'function' && S.busy(_thread));
    _timer = setTimeout(() => { _timer = 0; if (_chat && !document.hidden) _reload(); else _schedule(); }, busy ? POLL_MS : IDLE_MS);
  }
  function _stop() { clearTimeout(_timer); _timer = 0; }

  // ── Sending ───────────────────────────────────────────────────────────────
  async function _send() {
    if (_sending || !_ui) return;
    const ta = _ui.ta;
    const at = _ui.go;
    // A description may stand in for an empty box - Kling motion control's standard prompt.
    const text = ta.value.trim() || (typeof S.emptyText === 'function' ? String(S.emptyText() || '').trim() : '');
    // A description may let the box go empty - the video chat's writer makes a clip from the attachments.
    if (!text && !(typeof S.emptyOk === 'function' && S.emptyOk())) {
      ta.focus();
      ta.classList.add('is-bad');
      setTimeout(() => ta.classList.remove('is-bad'), 900);
      return;
    }
    // An empty numbered place first: the numbers in the prompt would move under it.
    const why = _holeWhy() || set.ready();
    if (why) { note(at, why[0], why[1]); return; }
    _sending = true;
    _ui.go.disabled = true;
    // THE MESSAGE IS DRAWN AT THE PRESS - what was asked, and "sending…" - and the
    // answer takes its place in the thread; a refusal takes it away, the box and the zone left as they were.
    _dropPend();
    if (typeof S.sending === 'function') {
      const pe = S.sending({ text, media: (set.body() || {}).media || [] });
      if (pe) {
        _pend = { el: pe, id: '' };
        const host = _ui.thread;
        const empty = host.querySelector('.mv3-ig-empty');
        if (empty) empty.remove();
        host.appendChild(pe);
        host.scrollTop = host.scrollHeight;
      }
    }
    try {
      // A file still on its way into the row goes with this message, not after it.
      if (_uploading) { _say(I18N.t('waiting for the picture to be added…')); await _uploading.catch(() => {}); _say(''); }
      if (!Store.key()) {
        _adopt = true;
        try { await _ensureProject(); }
        catch (e) { _adopt = false; note(at, I18N.t('Could not start a project.'), String(e.message || e).slice(0, 120)); return; }
      }
      // The conversation's key: a highlights fragment talks in its project's, and its Alerts row leads back to
      // the project with this chat open.
      const key = Views.chatKey(Store.key());
      const d = await json(S.sendUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ project: key, text, refs: _real().map(a => a.path) }, set.body(), {
          n: _n, write: _writeOn(),
          // Where it was asked from, for Alerts (js/alerts-bell.js): the project, and this chat in it - or
          // the place the description names (the frames chat's).
          // From the Library's unbound chat - the Library (chat-owner.js whereOf).
          where: typeof S.where === 'function' ? S.where(key) : Store.whereOf(key, S.name),
        })),
      });
      if (!d || !d.success) { _dropPend(); note(at, I18N.t('Not sent.'), (d && d.error) || I18N.t('the server did not answer')); return; }
      if (_pend) _pend.id = d.send || '';
      ta.value = '';
      _notice = '';
      _grow();
      // What the description does once a send is in (the video chat: the zone emptied - its attachments are
      // packed into the writer's message).
      if (typeof S.afterSend === 'function') S.afterSend(d);
      _saveDraft(_key || '');
      if (d.send) _sendSeq.set(d.send, _attSeq);
      await _reload(true);
    } finally {
      // An answer the thread did not bring back with it: the message drawn at the press goes all the same.
      _dropPend();
      _sending = false;
      if (_ui) { _ui.go.disabled = false; _ui.ta.focus(); }
    }
  }

  function _dropPend() {
    if (_pend) _pend.el.remove();
    _pend = null;
  }

  // The writer on or off - the pen in the bar, or the description's own switch through ctx.setWriting.
  // How many at once: the layers icon and the number, the words in its title.
  function _paintN() {
    const b = _ui && _ui.nBtn;
    if (!b) return;
    b.innerHTML = icon('layers', 14) + '<span class="u-mono">' + _n + '</span>';
    b.title = I18N.t('How many to make at once: {n} - press for {next}. Each is its own attempt.',
      { n: _n, next: S.counts[(S.counts.indexOf(_n) + 1) % S.counts.length] });
    b.setAttribute('aria-label', I18N.t('How many at once: {n}', { n: _n }));
  }
  // THE PRICE BY THE SEND: the column's price box (a model column paints it) is read into the bar - its
  // figure beside the button, the whole phrase in the title - and the box itself is not shown.
  function _priceFrom(box) {
    const p = _ui && _ui.price;
    if (!p || !box) return;
    box.hidden = true;
    const b = box.querySelector('b');
    const fig = (b ? b.textContent : '').trim().replace(/^≈s*/, '≈ ');
    p.textContent = fig;
    p.title = [...box.children].map(c => c.textContent.trim()).filter(Boolean).join(' · ');
    p.hidden = !fig;
  }
  // The writer as it works now: switched on, and an agent of the ladder can be asked. The choice itself is kept as it
  // was - a key added, the writer is back as the person left it.
  const _writeOn = () => _write && KG.isOpen('writer');
  function _paintPen() {
    const pen = _ui && _ui.pen;
    if (!pen) return;
    const on = _writeOn();
    pen.classList.toggle('on', on);
    pen.classList.toggle('is-on', on);   // pressed: the selected look
    pen.classList.toggle('is-keyshut', !KG.isOpen('writer'));
    if (!KG.isOpen('writer')) { pen.title = I18N.t('The writer needs an AI key for the agents - press to see which'); return; }
    pen.title = on
      ? I18N.t('The writer is on: your message is rewritten into the shape this model wants. Press to send your words exactly as typed.')
      : I18N.t('Sending your words exactly as typed. Press to let the writer shape them for this model.');
  }
  function _setWriting(v) {
    // Switched on with no agent to write: the popup says which key, and nothing changes.
    if (v && !KG.allow('writer', _ui && _ui.pen)) { _paintPen(); return; }
    _write = !!v;
    keep(S.keys.write, _write);
    _paintPen();
    if (typeof set.onPen === 'function') set.onPen(_write);
  }

  // One line of 26 px, growing with the words up to six lines (css/mv3-imagen.css .mv3-ig-say).
  const SAY_MAX = 106;
  function _grow() {
    const ta = _ui.ta;
    // Empty, it is one line - measured, the placeholder of a box not laid out yet would make it tall.
    if (!ta.value) { ta.style.height = ''; if (ta._imw) ta._imw.refresh(); return; }
    ta.style.height = 'auto';
    // scrollHeight is the words and the padding; the box's height takes its border too.
    ta.style.height = Math.min(SAY_MAX, ta.scrollHeight + 2) + 'px';
    // The pictures' numbers marked over the box follow a value set by script too.
    if (ta._imw) ta._imw.refresh();
  }

  // ── The right column ──────────────────────────────────────────────────────
  // The FOLDER COLUMN (js/folder-column.js): a dropdown of the media tree - "this project"
  // first, then the description's roots (the pictures chat: REFERENCES and IMAGES with all their folders) -, the open
  // folder's folders as tiles, then its pictures. "this project" is this project's own results, read with the thread.
  // A description's `sig` says what its column offers now (the video chat: which tops, the longest clip): read
  // again only when it changed.
  let _colSig = null;
  let _colWait = false;      // the window has just opened: the column is read once the settings are in (_show)
  let _opens = 0;
  const _sigNow = () => (S.column && typeof S.column.sig === 'function' ? String(S.column.sig()) : '');
  function _loadColumn() {
    if (!_col) return;
    _colSig = _sigNow();
    _col.reload();
  }
  function _columnChanged() {
    if (!_col || _colWait || _sigNow() === _colSig) return;
    _loadColumn();
  }

  // What the column shows drawn again - this project's own as last read, every tile's mark as the row is now.
  function _paintStrip() {
    if (!_col) return;
    _col.setOwn(_feed);
    if (!_col.isOwn()) _col.paint();
  }

  // The column's "+": the picture goes into IMAGES itself, and the column opens there with it in view -
  // into the folder open in the column when it is a folder of the person's own in IMAGES
  // (not a required one, nor anything under Environments / Lookbooks - the server's rule), and the column stays on it.
  let _colFile = null;
  function _colFolder() {
    const s = _col ? _col.selected() : null;
    const n = s && s.node;
    return n && n.kind === 'images' && n.cat && !n.locked ? String(n.cat) : '';
  }
  // A column of several kinds (`column.multi` - the video chat): the folder open is the person's own folder of
  // one kind's home (`pick.lands` - IMAGES, VIDEO -> Uploads, My sounds) -> { kind, cat }, else null - the server has the last
  // word (`_folderFor`), as through the attachment window.
  function _colInto() {
    const s = _col ? _col.selected() : null;
    const n = s && s.node;
    const lands = (S.pick || {}).lands || {};
    const kind = n && n.cat && !n.locked ? Object.keys(lands).find(k => lands[k] === n.kind) : '';
    return kind ? { kind, cat: String(n.cat) } : null;
  }
  // Nothing is brought into REFERENCES - no "+" while one of its folders is open.
  function _plusTile() {
    const open = _col ? _col.selected() : null;
    if (open && open.node && open.node.kind === 'references') return null;
    const b = el('button', 'mv3-ig-card is-plus', '+');
    b.type = 'button';
    b.title = T.plus;
    b.addEventListener('click', () => {
      if (!_ui || !_ui.file) return;
      if (!_colFile) {
        _colFile = document.createElement('input');
        _colFile.type = 'file';
        _colFile.multiple = true;
        _colFile.accept = S.column.multi ? Object.values(_ui.files).map(i => i.accept).join(',') : _ui.file.accept;
        _colFile.hidden = true;
        _colFile.addEventListener('change', async () => {
          const f = [..._colFile.files || []];
          _colFile.value = '';
          if (S.column.multi) {
            // Each file into the root of its kind - or the folder open, when it is the person's own of that kind - and
            // the column opens where the first of them went.
            const into = _colInto();
            const got = (await _upload(f, into || undefined)) || {};
            const k = into && got[into.kind] ? into.kind : Object.keys(got)[0];
            if (k && got[k] && _col) _col.select(got[k].at || S.column.home || '');
            return;
          }
          const got = await _upload(f, { kind: 'image', cat: _colFolder() });
          if (got && got.image && _col) _col.select(got.image.at || S.column.home || '');
        });
      }
      if (!_colFile.isConnected) _ui.root.appendChild(_colFile);
      _colFile.click();
    });
    return b;
  }

  function _tile(it) {
    // The video chat's column holds clips and sounds too.
    if (it && it.ftype === 'video') return _clipTile(it);
    if (it && it.ftype === 'audio') return _soundTile(it);
    const t = el('div', 'mv3-ig-card'
      + (it.state === 'pending' ? ' is-busy' : it.state === 'failed' ? ' is-fail' : '')
      + (_atts.some(a => a.path === it.path) ? ' on' : ''));
    if (it.aspect) t.style.aspectRatio = String(it.aspect).replace(':', '/');
    t.title = it.name || '';
    if ((it.state || 'done') === 'done' && it.path) {
      const img = document.createElement('img');
      img.src = thumbOf(it.path, 'strip');
      img.alt = it.name || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      t.appendChild(img);
      t.draggable = true;
      // The library's own payload, so a tile can be dragged onto a lane like anything on the shelf.
      t.addEventListener('dragstart', (ev) => {
        if (refuseHome(t, ev)) return;
        ev.dataTransfer.effectAllowed = 'copy';
        ev.dataTransfer.setData(Store.DRAG_TYPE, JSON.stringify({
          libId: it.libId || '', src: it.path, thumb: it.path,
          name: (it.name || '').slice(0, 60), group: S.column.group || 'images', dur: 0,
        }));
        t.classList.add('is-dragging');
      });
      t.addEventListener('dragend', () => t.classList.remove('is-dragging'));
      // A press ATTACHES, and a second one takes it back off; ⤢ in its corner opens it large - the folder's pictures, from it.
      t.addEventListener('click', () => {
        if (_atts.some(a => a.path === it.path)) _detach(it.path);
        else _attach(it.path, it.name);
      });
      t.appendChild(mediaBtn('image', () => viewPictures((_col ? _col.items() : [it])
        .filter(x => x && x.path && (x.state || 'done') === 'done' && x.ftype !== 'video' && x.ftype !== 'audio'), it.path)));
    } else if (it.state === 'pending') {
      t.appendChild(el('span', 'sp', I18N.t('making…')));
    } else {
      t.appendChild(el('span', 'sp', String(it.error || I18N.t('failed')).slice(0, 70)));
    }
    return t;
  }

  // What the video chat's column holds besides pictures. A press attaches it to its part of
  // the zone as the attachment window does - a clip with its poster and length (its part window opens as there), a sound
  // with its length -, a second press takes it off; what the model cannot take of it is said over the box (`pick.why`, `_say`).
  // Dragged, it goes onto a lane as a shelf's tile does.
  function _colPress(it, kind, extra) {
    if (_atts.some(a => a.path === it.path)) { _detach(it.path); return; }
    const why = S.pick && typeof S.pick.why === 'function' ? S.pick.why(it, kind) : '';
    if (why) { _say(why); return; }
    _attach(it.path, it.name, Object.assign({ kind }, extra));
  }
  function _colDrag(t, item, media) {
    t.draggable = true;
    t.addEventListener('dragstart', (ev) => {
      if (refuseHome(t, ev)) return;
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData(Store.DRAG_TYPE, JSON.stringify(Object.assign(item, { media })));
      ev.dataTransfer.setData(Store.DRAG_MEDIA + media, '1');
      t.classList.add('is-dragging');
    });
    t.addEventListener('dragend', () => t.classList.remove('is-dragging'));
  }
  const _secsOf = (v) => (+v > 0 ? I18N.t('{n}s', { n: (+v).toFixed(1) }) : '');

  // A clip: its poster at its shape, its length; ▶ in its middle plays it in the Library's viewer and the pointer resting on
  // it plays it in place without its sound.
  function _clipTile(it) {
    const t = el('div', 'mv3-ig-card is-clip'
      + (it.state === 'pending' ? ' is-busy' : it.state === 'failed' ? ' is-fail' : '')
      + (_atts.some(a => a.path === it.path) ? ' on' : ''));
    if (it.aspect) t.style.aspectRatio = String(it.aspect).replace(':', '/');
    t.title = it.name || '';
    if ((it.state || 'done') !== 'done' || !it.path) {
      t.appendChild(el('span', 'sp', it.state === 'pending' ? I18N.t('making…') : String(it.error || I18N.t('failed')).slice(0, 70)));
      return t;
    }
    const poster = it.thumb || posterOf(it.path);
    const img = document.createElement('img');
    img.src = thumbOf(poster, 'strip');
    img.alt = it.name || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', () => img.remove(), { once: true });
    t.appendChild(img);
    const secs = _secsOf(it.dur);
    if (secs) t.appendChild(el('span', 'mv3-ig-dur', secs));
    const why = S.pick && typeof S.pick.why === 'function' ? S.pick.why(it, 'video') : '';
    if (why) { t.classList.add('is-short'); t.title = it.name ? I18N.t('{name} - {why}', { name: it.name, why }) : why; }
    t.appendChild(mediaBtn('video', () => viewClip(it.path, it.name, it.thumb)));
    hoverClip(t, it.path);
    _colDrag(t, {
      libId: it.libId || '', src: it.path, thumb: poster, name: (it.name || '').slice(0, 60),
      group: it.group || (it.kind === 'references' ? 'uploads' : it.kind || 'uploads'), dur: +it.dur || 0, bed: false,
    }, 'video');
    t.addEventListener('click', () => _colPress(it, 'video', { poster, dur: +it.dur || 0 }));
    return t;
  }

  // A sound: a row - ▶ to listen here, its name, its length.
  let _hear = null;             // { audio, btn, path } - the column's sound playing
  function _hearStop() {
    if (!_hear) return;
    try { _hear.audio.pause(); } catch (e) { /* gone */ }
    _hear.btn.textContent = '▶';
    _hear = null;
  }
  function _soundTile(it) {
    const t = el('div', 'mv3-ig-card is-sound' + (_atts.some(a => a.path === it.path) ? ' on' : ''));
    t.title = it.name || '';
    const play = el('button', 'mv3-ig-splay u-btn is-s is-icon', _hear && _hear.path === it.path ? '❚❚' : '▶');
    play.type = 'button';
    play.title = I18N.t('Listen');
    play.draggable = false;
    // Drawn again while it plays: this button is the one that stops it now.
    if (_hear && _hear.path === it.path) _hear.btn = play;
    play.addEventListener('click', (e) => {
      e.stopPropagation();
      const same = _hear && _hear.path === it.path;
      _hearStop();
      if (same) return;
      const a = new Audio(it.path);
      a.addEventListener('ended', () => { if (_hear && _hear.audio === a) _hearStop(); });
      a.play().catch(() => { if (_hear && _hear.audio === a) _hearStop(); });
      _hear = { audio: a, btn: play, path: it.path };
      play.textContent = '❚❚';
    });
    t.append(play, el('span', 'nm', it.name || I18N.t('sound')), el('span', 'du', _secsOf(it.dur)));
    const why = S.pick && typeof S.pick.why === 'function' ? S.pick.why(it, 'audio') : '';
    if (why) { t.classList.add('is-short'); t.title = it.name ? I18N.t('{name} - {why}', { name: it.name, why }) : why; }
    _colDrag(t, {
      libId: it.libId || '', src: it.path, thumb: null, name: (it.name || '').slice(0, 60),
      group: it.kind || 'sounds', dur: +it.dur || 0, bed: it.kind === 'music',
    }, 'audio');
    t.addEventListener('click', () => _colPress(it, 'audio', { dur: +it.dur || 0 }));
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

  // ── The zone's enlarged view ──────────────────────────────────────────────
  // ONE PLACE, ALWAYS THE SAME: the bottom right of the conversation, over the thread - learnt once.
  // It closes itself the moment the pointer is anywhere but what opened it, or that thing is repainted
  // away; a wheel and a press close it too. Only the zone's things have it - every
  // chat's, the frames chat's too: `what` { img, clip } - a picture larger, a clip playing in it without its sound, over its
  // poster (hover-play.js).
  let _peek = null;
  let _peekOn = null;
  let _peekOff = null;

  function peekShow(what, anchor) {
    peekHide();
    if (!_ui || !what || !(what.img || what.clip)) return;
    const box = el('div', 'mv3-ig-peek');
    let img = null;
    if (what.img) {
      img = document.createElement('img');
      img.src = what.img;
      box.appendChild(img);
    }
    document.body.appendChild(box);
    _peek = box;
    const t = _ui.thread.getBoundingClientRect();
    const w = Math.max(120, Math.min(400, t.width - 24));
    const h = Math.max(120, Math.min(520, t.height - 16));
    box.style.width = w + 'px';
    box.style.maxHeight = h + 'px';
    // A clip with no poster: the box at its largest, the clip inside it at its own shape.
    if (img) img.style.maxHeight = (h - 8) + 'px';
    else box.style.height = h + 'px';
    box.style.left = Math.round(Math.max(8, t.right - w - 12)) + 'px';
    box.style.bottom = Math.round(Math.max(8, window.innerHeight - t.bottom + 8)) + 'px';
    _peekOn = anchor;
    if (what.clip) _hp.on(anchor, box, what.clip);
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
    // A clip playing in it lets go.
    if (_peekOn) _hp.off(_peekOn);
    _peekOn = null;
    if (_peek) { _peek.remove(); _peek = null; }
  }

  // ── Narrow or wide ────────────────────────────────────────────────────────
  // Narrower than 700px, the settings column folds into one row above the input.
  function _fit() {
    if (!_ui) return;
    const w = _ui.root.clientWidth;
    const narrow = w > 0 && w < NARROW;
    if (narrow !== _ui.narrow) {
      _ui.narrow = narrow;
      _ui.root.classList.toggle('is-narrow', narrow);
      if (narrow) _ui.chat.insertBefore(_ui.set, _ui.attsAt);
      else _ui.main.insertBefore(_ui.set, _ui.chat);
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
    // The columns, side by side - the window's head says what the chat is.
    const main = el('div', 'mv3-ig-main');
    root.appendChild(main);

    const setBox = el('div', 'mv3-ig-set');
    const left = el('div', 'mv3-ig-scroll');
    const said = el('div', 'mv3-ig-said u-status is-bad');
    // A description's own foot of the column, under everything - the video chat's almanac.
    setBox.append(left, said, ...(typeof S.columnFoot === 'function' ? S.columnFoot() : []));

    const chat = el('div', 'mv3-ig-chat');
    const thread = el('div', 'mv3-ig-thread');
    const atts = el('div', 'mv3-ig-atts');
    // A door from this computer for every kind the description takes - pictures' is `file`.
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
    // exactly as typed. A description that keeps its own switch for it in its column has no pen here.
    // The bar's buttons are icons, their words in the title: the writer a pencil, how many at
    // once the layers with the number, the send an arrow; the price of the press stands right before it (_priceFrom).
    const pen = S.penInBar === false ? null : el('button', 'pen u-btn is-s is-icon');
    if (pen) { pen.type = 'button'; pen.innerHTML = icon('pencil', 14); }
    const nBtn = el('button', 'n u-btn is-s');
    nBtn.type = 'button';
    const go = el('button', 'b u-btn is-s is-icon is-main');
    go.type = 'button';
    go.innerHTML = icon('arrow-right', 14);
    go.title = I18N.t('Send (Enter) · a new line is Shift+Enter');
    go.setAttribute('aria-label', I18N.t('Send'));
    const price = el('span', 'mv3-ig-price u-price');
    price.hidden = true;
    bar.append(...[ta, pen, nBtn, price, go].filter(Boolean));
    // A description with `markImages` (the frames chat) has the pictures'
    // numbers - "image 1" - yellow in its box (js/merge-v3/image-words.js).
    if (S.markImages) markField(ta);
    // What a description stands right of the attachment row - the frames chat's `ideas`.
    const side = typeof S.attsSide === 'function' ? S.attsSide() : [];
    let attsAt = atts;
    if (side.length) {
      attsAt = el('div', 'mv3-ig-attsrow');
      attsAt.append(atts, ...side);
    }
    chat.append(thread, attsAt, ...Object.values(files), bar);

    // The right column - for a description that has one (`column`: the pictures chat; the video chat too -
    // its pictures, clips and sounds, `column.multi`).
    let sash = null, stripBox = null;
    if (S.column) {
      sash = el('div', 'mv3-sash is-v mv3-ig-sash');
      sash.title = I18N.t('Drag to resize · double-click to reset');
      stripBox = el('div', 'mv3-ig-strip');
      main.append(setBox, chat, sash, stripBox);
    } else main.append(setBox, chat);

    _ui = { root, main, set: setBox, left, said, chat, thread, atts, attsAt, file, files, bar, ta, pen, nBtn, price, go, stripBox, narrow: null };
    _paintN();
    if (stripBox) {
      _col = createFolderColumn(stripBox, {
        roots: S.column.roots, files: S.column.files || 'photo', fit: S.column.fit, title: T.cat || I18N.t('Show'),
        // THIS PROJECT's folders - the project's; none in the Library's unbound chat.
        plinks: () => (Store.unbound() ? '' : (_key || '')),
        // The Library's unbound chat has no project: no "this project" row.
        // ONE "this project": what this chat made here, and THIS PROJECT's folders and links.
        // A draft has no THIS PROJECT: there the row is what this chat made in the draft - "This draft".
        own: Store.unbound() ? null : {
          get label() { return Store.isDraft() ? I18N.t('This draft') : I18N.t('THIS PROJECT'); },
          get empty() {
            return Store.isDraft() ? I18N.t('Nothing made in this draft yet.')
              : I18N.t('Nothing here yet - what this chat makes in the project lies here, with the links of THIS PROJECT.');
          },
        },
        tile: _tile, lead: _plusTile,
        // "this project" opened: its own results are read now, not at the next tick.
        onChange: (sel) => { if (sel.own) _reload(); },
      });
      _col.setOwn(_feed);
    }
    if (stripBox) KG.lock(stripBox, 'attach');
    if (sash) _wireStripSash(sash, stripBox);

    for (const input of Object.values(files)) {
      input.addEventListener('change', () => { const f = [...(input.files || [])]; input.value = ''; _upload(f); });
    }
    nBtn.addEventListener('click', () => {
      const i = S.counts.indexOf(_n);
      _n = S.counts[(i + 1) % S.counts.length];
      _paintN();
      set.onCount();
    });
    if (pen) {
      pen.addEventListener('click', () => _setWriting(!_writeOn()));
      _paintPen();
      KG.onChange(() => { if (_ui && _ui.pen === pen) { _paintPen(); if (typeof set.onPen === 'function') set.onPen(_writeOn()); } });
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
    // So is a picture's link dragged from a browser - downloaded into IMAGES itself (_linkPicture); a
    // drag of this app's own (a tile, a clip - `application/x-…`) is not one.
    const _linkDrag = (dt) => {
      const t = [...((dt && dt.types) || [])];
      return !!_U('image') && t.includes('text/uri-list') && !t.some(x => /^application\/x-/i.test(x));
    };
    root.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer || (![...ev.dataTransfer.types].includes('Files') && !_linkDrag(ev.dataTransfer))) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    root.addEventListener('drop', (ev) => {
      if (!ev.dataTransfer) return;
      if (!ev.dataTransfer.files || !ev.dataTransfer.files.length) {
        if (!_linkDrag(ev.dataTransfer)) return;
        ev.preventDefault();
        ev.stopPropagation();
        const url = Pick.dropLink(ev.dataTransfer);
        if (url) _linkPicture(url, null);
        else _say(I18N.t('Only a picture\'s own link comes in this way.'));
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      _upload(ev.dataTransfer.files);
    });
    // The panel is its own size: the sashes of the page move it, not the window.
    if (window.ResizeObserver) {
      let raf = 0;
      new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(_fit); }).observe(root);
    }

    const d = stored(S.keys.draft, {})[_lk(_key)] || {};
    ta.value = String(d.text || '');
    _grow();
    set.paint();
    _paintAtts();
    if (typeof set.draftLoad === 'function') set.draftLoad(d.extra || null);
  }

  function init() {
    // Back from another tab or window: the countdowns catch up at once rather than at the next tick.
    document.addEventListener('visibilitychange', () => { if (!document.hidden && _chat) _reload(); });
    window.addEventListener('beforeunload', () => { if (_key !== null) _saveDraft(_key); });
    Store.onChange(_onStore);
    _paintHead();
  }

  // `close` - its window hides it; `fit` - its place changed size.
  return { open, init, isOpen: () => _chat, close: () => { if (_chat) _show(false); }, fit: () => _fit(), ctx };
}
