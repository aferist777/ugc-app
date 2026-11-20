/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the FRAMES CHAT of a talking head.

   A first frame asked for in words. It is a WINDOW over the page, as New Character's is - js/gen-window.js openFrame,
   1280×800 as every generation's window: its root (#mv3-fc) is MOVED into
   the window and back to its parking place in the Setup panel, so what is typed, picked and waited for stays - opened by
   "frames chat" in the frames field of setup (js/merge-v3/wk-fragments.js) and by its rows of Alerts. It is the pictures
   chat's conversation (chat-shell.js) with the pictures chat's model column (pic-models.js), and what is its own is here:
     - no right column: the row above the box is a ZONE of named places - `character` and `place` (the project's look
       and environment, put there when the chat opens), `frame` (a frame to edit: "to reference" under a result, or the
       picker), up to two `product`s of IMAGES -> Props and up to four `extra` - and every empty place opens the picker, as
       in the video chat;
     - no shape to choose: a frame is drawn in the project's shape, or it would go to the clip with bars;
       `shot` - none / selfie / half body / full body - is where the frame's EDGE is, the pose is the words';
     - the writer stops for a look (as in the video chat) when it is on, and with it off a light agent puts the
       words into English and names the pictures;
     - a frame that lands is the project's, in its frames folder - `to frames` puts it into the set with the edge it was
       asked with (`shot`), `to reference` into the `frame` place;
     - a press on a frame or on a message's picture does nothing: ⤢ in its top-right corner
       opens it large; the pointer resting on a thing in the zone shows it larger over the chat's field, as in the other chats;
     - the almanac at the foot of the column - not yet, dimmed.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { createChat, el, thumbOf, json, money, refCell, almanacSoon, switchRow, mediaBtn } from './chat-shell.js';
import { note } from '../ask.js';
import { closePick } from './chat-pick.js';
import { startInlineProgress } from '../progress.js';
import { modelColumn } from './pic-models.js';
import * as Src from './chat-sources.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';
import { openFrame, GEN_SIZE, GEOM_CHAT } from '../gen-window.js';
import { markText, markField } from './image-words.js';
// The app's words as T.t / T.tn: this module's own `t`s are a shot's label and a prompt variant. The words handed to the
// chat's shell (the zone's places, the nouns, the texts, the facts' names) are given already in the app's language.
import * as T from '../i18n/t.js';

const MAX_ATTS = 6;
const LS_LAST = 'mv3-fc-last';           // the model choice of this chat
// The words of the zone's places - their keys are what the code and the server compare.
const ROLE_WORD = {
  character: T.t('character'), place: T.tc('frames chat', 'place'), frame: T.t('frame'),
  extra: T.tc('frames chat', 'extra'), product: T.tc('frames chat', 'product'),
};
// THE ZONE IS TWO FIELDS: the BASE - the person and the place, or the frame
// being changed once one is put there with "to reference" - and the EXTRA pictures, up to four, whatever the person
// wants in the frame, said in words what each is. The numbers count across both: the base first.
const BASE_CAST = [
  { key: 'character', label: ROLE_WORD.character, max: 1, min: 0, hint: T.t('The person - their look\'s sheet. The frame takes only the person from it, never the sheet itself.') },
  { key: 'place', label: ROLE_WORD.place, max: 1, min: 0, hint: T.t('The place - the environment the person is in') },
];
const BASE_FRAME = [
  { key: 'frame', label: ROLE_WORD.frame, max: 1, min: 0, hint: T.t('The frame being changed - its cross puts the person and the place back') },
];
const EXTRA = { key: 'extra', label: ROLE_WORD.extra, max: 4, min: 0, hint: T.t('Anything else for the frame - an object, a pose to copy, a look; say in the message what it is') };
// THE PRODUCT - up to two products of IMAGES -> Props, between the base and
// the extra pictures; each goes with its name and description, drawn exactly as on its picture. It stays from message to
// message until taken off (the zone is never emptied by a send). The pictures stay at most 6: the extra ones take the rest.
const PRODUCT = { key: 'product', label: ROLE_WORD.product, max: 2, min: 0, hint: T.t('A product of IMAGES → Props - drawn exactly as on its picture; its description goes with it') };
const PROPS_AT = '/media/props/';
const _isProp = (path) => String(path || '').split('?')[0].startsWith(PROPS_AT);
const NOT_PROP = T.t('A product comes from IMAGES → Props - add it there with New prop, or put the picture into extra');
// The shot sizes of the set (routes/scen3.js FRAME_SETS) - here only as where the frame's edge is: the value sent, the
// words shown.
const SHOTS = [['', T.t('none')], ['selfie', T.t('selfie')], ['half', T.t('half body')], ['full', T.t('full body')]];
// A frame of the set says the shot size it was drawn to (its `framing` - one of SHOTS' values) in a word.
const FRAMING_WORD = { selfie: T.tc('shot', 'selfie'), half: T.tc('shot', 'half'), full: T.tc('shot', 'full') };

