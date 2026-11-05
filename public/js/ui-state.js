/* ═══════════════════════════════════════════════════════════════════════════
   EMPTY, LOADING, DID NOT LOAD (phase V73 block 2, step 2b; the owner's (б2-17) а, (б2-19) а) - ONE way for every page to
   say that a body has nothing, is being read, or could not be read. The parts are css/app-shell.css `.u-empty`,
   `.u-loading`, `.u-failed`.

     emptyEl(text, o)          nothing here - the place's own words; o.icon (a Lucide name, 'folder' by default),
                               o.action { label, on } a button under the words, o.line - a row, a strip or a menu: no
                               frame, no icon (б2-17)
     loadingEl(text, o)        being read - a turning icon and the place's words ("Reading the environments…"); o.line
     failedEl(what, retry, o)  could not be read - "<what> did not load" and Try again (retry); the reason is the caller's
                               popup (js/notice.js showError), never a line here (б2-19)
     cap(text)                 the first letter capital ((к17): "reading…" -> "Reading…")
   Every function takes o.cls - the place's own class, kept beside the part for where it sits.
   ═══════════════════════════════════════════════════════════════════════════ */

import { iconEl } from './icons.js';

export const cap = (s) => { const t = String(s == null ? '' : s); return t ? t[0].toUpperCase() + t.slice(1) : t; };

function _box(part, o) {
  const el = document.createElement('div');
  el.className = part + (o.line ? ' is-line' : '') + (o.cls ? ' ' + o.cls : '');
  return el;
}

export function emptyEl(text, o) {
  const opt = o || {};
  const el = _box('u-empty', opt);
  if (!opt.line) el.appendChild(iconEl(opt.icon || 'folder', 20));
  el.appendChild(Object.assign(document.createElement('span'), { textContent: cap(text) }));
  if (opt.action && opt.action.label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'u-btn is-s';
    b.textContent = opt.action.label;
    b.addEventListener('click', (e) => { e.stopPropagation(); opt.action.on(e); });
    el.appendChild(b);
  }
  return el;
}

export function loadingEl(text, o) {
  const opt = o || {};
  const el = _box('u-loading', opt);
  el.setAttribute('role', 'status');
  el.appendChild(iconEl('loader-circle', opt.line ? 14 : 16));
  el.appendChild(Object.assign(document.createElement('span'), { textContent: cap(text || 'Loading') }));
  return el;
}

export function failedEl(what, retry, o) {
  const opt = o || {};
  const el = _box('u-failed', opt);
  el.appendChild(iconEl('circle-alert', opt.line ? 14 : 16));
  el.appendChild(Object.assign(document.createElement('span'), { textContent: cap(what) + ' did not load' }));
  el.appendChild(Object.assign(document.createElement('span'), { className: 'sp' }));
  if (typeof retry === 'function') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'u-btn is-s is-quiet';
    b.appendChild(iconEl('refresh-cw', 14));
    b.appendChild(document.createTextNode('Try again'));
    b.addEventListener('click', (e) => { e.stopPropagation(); retry(e); });
    el.appendChild(b);
  }
  return el;
}
