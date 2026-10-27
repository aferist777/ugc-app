// LIBRARY - the making chats: New environment on the Environments shelf, New lookbook on the Lookbooks
// shelf (phase I, the owner 2026-10-01: "как в попапе где мы генерируем изображения в merge").
//
// Three columns in place of the shelf. On the LEFT the shelf itself, small: a tile pressed is the BASE
// of the next message - an environment to change, a lookbook to build on. In the MIDDLE the chat: what
// was asked and what came of it, oldest first, and under it five places for pictures and the box to
// type in - Enter sends, Shift+Enter breaks the line, ">" sends too. On the RIGHT where else a picture
// can come from: this computer, or the Library's Images. One picture per message for now (the owner):
// the first place is live, the other four are drawn for later, and a new picture replaces the one there.
//
// THE SERVER HOLDS THE WORK (routes/makechat.js). A send writes its Alerts row and its message in one
// go; the agent, the upload and the task happen behind it, and the chat - kept on the server, thirty
// sends, never cleared by itself - carries what came of each. This page only reads the chat: every four
// seconds while something in it is running and the area is shown, and on opening and on focus. Leaving
// is always allowed. Up to three sends run at once (the owner); each answer has its own countdown, at
// the row's real age, with the cross that lets it go.
//
// A picture that lands becomes the base of the next message - unless the place above the box was
// changed while it was being made, which is the person deciding something else.

import { startInlineProgress } from '../progress.js';
import { openViewer } from './viewer.js';
import { nonsense, MIN_WORDS_ALONE } from '../merge-v3/wk-maker.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';

const POLL_MS = 4000;
const PLACES = 5;
const AT_ONCE = 3;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const thumb = (p, v) => '/api/thumb?src=' + encodeURIComponent(p) + '&v=' + (v || 'card');
const json = async (url, opts) => {
  const r = await fetch(url, opts);
  let d = null;
  try { d = await r.json(); } catch (e) { d = null; }
  if (!r.ok || !d || d.success === false) throw Object.assign(new Error((d && d.error) || ('HTTP ' + r.status)), { status: r.status });
  return d;
};
const post = (url, body) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

// What the row is doing, said the person's way. An empty stage on a running row is the drawing itself.
const STAGE = {
  'sending the picture': 'sending the picture',
  'reading the picture': 'the agent is reading the picture',
  'reading your words': 'the agent is reading your words',
  'asking for the picture': 'asking for the picture',
};
const _stageWords = (s) => STAGE[s] || s || 'drawing';

const SPECS = {
  environments: {
    host: 'lib-envmake', title: 'New environment', shelf: 'Environments', aspect: '3:2', estimateMs: 120000,
    uploads: 'uploads_environments',
    placeholder: 'Describe a place - or pick a picture and say what to change: "evening, the lamps on"',
    empty: 'Describe a place to make it from words. Press one on the left to change it, or take a photo from the right - from this computer or the Library\'s Images - and the place is taken out of it. Everything made here stays in this chat and on the Environments shelf.',
    hint: (att, text) => !att ? 'drawn from your words'
      : att.from === 'base' ? (text ? 'this environment, changed as you say' : 'say what to change in this environment')
        : (text ? 'the place taken out of the photo, and your words applied' : 'the place taken out of the photo'),
    modes: { photo: 'the place taken out of a photo', edit: 'an environment changed', draw: 'drawn from words', picked: 'a place picked for a picture' },
  },
  lookbooks: {
    host: 'lib-lbmake', title: 'New lookbook', shelf: 'Lookbooks', aspect: '1:1', estimateMs: 45000,
    uploads: 'uploads_lookbooks',
    placeholder: 'Describe an outfit - or pick a picture: alone it takes the outfit out of it, with words it applies them',
    empty: 'Describe an outfit to draw it from words. Press a lookbook on the left to build on it, or take a photo from the right - from this computer or the Library\'s Images - and the outfit is taken out of it. Everything made here stays in this chat and on the Lookbooks shelf.',
    hint: (att, text) => !att ? 'drawn from your words'
      : (text ? 'the picture read, and your words applied' : 'the outfit taken out of the picture'),
    modes: { extract: 'the outfit taken out of a picture', edit: 'a picture read and words applied', draw: 'drawn from words' },
  },
};

