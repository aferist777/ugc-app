/* ════════════════════════════════════════════════════════════════════════════
   NOTICES - the corner of popups at the top right, on every page (phase V49.1, the owner's (пр28)-(пр32)).

   One column under the strip (css/app-nav.css .sv3-toasts), the NEWEST ON TOP, FIVE AT MOST - a sixth takes the oldest
   away (one that would go by itself first, so a waiting error is not pushed out by news). Two kinds:

     showError(text, { detail, action: { label, run }, key })
         A refusal or a failure. It STAYS until its ✕ or its button is pressed (the button, where there is somewhere to
         go - "to highlights"); the same error again is the same popup with "×2", brought to the top.
     showToast({ mark, title, where, failed, cls, onClick, act: { label, run }, ms })
         News - a generation ready or failed, a post landed, the app updated (js/alerts-bell.js, js/app-update.js): it
         goes by itself after `ms`, and has a ✕ too. A press on it does `onClick`.

   NOT A LAYER (js/layers.js): Escape never closes one - it keeps clearing the timeline's pick - and neither does a press
   elsewhere or a scroll. Progress and calm news stay where they are said now (the bars' lines); only errors come here.
   The corner stands below the page's own top bars (the strip and the bar under it - Merge's project bar, the Library's), so
   it never covers Export or Upload.
   ════════════════════════════════════════════════════════════════════════════ */

const MAX = 5;
// (phase V73 block 2) The 3D Studio's page keeps its look (б1-13а): its cross keeps the glyph, everywhere else the part draws it.
const OLD_LOOK = () => !!document.querySelector('link[href="css/studio3d.css"]');
const GOING_MS = 300;

const _list = [];            // newest first: { el, key, n, stays, timer, nEl }

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Below the page's own top bars, measured when a popup is shown (a bar may wrap in a narrow window): the strip, and the
// bar under it whose right end has buttons - Merge's project bar (Export), the Library's (Upload, From a link), Home's tabs
// (reset layout), the 3D Studio's.
const BARS = ['.sv3-nav', '.mv3-bar', '.lib-bar', '.hm-sub', '.s3-bar'];
function _place(box) {
  let top = 0;
  for (const sel of BARS) {
    const b = document.querySelector(sel);
    if (!b) continue;
    const r = b.getBoundingClientRect();
    if (r.height > 0 && r.top < 160) top = Math.max(top, r.bottom);
  }
  box.style.top = Math.round((top || 40) + 6) + 'px';
}

