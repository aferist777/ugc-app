// A NAME, ASKED FOR IN THE PAGE (phase D6, 2026-09-29).
//
// window.prompt() does not exist in the app's window: Electron throws "prompt() is not supported."
// So everything that asked for a name with it - a rename in the Library, a new or renamed category,
// a new Merge project - asks here instead: a small box beside whatever was pressed (in the middle
// of the window when nothing was), on the layer stack (js/layers.js), so Escape closes this box and
// not the viewer or the window it sits over. Enter confirms; a press anywhere else cancels.
//
//   askName({ anchor, title, value, select, placeholder, okLabel, maxLength, check, submit })
//     -> Promise: what `submit` returned (the name itself without one), or null when cancelled
//
//   check(name)   optional, synchronous: a sentence saying why not, or '' - said in the box,
//                 which stays open for another try
//   submit(name)  optional, async: does the work while the box waits; a throw is said in the
//                 box the same way, and the box stays open
//
// One box at a time: opening a second one cancels the first.
//
// (phase V73 block 2, (б2-8)) The shared question's look (`.u-ask.is-float`, css/app-shell.css) with the shared field and
// buttons: Cancel LEFT, the verb right. The 3D Studio's page keeps its old look and order.

import * as Layers from './layers.js';

const OLD_LOOK = () => !!document.querySelector('link[href="css/studio3d.css"]');

let _box = null;

function _close(result) {
  if (!_box) return;
  const b = _box;
  _box = null;
  b.el.remove();
  document.removeEventListener('mousedown', b.away, true);
  Layers.close(b.layer);
  b.resolve(result);
}

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Under the anchor, its right edges lined up, and above it when there is no room below. Without an
// anchor - a rename asked for by the viewer's action row - in the middle of the window.
function _place(el, anchor) {
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!anchor || !anchor.isConnected) {
    el.style.left = Math.round((window.innerWidth - w) / 2) + 'px';
    el.style.top = Math.round(Math.max(8, window.innerHeight * 0.3 - h / 2)) + 'px';
    return;
  }
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))) + 'px';
  const below = r.bottom + 6;
  el.style.top = Math.round(below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6)) + 'px';
}

export function askName(opts) {
  const o = opts || {};
  _close(null);
  return new Promise((resolve) => {
    const el = _el('div', 'nm-box u-ask is-float');
    el.appendChild(_el('b', 'nm-t', o.title || 'Name'));
    const inp = _el('input', 'nm-in u-in');
    inp.type = 'text';
    inp.value = o.value || '';
    inp.placeholder = o.placeholder || 'Name';
    inp.maxLength = o.maxLength || 120;
    inp.spellcheck = false;
    const err = _el('div', 'nm-err');
    const row = _el('div', 'nm-r u-ask-r');
    const ok = _el('button', 'nm-b is-ok u-btn is-s is-main', o.okLabel || 'OK');
    ok.type = 'button';
    const no = _el('button', 'nm-b u-btn is-s', 'Cancel');
    no.type = 'button';
    if (OLD_LOOK()) row.append(ok, no); else row.append(no, ok);
    el.append(inp, err, row);
    document.body.appendChild(el);
    _place(el, o.anchor);
    inp.focus();
    // A name to replace is selected; a start to go on from (`select: false` - "2026-09-29 - ") keeps
    // the caret at its end.
    if (o.select === false) inp.setSelectionRange(inp.value.length, inp.value.length);
    else inp.select();

    let busy = false;
    const go = async () => {
      if (busy) return;                                   // a second Enter while it is working
      const name = inp.value.trim();
      if (!name) { err.textContent = 'Give it a name.'; inp.focus(); return; }
      const why = typeof o.check === 'function' ? (o.check(name) || '') : '';
      if (why) { err.textContent = why; inp.select(); return; }
      if (typeof o.submit !== 'function') { _close(name); return; }
      ok.disabled = true;
      busy = true;
      err.textContent = '';
      try {
        const result = await o.submit(name);
        // Cancelled while it was working: the answer belongs to this box, not to one opened since.
        if (!el.isConnected) return;
        _close(result === undefined ? name : result);
      } catch (e) {
        if (!el.isConnected) return;
        err.textContent = (e && e.message) || String(e);
        ok.disabled = false;
        inp.focus();
      } finally { busy = false; }
    };
    ok.addEventListener('click', go);
    no.addEventListener('click', () => _close(null));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const away = (e) => { if (!el.contains(e.target)) _close(null); };
    const layer = Layers.open(el, { name: o.title || 'name', onEsc: () => _close(null) });
    _box = { el, away, layer, resolve };
    document.addEventListener('mousedown', away, true);
  });
}
