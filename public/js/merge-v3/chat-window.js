/* ═══════════════════════════════════════════════════════════════════════════
   THE CHATS' WINDOWS. The pictures chat and the video chat each open in a generation's window over the page
   (js/gen-window.js openFrame, GEN_SIZE 1280×800, smaller on a smaller screen), as the frames chat does (fchat.js) - its
   root MOVED into the window while it is open and back to its parking place when it closes, so what is typed, attached and waited for is the same nodes. Closing the window hides the chat;
   nothing it asked for stops (the server waits, files, announces in Alerts).

   The window is the chat's owner (chat-shell.js): no crumb, no room of the panel, no view remembered per project. Its
   conversation is the open project's (the store's key; a highlights fragment's is its home's). A result dragged out of the window (a picture, a clip, a tile of the right column) lays the window aside until
   it is let go on a lane (`passDrags`); on a highlights project's own timeline the drag says "Open a fragment
   first." (chat-shell.js refuseHome).

     chatWindow({ chat, id, cls, name, title }) -> { open(), close(), isOpen(), name }
     closeChatWindows()   every chat's window closed - an Alerts row leads to a file in the Library panel behind them
     ensureChatCss()      the chats' sheets on a page that does not load them (the Library) - a promise
                          of them loaded, so a chat is never shown bare
     openEarly(which) / wanted(which) / dropEarly(which)   a page loading a chat at its first press (Home, the Library)
                          shows the chat's window at once, "loading…" in it, and the chat's open() takes it - below
       chat    createChat()'s answer - { open, close, isOpen, fit }
       id      its root's element id; made in a parking place of its own when the page has none (the Library)
       cls     the root's classes beside .mv3-pc ('is-video')
       name    the window's name on the stack of layers
       title   its crumb
   ═══════════════════════════════════════════════════════════════════════════ */

import { openFrame, GEN_SIZE, GEOM_CHAT } from '../gen-window.js';
import { loadingEl } from '../ui-state.js';

// Where a chat's root waits while its window is closed: in the document (the chat finds its root by its id when it hides
// and when it is built), never seen.
function _parking() {
  let p = document.getElementById('mv3-chat-park');
  if (!p) {
    p = document.createElement('div');
    p.id = 'mv3-chat-park';
    p.hidden = true;
    document.body.appendChild(p);
  }
  return p;
}

// The chats' look is Merge's sheets - the Library loads them the first time a chat opens there.
const CHAT_CSS = ['merge-v3.css', 'mv3-imagen.css', 'folder-column.css'];
const _cssIn = new Map();     // a sheet put in here -> a promise of it loaded (or failed)
export function ensureChatCss() {
  const have = new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map(l => String(l.getAttribute('href') || '').split('/').pop()));
  return Promise.all(CHAT_CSS.map((name) => {
    if (_cssIn.has(name)) return _cssIn.get(name);
    if (have.has(name)) return null;      // the page's own, or put in and waited for by its page (Home's windows.js)
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/' + name;
    const p = new Promise((res) => { l.onload = l.onerror = () => res(); });
    document.head.appendChild(l);
    _cssIn.set(name, p);
    return p;
  }));
}

const _all = new Set();
export function closeChatWindows() { for (const w of _all) w.close(); }

// A chat's frame: moved and stretched; one size and place for every chat's window, kept.
function _frame(name, title, onClose) {
  const win = openFrame({ name, size: GEN_SIZE, geom: GEOM_CHAT, cls: 'is-chatwin', passDrags: true, onClose });
  win.setCrumbs([{ label: title }]);
  return win;
}

// A page that loads a chat at its first press (Home, the Library) shows the chat's window AT ONCE - the same frame - with
// "loading…" in it; the chat's open() takes that frame when its sheets, modules and conversation are in. Closed meanwhile (✕, Escape, a press beside it),
// it is gone and the page opens nothing later (wanted()); pressed again meanwhile, the one window stays.
// The two chats' names and titles - picchat.js and vidchat.js take theirs from here, so the early window is always theirs.
export const CHAT_WIN = { pictures: { name: 'pictures chat', title: 'generate image' }, videos: { name: 'video chat', title: 'generate video' } };
const EARLY = CHAT_WIN;
const _early = new Map();     // a window's name -> { win, park } - shown, not taken by its chat yet
const _shown = (name) => [..._all].some(w => w.name === name && w.isOpen());

/** The window of the chat `which` ('pictures' | 'videos') at once - nothing when it is open already. */
export function openEarly(which) {
  const E = EARLY[which];
  if (!E || _shown(E.name)) return;
  const was = _early.get(E.name);
  if (was && was.win.alive()) return;
  const rec = { win: null, park: null };
  rec.win = _frame(E.name, E.title, () => {
    if (_early.get(E.name) === rec) _early.delete(E.name);
    if (rec.park) rec.park();
  });
  rec.win.body.appendChild(loadingEl('loading…', { cls: 'gw-wait' }));
  _early.set(E.name, rec);
}
/** Whether the chat loaded is still to be opened: its early window is open, or its own. */
export function wanted(which) {
  const E = EARLY[which];
  if (!E) return false;
  const e = _early.get(E.name);
  return !!(e && e.win.alive()) || _shown(E.name);
}
/** The chat did not load: its early window closed. */
export function dropEarly(which) {
  const e = EARLY[which] && _early.get(EARLY[which].name);
  if (e) e.win.close();
}

export function chatWindow(o) {
  let win = null;
  let ro = null;
  let rootEl = null;
  // The node itself, held: the window takes its overlay off the page before it says it closed, and the root with it.
  const root = () => {
    if (rootEl) return rootEl;
    rootEl = document.getElementById(o.id);
    if (!rootEl) {
      rootEl = document.createElement('div');
      rootEl.id = o.id;
      rootEl.className = 'mv3-pc' + (o.cls ? ' ' + o.cls : '');
      _parking().appendChild(rootEl);
    }
    return rootEl;
  };
  const isOpen = () => !!(win && win.alive());

  // The window gone (its ✕, Escape, a press beside it, or close()): the root back to its parking place first - the chat
  // finds it by its id as it hides -, then the chat hides.
  function park() {
    if (ro) ro.disconnect();
    _parking().appendChild(root());
    o.chat.close();
    win = null;
  }

  /** The window, over everything open; opened again while open, it stays as it is. */
  async function open() {
    const r = root();
    if (!isOpen()) {
      // Its early window showing "loading…" is taken as it is; else a frame of its own.
      const e = _early.get(o.name);
      if (e && e.win.alive()) {
        _early.delete(o.name);
        e.park = park;
        win = e.win;
        win.body.textContent = '';
      } else win = _frame(o.name, o.title, park);
      r.removeAttribute('style');
      win.body.appendChild(r);
      if (!ro && window.ResizeObserver) ro = new ResizeObserver(() => { if (isOpen()) o.chat.fit(); });
      if (ro) { ro.disconnect(); ro.observe(r); }
    }
    if (!o.chat.isOpen()) await o.chat.open();
    o.chat.fit();
  }

  const api = { open, close: () => { if (isOpen()) win.close(); }, isOpen, name: o.name };
  _all.add(api);
  return api;
}