function _corner() {
  let box = document.querySelector('.sv3-toasts');
  if (!box) {
    box = _el('div', 'sv3-toasts');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  _place(box);
  return box;
}

function _drop(it) {
  const i = _list.indexOf(it);
  if (i >= 0) _list.splice(i, 1);
  if (it.timer) { clearTimeout(it.timer); it.timer = 0; }
  it.el.remove();
}

function _going(it) {
  if (!it.el.isConnected) { _drop(it); return; }
  it.el.classList.add('is-going');
  setTimeout(() => _drop(it), GOING_MS);
}

// On top of the column, and the column kept to five.
function _putOnTop(it) {
  const box = _corner();
  const i = _list.indexOf(it);
  if (i >= 0) _list.splice(i, 1);
  _list.unshift(it);
  box.insertBefore(it.el, box.firstChild);
  while (_list.length > MAX) {
    let old = null;
    for (let j = _list.length - 1; j > 0; j--) if (!_list[j].stays) { old = _list[j]; break; }
    _drop(old || _list[_list.length - 1]);
  }
}

function _cross(it, title) {
  const x = _el('button', 'sv3-toast-x u-btn is-s is-icon is-quiet u-x', OLD_LOOK() ? '✕' : '');
  x.type = 'button';
  x.title = title || 'Close';
  x.setAttribute('aria-label', x.title);
  x.addEventListener('click', (e) => { e.stopPropagation(); _drop(it); });
  return x;
}

/**
 * A refusal or a failure, in the corner until its ✕ or its button. Returns { close }.
 *   detail   a second, quieter line
 *   action   { label, run } - a button where there is somewhere to go; pressed, it runs and the popup goes
 *   key      what makes two errors "the same" (the text by default)
 */
export function showError(text, opts = {}) {
  const msg = String(text || '').trim();
  if (!msg) return { close() {} };
  const key = String(opts.key || msg);
  const same = _list.find((x) => x.stays && x.key === key && x.el.isConnected);
  if (same) {
    same.n++;
    same.nEl.textContent = '×' + same.n;
    same.nEl.hidden = false;
    _putOnTop(same);
    return { close: () => _drop(same) };
  }
  const el = _el('div', 'sv3-toast is-error');
  el.setAttribute('role', 'alert');
  const it = { el, key, n: 1, stays: true, timer: 0, nEl: null };
  el.appendChild(_el('span', 'sv3-toast-mark', '!'));
  const main = _el('span', 'sv3-al-main');
  const line = _el('span', 'sv3-toast-text', msg);
  it.nEl = _el('b', 'sv3-toast-n');
  it.nEl.hidden = true;
  line.appendChild(it.nEl);
  main.appendChild(line);
  if (opts.detail) main.appendChild(_el('span', 'sv3-toast-detail', String(opts.detail)));
  el.appendChild(main);
  const a = opts.action;
  if (a && a.label && typeof a.run === 'function') {
    const b = _el('button', 'sv3-al-act u-btn is-s', a.label);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      _drop(it);
      try { a.run(); } catch (err) { console.warn('[notice] the button did not work:', (err && err.message) || err); }
    });
    el.appendChild(b);
  }
  el.appendChild(_cross(it));
  _putOnTop(it);
  return { close: () => _drop(it) };
}

/**
 * News that goes by itself (and has a ✕): a generation ready or failed, a post landed, the app updated.
 *   mark, title, where   the sign, the first line, the quieter second line
 *   failed               red, as a failure is
 *   cls                  a class of its own ('is-update')
 *   onClick              a press on it (it goes then)
 *   act                  { label, run } - a button of its own ("open")
 *   acts                 [{ label, title, run }] - several (phase V73: a render's "Open" and "Show in folder"); a press on one
 *                        takes the popup away
 *   ms                   how long it stays (5 s)
 */
export function showToast(o = {}) {
  const el = _el('div', 'sv3-toast' + (o.failed ? ' is-failed' : '') + (o.cls ? ' ' + o.cls : ''));
  const it = { el, key: '', n: 1, stays: false, timer: 0, nEl: null };
  el.appendChild(_el('span', 'sv3-toast-mark', o.mark || '▣'));
  const main = _el('span', 'sv3-al-main');
  main.appendChild(_el('span', 'sv3-al-title', o.title || ''));
  if (o.where) main.appendChild(_el('span', 'sv3-al-where', o.where));
  el.appendChild(main);
  if (o.act && o.act.label && typeof o.act.run === 'function') {
    const b = _el('button', 'sv3-al-act u-btn is-s', o.act.label);
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); o.act.run(); });
    el.appendChild(b);
  }
  for (const a of (Array.isArray(o.acts) ? o.acts : [])) {
    if (!a || !a.label || typeof a.run !== 'function') continue;
    const b = _el('button', 'sv3-al-act u-btn is-s', a.label);
    b.type = 'button';
    if (a.title) b.title = a.title;
    b.addEventListener('click', (e) => { e.stopPropagation(); _drop(it); a.run(); });
    el.appendChild(b);
  }
  if (typeof o.onClick === 'function') {
    el.classList.add('is-link');
    el.addEventListener('click', () => { _drop(it); o.onClick(); });
  }
  el.appendChild(_cross(it));
  _putOnTop(it);
  it.timer = setTimeout(() => { it.timer = 0; _going(it); }, Math.max(1000, +o.ms || 5000));
  return { close: () => _drop(it) };
}

/** How many popups are up, and their texts - for a test. */
export const shown = () => _list.map((x) => ({ text: x.el.textContent, stays: x.stays, n: x.n }));
