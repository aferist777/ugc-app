/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the FRAMES CHAT of a talking head (phase V26.5, the owner 2026-10-10; docs/local-app/PLAN.md "V26.5").

   A first frame asked for in words. The "+" at the head of the frames shelf opens it over Setup, in place of the
   fields - the script stays on the right and folds away with its strip (js/merge-v3/wk-fragments.js). It is the
   pictures chat's conversation (chat-shell.js) with the pictures chat's model column (pic-models.js), and what is its
   own is here:
     - no right column: the row above the box is a ZONE of named places - `character` and `place` (the project's look
       and environment, put there when the chat opens), `frame` (a frame to edit: "to reference" under a result, or the
       picker), up to three `prop`s and `other` - and every empty place opens the picker, as in the video chat;
     - no shape to choose: a frame is drawn in the project's shape, or it would go to the clip with bars (phase V);
       `shot` - none / selfie / half body / full body - is where the frame's EDGE is, the pose is the words';
     - the writer stops for a look (as in the video chat, V16) when it is on, and with it off a light agent puts the
       words into English and names the pictures (the owner's answer (g));
     - a frame that lands is the project's, in its frames folder - `to frames` puts it into the set, `to reference`
       into the `frame` place, a press shows it on the stage;
     - no hover popups (the owner): a picture is opened by a press;
     - the almanac at the foot of the column - not yet, dimmed.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { createChat, el, thumbOf, json, money, refCell, almanacSoon } from './chat-shell.js';
import { note } from './ask.js';
import { startInlineProgress } from '../progress.js';
import { modelColumn } from './pic-models.js';
import * as Src from './chat-sources.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';

const MAX_ATTS = 6;
const LS_LAST = 'mv3-fc-last';           // the model choice of this chat
// THE ZONE IS TWO FIELDS (the owner, 2026-10-10, after the first look): the BASE - the person and the place, or the frame
// being changed once one is put there with "to reference" - and the EXTRA pictures, up to four, whatever the person
// wants in the frame, said in words what each is. The numbers count across both: the base first.
const BASE_CAST = [
  { key: 'character', label: 'character', max: 1, min: 0, hint: 'The person - their look\'s sheet. The frame takes only the person from it, never the sheet itself.' },
  { key: 'place', label: 'place', max: 1, min: 0, hint: 'The place - the environment the person is in' },
];
const BASE_FRAME = [
  { key: 'frame', label: 'frame', max: 1, min: 0, hint: 'The frame being changed - its cross puts the person and the place back' },
];
const EXTRA = { key: 'extra', label: 'extra', max: 4, min: 0, hint: 'Anything else for the frame - a product, an object, a pose to copy; say in the message what it is' };
// The shot sizes of the set (routes/scen3.js FRAME_SETS) - here only as where the frame's edge is.
const SHOTS = [['', 'none'], ['selfie', 'selfie'], ['half', 'half body'], ['full', 'full body']];

let _proj = null;              // the talking head's project record, handed in by every paint
let _hooks = {};               // { close, stage(path, name) } from the panel
let _shot = '';                // where the frame's edge is - '' none
let _shotSel = null;
let _auto = {};                // { character, place } - what was put into those places from the casting
let _base = 'cast';            // what the base field holds: 'cast' - the person and the place; 'frame' - a frame to change
let _armedIdea = null;         // { id, i } - the idea put into the box, marked used when a message goes from it

// The project's format - the set is drawn in it (routes/scen3.js mix.settings.format).
const _format = () => String((((_proj || {}).mix || {}).settings || {}).format || ((Store.timeline() || {}).format) || '9:16');
const _cast = () => ((_proj || {}).casting) || {};
// Where Alerts brings the person back: the project, its setup, this chat.
const WHERE = (key) => ({
  page: 'merge', href: '/merge?p=' + encodeURIComponent(key) + '&step=setup&view=fchat',
  label: 'Merge · ' + (Store.title() || 'project') + ' · frames chat',
  spot: { key, view: 'fchat' },
});

function FRAMES(ctx) {
  const M = modelColumn(ctx, {
    lsKey: LS_LAST, maxAtts: MAX_ATTS, shapes: false, idPrefix: 'mv3-fc',
    // The set's own model and size (routes/scen3.js FRAG_FRAME_ENGINE), until another is chosen here.
    defEngine: 'nano-banana-2',
    aspect: () => (_format() === '16:9' ? '16:9' : '9:16'),
    extra: (host) => {
      // WHERE THE EDGE IS (the owner, 2026-10-10: a dropdown, words only, `none` first and by default).
      const r = el('div', 'mv3-ig-row');
      const l = el('label', null, 'shot');
      const s = document.createElement('select');
      s.id = 'mv3-fc-shot';
      l.htmlFor = s.id;
      s.title = 'Where the frame\'s edge is. none - your words decide how much of the person is in it; the pose is always your words.';
      for (const [v, t] of SHOTS) {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        s.appendChild(o);
      }
      s.value = _shot;
      s.addEventListener('change', () => { _shot = s.value; ctx.saveDraft(); });
      r.append(l, s);
      host.appendChild(r);
      _shotSel = s;
      // The writer, a switch of the column (as in the video chat, V15/V16).
      const wr = el('label', 'mv3-vc-check');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = ctx.writing();
      cb.addEventListener('change', () => ctx.setWriting(cb.checked));
      wr.append(cb, el('span', null, 'writer'));
      wr.title = 'On: the writer writes the frame\'s prompt from your words and the pictures, and stops - you look at it, edit it, and `draw` spends. '
        + 'Off: one press - your words are put into English and the pictures named for the model, and the frame is drawn.';
      const sw = el('div', 'mv3-vc-switches');
      sw.appendChild(wr);
      host.appendChild(sw);
    },
  });

  // ── The zone ──────────────────────────────────────────────────────────────
  function zone() {
    const room = Math.min(MAX_ATTS, M.room());
    const base = _base === 'frame' ? BASE_FRAME : BASE_CAST;
    const extra = Object.assign({}, EXTRA, { max: Math.max(0, Math.min(EXTRA.max, room - base.length)) });
    return { parts: [{
      kind: 'image', word: 'pictures', one: 'picture', room,
      // The two fields; the shell still knows every slot of the part, in the order the numbers count.
      slots: base.concat(extra.max ? [extra] : []),
      groups: [
        { word: _base === 'frame' ? 'frame to change' : 'person & place', slots: base, cls: 'is-base' },
        ...(extra.max ? [{ word: 'extra', slots: [extra], labels: false, cls: 'is-extra', note: 'say what each is', noteLong: 'Whatever else goes into the frame - say in your message what each picture is and what to take from it' }] : []),
      ],
      none: 'This model takes no pictures.',
      full: 'This model takes ' + room + ' pictures.',
    }] };
  }

  // ── Where pictures come from (the picker) ─────────────────────────────────
  // This project's frames: the set, then what this chat drew and is not in the set.
  async function _frames() {
    const vs = (((_proj || {}).mix || {}).variants) || [];
    const ar = _format() === '16:9' ? '16:9' : '9:16';
    const set = vs.filter(v => v && v.path).map(v => Src.pic(v.path, 'frame' + (v.n ? ' ' + v.n : ''),
      v.made === 'chat' ? 'in the set · from the chat' : 'in the set' + (v.framing ? ' · ' + v.framing : ''),
      { aspect: ar, thumb: thumbOf(v.preview || v.path, 'strip') }));
    const k = ctx.key();
    const d = k ? await json('/api/scen3/fchat/feed?project=' + encodeURIComponent(k)) : null;
    const inSet = new Set(set.map(x => x.path));
    const made = ((d && d.success && d.items) || []).filter(g => !inSet.has(g.imagePath))
      .map(g => Src.pic(g.imagePath, String(g.prompt || '').slice(0, 60), 'from the chat', { aspect: g.aspect || ar }));
    return { items: set.concat(made) };
  }
  const SOURCES = [
    { id: 'frames', label: 'this project\'s frames', load: _frames, empty: 'No frames in this project yet.' },
    { id: 'people', label: 'characters & looks', load: Src.people },
    { id: 'environments', label: 'environments', load: () => Src.flat('environments', '3:2') },
    { id: 'images', label: 'Images', load: Src.images },
  ];
  const START = { character: 'people', place: 'environments', frame: 'frames', extra: 'images' };

  // ── A message of this chat (the owner, 2026-10-10, after the first look) ──
  // ONE MESSAGE PER SEND, all of one kind (the owner's answer (g)): what was asked at its head - the words and the pictures,
  // by number and field -, then two columns: on the left the PROMPT - with the writer, the field to edit and its variants,
  // `draw`, `write it again`; without it, what went to the model - and on the right THE FRAME: a box of the project's shape
  // where the picture lands - empty, then counting down, then the frame -, its arrows through every frame of this message,
  // the prompt variant it was drawn from, `to frames` / `in frames` and `to reference`. A press on the frame puts it on the
  // stage, a right-click opens it large.
  const _live = new Map();       // card id -> { m, left, right, progs, ta, ver, go, price, save, patchKey }
  const _cardN = new Map();      // card id -> how many to draw
  const _patchT = new Map();     // a prompt being typed: its save, a moment later
  const _verAt = new Map();      // card id -> the variant of the prompt shown
  const _shotAt = new Map();     // message id -> { i, n } the frame shown, and how many there were
  const COUNTS_D = [1, 2, 4];
  const _post = (url, body, method) => json(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const _cardUrl = (m, tail) => '/api/scen3/fchat/card/' + encodeURIComponent(m.id) + (tail || '');
  const ROLE_WORD = { character: 'character', place: 'place', frame: 'frame', extra: 'extra' };

  // What was asked: the words, and the pictures by number with the field each was in.
  function _askedHead(words, media) {
    const h = el('div', 'mv3-fc-asked');
    if (words) h.appendChild(el('div', 'mv3-fc-asked-t', words));
    const list = (media || []).filter(a => a && a.path);
    if (list.length) {
      const row = el('div', 'mv3-ig-msg-refs');
      list.forEach((a, i) => {
        const w = el('div', 'vc-ref');
        w.appendChild(refCell(a, 'image', i + 1, null));
        const word = ROLE_WORD[a.role] || '';
        if (word) w.appendChild(el('span', 'lab', word));
        row.appendChild(w);
      });
      h.appendChild(row);
    }
    return h;
  }

  // THE FRAME BOX: every frame of the message, one at a time, with its arrows; `verOf(g)` - the prompt variant it was
  // drawn from ('' - none to say). Countdowns go into `progs`.
  function _shotBox(host, m, gens, progs, verOf) {
    host.textContent = '';
    const ar = String(_format()).replace(':', '/');
    if (!gens.length) {
      const empty = el('div', 'mv3-fc-shotbox is-empty');
      empty.style.aspectRatio = ar;
      empty.appendChild(el('span', null, 'the frame lands here'));
      host.appendChild(empty);
      return;
    }
    // A new frame of the message is where the eye goes; otherwise the one the person paged to.
    const was = _shotAt.get(m.id);
    let i = was ? was.i : gens.length - 1;
    if (!was || gens.length > was.n) i = gens.length - 1;
    i = Math.max(0, Math.min(gens.length - 1, i));
    _shotAt.set(m.id, { i, n: gens.length });
    const g = gens[i];
    const box = el('div', 'mv3-fc-shotbox is-' + g.state);
    box.style.aspectRatio = ar;
    if (g.state === 'done' && g.imagePath) {
      const img = document.createElement('img');
      img.src = thumbOf(g.imagePath, 'strip');
      img.alt = g.prompt || '';
      img.title = 'Press to see it on the stage · right-click to open it large';
      img.addEventListener('click', () => { if (_hooks.stage) _hooks.stage(g.imagePath, 'frame from the chat'); });
      img.addEventListener('contextmenu', (e) => { e.preventDefault(); _view(gens, i); });
      img.addEventListener('error', () => { img.replaceWith(el('span', 'mv3-ig-gone', 'not on the disk any more')); }, { once: true });
      box.appendChild(img);
    } else if (g.state === 'pending') {
      const strip = el('div', 'mv3-ig-prog');
      box.appendChild(strip);
      progs.set(g.id, startInlineProgress(strip, {
        label: ctx.stageWords(g), key: 'mv3-imagen-' + (g.engine || ''), estimateMs: 40000, startedAt: Date.parse(g.at) || 0,
        onCancel: g.alertId ? async () => { await json('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', { method: 'POST' }); ctx.reload(); } : null,
      }));
    } else {
      box.appendChild(el('div', 'mv3-ig-bad', g.error || 'nothing came back'));
    }
    host.appendChild(box);
    if (gens.length > 1) {
      const nav = el('div', 'vc-vars mv3-fc-shotnav');
      const prev = el('button', 'vc-nav is-prev', '‹');
      const next = el('button', 'vc-nav is-next', '›');
      prev.type = 'button'; next.type = 'button';
      prev.disabled = i === 0;
      next.disabled = i === gens.length - 1;
      prev.title = 'The previous frame of this message';
      next.title = 'The next frame of this message';
      const go = (d) => { _shotAt.set(m.id, { i: i + d, n: gens.length }); _shotBox(host, m, gens, progs, verOf); };
      prev.addEventListener('click', () => go(-1));
      next.addEventListener('click', () => go(1));
      nav.append(prev, el('span', 'vc-vars-t', 'frame ' + (i + 1) + ' of ' + gens.length), next);
      host.appendChild(nav);
    }
    const from = verOf ? verOf(g) : '';
    if (from) host.appendChild(el('div', 'mv3-fc-from', from));
    if (g.state === 'done' && g.imagePath) host.appendChild(_shotActs(g));
  }

  // "to frames" - into the set the lines take their frames from; "to reference" - into the base, to change it next.
  function _shotActs(g) {
    const acts = el('div', 'mv3-ig-acts mv3-fc-acts');
    const inSet = () => ((((_proj || {}).mix || {}).variants) || []).some(v => v && v.path === g.imagePath);
    const add = el('button', 'mv3-c-btn', inSet() ? 'in frames' : 'to frames');
    add.type = 'button';
    add.disabled = inSet();
    add.title = inSet() ? 'This frame is in the set' : 'Put it into the set of first frames - the fragments take their frames from it by the rule';
    add.addEventListener('click', async () => {
      add.disabled = true;
      const d = await _post('/api/scen3/fchat/to-set', { genId: g.id });
      if (!d || !d.success) { add.disabled = false; note(add, 'Not added.', (d && d.error) || 'the server did not answer'); return; }
      add.textContent = 'in frames';
      if (_hooks.added) _hooks.added(d.project);
    });
    const use = el('button', 'mv3-c-btn', 'to reference');
    use.type = 'button';
    use.title = 'Change this frame with the next message: it takes the place of the person and the place above the box; the extra pictures stay';
    use.addEventListener('click', () => toReference(g.imagePath, (g.said || g.prompt || '').slice(0, 60)));
    acts.append(add, use);
    return acts;
  }

  // Every frame of the thread, large - from the 2048px tier.
  function _view(gens, at) {
    const done = gens.filter(x => x && x.state === 'done' && x.imagePath);
    const g = gens[at];
    import('../library/viewer.js').then(V => V.openViewer(
      done.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: x.prompt || '', meta: { date: x.at } })),
      Math.max(0, done.indexOf(g)), { showSrc: (it) => thumbOf(it.media, 'main') }));
  }

  // ── Without the writer: what went to the model on the left, the frame on the right ──
  function _plainBubble(m, progs, asked) {
    const gens = m.gens || [];
    const box = el('div', 'mv3-ig-msg is-agent mv3-fc-msg');
    box.appendChild(_askedHead(m.asked || (asked && asked.text) || (m.loose && gens[0] ? gens[0].said : ''),
      (m.media && m.media.length) ? m.media : ((asked && asked.media) || [])));
    const cols = el('div', 'mv3-fc-cols');
    const left = el('div', 'mv3-fc-left');
    const right = el('div', 'mv3-fc-right');
    cols.append(left, right);
    box.appendChild(cols);
    const g = gens[gens.length - 1];
    left.appendChild(el('div', 'mv3-fc-k', 'sent without the writer'));
    if (g && g.state === 'pending' && !g.taskId) left.appendChild(el('div', 'mv3-fc-note', ctx.stageWords(g)));
    if (g && g.prompt && g.prompt !== g.said) {
      const more = el('details', 'mv3-fc-sent');
      more.appendChild(el('summary', null, 'sent as'));
      more.appendChild(el('div', 'mv3-fc-sent-t', g.prompt));
      left.appendChild(more);
    }
    if (g && (g.fell || g.writer)) left.appendChild(el('div', 'mv3-fc-note', g.fell || ('put into English by ' + g.writer)));
    _shotBox(right, m, gens, progs, null);
    return box;
  }

  // ── With the writer: the prompt to edit on the left, the frame on the right ──
  const _versOf = (c) => (c.versions || []);
  function _cardBubble(m, progs, asked) {
    const c = m.card;
    const was = _live.get(m.id);
    if (was) { for (const p of was.progs.values()) p.detach(); }
    _live.delete(m.id);
    const box = el('div', 'mv3-ig-msg is-agent mv3-fc-msg is-card is-' + c.state);
    box.appendChild(_askedHead(c.text || (asked && asked.text) || '', (m.media && m.media.length) ? m.media : ((asked && asked.media) || [])));
    if (!_versOf(c).length) {
      if (c.state === 'writing') {
        const strip = el('div', 'mv3-ig-prog');
        box.appendChild(strip);
        progs.set('w:' + m.id, startInlineProgress(strip, {
          label: 'writing the prompt…', key: 'mv3-fchat-writer', estimateMs: 20000, startedAt: Date.parse(c.startedAt || m.at) || 0,
        }));
        return box;
      }
      box.appendChild(el('div', 'mv3-ig-bad', c.error || 'it was not written'));
      const acts = el('div', 'vc-card-acts');
      const again = el('button', 'mv3-c-btn vc-go', 'write it again');
      again.type = 'button';
      again.addEventListener('click', () => _rewrite(m, again));
      acts.appendChild(again);
      box.appendChild(acts);
      return box;
    }
    const cols = el('div', 'mv3-fc-cols');
    const left = el('div', 'mv3-fc-left');
    const right = el('div', 'mv3-fc-right');
    cols.append(left, right);
    box.appendChild(cols);
    const l = { m, left, right, progs: new Map(), ta: null, ver: '', go: null, price: null, gsig: '' };
    _live.set(m.id, l);
    _paintLeft(l);
    _paintRight(l);
    return box;
  }

  // The prompt: the variant shown - the one the person paged to, else the chosen one -, its field and its arrows; the
  // press and the price under it.
  function _paintLeft(l) {
    const m = l.m, c = m.card;
    const vs = _versOf(c);
    let vi = vs.findIndex(v => v.id === _verAt.get(m.id));
    if (vi < 0) vi = vs.findIndex(v => v.id === c.cur);
    if (vi < 0) vi = vs.length - 1;
    const v = vs[vi];
    l.left.textContent = '';
    l.ta = null; l.ver = v.id;
    const head = el('div', 'mv3-fc-k', 'prompt' + (c.model ? ' · written for ' + c.model : ''));
    l.left.appendChild(head);
    if (c.error) l.left.appendChild(el('div', 'mv3-ig-bad', 'The last writing did not work: ' + c.error));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta';
    ta.spellcheck = true;
    ta.value = v.prompt || '';
    ta.title = 'The prompt the model gets - edit it before the frame is drawn. image 1, image 2 are the pictures above, by their numbers.';
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(420, ta.scrollHeight + 2) + 'px'; };
    requestAnimationFrame(grow);
    const key = 'p:' + m.id + ':' + v.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      return _post(_cardUrl(m), { project: m.project, ver: v.id, prompt: ta.value }, 'PATCH');
    };
    ta.addEventListener('input', () => { grow(); clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    ta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    l.left.appendChild(ta);
    Object.assign(l, { ta, save, patchKey: key });
    if (c.state === 'writing') {
      const strip = el('div', 'mv3-ig-prog');
      l.left.appendChild(strip);
      for (const p of l.progs.values()) p.detach();
      l.progs.clear();
      l.progs.set('w', startInlineProgress(strip, {
        label: 'writing another variant…', key: 'mv3-fchat-writer', estimateMs: 20000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      }));
    }
    if (vs.length > 1) {
      const nav = el('div', 'vc-vars');
      const prev = el('button', 'vc-nav is-prev', '‹');
      const next = el('button', 'vc-nav is-next', '›');
      prev.type = 'button'; next.type = 'button';
      prev.disabled = vi === 0;
      next.disabled = vi === vs.length - 1;
      prev.title = 'The previous variant of the prompt';
      next.title = 'The next variant of the prompt';
      const go = (d) => {
        if (_patchT.has(key)) save();
        const t = vs[vi + d];
        if (!t) return;
        _verAt.set(m.id, t.id);
        if (t.id !== c.cur) _post(_cardUrl(m), { project: m.project, cur: t.id }, 'PATCH');
        _paintLeft(l);
      };
      prev.addEventListener('click', () => go(-1));
      next.addEventListener('click', () => go(1));
      nav.append(prev, el('span', 'vc-vars-t', 'variant ' + (vi + 1) + ' of ' + vs.length + ' · "draw" sends this one'), next);
      l.left.appendChild(nav);
    }
    const acts = el('div', 'vc-card-acts');
    const nBtn = el('button', 'vc-n', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = 'How many frames to draw from it - each lands in the box on the right';
    nBtn.addEventListener('click', () => {
      const i = COUNTS_D.indexOf(_cardN.get(m.id) || 1);
      _cardN.set(m.id, COUNTS_D[(i + 1) % COUNTS_D.length]);
      nBtn.textContent = '×' + _cardN.get(m.id);
      _freshen(l);
    });
    const go = el('button', 'mv3-c-btn vc-go is-make', 'draw');
    go.type = 'button';
    go.addEventListener('click', () => _draw(l, go));
    const price = el('span', 'vc-card-why');
    const again = el('button', 'vc-link', 'write it again');
    again.type = 'button';
    again.title = 'Another variant of the prompt from the same words and pictures - this one stays';
    again.addEventListener('click', () => _rewrite(m, again));
    acts.append(nBtn, go, price, again);
    l.left.appendChild(acts);
    Object.assign(l, { go, price });
    _freshen(l);
  }

  // The frame box of a card: the prompt variant each frame was drawn from, when there is more than one.
  function _paintRight(l) {
    const m = l.m, c = m.card;
    const gens = m.gens || [];
    l.gsig = gens.map(g => g.id + ':' + g.state + ':' + (g.imagePath || '') + ':' + (g.error || '')).join(',');
    for (const [k, p] of l.progs) { if (k !== 'w') { p.detach(); l.progs.delete(k); } }
    const vs = _versOf(c);
    const verOf = (g) => {
      if (vs.length < 2) return '';
      const send = (c.sends || []).find(s => (s.genIds || []).includes(g.id));
      const k = send ? vs.findIndex(v => v.id === send.ver) : -1;
      return k >= 0 ? 'from prompt variant ' + (k + 1) : '';
    };
    _shotBox(l.right, m, gens, l.progs, verOf);
  }

  // The press and the price follow the column: the model it draws with is the one chosen there now.
  function _freshen(l) {
    if (!l.go) return;
    const c = l.m.card;
    const n = _cardN.get(l.m.id) || 1;
    const made = (c.sends || []).length > 0 || (l.m.genIds || []).length > 0;
    l.go.textContent = (made ? 'draw again' : 'draw') + (n > 1 ? ' ×' + n : '');
    l.go.disabled = c.state === 'writing';
    const p = M.price();
    l.price.textContent = p ? (p.approx ? '≈' : '') + money(p.usd * n) + ' · ' + p.model + ' · ' + p.agg : '';
  }

  async function _draw(l, btn) {
    const m = l.m;
    const k = ctx.key();
    if (!k) return;
    const why = M.ready();
    if (why) { note(btn, why[0], why[1]); return; }
    btn.disabled = true;
    // What is being typed goes first: the frame is drawn from the prompt as it stands.
    if (l.patchKey && _patchT.has(l.patchKey) && l.save) await l.save();
    const col = M.body();
    const d = await _post(_cardUrl(m, '/draw'), {
      project: m.project, ver: l.ver, prompt: l.ta ? l.ta.value : undefined,
      engine: col.engine, provider: col.provider, quality: col.quality, n: _cardN.get(m.id) || 1,
      where: WHERE(k),
    });
    btn.disabled = false;
    if (!d || !d.success) { note(btn, 'Not drawn.', (d && d.error) || 'the server did not answer'); return; }
    ctx.reload();
  }

  async function _rewrite(m, btn) {
    btn.disabled = true;
    const d = await _post(_cardUrl(m, '/rewrite'), { project: m.project, engine: (M.engine() || {}).id || '' });
    btn.disabled = false;
    if (!d || !d.success) { note(btn, 'Not written.', (d && d.error) || 'the server did not answer'); return; }
    _verAt.delete(m.id);
    ctx.reload();
  }

  // ── `ideas` (the owner, 2026-10-10): right of the places above the box ──
  // The agent looks at the person's sheet, the place and the props in the zone and answers five frames in words, as a
  // message of the thread; a press on one puts it into the box. In English (the owner's answer (e)).
  let _ideasBtn = null;
  function _ideasSide() {
    const b = el('button', 'mv3-fc-ideas', 'ideas');
    b.type = 'button';
    b.title = 'The agent looks at the pictures above the box - the person, the place, the extra ones - and offers six frames in words; press one to put it into the box. Ask again after adding pictures. Fractions of a cent.';
    b.addEventListener('click', () => _askIdeas(b));
    return [b];
  }
  async function _askIdeas(b) {
    const k = ctx.key();
    if (!k || b.disabled) return;
    const atts = ctx.atts();
    if (!atts.some(a => a.slot === 'character' || a.slot === 'place' || a.slot === 'frame')) { note(b, 'Nothing to look at.', 'Put the person or the place above the box first.'); return; }
    b.disabled = true;
    b.textContent = 'thinking…';
    const d = await _post('/api/scen3/fchat/ideas', {
      project: k, projectId: (_proj && _proj.id) || '', refs: atts.map(a => a.path), roles: atts.map(a => a.slot || ''), shot: _shot,
    });
    b.disabled = false;
    b.textContent = 'ideas';
    if (!d || !d.success) { note(b, 'No ideas.', (d && d.error) || 'the server did not answer'); return; }
    ctx.reload(true);
  }
  // Six, in two columns (the owner); one a message went from wears gold and "used".
  function _ideasBubble(m) {
    const box = el('div', 'mv3-ig-msg is-agent mv3-fc-ideasmsg');
    box.appendChild(el('div', 'mv3-ig-text', m.text || 'Ideas for a frame'));
    const used = new Set((m.used || []).map(Number));
    const list = el('div', 'mv3-fc-ideaslist');
    m.ideas.forEach((idea, i) => {
      const it = el('button', 'mv3-fc-idea' + (used.has(i) ? ' is-used' : ''));
      it.type = 'button';
      it.appendChild(el('span', 't', idea));
      if (used.has(i)) it.appendChild(el('span', 'u', 'used'));
      it.title = (used.has(i) ? 'A frame was asked for from this one. ' : '') + 'Put it into the message box - change it as you like, then send';
      it.addEventListener('click', () => {
        ctx.setText(idea);
        _armedIdea = { id: m.id, i };
        const ui = ctx.ui();
        if (ui) ui.ta.focus();
      });
      list.appendChild(it);
    });
    box.appendChild(list);
    return box;
  }

  // The sig of a card for the shell: what it IS - never the text being typed into it.
  // Its frames are not: they change in place (onThread), so a frame landing never rebuilds the prompt being typed.
  const _cardSig = (m) => {
    const c = m.card || {};
    return [c.state, (c.versions || []).map(v => v.id + ':' + v.model).join(','), c.error || ''].join('|');
  };

  return {
    name: 'frames',
    kind: 'fchat',
    host: true,
    noPeek: true,
    ids: { root: 'mv3-fc' },
    keys: { draft: 'mv3_fc_draft_v1', write: 'mv3_fc_write_v1' },
    maxAtts: MAX_ATTS,
    counts: [1, 2, 4],
    noun: { one: 'picture', many: 'pictures' },
    busyWord: 'drawing',
    eta: 40000,
    progressKey: (g) => 'mv3-imagen-' + (g.engine || ''),
    sendUrl: '/api/scen3/fchat/send',
    // A frame that lands goes into the `frame` place only when asked ("to reference").
    landAsRef: false,
    text: {
      title: 'frames chat',
      placeholder: 'Describe the frame - where the person is, the pose, the hands, where they look.',
      empty: 'Describe a frame of this video in words. The person and the place are attached already; what comes back is this project\'s, and "to frames" puts it into the set.',
      emptyNoProject: 'Open a talking head first.',
      onlyFiles: 'Only pictures can be attached here.',
      slot: 'A picture - from the Library or this computer',
    },
    upload: { url: '/api/mv3/img/upload', field: 'image', accept: PICTURE_ACCEPT, ok: isPictureFile },
    pick: {
      sources: () => SOURCES,
      start: (kind, s) => (s && START[s.key]) || '',
      first: { image: 'frames' },
      why: () => '',
      sourceOf: (path) => (String(path || '').startsWith('/projects/') ? ['frames'] : Src.pictureSourceOf(path)),
      lands: { image: 'images' },
      upWords: { image: 'A picture goes into Images, in this project\'s category.' },
    },
    penInBar: false,
    columnFoot: () => [almanacSoon()],
    resultPath: (g) => g.imagePath,
    // Alerts brings the person back here: the project, its setup, this chat.
    where: WHERE,
    // The writer's message is the description's to draw; the shell keeps the thread reading while one is being written.
    cardBubble: _cardBubble,
    cardSig: _cardSig,
    // ONE MESSAGE PER SEND (the owner's answer (g)): the person's turn is not drawn apart - what was asked heads its answer.
    hidden: (m) => m.role === 'user',
    bubble: (m, progs, asked) => (Array.isArray(m.ideas) && m.ideas.length ? _ideasBubble(m)
      : (m.role !== 'user' && (m.gens || []).length ? _plainBubble(m, progs, asked) : null)),
    msgSig: (m) => (Array.isArray(m.ideas) ? (m.used || []).join(',') : ''),
    attsSide: _ideasSide,
    // The idea a message went from is used now; the box is its own again.
    afterSend: () => { _armedIdea = null; },
    // The frame being changed taken out of the base: the person and the place come back (the owner's answer (v)).
    onDetach: (a) => {
      if (!a || a.slot !== 'frame') return false;
      _base = 'cast';
      const keep = ctx.zoneAtts().filter(x => x.slot === 'extra' && !x.hole);
      const c = _cast();
      const back = [];
      if (c.obrazImage) back.push({ path: c.obrazImage, name: c.characterName || 'the character', slot: 'character' });
      if (c.locationImage) back.push({ path: c.locationImage, name: 'the place', slot: 'place' });
      _auto = { character: c.obrazImage || '', place: c.locationImage || '' };
      ctx.useAtts(back.concat(keep));
      ctx.saveDraft();
      return true;
    },
    busy: (thread) => thread.some(m => m.card && m.card.state === 'writing'),
    // A card's frames and its price follow the thread in place.
    onThread: (thread) => {
      for (const m of thread) {
        const l = _live.get(m.id);
        if (!l || !m.card) continue;
        l.m = m;
        const gsig = (m.gens || []).map(g => g.id + ':' + g.state + ':' + (g.imagePath || '') + ':' + (g.error || '')).join(',');
        if (gsig !== l.gsig) _paintRight(l);
        else for (const g of m.gens || []) { const p = l.progs.get(g.id); if (p) p.say(ctx.stageWords(g)); }
        _freshen(l);
      }
    },

    settings: {
      load: M.load,
      paint: M.paint,
      onAtts: M.onAtts,
      onCount: M.onCount,
      onProject: M.onProject,
      room: M.room,
      ready: M.ready,
      zone,
      // What goes with a send besides the words and the pictures: the column, the edge, and what each picture is.
      body: () => Object.assign(M.body(), {
        shot: _shot,
        roles: ctx.atts().map(a => a.slot || 'extra'),
        projectId: (_proj && _proj.id) || '',
        // The idea the words came from - marked used by the server with the send (the owner's answer (d)).
        idea: _armedIdea,
      }),
      draftExtra: () => ((_shot || _auto.character || _auto.place || _base !== 'cast') ? { shot: _shot, auto: _auto, base: _base } : null),
      draftLoad: (x) => {
        _shot = SHOTS.some(s => s[0] === (x && x.shot)) ? x.shot : '';
        _auto = (x && x.auto && typeof x.auto === 'object') ? { character: String(x.auto.character || ''), place: String(x.auto.place || '') } : {};
        _base = x && x.base === 'frame' ? 'frame' : 'cast';
        _armedIdea = null;
        if (_shotSel) _shotSel.value = _shot;
      },
    },

    // A finished frame in the thread: a press shows it on the stage, a right-click opens it large.
    shot(g, cell, open) {
      const img = document.createElement('img');
      img.className = 'mv3-ig-shot';
      img.src = thumbOf(g.imagePath, 'strip');
      img.alt = g.prompt || '';
      img.loading = 'lazy'; img.decoding = 'async';
      img.style.aspectRatio = String(g.aspect || _format()).replace(':', '/');
      img.title = 'Press to see it on the stage · right-click to open it large';
      img.addEventListener('click', () => { if (_hooks.stage) _hooks.stage(g.imagePath, 'frame from the chat'); else open(); });
      img.addEventListener('contextmenu', (e) => { e.preventDefault(); open(); });
      cell.appendChild(img);
      // "to frames" - into the set, where the lines take frames from; "to reference" - into the `frame` place, for the
      // next change.
      const acts = el('div', 'mv3-ig-acts');
      const inSet = () => ((((_proj || {}).mix || {}).variants) || []).some(v => v && v.path === g.imagePath);
      const add = el('button', 'mv3-c-btn', inSet() ? 'in frames' : 'to frames');
      add.type = 'button';
      add.disabled = inSet();
      add.title = inSet() ? 'This frame is in the set' : 'Put it into the set of first frames - the fragments take their frames from it by the rule';
      add.addEventListener('click', async () => {
        add.disabled = true;
        const d = await json('/api/scen3/fchat/to-set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genId: g.id }) });
        if (!d || !d.success) { add.disabled = false; note(add, 'Not added.', (d && d.error) || 'the server did not answer'); return; }
        add.textContent = 'in frames';
        if (_hooks.added) _hooks.added(d.project);
      });
      const use = el('button', 'mv3-c-btn', 'to reference');
      use.type = 'button';
      use.title = 'Put it into the "frame" place above the message box, to change it with the next message';
      use.addEventListener('click', () => toReference(g.imagePath, (g.said || g.prompt || '').slice(0, 60)));
      acts.append(add, use);
      cell.appendChild(acts);
      img.addEventListener('error', () => {
        const gone = el('div', 'mv3-ig-gone', 'not on the disk any more');
        gone.style.aspectRatio = img.style.aspectRatio;
        img.replaceWith(gone);
        add.disabled = true; use.disabled = true;
      }, { once: true });
    },
    facts: (g) => [
      ['model', (g.engine || '') + ' · ' + (g.provider || '?') + ' · ' + (g.quality || '')],
      ['asked as', g.model || ''],
      ['shape', (g.aspect || '') + ((g.w && g.h) ? ' · ' + g.w + '×' + g.h : '')],
      ['took', g.secs ? g.secs + 's' : ''],
      ['references', (g.refs || []).length ? String(g.refs.length) : ''],
      ['writer', g.fell ? g.fell : (g.writer || '')],
      ['you said', g.said || ''],
      ['sent as', (g.prompt && g.prompt !== g.said) ? g.prompt : ''],
    ],
    view(done, at) {
      import('../library/viewer.js').then(V => V.openViewer(
        done.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: x.prompt || '', meta: { date: x.at } })),
        at, { showSrc: (it) => thumbOf(it.media, 'main') }));
    },
    // Its own head line: the cross back to the fields.
    headButtons() {
      const x = el('button', 'mv3-iconbtn mv3-fc-close', '✕');
      x.type = 'button';
      x.title = 'Close the frames chat - back to the fields. What is written stays.';
      x.addEventListener('click', (ev) => { ev.stopPropagation(); if (_hooks.close) _hooks.close(); });
      return [x];
    },
  };
}