let _proj = null;              // the talking head's project record, handed in by every paint
let _hooks = {};               // { added(project) } from the panel
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
      // WHERE THE EDGE IS: a dropdown, words only, `none` first and by default.
      const r = el('div', 'mv3-ig-row');
      const l = el('label', null, T.t('shot'));
      const s = document.createElement('select');
      s.className = 'u-in is-s';
      s.id = 'mv3-fc-shot';
      l.htmlFor = s.id;
      s.title = T.t('Where the frame\'s edge is. none - your words decide how much of the person is in it; the pose is always your words.');
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
      // The writer, a switch of the column (as in the video chat).
      // the shared switch (.u-switch), its word beside it
      const wr = switchRow(T.t('Writer'), ctx.writing(), false, (v) => ctx.setWriting(v));
      wr.title = T.t('On: the writer writes the frame\'s prompt from your words and the pictures, and stops - you look at it, edit it, and `draw` spends. Off: one press - your words are put into English and the pictures named for the model, and the frame is drawn.');
      const sw = el('div', 'mv3-vc-switches');
      sw.appendChild(wr);
      host.appendChild(sw);
    },
  });

  // ── The zone ──────────────────────────────────────────────────────────────
  function zone() {
    const room = Math.min(MAX_ATTS, M.room());
    const base = _base === 'frame' ? BASE_FRAME : BASE_CAST;
    const prod = Object.assign({}, PRODUCT, { max: Math.max(0, Math.min(PRODUCT.max, room - base.length)) });
    const extra = Object.assign({}, EXTRA, { max: Math.max(0, Math.min(EXTRA.max, room - base.length)) });
    return { parts: [{
      kind: 'image', word: T.t('pictures'), one: T.t('picture'), room,
      // The fields; the shell still knows every slot of the part, in the order the numbers count.
      slots: base.concat(prod.max ? [prod] : [], extra.max ? [extra] : []),
      groups: [
        { word: _base === 'frame' ? T.t('frame to change') : T.t('person & place'), slots: base, cls: 'is-base' },
        ...(prod.max ? [{ word: ROLE_WORD.product, slots: [prod], labels: false, cls: 'is-product', note: T.t('from Props'), noteLong: T.t('Up to two products of IMAGES → Props - each drawn exactly as on its picture, its description going with it; it stays from message to message until you take it off') }] : []),
        ...(extra.max ? [{ word: T.tc('frames chat zone', 'extra'), slots: [extra], labels: false, cls: 'is-extra', note: T.t('say what each is'), noteLong: T.t('Whatever else goes into the frame - say in your message what each picture is and what to take from it') }] : []),
      ],
      none: T.t('This model takes no pictures.'),
      full: T.tn(room, 'This model takes {n} picture.', 'This model takes {n} pictures.'),
    }] };
  }

  // ── Where pictures come from (the picker) ─────────────────────────────────
  // This project's frames: the set, then what this chat drew and is not in the set.
  async function _frames() {
    const vs = (((_proj || {}).mix || {}).variants) || [];
    const ar = _format() === '16:9' ? '16:9' : '9:16';
    const set = vs.filter(v => v && v.path).map(v => Src.pic(v.path, v.n ? T.t('frame {n}', { n: v.n }) : T.t('frame'),
      v.made === 'chat' ? T.t('in the set · from the chat')
        : v.framing ? T.t('in the set · {shot}', { shot: FRAMING_WORD[v.framing] || v.framing }) : T.t('in the set'),
      { aspect: ar, thumb: thumbOf(v.preview || v.path, 'strip') }));
    const k = ctx.key();
    const d = k ? await json('/api/scen3/fchat/feed?project=' + encodeURIComponent(k)) : null;
    const inSet = new Set(set.map(x => x.path));
    const made = ((d && d.success && d.items) || []).filter(g => !inSet.has(g.imagePath))
      .map(g => Src.pic(g.imagePath, String(g.prompt || '').slice(0, 60), T.t('from the chat'), { aspect: g.aspect || ar }));
    return { items: set.concat(made) };
  }
  // The rows above the window's tree; REFERENCES and IMAGES are the tree (chat-sources.js TREE).
  const SOURCES = [
    { id: 'frames', label: T.t('This project\'s frames'), load: _frames, empty: T.t('No frames in this project yet.') },
    Src.PEOPLE_ROW,
  ];
  const START = { character: ['row:people'], place: Src.pictureStart('location'), frame: ['row:frames'], extra: ['node:images'],
    product: ['node:images/Props', 'node:images'] };

  // ── A message of this chat ──
  // ONE MESSAGE PER SEND, all of one kind: what was asked at its head - the words and the pictures,
  // by number and field -, then two columns: on the left the PROMPT - with the writer, the field to edit and its variants,
  // `draw`, `write it again`; without it, what went to the model - and on the right THE FRAME: a box of the project's shape
  // where the picture lands - empty, then counting down, then the frame -, its arrows through every frame of this message,
  // the prompt variant it was drawn from, `to frames` / `in frames` and `to reference`. ⤢ in the frame's corner opens the
  // message's frames large; a press on the frame itself does nothing.
  const _live = new Map();       // card id -> { m, left, right, progs, ta, ver, go, price, save, patchKey }
  const _cardN = new Map();      // card id -> how many to draw
  const _patchT = new Map();     // a prompt being typed: its save, a moment later
  const _verAt = new Map();      // card id -> the variant of the prompt shown
  const _shotAt = new Map();     // message id -> { i, n } the frame shown, and how many there were
  const COUNTS_D = [1, 2, 4];
  const _post = (url, body, method) => json(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const _cardUrl = (m, tail) => '/api/scen3/fchat/card/' + encodeURIComponent(m.id) + (tail || '');

  // What was asked: the words, and the pictures by number with the field each was in.
  function _askedHead(words, media) {
    const h = el('div', 'mv3-fc-asked');
    if (words) h.appendChild(markText(el('div', 'mv3-fc-asked-t'), words));
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
      empty.appendChild(el('span', null, T.t('the frame lands here')));
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
      // A press on it does nothing: ⤢ in its corner opens the message's frames large.
      const big = mediaBtn('image', () => _view(gens, i));
      img.addEventListener('error', () => { img.replaceWith(el('span', 'mv3-ig-gone', T.t('not on the disk any more'))); big.remove(); }, { once: true });
      box.append(img, big);
    } else if (g.state === 'pending') {
      const strip = el('div', 'mv3-ig-prog');
      box.appendChild(strip);
      progs.set(g.id, startInlineProgress(strip, {
        label: ctx.stageWords(g), key: 'mv3-imagen-' + (g.engine || ''), estimateMs: 40000, startedAt: Date.parse(g.at) || 0,
        onCancel: g.alertId ? async () => { await json('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', { method: 'POST' }); ctx.reload(); } : null,
      }));
    } else {
      box.appendChild(el('div', 'mv3-ig-bad', g.error || T.t('nothing came back')));
    }
    host.appendChild(box);
    if (gens.length > 1) {
      const nav = el('div', 'vc-vars mv3-fc-shotnav');
      const prev = el('button', 'vc-nav is-prev u-btn is-s is-icon', '‹');
      const next = el('button', 'vc-nav is-next u-btn is-s is-icon', '›');
      prev.type = 'button'; next.type = 'button';
      prev.disabled = i === 0;
      next.disabled = i === gens.length - 1;
      prev.title = T.t('The previous frame of this message');
      next.title = T.t('The next frame of this message');
      const go = (d) => { _shotAt.set(m.id, { i: i + d, n: gens.length }); _shotBox(host, m, gens, progs, verOf); };
      prev.addEventListener('click', () => go(-1));
      next.addEventListener('click', () => go(1));
      nav.append(prev, el('span', 'vc-vars-t', T.t('frame {k} of {n}', { k: i + 1, n: gens.length })), next);
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
    const add = el('button', 'mv3-c-btn u-btn is-s', inSet() ? T.t('in frames') : T.t('to frames'));
    add.type = 'button';
    add.disabled = inSet();
    add.title = inSet() ? T.t('This frame is in the set') : T.t('Put it into the set of first frames - the fragments take their frames from it by the rule');
    add.addEventListener('click', async () => {
      add.disabled = true;
      const d = await _post('/api/scen3/fchat/to-set', { genId: g.id });
      if (!d || !d.success) { add.disabled = false; note(add, T.t('Not added.'), (d && d.error) || T.t('the server did not answer')); return; }
      add.textContent = T.t('In frames');
      if (_hooks.added) _hooks.added(d.project);
    });
    const use = el('button', 'mv3-c-btn u-btn is-s', T.t('To reference'));
    use.type = 'button';
    use.title = T.t('Change this frame with the next message: it takes the place of the person and the place above the box; the products and the extra pictures stay');
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
    left.appendChild(el('div', 'mv3-fc-k', T.t('sent without the writer')));
    if (g && g.state === 'pending' && !g.taskId) left.appendChild(el('div', 'mv3-fc-note', ctx.stageWords(g)));
    if (g && g.prompt && g.prompt !== g.said) {
      const more = el('details', 'mv3-fc-sent');
      more.appendChild(el('summary', null, T.t('sent as')));
      more.appendChild(markText(el('div', 'mv3-fc-sent-t'), g.prompt));
      left.appendChild(more);
    }
    if (g && (g.fell || g.writer)) left.appendChild(el('div', 'mv3-fc-note', g.fell || T.t('put into English by {name}', { name: g.writer })));
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
          label: T.t('writing the prompt…'), key: 'mv3-fchat-writer', estimateMs: 20000, startedAt: Date.parse(c.startedAt || m.at) || 0,
        }));
        return box;
      }
      box.appendChild(el('div', 'mv3-ig-bad', c.error || T.t('it was not written')));
      const acts = el('div', 'vc-card-acts');
      const again = el('button', 'mv3-c-btn vc-go u-btn is-s', T.t('Write it again'));
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
    const head = el('div', 'mv3-fc-k', c.model ? T.t('Prompt · written for {model}', { model: c.model }) : T.t('Prompt'));
    l.left.appendChild(head);
    if (c.error) l.left.appendChild(el('div', 'mv3-ig-bad', T.t('The last writing did not work: {why}', { why: c.error })));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta u-area';
    ta.spellcheck = true;
    ta.value = v.prompt || '';
    ta.title = T.t('The prompt the model gets - edit it before the frame is drawn. image 1, image 2 are the pictures above, by their numbers.');
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
    markField(ta);                           // "image 1" yellow in the prompt too
    Object.assign(l, { ta, save, patchKey: key });
    if (c.state === 'writing') {
      const strip = el('div', 'mv3-ig-prog');
      l.left.appendChild(strip);
      for (const p of l.progs.values()) p.detach();
      l.progs.clear();
      l.progs.set('w', startInlineProgress(strip, {
        label: T.t('writing another variant…'), key: 'mv3-fchat-writer', estimateMs: 20000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      }));
    }
    if (vs.length > 1) {
      const nav = el('div', 'vc-vars');
      const prev = el('button', 'vc-nav is-prev u-btn is-s is-icon', '‹');
      const next = el('button', 'vc-nav is-next u-btn is-s is-icon', '›');
      prev.type = 'button'; next.type = 'button';
      prev.disabled = vi === 0;
      next.disabled = vi === vs.length - 1;
      prev.title = T.t('The previous variant of the prompt');
      next.title = T.t('The next variant of the prompt');
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
      nav.append(prev, el('span', 'vc-vars-t', T.t('variant {k} of {n} · "draw" sends this one', { k: vi + 1, n: vs.length })), next);
      l.left.appendChild(nav);
    }
    const acts = el('div', 'vc-card-acts');
    const nBtn = el('button', 'vc-n u-btn is-s', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = T.t('How many frames to draw from it - each lands in the box on the right');
    nBtn.addEventListener('click', () => {
      const i = COUNTS_D.indexOf(_cardN.get(m.id) || 1);
      _cardN.set(m.id, COUNTS_D[(i + 1) % COUNTS_D.length]);
      nBtn.textContent = '×' + _cardN.get(m.id);
      _freshen(l);
    });
    const go = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', T.t('Draw'));
    go.type = 'button';
    go.addEventListener('click', () => _draw(l, go));
    const price = el('span', 'vc-card-why');
    const again = el('button', 'vc-link', T.t('Write it again'));
    again.type = 'button';
    again.title = T.t('Another variant of the prompt from the same words and pictures - this one stays');
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
      return k >= 0 ? T.t('from prompt variant {n}', { n: k + 1 }) : '';
    };
    _shotBox(l.right, m, gens, l.progs, verOf);
  }

  // The press and the price follow the column: the model it draws with is the one chosen there now.
  function _freshen(l) {
    if (!l.go) return;
    const c = l.m.card;
    const n = _cardN.get(l.m.id) || 1;
    const made = (c.sends || []).length > 0 || (l.m.genIds || []).length > 0;
    l.go.textContent = n > 1 ? (made ? T.t('Draw again ×{n}', { n }) : T.t('Draw ×{n}', { n })) : (made ? T.t('Draw again') : T.t('Draw'));
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
    if (!d || !d.success) { note(btn, T.t('Not drawn.'), (d && d.error) || T.t('the server did not answer')); return; }
    ctx.reload();
  }

  async function _rewrite(m, btn) {
    btn.disabled = true;
    const d = await _post(_cardUrl(m, '/rewrite'), { project: m.project, engine: (M.engine() || {}).id || '' });
    btn.disabled = false;
    if (!d || !d.success) { note(btn, T.t('Not written.'), (d && d.error) || T.t('the server did not answer')); return; }
    _verAt.delete(m.id);
    ctx.reload();
  }

  // ── `ideas`: right of the places above the box ──
  // The agent looks at the person's sheet, the place and the props in the zone and answers six frames in words, as a
  // message of the thread; a press on one puts it into the box. In English.
  let _ideasBtn = null;
  function _ideasSide() {
    const b = el('button', 'mv3-fc-ideas u-btn is-gen', T.t('Ideas'));
    b.type = 'button';
    b.title = T.t('The agent looks at the pictures above the box - the person, the place, the products, the extra ones - and offers six frames in words; press one to put it into the box. Ask again after adding pictures. Fractions of a cent.');
    b.addEventListener('click', () => _askIdeas(b));
    return [b];
  }
  async function _askIdeas(b) {
    const k = ctx.key();
    if (!k || b.disabled) return;
    const atts = ctx.atts();
    if (!atts.some(a => a.slot === 'character' || a.slot === 'place' || a.slot === 'frame')) { note(b, T.t('Nothing to look at.'), T.t('Put the person or the place above the box first.')); return; }
    b.disabled = true;
    b.textContent = T.t('Thinking…');
    const d = await _post('/api/scen3/fchat/ideas', {
      project: k, projectId: (_proj && _proj.id) || '', refs: atts.map(a => a.path), roles: atts.map(a => a.slot || ''), shot: _shot,
    });
    b.disabled = false;
    b.textContent = T.t('Ideas');
    if (!d || !d.success) { note(b, T.t('No ideas.'), (d && d.error) || T.t('the server did not answer')); return; }
    ctx.reload(true);
  }
  // Six, in two columns; one a message went from wears gold and "used".
  // Each has ↻ in its corner on hover: that idea written again as a
  // variation of itself, in its place (POST /api/scen3/fchat/ideas/again); while it is written the card waits.
  const _againBusy = new Set();          // '<message id>:<i>' being written again
  function _ideasBubble(m) {
    const box = el('div', 'mv3-ig-msg is-agent mv3-fc-ideasmsg');
    box.appendChild(el('div', 'mv3-ig-text', m.text || T.t('Ideas for a frame')));
    const used = new Set((m.used || []).map(Number));
    const list = el('div', 'mv3-fc-ideaslist');
    m.ideas.forEach((idea, i) => {
      const cell = el('div', 'mv3-fc-ideacell');
      const it = el('button', 'mv3-fc-idea' + (used.has(i) ? ' is-used' : ''));
      it.type = 'button';
      it.appendChild(markText(el('span', 't'), idea));
      if (used.has(i)) it.appendChild(el('span', 'u', T.t('Used')));
      it.title = used.has(i) ? T.t('A frame was asked for from this one. Put it into the message box - change it as you like, then send')
        : T.t('Put it into the message box - change it as you like, then send');
      it.addEventListener('click', () => {
        if (cell.classList.contains('is-again')) return;
        ctx.setText(idea);
        _armedIdea = { id: m.id, i };
        const ui = ctx.ui();
        if (ui) ui.ta.focus();
      });
      const re = el('button', 'mv3-fc-idea-re u-btn is-icon', '↻');
      re.type = 'button';
      re.title = T.t('Another take on this idea - the same spot, another pose or angle - in its place. Fractions of a cent.');
      re.addEventListener('click', (ev) => { ev.stopPropagation(); _ideaAgain(m, i, cell, re); });
      if (_againBusy.has(m.id + ':' + i)) cell.classList.add('is-again');
      cell.append(it, re);
      list.appendChild(cell);
    });
    box.appendChild(list);
    return box;
  }
  async function _ideaAgain(m, i, cell, re) {
    const k = ctx.key();
    const lock = m.id + ':' + i;
    if (!k || _againBusy.has(lock)) return;
    _againBusy.add(lock);
    cell.classList.add('is-again');
    const d = await _post('/api/scen3/fchat/ideas/again', {
      project: k, projectId: (_proj && _proj.id) || '', id: m.id, i, shot: _shot,
    });
    _againBusy.delete(lock);
    cell.classList.remove('is-again');
    if (!d || !d.success) { note(re.isConnected ? re : cell, T.t('Not written again.'), (d && d.error) || T.t('the server did not answer')); return; }
    // The box keeps its words; a send from them no longer marks the new idea used.
    if (_armedIdea && _armedIdea.id === m.id && _armedIdea.i === i) _armedIdea = null;
    ctx.reload();
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
    // "image 1", "image/2" yellow in the box and in read more.
    markImages: true,
    ids: { root: 'mv3-fc' },
    keys: { draft: 'mv3_fc_draft_v1', write: 'mv3_fc_write_v1' },
    maxAtts: MAX_ATTS,
    counts: [1, 2, 4],
    noun: { one: T.t('picture'), many: T.t('pictures') },
    busyWord: T.t('drawing'),
    eta: 40000,
    progressKey: (g) => 'mv3-imagen-' + (g.engine || ''),
    sendUrl: '/api/scen3/fchat/send',
    // A frame that lands goes into the `frame` place only when asked ("to reference").
    landAsRef: false,
    text: {
      placeholder: T.t('Describe the frame - where the person is, the pose, the hands, where they look.'),
      empty: T.t('Describe a frame of this video in words. The person and the place are attached already; what comes back is this project\'s, and "to frames" puts it into the set.'),
      emptyNoProject: T.t('Open a talking head first.'),
      onlyFiles: T.t('Only pictures can be attached here.'),
      slot: T.t('A picture - from the Library or this computer'),
    },
    upload: { url: '/api/mv3/img/upload', field: 'image', accept: PICTURE_ACCEPT, ok: isPictureFile },
    pick: {
      sources: () => SOURCES,
      tree: () => Src.TREE.image,
      start: (kind, s) => (s && START[s.key]) || '',
      // The product place takes only a product of Props.
      why: (it, kind, slot) => (slot === 'product' && it && !_isProp(it.path) ? NOT_PROP : ''),
      // ...and makes one: New prop over the chat, the product added going straight into the
      // place.
      make: (kind, slot) => (slot !== 'product' ? null : {
        label: T.t('+ new prop'), title: T.t('A product of your own - its photo and what you know about it; it goes into IMAGES → Props and into this place'),
        on: async () => {
          closePick();
          const { openNewProp } = await import('../prop-window.js');
          let taken = '';
          openNewProp({
            onAdded: (it) => {
              if (!it || !it.media || taken === it.media) return;
              taken = it.media;
              ctx.attach(it.media, it.name || ROLE_WORD.product, { slot: 'product' });
              ctx.saveDraft();
            },
          });
        },
      }),
      lands: { image: 'images' },
      upWords: { image: T.t('A picture goes into the folder open here when it is one of yours in IMAGES - else into IMAGES itself.') },
    },
    penInBar: false,
    columnFoot: () => [almanacSoon()],
    resultPath: (g) => g.imagePath,
    // Alerts brings the person back here: the project, its setup, this chat.
    where: WHERE,
    // The writer's message is the description's to draw; the shell keeps the thread reading while one is being written.
    cardBubble: _cardBubble,
    cardSig: _cardSig,
    // ONE MESSAGE PER SEND: the person's turn is not drawn apart - what was asked heads its answer.
    hidden: (m) => m.role === 'user',
    bubble: (m, progs, asked) => (Array.isArray(m.ideas) && m.ideas.length ? _ideasBubble(m)
      : (m.role !== 'user' && (m.gens || []).length ? _plainBubble(m, progs, asked) : null)),
    msgSig: (m) => (Array.isArray(m.ideas) ? (m.used || []).join(',') + '|' + m.ideas.join('|') : ''),
    attsSide: _ideasSide,
    // The idea a message went from is used now; the box is its own again.
    afterSend: () => { _armedIdea = null; },
    // Into the product place only a product of Props - a file from this computer too.
    refuseAt: (slot, path) => (slot === 'product' && !_isProp(path) ? NOT_PROP : ''),
    // The frame being changed taken out of the base: the person and the place come back.
    onDetach: (a) => {
      if (!a || a.slot !== 'frame') return false;
      _base = 'cast';
      const keep = ctx.zoneAtts().filter(x => (x.slot === 'extra' || x.slot === 'product') && !x.hole);
      const c = _cast();
      const back = [];
      if (c.obrazImage) back.push({ path: c.obrazImage, name: c.characterName || T.t('the character'), slot: 'character' });
      if (c.locationImage) back.push({ path: c.locationImage, name: T.t('the place'), slot: 'place' });
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
        // The idea the words came from - marked used by the server with the send.
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

    // A finished frame in the thread: a press on it does nothing, ⤢ in its corner opens the thread's frames large.
    shot(g, cell, open) {
      const img = document.createElement('img');
      img.className = 'mv3-ig-shot';
      img.src = thumbOf(g.imagePath, 'strip');
      img.alt = g.prompt || '';
      img.loading = 'lazy'; img.decoding = 'async';
      img.style.aspectRatio = String(g.aspect || _format()).replace(':', '/');
      cell.appendChild(img);
      const big = mediaBtn('image', open);
      cell.appendChild(big);
      // "to frames" - into the set, where the lines take frames from; "to reference" - into the `frame` place, for the
      // next change.
      const acts = el('div', 'mv3-ig-acts');
      const inSet = () => ((((_proj || {}).mix || {}).variants) || []).some(v => v && v.path === g.imagePath);
      const add = el('button', 'mv3-c-btn u-btn is-s', inSet() ? T.t('in frames') : T.t('to frames'));
      add.type = 'button';
      add.disabled = inSet();
      add.title = inSet() ? T.t('This frame is in the set') : T.t('Put it into the set of first frames - the fragments take their frames from it by the rule');
      add.addEventListener('click', async () => {
        add.disabled = true;
        const d = await json('/api/scen3/fchat/to-set', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ genId: g.id }) });
        if (!d || !d.success) { add.disabled = false; note(add, T.t('Not added.'), (d && d.error) || T.t('the server did not answer')); return; }
        add.textContent = T.t('In frames');
        if (_hooks.added) _hooks.added(d.project);
      });
      const use = el('button', 'mv3-c-btn u-btn is-s', T.t('To reference'));
      use.type = 'button';
      use.title = T.t('Put it into the "frame" place above the message box, to change it with the next message');
      use.addEventListener('click', () => toReference(g.imagePath, (g.said || g.prompt || '').slice(0, 60)));
      acts.append(add, use);
      cell.appendChild(acts);
      img.addEventListener('error', () => {
        const gone = el('div', 'mv3-ig-gone', T.t('not on the disk any more'));
        gone.style.aspectRatio = img.style.aspectRatio;
        img.replaceWith(gone);
        big.remove();
        add.disabled = true; use.disabled = true;
      }, { once: true });
    },
    facts: (g) => [
      [T.t('model'), (g.engine || '') + ' · ' + (g.provider || '?') + ' · ' + (g.quality || '')],
      [T.t('asked as'), g.model || ''],
      [T.t('shape'), (g.aspect || '') + ((g.w && g.h) ? ' · ' + g.w + '×' + g.h : '')],
      [T.t('took'), g.secs ? T.t('{n}s', { n: g.secs }) : ''],
      [T.t('references'), (g.refs || []).length ? String(g.refs.length) : ''],
      [T.t('writer'), g.fell ? g.fell : (g.writer || '')],
      [T.t('you said'), g.said || ''],
      [T.t('sent as'), (g.prompt && g.prompt !== g.said) ? g.prompt : ''],
    ],
    view(done, at) {
      import('../library/viewer.js').then(V => V.openViewer(
        done.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: x.prompt || '', meta: { date: x.at } })),
        at, { showSrc: (it) => thumbOf(it.media, 'main') }));
    },
    // No cross of its own: the chat lives in its window, whose head's ✕ closes it (its own head line is
    // not shown there).
  };
}

