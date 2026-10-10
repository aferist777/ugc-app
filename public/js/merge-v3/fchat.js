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
import { createChat, el, thumbOf, json, money, almanacSoon } from './chat-shell.js';
import { note } from './ask.js';
import { stepCard } from './vsteps.js';
import { startInlineProgress } from '../progress.js';
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
    return { parts: [{
      kind: 'image', word: 'pictures', one: 'picture', room: Math.min(MAX_ATTS, M.room()), slots: SLOTS.map(s => Object.assign({ min: 0 }, s)),
      otherLabel: 'other', other: 'Another picture - say in the message what it is for',
      none: 'This model takes no pictures.',
      full: 'This model takes ' + Math.min(MAX_ATTS, M.room()) + ' pictures.',
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
  const START = { character: 'people', place: 'environments', frame: 'frames', prop: 'images' };

  // ── The writer's message (as in the video chat, V16) ──────────────────────
  // With the writer on, ">" sends the words and the pictures, and the writer's prompt comes back in a message of its own
  // to look at and edit; only its `draw` spends. The message is a SUB-PROJECT (vsteps.js): "prompt" - every writing of it a
  // variant - then "frame" - every picture drawn from it a variant. The variant of the prompt shown is the one drawn from.
  const _live = new Map();       // card id -> { m, steps, ta, ver, go, price }
  const _cardN = new Map();      // card id -> how many to draw
  const _patchT = new Map();     // a prompt being typed: its save, a moment later
  const COUNTS_D = [1, 2, 4];
  const _post = (url, body, method) => json(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const _cardUrl = (m, tail) => '/api/scen3/fchat/card/' + encodeURIComponent(m.id) + (tail || '');

  function _cardBubble(m, progs) {
    const c = m.card;
    const was = _live.get(m.id);
    if (was && was.steps) was.steps.destroy();
    _live.delete(m.id);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-prompt is-steps is-' + c.state);
    const h = el('div', 'vc-card-h');
    h.appendChild(el('span', 'k', 'frame'));
    if (c.model) h.appendChild(el('span', 'm', 'written for ' + c.model));
    box.appendChild(h);
    if (!(c.versions || []).length) {
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
    const steps = stepCard(m.id);
    box.append(...steps.parts);
    const l = { m, steps, ta: null, ver: '', go: null, price: null };
    _live.set(m.id, l);
    _paintCard(l);
    return box;
  }

  function _paintCard(l) {
    const m = l.m, c = m.card;
    const vers = (c.versions || []).map(v => ({ key: v.id, sig: v.model, v }));
    if (c.state === 'writing') vers.push({ key: 'writing', sig: 'writing', writing: true });
    const steps = [{
      key: 'prompt', title: 'prompt', word: 'variant', pick: c.cur, variants: vers,
      note: (x) => (!x ? '' : x.writing ? 'being written' : '"draw" sends this one'),
      body: (x, b, progs) => _promptBody(l, x, b, progs),
      acts: (x, a) => _promptActs(l, x, a),
      // The variant paged to is the chosen one (the server keeps it for the next read).
      page: (x) => { if (x && x.v && x.key !== l.m.card.cur) _post(_cardUrl(l.m), { project: l.m.project, cur: x.key }, 'PATCH'); },
      freshen: () => _freshen(l),
    }];
    const gens = m.gens || [];
    if (gens.length) {
      steps.push({
        key: 'frame', title: 'frame', word: 'frame', variants: gens.map(g => ({ key: g.id, sig: g.state + ':' + (g.imagePath || '') + ':' + (g.error || ''), g })),
        body: (x, b, progs) => { if (!x) return; const sh = ctx.shots({ gens: [x.g] }, progs); if (sh) b.appendChild(sh); },
        freshen: (x) => { const p = x && x.g.state === 'pending' ? l.steps.progs.get(x.g.id) : null; if (p) p.say(ctx.stageWords(x.g)); },
      });
    }
    l.steps.paint({ steps });
  }

  function _promptBody(l, x, b, progs) {
    l.ta = null; l.ver = '';
    const c = l.m.card;
    if (!x || x.writing) {
      const strip = el('div', 'mv3-ig-prog');
      b.appendChild(strip);
      progs.set('w', startInlineProgress(strip, {
        label: 'writing another variant…', key: 'mv3-fchat-writer', estimateMs: 20000, startedAt: Date.parse(c.startedAt || l.m.at) || 0,
      }));
      return;
    }
    if (c.error) b.appendChild(el('div', 'mv3-ig-bad', 'The last writing did not work: ' + c.error));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta';
    ta.spellcheck = true;
    ta.value = x.v.prompt || '';
    ta.title = 'The prompt the model gets - edit it before the frame is drawn. image 1, image 2 are the pictures above, by their numbers.';
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(420, ta.scrollHeight + 2) + 'px'; };
    requestAnimationFrame(grow);
    const key = 'p:' + l.m.id + ':' + x.v.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      return _post(_cardUrl(l.m), { project: l.m.project, ver: x.v.id, prompt: ta.value }, 'PATCH');
    };
    ta.addEventListener('input', () => { grow(); clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    ta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    b.appendChild(ta);
    l.ta = ta;
    l.ver = x.v.id;
    l.save = save;
    l.patchKey = key;
  }

  function _promptActs(l, x, a) {
    l.go = null; l.price = null;
    if (!x || x.writing) return;
    const m = l.m;
    const nBtn = el('button', 'vc-n', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = 'How many frames to draw from it - each is its own variant of the frame';
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
    again.addEventListener('click', () => _rewrite(l.m, again));
    a.append(nBtn, go, price, again);
    l.go = go;
    l.price = price;
    _freshen(l);
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
    ctx.reload();
  }

  // ── `ideas` (the owner, 2026-10-10): right of the places above the box ──
  // The agent looks at the person's sheet, the place and the props in the zone and answers five frames in words, as a
  // message of the thread; a press on one puts it into the box. In English (the owner's answer (e)).
  let _ideasBtn = null;
  function _ideasSide() {
    const b = el('button', 'mv3-fc-ideas', 'ideas');
    b.type = 'button';
    b.title = 'The agent looks at the person and the place above the box (and a prop) and offers five frames in words - press one to put it into the box. Fractions of a cent.';
    b.addEventListener('click', () => _askIdeas(b));
    _ideasBtn = b;
    return [b];
  }
  async function _askIdeas(b) {
    const k = ctx.key();
    if (!k || b.disabled) return;
    const atts = ctx.atts();
    if (!atts.some(a => a.slot === 'character' || a.slot === 'place')) { note(b, 'Nothing to look at.', 'Put the person or the place above the box first.'); return; }
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
  function _ideasBubble(m) {
    const box = el('div', 'mv3-ig-msg is-agent mv3-fc-ideasmsg');
    box.appendChild(el('div', 'mv3-ig-text', m.text || 'Ideas for a frame'));
    const list = el('div', 'mv3-fc-ideaslist');
    for (const idea of m.ideas) {
      const it = el('button', 'mv3-fc-idea', idea);
      it.type = 'button';
      it.title = 'Put it into the message box - change it as you like, then send';
      it.addEventListener('click', () => { ctx.setText(idea); const ui = ctx.ui(); if (ui) ui.ta.focus(); });
      list.appendChild(it);
    }
    box.appendChild(list);
    return box;
  }

  // The sig of a card for the shell: what it IS - never the text being typed into it.
  const _cardSig = (m) => {
    const c = m.card || {};
    return [c.state, c.cur, (c.versions || []).map(v => v.id + ':' + v.model).join(','), c.error || '',
      (m.gens || []).map(g => g.id + ':' + g.state + ':' + (g.imagePath || '') + ':' + (g.error || '')).join(',')].join('|');
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
    bubble: (m) => (Array.isArray(m.ideas) && m.ideas.length ? _ideasBubble(m) : null),
    attsSide: _ideasSide,
    busy: (thread) => thread.some(m => m.card && m.card.state === 'writing'),
    onThread: (thread) => {
      for (const m of thread) { const l = _live.get(m.id); if (l && l.steps && m.card) { l.m = m; _paintCard(l); } }
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

/** A frame put into the `frame` place - "to reference" under a result, or a frame of the set. */
export function toReference(path, name) {
  const z = CHAT.ctx.zoneAtts();
  const was = z.find(a => a.slot === 'frame' && !a.hole);
  if (was && was.path === path) return;
  if (was) CHAT.ctx.detach(was.path);
  CHAT.ctx.attach(path, name || 'frame', { slot: 'frame' });
}

export function initFramesChat() { CHAT.init(); }