const CHAT = createChat(FRAMES);

// ── Where it stands ──────────────────────────────────────────────────────────
// The chat lives in the Setup panel but outside its body, which every paint empties: it is laid OVER the place the
// fields column leaves for it (`slot`), measured after each paint and whenever that place changes size, and it goes
// the moment the place is no longer on the page - another face of the panel, another step, another project.
let _slot = null;
let _ro = null;
let _mo = null;
const $root = () => document.getElementById('mv3-fc');

function _fitNow() {
  const root = $root();
  const ins = document.getElementById('mv3-inspector');
  if (!root || !ins) return;
  if (!_slot || !_slot.isConnected) { hide(); return; }
  const a = ins.getBoundingClientRect();
  const b = _slot.getBoundingClientRect();
  root.style.left = Math.round(b.left - a.left) + 'px';
  root.style.top = Math.round(b.top - a.top) + 'px';
  root.style.width = Math.round(b.width) + 'px';
  root.style.height = Math.round(b.height) + 'px';
  CHAT.fit();
}

// The project's look and place go into their places when the chat opens - unless something is there, or the person
// took them out while it was open; and the one put there from the casting follows the casting when it changes.
function _autoCast(opening) {
  if (!_proj || !CHAT.isOpen()) return;
  // A row kept from before the two fields (places `prop`, `other`) - or a frame left in a base that holds the person and
  // the place - goes to the extra field.
  if (opening) {
    const keys = _base === 'frame' ? ['frame', 'extra'] : ['character', 'place', 'extra'];
    const real = CHAT.ctx.zoneAtts().filter(a => !a.hole);
    if (real.some(a => !keys.includes(a.slot))) {
      CHAT.ctx.useAtts(real.map(a => (keys.includes(a.slot) ? a : Object.assign({}, a, { slot: 'extra' }))));
    }
  }
  // While the base holds a frame being changed, the person and the place stay out (the owner's answer (b)).
  if (_base === 'frame') return;
  const c = _cast();
  const want = { character: c.obrazImage || '', place: c.locationImage || '' };
  const names = { character: c.characterName || 'the character', place: 'the place' };
  const zoneNow = () => CHAT.ctx.zoneAtts();
  let changed = false;
  for (const slot of ['character', 'place']) {
    const v = want[slot];
    const here = zoneNow().filter(a => a.slot === slot);
    const real = here.find(a => !a.hole);
    if (real) {
      if (v && _auto[slot] && real.path === _auto[slot] && real.path !== v) {
        CHAT.ctx.detach(real.path);
        CHAT.ctx.attach(v, names[slot], { slot });
        _auto[slot] = v;
        changed = true;
      }
      continue;
    }
    if (!v || !opening || here.some(a => a.hole)) continue;
    CHAT.ctx.attach(v, names[slot], { slot });
    _auto[slot] = v;
    changed = true;
  }
  if (changed) CHAT.ctx.saveDraft();
}

