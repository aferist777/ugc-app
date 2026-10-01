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
    placeholder: 'Describe a place - or pick a picture and say what to change: "evening, the lamps on"',
    empty: 'Describe a place to make it from words. Press one on the left to change it, or take a photo from the right - from this computer or the Library\'s Images - and the place is taken out of it. Everything made here stays in this chat and on the Environments shelf.',
    hint: (att, text) => !att ? 'drawn from your words'
      : att.from === 'base' ? (text ? 'this environment, changed as you say' : 'say what to change in this environment')
        : (text ? 'the place taken out of the photo, and your words applied' : 'the place taken out of the photo'),
    modes: { photo: 'the place taken out of a photo', edit: 'an environment changed', draw: 'drawn from words', picked: 'a place picked for a picture' },
  },
  lookbooks: {
    host: 'lib-lbmake', title: 'New lookbook', shelf: 'Lookbooks', aspect: '1:1', estimateMs: 45000,
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
  let _attAt = 0;                                   // when the place above the box last changed
  let _posting = false;
  let _shelf = null;                                // the base tiles
  let _src = 'computer';                            // the right column: 'computer' | 'library'
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
      localStorage.setItem(LS, JSON.stringify({ text: _ui.ta ? _ui.ta.value : '', att: _att, src: _src, cat: _cat }));
    } catch (e) { /* this view only */ }
  }
  function _recall() {
    let w = null;
    try { w = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { w = null; }
    if (!w) return;
    if (_ui.ta && typeof w.text === 'string') _ui.ta.value = w.text;
    if (w.att && typeof w.att.path === 'string' && w.att.path.startsWith('/')) _att = { path: w.att.path, from: w.att.from === 'base' ? 'base' : 'photo' };
    if (w.src === 'library' || w.src === 'computer') _src = w.src;
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

    const src = el('section', 'mkc-col mkc-src');
    const sh = el('div', 'mkc-head');
    const tabs = el('div', 'mkc-tabs');
    const tComp = el('button', 'mkc-tab', 'computer');
    tComp.type = 'button';
    tComp.title = 'A photo from this computer - it goes into the Library\'s Images, under ' + (kind === 'environments' ? 'uploads_environments' : 'uploads_lookbooks');
    const tLib = el('button', 'mkc-tab', 'library');
    tLib.type = 'button';
    tLib.title = 'A picture already in the Library\'s Images';
    tabs.append(tComp, tLib);
    sh.appendChild(tabs);
    src.appendChild(sh);
    const comp = el('div', 'mkc-comp');
    const drop = el('button', 'mkc-drop');
    drop.type = 'button';
    drop.appendChild(el('span', 'mkc-drop-plus', '+'));
    drop.appendChild(el('span', 'mkc-drop-t', 'a photo from this computer'));
    drop.appendChild(el('span', 'mkc-drop-s', 'click, drop it here, or paste it into the message box'));
    comp.appendChild(drop);
    src.appendChild(comp);
    const lib = el('div', 'mkc-lib');
    const cat = document.createElement('select');
    cat.className = 'mkc-cat';
    lib.appendChild(cat);
    const libList = el('div', 'mkc-masonry');
    lib.appendChild(libList);
    src.appendChild(lib);

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    _root.appendChild(file);

    _root.append(base, chat, src);
    host.appendChild(_root);
    _ui = { baseList, count, thread, atts, ta, go, tComp, tLib, comp, lib, cat, libList, drop, file };

    // No "Save image as" on a miniature, and the box keeps its own cut and paste.
    host.addEventListener('contextmenu', (e) => { if (e.target.closest('img')) e.preventDefault(); });

    go.addEventListener('click', () => _send());
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); _send(); }
    });
    ta.addEventListener('input', () => { _grow(); _paintAtts(); _remember(); });
    // A picture pasted into the box is the picture of the message.
    ta.addEventListener('paste', (e) => {
      const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(x => /^image\//.test(x.type || ''));
      if (!f) return;
      e.preventDefault();
      _upload(f);
    });
    tComp.addEventListener('click', () => { _src = 'computer'; _paintSrc(); _remember(); });
    tLib.addEventListener('click', () => { _src = 'library'; _paintSrc(); _remember(); });
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
      const f = e.dataTransfer && [...(e.dataTransfer.files || [])].find(x => /^image\//.test(x.type || ''));
      if (!f) return;
      e.preventDefault();
      _upload(f);
    });

    _recall();
    _grow();
    _paintSrc();
    _paintAtts();
    _paintThread();
  }

  function _grow() {
    const ta = _ui.ta;
    ta.style.height = 'auto';
    ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
  }

  // ── the picture of the next message ───────────────────────────────────────
  function _setAtt(a) {
    _att = a && a.path ? { path: a.path, from: a.from === 'base' ? 'base' : 'photo' } : null;
    _attAt = Date.now();
    _said = '';
    _paintAtts();
    _paintBase();
    _paintImages();
    _remember();
  }

  // Why the message cannot go yet, in words - '' when it can.
  function _why() {
    const t = (_ui.ta ? _ui.ta.value : '').trim();
    if (_sends.filter(s => s.state === 'running').length >= AT_ONCE) return AT_ONCE + ' are being made - wait for one of them';
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

  function _paintAtts() {
    const host = _ui.atts;
    if (!host) return;
    host.textContent = '';
    if (_att) {
      const cell = el('div', 'mkc-att');
      const img = document.createElement('img');
      img.src = thumb(_att.path, 'strip');
      img.alt = '';
      img.addEventListener('error', () => cell.classList.add('is-gone'));
      cell.appendChild(img);
      cell.appendChild(el('span', 'n', '1'));
      cell.appendChild(el('span', 'tag', _att.from === 'base' ? 'base' : 'photo'));
      const x = el('button', 'x', '✕');
      x.type = 'button';
      x.title = 'Not this one';
      x.addEventListener('click', () => _setAtt(null));
      cell.appendChild(x);
      cell.title = _att.path.split('/').pop();
      host.appendChild(cell);
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

  // A photo from this computer: into Images first, so the message can point at it for good.
  async function _upload(f) {
    if (!/^image\//.test(f.type || '')) { _say('that file is not a picture'); return; }
    if (f.size > 30 * 1024 * 1024) { _say('that picture is ' + Math.round(f.size / 1048576) + ' MB - the limit is 30'); return; }
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
      _setAtt({ path: d.path, from: 'photo' });
      if (_src === 'library') _loadImages();
      else _images = null;                         // read again when the library side is opened
    } catch (e) {
      _say('Could not add the photo: ' + e.message);
    } finally {
      _ui.drop.classList.remove('is-busy');
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
      _sends.push({ ...d.send, _sentAtt: _attAt });
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
      _sends = (d.sends || []).map(s => ({ ...s, _sentAtt: (before.get(s.id) || {})._sentAtt }));
      // A picture that has just landed becomes the next base - if nobody touched the place above the
      // box since it was sent.
      for (const s of _sends) {
        const was = before.get(s.id);
        if (was && was.state === 'running' && s.state === 'done' && s.result && s.result.path) {
          if (s._sentAtt != null && s._sentAtt === _attAt) _setAtt({ path: s.result.path, from: 'base' });
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
        if (s.state === 'running' && n.prog) n.prog.say(_stageWords(s.stage));
        continue;
      }
      // Ended, or running again (a retry from Alerts): the countdown says how it ended and the answer
      // is drawn anew in the same place.
      if (n.prog) {
        if (s.state === 'done') n.prog.finish(); else n.prog.detach();
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
  async function _loadBase() {
    try {
      const d = await json('/api/library/shelf/' + kind);
      _shelf = d.items || [];
    } catch (e) {
      _shelf = [];
    }
    _paintBase();
  }

  function _paintBase() {
    const host = _ui.baseList;
    if (!host) return;
    host.textContent = '';
    if (_shelf === null) { host.appendChild(el('div', 'mkc-none', 'reading the shelf…')); return; }
    if (!_shelf.length) { host.appendChild(el('div', 'mkc-none', 'Nothing on the shelf yet - the first one is made from words or a photo.')); return; }
    for (const it of _shelf) {
      const on = !!_att && _att.from === 'base' && _att.path === it.media;
      const t = el('button', 'mkc-tile' + (on ? ' on' : ''));
      t.type = 'button';
      t.title = it.name || '';
      const img = document.createElement('img');
      img.src = thumb(it.media, 'strip');
      img.alt = '';
      img.loading = 'lazy';
      t.appendChild(img);
      t.addEventListener('click', () => _setAtt(on ? null : { path: it.media, from: 'base' }));
      host.appendChild(t);
    }
  }

  // ── the right column: where else a picture comes from ─────────────────────
  function _paintSrc() {
    if (!_ui.tComp) return;
    _ui.tComp.classList.toggle('on', _src === 'computer');
    _ui.tLib.classList.toggle('on', _src === 'library');
    _ui.comp.hidden = _src !== 'computer';
    _ui.lib.hidden = _src !== 'library';
    if (_src === 'library' && _images === null) _loadImages();
  }

  async function _loadImages() {
    const want = _cat;
    try {
      const d = await json('/api/library/shelf/media?filter=images' + (want ? '&cat=' + encodeURIComponent(want) : ''));
      if (want !== _cat) return;
      _images = d.items || [];
      _cats = d.cats || [];
    } catch (e) {
      _images = [];
    }
    _paintImages();
  }

  function _paintImages() {
    const host = _ui.libList;
    if (!host || _src !== 'library') return;
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
    if (sel.value !== _cat) { _cat = ''; sel.value = ''; }

    host.textContent = '';
    if (_images === null) { host.appendChild(el('div', 'mkc-none', 'reading the Library…')); return; }
    if (!_images.length) { host.appendChild(el('div', 'mkc-none', _cat ? 'Nothing in this category.' : 'No pictures in the Library\'s Images yet.')); return; }
    // Two columns, each tile its own shape, the next into the shorter one.
    const cols = [el('div', 'mkc-mcol'), el('div', 'mkc-mcol')];
    const h = [0, 0];
    for (const it of _images) {
      const m = it.meta || {};
      const r = (m.w > 0 && m.h > 0) ? m.h / m.w : 1;
      const k = h[0] <= h[1] ? 0 : 1;
      h[k] += r;
      const on = !!_att && _att.from === 'photo' && _att.path === it.media;
      const t = el('button', 'mkc-card' + (on ? ' on' : ''));
      t.type = 'button';
      t.title = it.name || '';
      t.style.aspectRatio = (m.w > 0 && m.h > 0) ? (m.w + '/' + m.h) : '1/1';
      const img = document.createElement('img');
      img.src = thumb(it.media, 'card');
      img.alt = '';
      img.loading = 'lazy';
      t.appendChild(img);
      t.addEventListener('click', () => _setAtt(on ? null : { path: it.media, from: 'photo' }));
      cols[k].appendChild(t);
    }
    host.append(...cols);
  }

  // ── the area's door ───────────────────────────────────────────────────────
  let _opened = false;
  return {
    init(hooks) { _hooks = hooks || {}; },
    async open() {
      _build();
      if (!_opened) {
        _opened = true;
        window.addEventListener('focus', () => {
          const host = document.getElementById(sp.host);
          if (host && !host.hidden) _load();
        });
      }
      _shelf = null;
      _paintBase();
      _loadBase();
      if (_src === 'library') _loadImages();
      await _load();
      if (_ui.ta) _ui.ta.focus();
    },
    // Hidden, not stopped: what is being made goes on, on the server; the chat shows it on return.
    close() {
      clearTimeout(_timer);
      _timer = 0;
      _remember();
    },
  };
}

export const environments = createMaker('environments');
export const lookbooks = createMaker('lookbooks');
