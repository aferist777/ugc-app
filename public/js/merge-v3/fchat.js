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
import { createChat, el, thumbOf, almanacSoon } from './chat-shell.js';
import { modelColumn } from './pic-models.js';
import * as Src from './chat-sources.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';

const MAX_ATTS = 8;
const LS_LAST = 'mv3-fc-last';           // the model choice of this chat
// The places of the zone, in the order their numbers count. `max` - how many each holds.
const SLOTS = [
  { key: 'character', label: 'character', max: 1, hint: 'The person - their look\'s sheet. The frame takes only the person from it, never the sheet itself.' },
  { key: 'place', label: 'place', max: 1, hint: 'The place - the environment the person is in' },
  { key: 'frame', label: 'frame', max: 1, hint: 'A frame to change - "to reference" under a frame in the chat puts it here' },
  { key: 'prop', label: 'prop', max: 3, hint: 'A thing in the frame - a product, an object - drawn exactly as on its picture' },
];
// The shot sizes of the set (routes/scen3.js FRAME_SETS) - here only as where the frame's edge is.
const SHOTS = [['', 'none'], ['selfie', 'selfie'], ['half', 'half body'], ['full', 'full body']];

let _proj = null;              // the talking head's project record, handed in by every paint
let _hooks = {};               // { close, stage(path, name) } from the panel
let _shot = '';                // where the frame's edge is - '' none
let _shotSel = null;
let _auto = {};                // { character, place } - what was put into those places from the casting

// The project's format - the set is drawn in it (routes/scen3.js mix.settings.format).
const _format = () => String((((_proj || {}).mix || {}).settings || {}).format || ((Store.timeline() || {}).format) || '9:16');
const _cast = () => ((_proj || {}).casting) || {};

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
    return { parts: [{
      kind: 'image', word: 'pictures', one: 'picture', room: Math.min(MAX_ATTS, M.room()), slots: SLOTS.map(s => Object.assign({ min: 0 }, s)),
      otherLabel: 'other', other: 'Another picture - say in the message what it is for',
      none: 'This model takes no pictures.',
      full: 'This model takes ' + Math.min(MAX_ATTS, M.room()) + ' pictures.',
    }] };
  }

  // ── Where pictures come from (the picker) ─────────────────────────────────
  // This project's frames - the set, and (block B) what this chat drew.
  async function _frames() {
    const vs = (((_proj || {}).mix || {}).variants) || [];
    const ar = _format() === '16:9' ? '16:9' : '9:16';
    return { items: vs.filter(v => v && v.path).map(v => Src.pic(v.path, 'frame' + (v.n ? ' ' + v.n : ''),
      v.made === 'chat' ? 'from the chat' : (v.framing || ''), { aspect: ar, thumb: thumbOf(v.preview || v.path, 'strip') })) };
  }
  const SOURCES = [
    { id: 'frames', label: 'this project\'s frames', load: _frames, empty: 'No frames in this project yet.' },
    { id: 'people', label: 'characters & looks', load: Src.people },
    { id: 'environments', label: 'environments', load: () => Src.flat('environments', '3:2') },
    { id: 'images', label: 'Images', load: Src.images },
  ];
  const START = { character: 'people', place: 'environments', frame: 'frames', prop: 'images' };

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
    where: (key) => ({
      page: 'merge', href: '/merge?p=' + encodeURIComponent(key) + '&step=setup&view=fchat',
      label: 'Merge · ' + (Store.title() || 'project') + ' · frames chat',
      spot: { key, view: 'fchat' },
    }),

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
        roles: ctx.atts().map(a => a.slot || ''),
        projectId: (_proj && _proj.id) || '',
      }),
      draftExtra: () => ((_shot || _auto.character || _auto.place) ? { shot: _shot, auto: _auto } : null),
      draftLoad: (x) => {
        _shot = SHOTS.some(s => s[0] === (x && x.shot)) ? x.shot : '';
        _auto = (x && x.auto && typeof x.auto === 'object') ? { character: String(x.auto.character || ''), place: String(x.auto.place || '') } : {};
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
    },
    facts: (g) => [
      ['model', (g.engine || '') + ' · ' + (g.provider || '?') + ' · ' + (g.quality || '')],
      ['asked as', g.model || ''],
      ['shape', (g.aspect || '') + ((g.w && g.h) ? ' · ' + g.w + '×' + g.h : '')],
      ['took', g.secs ? g.secs + 's' : ''],
      ['references', (g.refs || []).length ? String(g.refs.length) : ''],
      ['writer', g.fell ? 'sent as typed - ' + g.fell : (g.writer || '')],
      ['prompt', g.prompt || ''],
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
// the moment the place is no longer on the page - another face of the panel, another step, the scenario picker.
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
 * Shown in `slot` - the place the fields column leaves for it - for the project `p`. `hooks`: { close, stage }.
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

/** A frame put into the `frame` place - "to reference" under a result, or a frame of the set. */
export function toReference(path, name) {
  const z = CHAT.ctx.zoneAtts();
  const was = z.find(a => a.slot === 'frame' && !a.hole);
  if (was && was.path === path) return;
  if (was) CHAT.ctx.detach(was.path);
  CHAT.ctx.attach(path, name || 'frame', { slot: 'frame' });
}

export function initFramesChat() { CHAT.init(); }