const CHAT = createChat(FRAMES);

// The project's look and place go into their places when the chat opens - unless something is there, or the person
// took them out while it was open; and the one put there from the casting follows the casting when it changes.
function _autoCast(opening) {
  if (!_proj || !CHAT.isOpen()) return;
  // A row in any other place (`prop`, `other`) - or a frame left in a base that holds the person and
  // the place - goes to the extra field.
  if (opening) {
    const keys = _base === 'frame' ? ['frame', 'product', 'extra'] : ['character', 'place', 'product', 'extra'];
    const real = CHAT.ctx.zoneAtts().filter(a => !a.hole);
    if (real.some(a => !keys.includes(a.slot))) {
      CHAT.ctx.useAtts(real.map(a => (keys.includes(a.slot) ? a : Object.assign({}, a, { slot: 'extra' }))));
    }
  }
  // While the base holds a frame being changed, the person and the place stay out.
  if (_base === 'frame') return;
  const c = _cast();
  const want = { character: c.obrazImage || '', place: c.locationImage || '' };
  const names = { character: c.characterName || T.t('the character'), place: T.t('the place') };
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

// ── IN A WINDOW ──────────────────────────────────────────────────────────────
// The chat's root lives in the Setup panel (#mv3-fc in merge-v3.html), hidden - its parking place - and is MOVED into the
// window while it is open and back when it closes, as New Character does (js/library/chmake.js): the conversation, the box
// being typed, the zone and the countdowns are the same nodes. Closing the window hides the chat; nothing it asked for stops.
// A generation's window: 1280×800 (gen-window.js GEN_SIZE).
let _win = null;
let _ro = null;
// The node itself, held: the window takes its overlay off the page before it says it closed, and the root with it - looked
// up by its id then, it would be gone (js/library/chmake.js holds its root the same way).
let _rootEl = null;
const $root = () => _rootEl || (_rootEl = document.getElementById('mv3-fc'));

/** Whether the window is open. */
export const isOpen = () => !!(_win && _win.alive());

/**
 * The window, over everything open, for the project `p`. `hooks`: { added(project) - a frame went into the set }. Opened
 * again while open - it only takes the project as it is now.
 */
export function open(p, hooks) {
  _proj = p || null;
  if (hooks) _hooks = hooks;
  const root = $root();
  if (!root) return;
  if (!isOpen()) {
    // The chats' one size and place, the person's (gen-window.js GEOM_CHAT).
    _win = openFrame({ name: 'frames chat', size: GEN_SIZE, geom: GEOM_CHAT, cls: 'is-fchat', onClose: _park });
    _win.setCrumbs([{ label: T.t('Frames chat') }]);
    root.removeAttribute('style');        // the place the old overlay measured for it
    _win.body.appendChild(root);
    if (!_ro && window.ResizeObserver) _ro = new ResizeObserver(() => { if (isOpen()) CHAT.fit(); });
    if (_ro) { _ro.disconnect(); _ro.observe(root); }
  }
  if (!CHAT.isOpen()) CHAT.open().then(() => { CHAT.fit(); _autoCast(true); });
  else { CHAT.fit(); _autoCast(false); }
}

/** The project as it is now - every paint of setup while the window is open (the casting may have changed). */
export function update(p) {
  if (!isOpen() || !p) return;
  _proj = p;
  _autoCast(false);
}

/** Closed from outside - another project, another step: the window goes, the chat hides, what is written stays. */
export function close() { if (isOpen()) _win.close(); }

// The window gone (its ✕, Escape, a press beside it, or close()): the chat hides and its root goes back to its parking place.
function _park() {
  const root = $root();
  const home = document.getElementById('mv3-inspector');
  if (_ro) _ro.disconnect();
  // Home first: the chat finds its root by its id when it hides (chat-shell.js), and off the page it would not.
  if (root && home && root.parentNode !== home) home.appendChild(root);
  CHAT.close();
  _win = null;
}

/**
 * "to reference": the frame takes the base - the person and the place go from it - and the extra
 * field stays as it is. Its cross in the base puts the person and the place back (onDetach).
 */
export function toReference(path, name) {
  const z = CHAT.ctx.zoneAtts();
  const was = z.find(a => a.slot === 'frame' && !a.hole);
  if (was && was.path === path) return;
  const keep = z.filter(a => (a.slot === 'extra' || a.slot === 'product') && !a.hole && a.path !== path);
  _base = 'frame';
  CHAT.ctx.useAtts([{ path, name: name || T.t('frame'), slot: 'frame' }].concat(keep));
  CHAT.ctx.saveDraft();
}

export function initFramesChat() { CHAT.init(); }
