/* ═══════════════════════════════════════════════════════════════════════════
   THE CHATS' WINDOWS (phase V64 block 3, the owner 2026-10-31: "будем открывать не вкладки а попапы с чатами генерации";
   (зг4)-(зг7), (зг9)). The pictures chat and the video chat are no views of Merge's Library panel any more: each opens in
   a generation's window over the page (js/gen-window.js openFrame, GEN_SIZE 1280×800, smaller on a smaller screen), as
   the frames chat does since V61 (fchat.js) - its root MOVED into the window while it is open and back to its parking
   place when it closes, so what is typed, attached and waited for is the same nodes. Closing the window hides the chat;
   nothing it asked for stops (the server waits, files, announces in Alerts).

   The chat is a HOSTED one (chat-shell.js `host`): no crumb, no room of the panel, no view remembered per project - the
   window is its owner. Its conversation is the open project's, as before (the store's key; a highlights fragment's is its
   home's). A result dragged out of the window (a picture, a clip, a tile of the right column) lays the window aside until
   it is let go on a lane (`passDrags`, (зг4)); on a highlights project's own timeline the drag says "Open a fragment
   first." (chat-shell.js refuseHome, (зг7)).

     chatWindow({ chat, id, cls, name, title }) -> { open(), close(), isOpen() }
     closeChatWindows()   every chat's window closed - an Alerts row leads to a file in the Library panel behind them
     ensureChatCss()      (phase V64 block 4) the chats' sheets on a page that does not load them (the Library)
       chat    createChat()'s answer - { open, close, isOpen, fit }
       id      its root's element id; made in a parking place of its own when the page has none (the Library, block 4)
       cls     the root's classes beside .mv3-pc ('is-video')
       name    the window's name on the stack of layers
       title   its crumb
   ═══════════════════════════════════════════════════════════════════════════ */

import { openFrame, GEN_SIZE, GEOM_CHAT } from '../gen-window.js';

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

// (phase V64 block 4) The chats' look is Merge's sheets - the Library loads them the first time a chat opens there.
const CHAT_CSS = ['merge-v3.css', 'mv3-imagen.css', 'mv3-catalog.css', 'folder-column.css'];
export function ensureChatCss() {
  const have = new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map(l => String(l.getAttribute('href') || '').split('/').pop()));
  for (const name of CHAT_CSS) {
    if (have.has(name)) continue;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/' + name;
    document.head.appendChild(l);
  }
}

const _all = new Set();
export function closeChatWindows() { for (const w of _all) w.close(); }

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
      // (fix (л)) Moved and stretched; one size and place for every chat's window, kept.
      win = openFrame({ name: o.name, size: GEN_SIZE, geom: GEOM_CHAT, cls: 'is-chatwin', passDrags: true, onClose: park });
      win.setCrumbs([{ label: o.title }]);
      r.removeAttribute('style');
      win.body.appendChild(r);
      if (!ro && window.ResizeObserver) ro = new ResizeObserver(() => { if (isOpen()) o.chat.fit(); });
      if (ro) { ro.disconnect(); ro.observe(r); }
    }
    if (!o.chat.isOpen()) await o.chat.open();
    o.chat.fit();
  }

  const api = { open, close: () => { if (isOpen()) win.close(); }, isOpen };
  _all.add(api);
  return api;
}