function createMaker(kind) {
  const sp = SPECS[kind];
  const LS = 'lib_mkchat_' + kind + '_v1';         // the unsent text, the picture above it, the right column
  const ADDR = '/api/makechat/' + kind;

  let _hooks = {};
  let _built = false;
  let _root = null;
  let _ui = {};
  let _sends = [];
  let _att = null;                                  // { path, from: 'base' | 'photo' }
  let _posting = false;
  let _lastSent = null;                             // { path, from } of the send just made - not sent twice by a second Enter
  let _uploading = 0;                               // photos still on their way into Images
  let _upSeq = 0;                                   // the newest of them is the one that lands in the place
  let _shelf = null;                                // the base tiles
  let _masonryCols = 0;                             // how many columns the Images kladka was last drawn in
  let _paintedCat = null;                           // which category it was last drawn for
  let _cat = '';
  let _images = null;
  let _cats = [];
  let _timer = 0;
  let _said = '';
  const _nodes = new Map();                         // send id -> { user, agent, sig, prog }
  const _gone = new Set();                          // results taken off the shelf since - the viewer skips them

  // ── the bench, remembered ─────────────────────────────────────────────────
  function _remember() {
    try {
      localStorage.setItem(LS, JSON.stringify({ text: _ui.ta ? _ui.ta.value : '', att: _att, cat: _cat }));
    } catch (e) { /* this view only */ }
  }
  function _recall() {
    let w = null;
    try { w = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { w = null; }
    if (!w) return;
    if (_ui.ta && typeof w.text === 'string') _ui.ta.value = w.text;
    if (w.att && typeof w.att.path === 'string' && w.att.path.startsWith('/')) _att = { path: w.att.path, from: w.att.from === 'base' ? 'base' : 'photo' };
    if (typeof w.cat === 'string') _cat = w.cat;
  }

  // ── build ─────────────────────────────────────────────────────────────────
  function _build() {
    const host = document.getElementById(sp.host);
    if (!host || _built) return;
    _built = true;
    host.textContent = '';
    _root = el('div', 'mkc');

    const base = el('section', 'mkc-col mkc-base');
    const bh = el('div', 'mkc-head');
    bh.appendChild(el('span', 'mkc-t', sp.shelf));
    bh.appendChild(el('span', 'mkc-sub', 'press one to build on it'));
    base.appendChild(bh);
    const baseList = el('div', 'mkc-tiles is-' + kind);
    base.appendChild(baseList);

    const chat = el('section', 'mkc-col mkc-chat');
    const ch = el('div', 'mkc-head');
    ch.appendChild(el('span', 'mkc-t', sp.title));
    const count = el('span', 'mkc-sub');
    ch.appendChild(count);
    chat.appendChild(ch);
    const thread = el('div', 'mkc-thread');
    chat.appendChild(thread);
    const atts = el('div', 'mkc-atts');
    chat.appendChild(atts);
    const bar = el('div', 'mkc-bar');
    const ta = document.createElement('textarea');
    ta.className = 'mkc-say';
    ta.rows = 1;
    ta.placeholder = sp.placeholder;
    ta.spellcheck = true;
    const go = el('button', 'mkc-go', '>');
    go.type = 'button';
    go.title = 'Send - Enter. Shift+Enter starts a new line. It spends credits.';
    bar.append(ta, go);
    chat.appendChild(bar);

    // ONE right column (phase I4, the owner): the field that brings a photo in from this computer, the
    // Images categories under it, and the pictures of the one chosen. A photo brought in lands in this
    // chat's upload category, and the dropdown goes there.
    const src = el('section', 'mkc-col mkc-src');
    const sh = el('div', 'mkc-head');
    sh.appendChild(el('span', 'mkc-t', 'Images'));
    sh.appendChild(el('span', 'mkc-sub', 'press one to use it as the photo'));
    src.appendChild(sh);
    const drop = el('button', 'mkc-up');
    drop.type = 'button';
    drop.title = 'A photo from this computer - it goes into the Library\'s Images, under ' + sp.uploads;
    drop.appendChild(el('span', 'mkc-up-plus', '+'));
    const upT = el('span', 'mkc-up-t');
    upT.appendChild(el('b', null, 'a photo from this computer'));
    upT.appendChild(el('span', null, 'click, drop it here, or paste it into the message box'));
    drop.appendChild(upT);
    src.appendChild(drop);
    const cat = document.createElement('select');
    cat.className = 'mkc-cat';
    src.appendChild(cat);
    const libList = el('div', 'mkc-masonry');
    src.appendChild(libList);

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = PICTURE_ACCEPT;
    file.hidden = true;
    _root.appendChild(file);

    // THE SASHES (phase I4, the owner): one between the shelf and the chat, one between the chat and
    // the right column. Each moves the side column's edge; a double click hands the width back.
    const sashL = el('div', 'mkc-sash');
    sashL.title = 'Drag to resize, double-click for the usual width';
    const sashR = el('div', 'mkc-sash');
    sashR.title = sashL.title;

    _root.append(base, sashL, chat, sashR, src);
    host.appendChild(_root);
    _ui = { base, src, chat, baseList, count, thread, atts, ta, go, cat, libList, drop, file };
    _wireSash(sashL, 'base', 1);
    _wireSash(sashR, 'src', -1);
    _applyWidths();
    // The kladka counts its columns from its width: drawn again when that count changes, not on every
    // pixel of a drag, and in the next frame rather than in the middle of one.
    if (window.ResizeObserver) {
      let raf = 0;
      new ResizeObserver(() => {
        if (raf) return;
        // Not while the area is hidden (width 0): it would be drawn in one column and shown so for a frame.
        raf = requestAnimationFrame(() => { raf = 0; if (libList.clientWidth && _colsOf(libList) !== _masonryCols) _paintImages(); });
      }).observe(libList);
    }

    // No "Save image as" on a miniature, and the box keeps its own cut and paste.
    host.addEventListener('contextmenu', (e) => { if (e.target.closest('img')) e.preventDefault(); });

    go.addEventListener('click', () => _send());
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); _send(); }
    });
    ta.addEventListener('input', () => { _grow(); _paintAtts(); _remember(); });
    // A picture pasted into the box is the picture of the message.
    ta.addEventListener('paste', (e) => {
      const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(isPictureFile);
      if (!f) return;
      e.preventDefault();
      _upload(f);
    });
    cat.addEventListener('change', () => { _cat = cat.value; _remember(); _loadImages(); });
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const f = file.files && file.files[0]; file.value = ''; if (f) _upload(f); });
    // A file dropped anywhere on the area.
    _root.addEventListener('dragover', (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); _root.classList.add('is-drag'); }
    });
    _root.addEventListener('dragleave', (e) => { if (!_root.contains(e.relatedTarget)) _root.classList.remove('is-drag'); });
    _root.addEventListener('drop', (e) => {
      _root.classList.remove('is-drag');
      const f = e.dataTransfer && [...(e.dataTransfer.files || [])].find(isPictureFile);
      if (!f) return;
      e.preventDefault();
      _upload(f);
    });

    _recall();
    _grow();
    _paintAtts();
    _paintThread();
  }

  // ── the columns' widths ───────────────────────────────────────────────────
  // Remembered per chat. The chat in the middle keeps at least CHAT_MIN; each side its own bounds.
  const LS_W = 'lib_mkchat_' + kind + '_w_v1';
  const W = { base: { def: 250, min: 150, max: 560 }, src: { def: 280, min: 200, max: 620 } };
  const CHAT_MIN = 360;
  let _w = { base: W.base.def, src: W.src.def };
  try {
    const s = JSON.parse(localStorage.getItem(LS_W) || 'null');
    if (s && typeof s === 'object') for (const k of ['base', 'src']) if (Number.isFinite(+s[k])) _w[k] = +s[k];
  } catch (e) { /* the usual widths */ }

  function _clampW(side, v) {
    const b = W[side];
    let max = b.max;
    // Never so wide that the chat is squeezed below its minimum, whatever the window's width now.
    if (_root && _root.clientWidth) max = Math.min(max, _root.clientWidth - _w[side === 'base' ? 'src' : 'base'] - CHAT_MIN - 12);
    return Math.round(Math.max(b.min, Math.min(Math.max(b.min, max), v)));
  }

  function _applyWidths() {
    if (!_ui.base) return;
    _ui.base.style.flexBasis = _w.base + 'px';
    _ui.src.style.flexBasis = _w.src + 'px';
  }

  // `dir` 1: the column is on the left, dragging right widens it; -1: on the right, dragging left does.
  function _wireSash(sash, side, dir) {
    sash.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const from = e.clientX;
      // From what is DRAWN, not what was remembered: a window made narrower (zoom, a smaller screen)
      // shrinks both side columns below their remembered widths, and starting from those made the
      // edge jump against the drag and the other column spring back (review I4).
      _w.base = Math.round(_ui.base.getBoundingClientRect().width) || _w.base;
      _w.src = Math.round(_ui.src.getBoundingClientRect().width) || _w.src;
      const start = _w[side];
      document.body.classList.add('mkc-resizing');
      sash.classList.add('on');
      const move = (ev) => { _w[side] = _clampW(side, start + dir * (ev.clientX - from)); _applyWidths(); };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('mkc-resizing');
        sash.classList.remove('on');
        try { localStorage.setItem(LS_W, JSON.stringify(_w)); } catch (err) { /* this view only */ }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    sash.addEventListener('dblclick', () => {
      _w[side] = _clampW(side, W[side].def);
      _applyWidths();
      try { localStorage.setItem(LS_W, JSON.stringify(_w)); } catch (err) { /* this view only */ }
    });
  }

  function _grow() {
    const ta = _ui.ta;
    ta.style.height = 'auto';
    ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
  }

  // ── the picture of the next message ───────────────────────────────────────
  function _setAtt(a) {
    _att = a && a.path ? { path: a.path, from: a.from === 'base' ? 'base' : 'photo' } : null;
    _said = '';
    _paintAtts();
    _markOn();
    _remember();
  }

  // Why the message cannot go yet, in words - '' when it can.
  function _why() {
    const t = (_ui.ta ? _ui.ta.value : '').trim();
    if (_sends.filter(s => s.state === 'running').length >= AT_ONCE) return AT_ONCE + ' are being made - wait for one of them';
    // A photo still on its way would be left out of the message (review I).
    if (_uploading) return 'the photo is still being added';
    // The same picture again with nothing typed is a second Enter, not a second wish (review I).
    if (!t && _lastSent && _sameRef(_att, _lastSent)) return 'sent - type the next message, or pick another picture';
    if (!_att) {
      if (!t) return '';
      if (t.length < MIN_WORDS_ALONE) return (MIN_WORDS_ALONE - t.length) + ' more characters, or add a picture';
      if (nonsense(t)) return 'that is not a description';
      return '';
    }
    if (t && nonsense(t)) return 'that is not a description';
    if (kind === 'environments' && _att.from === 'base' && !t) return 'say what to change in this environment';
    return '';
  }

  // The picture in the place, as a cell. When its thumbnail does not come, the file is asked about
  // ITSELF before anything is decided: gone (404) - it leaves the place and the chat says why, a send
  // with it would only be turned down; moved - the place follows it to its new address (the media
  // door redirects a moved file); anything else (a server restarting) - it stays (review I4).
  let _attCell = null;
  function _attCellOf(att) {
    const cell = el('div', 'mkc-att');
    const img = document.createElement('img');
    img.src = thumb(att.path, 'strip');
    img.alt = '';
    const was = att.path;
    img.addEventListener('error', async () => {
      let r = null;
      try { r = await fetch(was, { method: 'HEAD' }); } catch (e) { return; }
      if (!_att || _att.path !== was) return;
      if (r.ok) {
        const now = decodeURI(new URL(r.url, location.href).pathname);
        if (now && now !== was) { _setAtt({ path: now, from: _att.from }); }
        return;
      }
      if (r.status !== 404) return;
      _att = null;
      _said = 'that picture is not in the library any more';
      _paintAtts();
      _markOn();
      _remember();
    });
    cell.appendChild(img);
    cell.appendChild(el('span', 'n', '1'));
    cell.appendChild(el('span', 'tag', att.from === 'base' ? 'base' : 'photo'));
    const x = el('button', 'x', '✕');
    x.type = 'button';
    x.title = 'Not this one';
    x.addEventListener('click', () => _setAtt(null));
    cell.appendChild(x);
    cell.title = att.path.split('/').pop();
    return cell;
  }

  function _paintAtts() {
    const host = _ui.atts;
    if (!host) return;
    host.textContent = '';
    if (_att) {
      // The same picture keeps its cell: the row is painted on every key typed, and a new <img> each
      // time was a new request each time - and a single failed one (a server restarting) dropped the
      // picture (review I4).
      const key = _att.path + '|' + _att.from;
      if (!_attCell || _attCell.key !== key) _attCell = { key, node: _attCellOf(_att) };
      host.appendChild(_attCell.node);
    } else {
      const slot = el('button', 'mkc-slot', '+');
      slot.type = 'button';
      slot.title = 'A photo from this computer - or press one on the left or on the right';
      slot.addEventListener('click', () => _ui.file.click());
      host.appendChild(slot);
    }
    for (let i = 1; i < PLACES; i++) {
      const s = el('button', 'mkc-slot is-later', '+');
      s.type = 'button';
      s.disabled = true;
      s.title = 'One picture per message for now';
      host.appendChild(s);
    }
    const t = (_ui.ta ? _ui.ta.value : '').trim();
    const why = _why();
    const note = el('span', 'mkc-att-note' + (why || _said ? ' is-why' : ''),
      _said || why || ((_att || t) ? sp.hint(_att, t) : 'one picture per message for now'));
    host.appendChild(note);
    _ui.go.disabled = _posting || !!why || (!_att && !t);
  }

  const _sameRef = (a, r) => ((!a || !a.path)
    ? !(r && r.path)
    : !!(r && r.path === a.path && (r.from || 'photo') === a.from));

  // A photo from this computer: into Images first, so the message can point at it for good. Sending
  // waits while one is on its way, and when two are, the newer one is the picture (review I).
  async function _upload(f) {
    if (!isPictureFile(f)) { _say('that file is not a picture'); return; }
    if (f.size > 30 * 1024 * 1024) { _say('that picture is ' + Math.round(f.size / 1048576) + ' MB - the limit is 30'); return; }
    const my = ++_upSeq;
    _uploading++;
    _ui.drop.classList.add('is-busy');
    _say('adding the photo to Images…');
    try {
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(new Error('could not read that file'));
        fr.readAsDataURL(f);
      });
      const d = await post(ADDR + '/photo', { dataUrl, name: f.name || '' });
      _said = '';
      if (my === _upSeq) {
        // The dropdown goes to where it was filed, so the picture just added is in view (phase I4).
        if (d.catId) _cat = String(d.catId);
        _setAtt({ path: d.path, from: 'photo' });
      }
      await _loadImages();
      // And brought into view, wherever the list is (review I4).
      const lit = _ui.libList && _ui.libList.querySelector('.mkc-card.on');
      if (lit && my === _upSeq) lit.scrollIntoView({ block: 'nearest' });
    } catch (e) {
      _said = 'Could not add the photo: ' + e.message;
    } finally {
      _uploading--;
      if (!_uploading) _ui.drop.classList.remove('is-busy');
      _paintAtts();
    }
  }

  function _say(text) {
    _said = text || '';
    _paintAtts();
  }

  // ── sending ───────────────────────────────────────────────────────────────
  async function _send() {
    if (_posting || !_ui.ta) return;
    const text = _ui.ta.value.trim();
    if ((!text && !_att) || _why()) { _paintAtts(); return; }
    _posting = true;
    _said = '';
    _paintAtts();
    const att = _att;
    try {
      const d = await post(ADDR + '/send', { text, ref: att });
      _ui.ta.value = '';
      _grow();
      // The picture stays above the box until it is replaced - by hand, or by the result of this.
      _sends.push(d.send);
      _lastSent = att ? { path: att.path, from: att.from } : { path: '', from: '' };
      _paintThread(true);
      _remember();
      _poll();
    } catch (e) {
      _say(e.message);
    } finally {
      _posting = false;
      _paintAtts();
    }
  }

  // ── the chat ──────────────────────────────────────────────────────────────
  async function _load() {
    try {
      const d = await json(ADDR);
      const before = new Map(_sends.map(s => [s.id, s]));
      _sends = d.sends || [];
      // A picture that has just landed becomes the next base - if the place above the box still holds
      // what that message was sent with (decided by what is there, so a reload does not forget it).
      for (const s of _sends) {
        const was = before.get(s.id);
        if (was && was.state === 'running' && s.state === 'done' && s.result && s.result.path) {
          if (_sameRef(_att, s.ref)) _setAtt({ path: s.result.path, from: 'base' });
          _shelf = null;                           // the left column shows it next
          if (_hooks.landed) _hooks.landed(kind);
        }
      }
      _paintThread();
      _paintAtts();
      if (_shelf === null) _loadBase();
    } catch (e) { /* the server restarting: the next look reads it */ }
    _poll();
  }

  function _poll() {
    clearTimeout(_timer);
    _timer = 0;
    if (!_sends.some(s => s.state === 'running')) return;
    _timer = setTimeout(() => {
      _timer = 0;
      const host = document.getElementById(sp.host);
      if (host && !host.hidden) _load();
    }, POLL_MS);
  }

  const _sig = (s) => s.state === 'running' ? 'run|' + (s.startedAt || '')
    : [s.state, s.result && s.result.path, s.error, s.mode].join('|');

  function _paintThread(toEnd) {
    const host = _ui.thread;
    if (!host) return;
    const atEnd = toEnd || host.scrollTop + host.clientHeight >= host.scrollHeight - 40;
    const ids = new Set(_sends.map(s => s.id));
    for (const [id, n] of _nodes) {
      if (ids.has(id)) continue;
      if (n.prog) n.prog.detach();
      n.user.remove();
      n.agent.remove();
      _nodes.delete(id);
    }
    const empty = host.querySelector('.mkc-empty');
    if (!_sends.length) {
      if (!empty) host.appendChild(el('div', 'mkc-empty', sp.empty));
    } else if (empty) empty.remove();

    for (const s of _sends) {
      let n = _nodes.get(s.id);
      if (!n) {
        n = { user: _userBubble(s), agent: null, sig: '', prog: null };
        host.appendChild(n.user);
        _nodes.set(s.id, n);
      }
      const sig = _sig(s);
      if (n.agent && n.sig === sig) {
        if (s.state === 'running' && n.prog) { n.prog.say(_stageWords(s.stage)); n.away = false; }
        continue;
      }
      // Ended, or running again (a retry from Alerts): the countdown says how it ended and the answer
      // is drawn anew in the same place.
      if (n.prog) {
        // Timed only when it was seen landing: one that landed while the area was hidden would teach the
        // countdown the time it was away (review I).
        if (s.state === 'done' && !n.away) n.prog.finish(); else n.prog.detach();
        n.prog = null;
      }
      const agent = _agentBubble(s, n);
      if (n.agent) n.agent.replaceWith(agent); else n.user.after(agent);
      n.agent = agent;
      n.sig = sig;
    }
    _ui.count.textContent = _sends.length ? 'the last ' + _sends.length + (_sends.length === 1 ? ' message' : ' messages') + ' - thirty are kept' : '';
    if (atEnd) host.scrollTop = host.scrollHeight;
  }

  function _userBubble(s) {
    const b = el('div', 'mkc-msg is-user');
    if (s.text) b.appendChild(el('div', 'mkc-text', s.text));
    if (s.ref && s.ref.path) {
      const r = el('div', 'mkc-msg-ref');
      const img = document.createElement('img');
      img.src = thumb(s.ref.path, 'strip');
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', () => r.classList.add('is-gone'));
      r.appendChild(img);
      r.appendChild(el('span', 'tag', s.ref.from === 'base' ? 'base' : 'photo'));
      r.title = s.ref.path.split('/').pop();
      b.appendChild(r);
    }
    return b;
  }

  function _agentBubble(s, n) {
    const b = el('div', 'mkc-msg is-agent');
    if (s.state === 'running') {
      const ghost = el('div', 'mkc-ghost');
      ghost.style.aspectRatio = sp.aspect.replace(':', '/');
      b.appendChild(ghost);
      const strip = el('div', 'mkc-prog');
      b.appendChild(strip);
      n.prog = startInlineProgress(strip, {
        label: _stageWords(s.stage), key: 'mkc-' + kind, estimateMs: sp.estimateMs,
        startedAt: Date.parse(s.startedAt) || 0,
        onCancel: () => _letGo(s),
      });
      return b;
    }
    if (s.state === 'done' && s.result && s.result.path) {
      const fig = el('div', 'mkc-shot-wrap');
      const img = document.createElement('img');
      img.className = 'mkc-shot';
      img.src = thumb(s.result.path, 'card');
      img.alt = '';
      img.loading = 'lazy';
      img.title = 'Open it large';
      img.style.aspectRatio = sp.aspect.replace(':', '/');
      fig.appendChild(img);
      const acts = el('div', 'mkc-acts');
      const useB = el('button', 'lib-btn', 'use as base');
      useB.type = 'button';
      useB.title = 'Build the next message on it';
      useB.addEventListener('click', () => { _setAtt({ path: s.result.path, from: 'base' }); _ui.ta.focus(); });
      const shelfB = el('button', 'lib-btn', 'show on shelf');
      shelfB.type = 'button';
      shelfB.title = 'Back to the ' + sp.shelf + ' shelf, with this one selected';
      shelfB.addEventListener('click', () => { if (_hooks.showOnShelf) _hooks.showOnShelf(kind, s.result.path); });
      acts.append(useB, shelfB);
      fig.appendChild(acts);
      img.addEventListener('click', () => _view(s));
      // Taken off the shelf since: the chat says so instead of a broken picture, and nothing builds on it.
      img.addEventListener('error', () => {
        _gone.add(s.result.path);
        const gone = el('div', 'mkc-gone', 'not on the shelf any more');
        gone.style.aspectRatio = sp.aspect.replace(':', '/');
        img.replaceWith(gone);
        useB.disabled = true;
        shelfB.disabled = true;
      });
      b.appendChild(fig);
      b.appendChild(_facts(s));
      return b;
    }
    if (s.state === 'refused') {
      b.classList.add('is-said');
      b.appendChild(el('div', 'mkc-text', s.error || 'The agent made nothing of that.'));
      b.appendChild(el('div', 'mkc-note', 'nothing was drawn - say it another way, or add a picture'));
      return b;
    }
    if (s.state === 'cancelled') {
      b.appendChild(el('div', 'mkc-note', 'let go of - ' + (s.error || 'you stopped waiting for it')));
      return b;
    }
    if (s.state === 'lost') {
      b.appendChild(el('div', 'mkc-note', s.error || 'its row is gone from Alerts'));
      return b;
    }
    b.appendChild(el('div', 'mkc-bad', s.error || 'it did not come'));
    b.appendChild(el('div', 'mkc-note', 'Alerts can try it again'));
    return b;
  }

  // What was made of it, folded away: what the agent wrote, how, from what.
  function _facts(s) {
    const r = s.result || {};
    const wrap = el('div', 'mkc-more');
    const btn = el('button', 'mkc-more-b', 'read more');
    btn.type = 'button';
    const body = el('div', 'mkc-more-body');
    body.hidden = true;
    const rows = [
      ['made', sp.modes[s.mode] || s.mode || ''],
      ['gender', r.gender || ''],
      ['about', r.description || ''],
      ['from', r.from ? r.from.split('/').pop() : ''],
      ['prompt', r.prompt || ''],
      ['file', r.path ? r.path.split('/').pop() : ''],
    ];
    for (const [k, v] of rows) {
      if (!v) continue;
      const row = el('div', 'mkc-more-row');
      row.appendChild(el('span', 'k', k));
      row.appendChild(el('span', 'v', v));
      body.appendChild(row);
    }
    btn.addEventListener('click', () => { body.hidden = !body.hidden; btn.textContent = body.hidden ? 'read more' : 'less'; });
    wrap.append(btn, body);
    return wrap;
  }

  // Every picture this chat made, in the Library's viewer, starting on this one.
  function _view(s) {
    const done = _sends.filter(x => x.state === 'done' && x.result && x.result.path && !_gone.has(x.result.path));
    const items = done.map(x => ({
      id: x.result.path.split('/').pop(), name: x.result.path.split('/').pop(), kind,
      media: x.result.path, thumb: x.result.path, meta: {},
    }));
    openViewer(items, Math.max(0, done.findIndex(x => x.id === s.id)), {});
  }

  async function _letGo(s) {
    try { await fetch('/api/alerts/' + encodeURIComponent(s.alertId) + '/cancel', { method: 'POST' }); }
    catch (e) { /* the next read says what happened */ }
    _load();
  }

  // ── the left column: the shelf, small ─────────────────────────────────────
  // A TILE IS A BOX OF ITS OWN SHAPE (phase I4): square for a lookbook, 3:2 for an environment, and the
  // picture fills it, cut at the edges. The shape lives on an inner box, never on the grid's cell: a
  // cell that clips its content may be squeezed by the grid to nothing, and with a long shelf the rows
  // were squeezed under their tiles until each lay over the one above. The columns are as many as fit
  // (css/makechat.css), so a sash dragged reflows them by itself.
  async function _loadBase() {
    try {
      const d = await json('/api/library/shelf/' + kind);
      _shelf = d.items || [];
    } catch (e) {
      _shelf = [];
    }
    _paintBase();
  }

  // A miniature, never the original: the shelf's own copy (thumbs/, 600px) through the thumbnail
  // door, as the Library's grid does - the original only when there is no copy.
  // An Images record's `thumb` is a thumbnail door address already, never a file - for those the
  // picture itself goes through the door (main.js _tileSrc does the same).
  const _mini = (it) => thumb((it.thumb && !String(it.thumb).startsWith('/api/')) ? it.thumb : it.media, 'strip');

  function _tileOf(cls, it, shape) {
    const t = el('button', cls);
    t.type = 'button';
    t.title = it.name || '';
    t.dataset.path = it.media;
    const box = el('span', 'mkc-box');
    if (shape) box.style.aspectRatio = shape;
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = _mini(it);
    box.appendChild(img);
    t.appendChild(box);
    return t;
  }

  function _paintBase() {
    const host = _ui.baseList;
    if (!host) return;
    host.textContent = '';
    if (_shelf === null) { host.appendChild(el('div', 'mkc-none', 'reading the shelf…')); return; }
    if (!_shelf.length) { host.appendChild(el('div', 'mkc-none', 'Nothing on the shelf yet - the first one is made from words or a photo.')); return; }
    for (const it of _shelf) {
      const t = _tileOf('mkc-tile', it, '');
      t.addEventListener('click', () => {
        const on = !!_att && _att.from === 'base' && _att.path === it.media;
        _setAtt(on ? null : { path: it.media, from: 'base' });
      });
      host.appendChild(t);
    }
    _markOn();
  }

  // Which tiles hold the picture of the next message - lit in place, nothing drawn again.
  function _markOn() {
    const mark = (host, from) => {
      if (!host) return;
      for (const t of host.querySelectorAll('[data-path]')) {
        t.classList.toggle('on', !!_att && _att.from === from && _att.path === t.dataset.path);
      }
    };
    mark(_ui.baseList, 'base');
    mark(_ui.libList, 'photo');
  }

  // ── the right column: Images ──────────────────────────────────────────────
  let _imagesErr = '';                               // the last read failed - said instead of "no pictures"
  async function _loadImages() {
    const want = _cat;
    try {
      const d = await json('/api/library/shelf/media?filter=images' + (want ? '&cat=' + encodeURIComponent(want) : ''));
      if (want !== _cat) return;
      _images = d.items || [];
      _cats = d.cats || [];
      _imagesErr = '';
    } catch (e) {
      if (want !== _cat) return;
      // What was there stays; the column says the Library could not be read (review I4).
      _imagesErr = 'could not read the Library - it is asked again when the chat is opened again';
      if (_images === null) _images = [];
    }
    _paintImages();
  }

  // As many columns as tiles of ~120px fit, one at the least.
  const _colsOf = (host) => Math.max(1, Math.min(6, Math.floor(((host && host.clientWidth) || 0) / 126) || 1));

  function _paintImages() {
    const host = _ui.libList;
    if (!host) return;
    const sel = _ui.cat;
    sel.textContent = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'all images';
    sel.appendChild(all);
    for (const c of _cats) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.label || c.name || c.id;
      sel.appendChild(o);
    }
    sel.value = _cat;
    // A remembered category that is not there any more (deleted, or made again under another id) is
    // dropped - once the categories are known - and all of Images read in its place: the answer in
    // hand was for the dead one (review I4).
    if (_images !== null && !_imagesErr && sel.value !== _cat) {
      _cat = '';
      sel.value = '';
      _remember();
      _loadImages();
      return;
    }

    // The scroll is kept only for the same list drawn again (a width change, a reload); another
    // category starts at its top, where the newest is (review I4).
    const top = _paintedCat === _cat ? host.scrollTop : 0;
    _paintedCat = _cat;
    host.textContent = '';
    if (host.clientWidth) _masonryCols = _colsOf(host);
    else if (!_masonryCols) _masonryCols = 2;
    if (_images === null) { host.appendChild(el('div', 'mkc-none', 'reading the Library…')); return; }
    if (_imagesErr && !_images.length) { host.appendChild(el('div', 'mkc-none', _imagesErr)); return; }
    if (!_images.length) { host.appendChild(el('div', 'mkc-none', _cat ? 'Nothing in this folder.' : 'No pictures in the Library\'s Images yet.')); return; }
    // A kladka: each tile its own shape, the next into the shortest column.
    const cols = [];
    const h = [];
    for (let i = 0; i < _masonryCols; i++) { cols.push(el('div', 'mkc-mcol')); h.push(0); }
    for (const it of _images) {
      const m = it.meta || {};
      const sized = m.w > 0 && m.h > 0;
      let k = 0;
      for (let j = 1; j < cols.length; j++) if (h[j] < h[k]) k = j;
      h[k] += sized ? m.h / m.w : 1;
      const t = _tileOf('mkc-card', it, sized ? (m.w + '/' + m.h) : '1/1');
      t.addEventListener('click', () => {
        const on = !!_att && _att.from === 'photo' && _att.path === it.media;
        _setAtt(on ? null : { path: it.media, from: 'photo' });
      });
      cols[k].appendChild(t);
    }
    host.append(...cols);
    host.scrollTop = top;
    _markOn();
  }

  // ── the area's door ───────────────────────────────────────────────────────
  let _opened = false;
  return {
    init(hooks) { _hooks = hooks || {}; },
    async open() {
      _build();
      if (!_opened) {
        _opened = true;
        // Read again whenever something may have changed it from outside: the window comes back, or a
        // row was asked for again from the Alerts list on this page (review I - a failed send has no
        // poll of its own running).
        const again = () => {
          const host = document.getElementById(sp.host);
          if (host && !host.hidden) _load();
        };
        window.addEventListener('focus', again);
        window.addEventListener('ugc:alert-retried', again);
      }
      _shelf = null;
      _paintBase();
      _loadBase();
      // The chat first: its read makes the upload categories, and the dropdown is read after it.
      await _load();
      _loadImages();
      if (_ui.ta) _ui.ta.focus();
    },
    // Hidden, not stopped: what is being made goes on, on the server; the chat shows it on return.
    close() {
      clearTimeout(_timer);
      _timer = 0;
      // A countdown left running while the area is hidden is not timed if it lands meanwhile.
      for (const n of _nodes.values()) if (n.prog) n.away = true;
      _remember();
    },
  };
}

export const environments = createMaker('environments');
export const lookbooks = createMaker('lookbooks');