/**
 * Shown in `slot` - the place the fields column leaves for it - for the project `p`. `hooks`: { close, stage(path, name),
 * added(project) - a frame went into the set }.
 * Called by every paint of that face; the first one opens it.
 */
export function show(slot, p, hooks) {
  _proj = p || null;
  _hooks = hooks || {};
  _slot = slot;
  const root = $root();
  if (!root) return;
  if (!_ro && window.ResizeObserver) _ro = new ResizeObserver(() => _fitNow());
  if (_ro) { _ro.disconnect(); _ro.observe(slot); const ins = document.getElementById('mv3-inspector'); if (ins) _ro.observe(ins); }
  if (!_mo) {
    const body = document.querySelector('#mv3-inspector .mv3-panel-body');
    if (body && window.MutationObserver) {
      _mo = new MutationObserver(() => { if (_slot && !_slot.isConnected) hide(); });
      _mo.observe(body, { childList: true, subtree: true });
    }
  }
  const was = CHAT.isOpen();
  _fitNow();
  if (!was) CHAT.open().then(() => { _fitNow(); _autoCast(true); });
  else _autoCast(false);
}

/** Taken off the page: the chat hides, what is written stays. */
export function hide() {
  _slot = null;
  if (_ro) _ro.disconnect();
  CHAT.close();
}

export const isShown = () => CHAT.isOpen();

/**
 * "to reference" (the owner, 2026-10-10): the frame takes the base - the person and the place go from it - and the extra
 * field stays as it is (the owner's answer (b)). Its cross in the base puts the person and the place back (onDetach).
 */
export function toReference(path, name) {
  const z = CHAT.ctx.zoneAtts();
  const was = z.find(a => a.slot === 'frame' && !a.hole);
  if (was && was.path === path) return;
  const keep = z.filter(a => a.slot === 'extra' && !a.hole && a.path !== path);
  _base = 'frame';
  CHAT.ctx.useAtts([{ path, name: name || 'frame', slot: 'frame' }].concat(keep));
  CHAT.ctx.saveDraft();
}

export function initFramesChat() { CHAT.init(); }
