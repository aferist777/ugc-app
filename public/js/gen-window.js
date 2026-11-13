// ════════════════════════════════════════════════════════════════════════════
// THE GENERATORS' WINDOWS. ONE module, opened from anywhere:
//
//   openFrame(o)      a window the almanac's size (860×560) - a generation's GEN_SIZE, 1280×800 - over the page - its head a row of CRUMBS (each but the
//                     last goes back; one may carry a button, "characters / Mute (+ new look)"), its body the caller's;
//                     on the stack of layers (js/layers.js): Escape, its ✕ and a press beside it close it. SEVERAL at
//                     once - one over another (talking head's "who" over "where", wk-setup.js): the one closed shows the
//                     one under it as it was.
//   paintBench(host, o)  THE BENCH of a generator, painted into a window's body: "new environment" or "new lookbook" -
//                     a shelf to draw a base from on the left (its tiles' ✕ pressed twice delete), a field for a photo
//                     and a sentence on the right, `create`. The server decides what the inputs mean (routes/scen3.js
//                     POST /scen3/gen/env, /scen3/gen/lookbook) and files what is made: IMAGES -> Environments /
//                     Lookbooks, the photo in their references.
//   openGenerator(o)  a window holding only the bench - THE SEAM for the Library and Merge's Library panel:
//                       openGenerator({ kind: 'environment' | 'lookbook', where, anchor, onMade, onClose })
//
// THE WINDOW DOES NOT CLOSE BY ITSELF: `create` starts a row of Alerts (the server's - it waits, files, announces)
// and the bench says so on its line ("in Alerts · Drawing the place…"); the person closes the window when they want. A
// row of this bench found running (a reload, a window opened again) is followed to its end (`where.spot` the same).
//
//   o (paintBench / openGenerator):
//     kind       'environment' | 'lookbook'
//     where()    -> { page, href, label, spot } - where a generation is started from, as the Alerts row keeps it
//     onMade(path)        what was made, once it is filed
//     onStart(spec) / onEnd(error)   the work began / ended (talking head's stage half - wk-setup.js)
//     onChange()          the bench painted something new (its window may follow)
//
// Its look is its own (css/gen-window.css, put in once), so a page needs nothing loaded for it.
// ════════════════════════════════════════════════════════════════════════════

import * as Layers from './layers.js';
import * as API from './merge-v3/scen-api.js';
import { derived } from './chars-store.js';
import { isPictureFile, pictureDataUrl, PICTURE_ACCEPT } from './picture-file.js';
import { showPicture, tileMenu, MIN_WORDS_ALONE, nonsense } from './merge-v3/wk-maker.js';
import { delX } from './del-x.js';
import { showError } from './notice.js';
import { emptyEl, loadingEl, failedEl } from './ui-state.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let _css = false;
export function ensureCss() {
  if (_css || document.querySelector('link[data-gw]')) { _css = true; return; }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/gen-window.css';
  l.dataset.gw = '1';
  document.head.appendChild(l);
  _css = true;
}

// ── The frame ───────────────────────────────────────────────────────────────
const W_WIN = 860, H_WIN = 560;            // the almanac's size (js/merge-v3/vhelp.js)
// THE GENERATIONS' WINDOWS - the pictures, video and sound chats, the frames chat, New Character - are this size; a smaller
// screen makes it smaller (openFrame). New environment, New lookbook and New prop are the almanac's size (W_WIN × H_WIN, over
// their place), as are the pickers, the almanac, the viewer and the "who" / "where" windows.
// And it stands in the MIDDLE OF THE SCREEN, its opener's anchor left aside - every one in the same place.
export const GEN_SIZE = Object.freeze({ w: 1280, h: 800 });
// The highlights popup and Home's talking head quick start open at this size, in one column; each keeps its own size and place once moved or stretched.
export const POPUP_SIZE = Object.freeze({ w: 960, h: 670 });
// The chats' windows - pictures, video, sound, frames - are ONE size in ONE place, both the person's and kept.
export const GEOM_CHAT = Object.freeze({ key: 'chat', resize: true, move: true, keepSize: true, keepPos: true });
const _frames = [];                        // open, the top last

// A WINDOW'S OWN SIZE AND PLACE. A window opened with `geom: { key, resize, move, keepSize, keepPos }` is dragged by its head (`move`) and stretched by its edges and
// corners (`resize`); what the person set is kept in the browser under `key` (`keepSize`, `keepPos`) - one key shared by
// several windows makes them one size in one place (the chats: 'chat'). A double press on the head puts the window back to its
// own size, centred, and forgets what was kept. A window without `geom` stays as it opens (New environment / lookbook / prop).
const LS_GEOM = 'gw_geom_v1';
const MIN_W = 520, MIN_H = 340;
function _geomAll() { try { return JSON.parse(localStorage.getItem(LS_GEOM) || '{}') || {}; } catch (e) { return {}; } }
function _geomOf(key) { const g = _geomAll()[key]; return g && typeof g === 'object' ? g : null; }
function _geomPut(key, g) {
  const all = _geomAll();
  if (g) all[key] = g; else delete all[key];
  try { localStorage.setItem(LS_GEOM, JSON.stringify(all)); } catch (e) { /* a private window */ }
}

/**
 * A window over the page. `o`: { name, anchor (an element it stands over), onClose, cls, size, passDrags, geom, foot }.
 *   size  { w, h } - another size than the almanac's (a generation's GEN_SIZE); a smaller screen still makes it smaller
 *   passDrags  a thing of the app dragged out of it lays the windows aside until it is let go (_passing)
 *   geom  { key, resize, move, keepSize, keepPos } - moved by its head, stretched by its edges, kept
 *   foot  true - the frame's foot of 52 px under the body, `win.foot`, filled by the caller: what is
 *         secondary at the left, a `.sp`, then the price and the one gold button at the right
 * The frame is the shared one (css/app-shell.css `.u-win`): a head of 40 px one step lighter, the
 * crumbs at 13 px, the ✕ of 28 px.
 * -> { box, head, crumbs, body, foot, close(), alive(), isTop(), setCrumbs(list) }
 *    setCrumbs([{ label, on?, act?: { label, title, on } }]) - the last is where the window is; the others go back.
 */
export function openFrame(o) {
  ensureCss();
  const ov = el('div', 'gw-ov' + (o.cls ? ' ' + o.cls : ''));
  const box = el('div', 'gw u-win is-float');
  box.setAttribute('role', 'dialog');
  const head = el('div', 'gw-head u-win-head');
  const crumbs = el('div', 'gw-crumbs u-crumbs');
  const x = el('button', 'gw-x u-btn is-icon is-quiet u-x', '');
  x.type = 'button';
  x.title = 'Close (Esc)';
  head.append(crumbs, x);
  const body = el('div', 'gw-body');
  box.append(head, body);
  const foot = o.foot ? el('div', 'gw-wfoot u-win-foot') : null;
  if (foot) box.appendChild(foot);
  ov.appendChild(box);
  document.body.appendChild(ov);
  const G = o.geom && o.geom.key ? o.geom : null;
  let live = null;                         // { x, y, w, h } the person set in this opening
  const place = () => {
    const W = window.innerWidth, H = window.innerHeight, M = 8;
    const sz = o.size || {};
    const kept = G ? _geomOf(G.key) : null;
    let w = +sz.w || W_WIN, h = +sz.h || H_WIN;
    if (live) { w = live.w; h = live.h; } else if (kept && G.keepSize && +kept.w > 0 && +kept.h > 0) { w = +kept.w; h = +kept.h; }
    w = Math.min(w, W - 2 * M);
    h = Math.min(h, H - 2 * M);
    let left, top;
    if (live) { left = live.x; top = live.y; } else if (kept && G.keepPos && kept.x != null && kept.y != null) { left = +kept.x; top = +kept.y; } else {
      // A generation's window (GEN_SIZE) stands in the middle of the screen whatever opened it - the chats, the sound, the generators all in one place.
      const a = o.size !== GEN_SIZE && o.anchor && o.anchor.isConnected ? o.anchor.getBoundingClientRect() : null;
      const cx = a && a.width ? a.left + a.width / 2 : W / 2;
      const cy = a && a.height ? a.top + a.height / 2 : H / 2;
      left = cx - w / 2;
      top = cy - h / 2;
    }
    box.style.width = Math.round(w) + 'px';
    box.style.height = Math.round(h) + 'px';
    box.style.left = Math.round(Math.max(M, Math.min(W - w - M, left))) + 'px';
    box.style.top = Math.round(Math.max(M, Math.min(H - h - M, top))) + 'px';
  };
  place();
  if (G) _wireGeom(box, head, G, place, (g) => { live = g; });
  window.addEventListener('resize', place);
  let open = true;
  const win = {
    box, head, crumbs, body, foot, name: o.name || '',
    alive: () => open,
    isTop: () => open && _frames[_frames.length - 1] === win,
    close: () => {
      if (!open) return;
      open = false;
      const i = _frames.indexOf(win);
      if (i >= 0) _frames.splice(i, 1);
      window.removeEventListener('resize', place);
      Layers.close(layer);
      ov.remove();
      if (typeof o.onClose === 'function') o.onClose();
    },
    setCrumbs: (list) => _crumbs(crumbs, list),
  };
  const layer = Layers.open(ov, { name: o.name || 'window', onEsc: win.close });
  x.addEventListener('click', win.close);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) win.close(); });
  if (o.passDrags) ov.addEventListener('dragstart', _passing);
  _frames.push(win);
  return win;
}

// A window with `passDrags` - the chats'
// - lets a result dragged out of it reach the page: from the moment the drag starts (a tick later - the drag's picture is
// taken first) every window and its darkening are see-through and catch nothing; let go anywhere, or Escape, and they come
// back. Only a drag of this app's own things (`application/x-…`: a picture, a clip, a sound for a lane) - files and words
// dragged inside a window stay the window's.
function _passing(e) {
  if (e.defaultPrevented || !e.dataTransfer) return;
  if (![...e.dataTransfer.types].some(t => /^application\/x-/i.test(t))) return;
  setTimeout(() => {
    for (const ov of document.querySelectorAll('.gw-ov')) ov.classList.add('is-passing');
    document.body.classList.add('gw-passing');
  }, 0);
  const back = () => {
    document.removeEventListener('dragend', back, true);
    document.removeEventListener('drop', later, true);
    for (const ov of document.querySelectorAll('.gw-ov.is-passing')) ov.classList.remove('is-passing');
    document.body.classList.remove('gw-passing');
  };
  // A drop elsewhere ends the drag too; its `dragend` comes after - the window back at the first of them.
  const later = () => setTimeout(back, 0);
  document.addEventListener('dragend', back, true);
  document.addEventListener('drop', later, true);
}

function _crumbs(host, list) {
  host.textContent = '';
  const items = (list || []).filter(Boolean);
  items.forEach((c, i) => {
    if (i) host.appendChild(el('span', 'gw-sep', '/'));
    const last = i === items.length - 1;
    const b = el(last || !c.on ? 'span' : 'button', 'gw-crumb' + (last ? ' is-here' : ''), c.label);
    if (!last && c.on) { b.type = 'button'; b.title = 'Back to ' + c.label; b.addEventListener('click', c.on); }
    host.appendChild(b);
    if (c.act) {
      // a generator's place in the head: the button with the gold line ("+ new look", "+ new environment")
      const a = el('button', 'gw-act u-btn is-s is-gen', c.act.label);
      a.type = 'button';
      if (c.act.title) a.title = c.act.title;
      a.disabled = !!c.act.off;
      a.addEventListener('click', c.act.on);
      host.appendChild(a);
    }
  });
}

/** The frames open now, the top last. */
export const frames = () => _frames.slice();

// Moved by the head and stretched by the edges and corners - what was set kept under the window's key; a double press
// on the head puts it back. `setLive(g)` tells the frame what the person set in this opening (null - none).
function _wireGeom(box, head, G, place, setLive) {
  const M = 8;
  const rectNow = () => { const r = box.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const keep = (g) => {
    const was = _geomOf(G.key) || {};
    const next = Object.assign({}, was);
    if (G.keepSize) { next.w = Math.round(g.w); next.h = Math.round(g.h); }
    if (G.keepPos) { next.x = Math.round(g.x); next.y = Math.round(g.y); }
    if (G.keepSize || G.keepPos) _geomPut(G.key, next);
  };
  const apply = (g) => {
    box.style.left = Math.round(g.x) + 'px';
    box.style.top = Math.round(g.y) + 'px';
    box.style.width = Math.round(g.w) + 'px';
    box.style.height = Math.round(g.h) + 'px';
  };
  const drag = (e, onMove) => {
    e.preventDefault();
    const t = e.currentTarget;
    try { t.setPointerCapture(e.pointerId); } catch (er) { /* not captured: the moves still come while over it */ }
    const x0 = e.clientX, y0 = e.clientY, r0 = rectNow();
    document.body.classList.add('gw-sizing');
    const move = (ev) => apply(onMove(r0, ev.clientX - x0, ev.clientY - y0));
    const up = () => {
      t.removeEventListener('pointermove', move);
      t.removeEventListener('pointerup', up);
      t.removeEventListener('pointercancel', up);
      document.body.classList.remove('gw-sizing');
      const g = rectNow();
      setLive(g);
      keep(g);
    };
    t.addEventListener('pointermove', move);
    t.addEventListener('pointerup', up);
    t.addEventListener('pointercancel', up);
  };
  const W = () => window.innerWidth, H = () => window.innerHeight;
  if (G.move) {
    box.classList.add('is-movable');
    head.title = 'Drag to move · double-click: back to its own size and place';
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target.closest && e.target.closest('button, a, input, select, textarea, .qm'))) return;
      drag(e, (r0, dx, dy) => ({ w: r0.w, h: r0.h,
        x: Math.max(M, Math.min(W() - r0.w - M, r0.x + dx)), y: Math.max(M, Math.min(H() - r0.h - M, r0.y + dy)) }));
    });
  }
  if (G.resize) {
    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const h = el('div', 'gw-rs');
      h.dataset.d = d;
      h.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        drag(e, (r0, dx, dy) => {
          let { x, y, w, h: hh } = r0;
          if (d.includes('e')) w = Math.max(MIN_W, Math.min(W() - M - x, r0.w + dx));
          if (d.includes('s')) hh = Math.max(MIN_H, Math.min(H() - M - y, r0.h + dy));
          if (d.includes('w')) { const nx = Math.max(M, Math.min(r0.x + r0.w - MIN_W, r0.x + dx)); w = r0.w + (r0.x - nx); x = nx; }
          if (d.includes('n')) { const ny = Math.max(M, Math.min(r0.y + r0.h - MIN_H, r0.y + dy)); hh = r0.h + (r0.y - ny); y = ny; }
          return { x, y, w, h: hh };
        });
      });
      box.appendChild(h);
    }
  }
  // A double press on the head (not on its buttons): its own size, centred - and nothing kept.
  head.addEventListener('dblclick', (e) => {
    if (e.target.closest && e.target.closest('button, a, input, select, textarea, .qm')) return;
    setLive(null);
    _geomPut(G.key, null);
    place();
  });
}

// ── The bench ───────────────────────────────────────────────────────────────
const KINDS = {
  environment: {
    what: 'environment', noun: 'environment', title: 'new environment', estimateMs: 120000,
    list: () => API.environments(), meta: () => API.envMeta(), del: 'environments',
    empty: 'a photo from this computer, or pick an environment on the left',
    say: 'What place should it be? With a photo, say what to change - "evening, the lamps on".',
    none: 'No environments yet. The first one is made on the right.',
  },
  lookbook: {
    what: 'lookbook', noun: 'lookbook', title: 'new lookbook', estimateMs: 45000,
    list: () => API.lookbooks(), meta: () => API.lookbookMeta(), del: 'lookbooks',
    empty: 'a photo from this computer, or pick a lookbook on the left',
    say: 'What should it be? With a photo, say what to change - "shoes to white Nike trainers".',
    none: 'No lookbooks yet. The first one is made on the right.',
  },
};
const _blank = () => ({ list: null, loading: false, failed: false, ref: null, base: '', note: '', options: null, optionsWhy: '', picked: new Set(),
  making: false, said: '', status: '', job: null, looked: '' });
const S = { environment: _blank(), lookbook: _blank() };
const _shown = { environment: null, lookbook: null };   // { host, o } - where each bench is painted now

const _pathOf = (p) => String((p && p.path) || p || '');
const _nameOf = (path) => String(path || '').split('/').pop();

/** The work of a bench being waited for - { label, estimateMs, startedAt, spot } - or null. */
export function running(kind) {
  const j = S[kind] && S[kind].job;
  return j ? { label: j.label, estimateMs: j.estimateMs, startedAt: j.startedAt, spot: j.spot } : null;
}

/** The bench of `o.kind`, painted into `host` (a window's body). */
export function paintBench(host, o) {
  ensureCss();
  const kind = KINDS[o.kind] ? o.kind : 'environment';
  _shown[kind] = { host, o };
  if (S[kind].list === null) S[kind].failed = false;   // opened again: read again, "reading…" meanwhile
  _render(kind);
  if (S[kind].list === null) _read(kind);
  _pickUp(kind, o);
}

/** A window of the bench alone. */
export function openGenerator(o) {
  const kind = KINDS[o && o.kind] ? o.kind : 'environment';
  const win = openFrame({ name: KINDS[kind].title, anchor: o.anchor, cls: 'is-gen', onClose: o.onClose });
  win.setCrumbs([{ label: KINDS[kind].title }]);
  paintBench(win.body, Object.assign({}, o, { kind }));
  return win;
}

// A shelf that could not be read is not an empty shelf: "Environments did not load" and Try
// again where its tiles would be, the reason in the corner (js/notice.js). Tiles shown already stay.
function _read(kind) {
  const s = S[kind];
  if (s.loading) return;
  s.loading = true;
  s.failed = false;
  KINDS[kind].list()
    .then((files) => { s.list = files || []; })
    .catch((e) => {
      if (s.list === null) s.failed = true;
      showError('Could not read the ' + KINDS[kind].noun + 's: ' + ((e && e.message) || 'the app did not answer'));
    })
    .finally(() => { s.loading = false; _render(kind); });
}

// A new picture in the field is a new question: what was offered and said about the last one does not carry over.
function _forget(s) {
  s.options = null;
  s.optionsWhy = '';
  s.picked.clear();
  s.said = '';
}

function _mode(kind) {
  const s = S[kind];
  const note = s.note.trim();
  if (kind === 'lookbook') {
    const base = !!(s.ref || s.base);
    if (base && note) return 'edit';
    if (base) return 'extract';
    return note ? 'draw' : '';
  }
  if (s.picked.size) return 'picked';
  if (s.ref) return note ? 'photoWords' : 'photo';
  if (s.base) return note ? 'edit' : '';
  return note ? 'draw' : '';
}

// What stops `create`, in words ('' - nothing does). Twenty characters for words alone.
function _why(kind) {
  const s = S[kind];
  const note = s.note.trim();
  if (kind === 'environment' && s.options && s.options.length && !s.picked.size) return 'pick a place above';
  if (!s.ref && !s.base && !note) return 'a photo or a sentence';
  if (kind === 'environment' && s.base && !s.ref && !note) return 'say what to change';
  if (!s.ref && !s.base) {
    if (note.length < MIN_WORDS_ALONE) return (MIN_WORDS_ALONE - note.length) + ' more characters';
    if (nonsense(note)) return 'that is not a description';
  } else if (note && nonsense(note)) {
    return 'that is not a description';
  }
  return '';
}

const MODE_WORDS = {
  environment: { picked: 'make the place you picked', photoWords: 'read the photo and apply the words', photo: 'take the place out of the photo', edit: 'change this environment', draw: 'draw it from the words' },
  lookbook: { edit: 'read the photo and apply the words', extract: 'take the outfit out of the photo', draw: 'draw it from the words' },
};
const LABELS = {
  environment: { picked: 'Making the place you picked', edit: 'Changing the environment', draw: 'Drawing the place', photo: 'Reading the photo', photoWords: 'Reading the photo' },
  lookbook: { extract: 'Taking the outfit out of the photo', edit: 'Reading the photo and your words', draw: 'Drawing the outfit' },
};

function _render(kind) {
  const sh = _shown[kind];
  if (!sh || !sh.host || !sh.host.isConnected) return;
  const { host, o } = sh;
  const s = S[kind];
  const K = KINDS[kind];
  host.textContent = '';
  host.classList.add('gw-bench');

  // LEFT: the shelf a base is drawn from. What is made joins it, so the pile grows while you work.
  const left = el('div', 'gw-half is-shelf');
  // the shared parts - reading, empty, did not load (js/ui-state.js); `gw-note` is their place here
  if (s.failed) left.appendChild(failedEl(K.noun + 's', () => { s.failed = false; _render(kind); _read(kind); }, { cls: 'gw-note' }));
  else if (s.list === null) left.appendChild(loadingEl('reading the ' + K.noun + 's…', { cls: 'gw-note' }));
  else if (!s.list.length) left.appendChild(emptyEl(K.none, { icon: 'image', cls: 'gw-note' }));
  else {
    const grid = el('div', 'gw-grid is-' + kind);
    for (const p of s.list) {
      const path = _pathOf(p);
      if (!path) continue;
      grid.appendChild(_shelfTile(kind, path, path === s.base && !s.ref, () => {
        s.base = (s.base === path ? '' : path);
        if (s.base) s.ref = null;               // one base, not two
        _forget(s);
        _render(kind);
      }));
    }
    left.appendChild(grid);
  }
  host.appendChild(left);

  // RIGHT: the field, then what was said, the places to pick, the sentence, the line of Alerts and `create`.
  const right = el('div', 'gw-half is-make');
  right.appendChild(_field(kind));
  const foot = el('div', 'gw-foot');
  const said = s.said ? el('div', 'gw-said u-status is-bad', s.said) : null;
  if (said) foot.appendChild(said);
  const go = el('button', 'gw-create u-btn is-main', 'Create');
  go.type = 'button';
  const hint = el('span', 'gw-hint u-status');
  const sync = () => {
    const why = _why(kind);
    go.disabled = !!why || s.making;
    go.textContent = s.making ? 'Making…' : 'Create';
    go.title = why || 'Make it - this spends credits';
    hint.textContent = s.making ? '' : (why || MODE_WORDS[kind][_mode(kind)] || '');
    hint.classList.toggle('is-why', !!why && !s.making);
  };
  if (kind === 'environment' && s.options && s.options.length) {
    const ask = el('div', 'gw-choice');
    ask.appendChild(el('div', 'gw-choice-why', s.optionsWhy || 'There is no place in this picture. What should it become?'));
    const chips = el('div', 'gw-chips');
    for (const opt of s.options) {
      // the shared chip (.u-chip): several may be lit
      const c = el('button', 'gw-chip u-chip' + (s.picked.has(opt) ? ' is-on' : ''), opt);
      c.type = 'button';
      c.title = 'Pick any number of them - they are made into one place';
      c.addEventListener('click', () => {
        if (s.picked.has(opt)) s.picked.delete(opt); else s.picked.add(opt);
        c.classList.toggle('is-on', s.picked.has(opt));
        sync();
      });
      chips.appendChild(c);
    }
    ask.appendChild(chips);
    foot.appendChild(ask);
  }
  const note = el('textarea', 'gw-say u-area');
  note.placeholder = K.say;
  note.value = s.note;
  note.addEventListener('input', () => {
    s.note = note.value;
    // Typing answers whatever was said - it goes without a repaint that would take the cursor out of the field.
    if (said && said.isConnected) { said.remove(); s.said = ''; }
    sync();
  });
  foot.appendChild(note);
  if (s.status) foot.appendChild(el('div', 'gw-status u-status', s.status));
  const row = el('div', 'gw-row');
  go.addEventListener('click', () => _make(kind, o));
  row.append(hint, go);
  foot.appendChild(row);
  sync();
  right.appendChild(foot);
  host.appendChild(right);
  if (typeof o.onChange === 'function') { try { o.onChange(); } catch (e) { /* the caller's */ } }
}

// The field a base picture goes into: empty, a press opens the file picker; holding a picture, a press opens it large; ✕
// takes it off; a file let go on it replaces it.
function _field(kind) {
  const s = S[kind];
  const src = s.ref ? s.ref.dataUrl : (s.base ? derived(s.base, 'card') : '');
  const box = el('div', 'gw-drop' + (src ? ' is-full' : ''));
  box.title = src ? 'Press to look at it large - let another photo go here to replace it' : 'Let a photo go here, or press to choose one from this computer';
  const input = el('input');
  input.type = 'file';
  input.accept = PICTURE_ACCEPT;
  input.hidden = true;
  const take = async (file) => {
    if (!file) return;
    // a refused or unread file is said in the corner (js/notice.js)
    if (!isPictureFile(file)) { showError('That is not a picture'); return; }
    try { s.ref = { name: file.name || 'photo', dataUrl: await pictureDataUrl(file), token: '' }; s.base = ''; _forget(s); }
    catch (e) { showError((e && e.message) || 'The file could not be read'); return; }
    _render(kind);
  };
  input.addEventListener('change', () => take(input.files && input.files[0]));
  if (src) {
    const img = el('img');
    img.alt = '';
    img.src = src;
    box.appendChild(img);
    const clear = el('button', 'gw-dropx u-onpic is-del u-x', '');
    clear.type = 'button';
    clear.title = 'Take it off';
    clear.addEventListener('click', (e) => { e.stopPropagation(); s.ref = null; s.base = ''; _forget(s); _render(kind); });
    box.appendChild(clear);
  } else box.appendChild(el('span', null, KINDS[kind].empty));
  box.addEventListener('click', () => {
    if (!src) { input.click(); return; }
    if (s.ref) showPicture({ src: s.ref.dataUrl, name: s.ref.name });
    else _open(kind, s.base);
  });
  box.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); box.classList.add('is-over'); });
  box.addEventListener('dragleave', () => box.classList.remove('is-over'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove('is-over');
    take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });
  const wrap = el('div', 'gw-fieldwrap');
  wrap.append(box, input);
  return wrap;
}

// One tile of the shelf: picked, the base; its ✕ pressed twice deletes it (an environment a project stands on is refused
// by the server, with the project's name - lib/casting-use.js); its right button opens it large or deletes it.
function _shelfTile(kind, path, on, pick) {
  const tile = el('button', 'gw-tile' + (on ? ' is-on' : ''));
  tile.type = 'button';
  tile.title = _nameOf(path);
  const img = el('img');
  img.alt = '';
  img.loading = 'lazy';
  img.src = derived(path, 'card');
  tile.appendChild(img);
  tile.appendChild(delX({
    host: tile, title: 'Delete this ' + KINDS[kind].noun + ' from the library',
    run: () => _delete(kind, path),
    done: () => _deleted(kind, path),
  }));
  tile.addEventListener('click', pick);
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tileMenu(e, [{ label: 'Open', sub: 'look at it, full size', on: () => _open(kind, path) }], KINDS[kind].noun + ' menu');
  });
  return tile;
}

async function _delete(kind, path) {
  const d = await fetch('/api/library/item/' + KINDS[kind].del + '/' + encodeURIComponent(_nameOf(path)), { method: 'DELETE' })
    .then(r => r.json()).catch(() => null);
  return d && d.success ? '' : ((d && d.error) || 'the app did not answer');
}

async function _deleted(kind, path) {
  const s = S[kind];
  if (s.base === path) { s.base = ''; _forget(s); }
  s.list = await KINDS[kind].list().catch(() => s.list);
  _render(kind);
}

// The viewer the Library uses, with what the agent wrote about it - read at the moment it is opened.
async function _open(kind, path) {
  if (!path) return;
  let meta = {};
  try { meta = ((await KINDS[kind].meta()) || {})[path] || {}; } catch (e) { /* nothing known */ }
  showPicture({ src: path, name: _nameOf(path), rows: [['description', meta.description], ['suits', meta.gender]], from: meta.from });
}

// ── Making it ───────────────────────────────────────────────────────────────
async function _make(kind, o) {
  const s = S[kind];
  const mode = _mode(kind);
  if (!mode || _why(kind) || s.making) return;
  s.making = true;
  s.said = '';
  s.status = 'asking…';
  _render(kind);
  const where = typeof o.where === 'function' ? o.where() : (o.where || null);
  const body = { prompt: s.note.trim(), refName: s.ref ? s.ref.name : '', title: kind === 'environment' ? 'Environment' : 'Lookbook', where };
  if (kind === 'environment') body.choices = [...s.picked];
  if (s.ref) {
    if (s.ref.token) body.refToken = s.ref.token;
    else body.imageBase64 = s.ref.dataUrl;
  } else if (s.base) body.imagePath = s.base;
  if (kind === 'lookbook' && !body.imagePath && !s.ref) body.imagePath = '';
  try {
    const call = kind === 'environment' ? API.makeEnvironment : API.makeLookbook;
    let r;
    try { r = await call(body); }
    catch (e) {
      // The server's copy of the photo has expired: the photo itself goes once more.
      if (!(e && e.gone && s.ref)) throw e;
      s.ref.token = '';
      delete body.refToken;
      body.imageBase64 = s.ref.dataUrl;
      r = await call(body);
    }
    if (s.ref && r.refToken) s.ref.token = r.refToken;
    if (r.choose) {
      // Nothing was made and nothing spent: the agent asks which place - here.
      s.options = r.options || [];
      s.optionsWhy = r.why || '';
      s.picked.clear();
      s.making = false;
      s.status = '';
      _render(kind);
      return;
    }
    _begin(kind, o, LABELS[kind][mode] || 'Making it', Date.now(), where);
    await _follow(kind, r.alertId);
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    s.making = false;
    s.status = '';
    // A refusal of the agent is an answer about what was asked for, and it reads better as that than as an error - it stays
    // on the bench's line; a failure of the press is an error, in the corner.
    if (e && e.refused) s.said = msg;
    else showError('The ' + KINDS[kind].noun + ' failed: ' + msg);
    _end(kind, msg);
    _render(kind);
  }
}

// The work is the server's now: the line says it is in Alerts, the caller's stage may say how far (`onStart`).
function _begin(kind, o, label, startedAt, where) {
  const s = S[kind];
  s.making = true;
  s.job = { label, estimateMs: KINDS[kind].estimateMs, startedAt: startedAt || Date.now(), spot: (where && where.spot) || null,
    onMade: o.onMade, onEnd: o.onEnd };
  s.status = 'in Alerts · ' + label + '…';
  if (typeof o.onStart === 'function') { try { o.onStart(running(kind)); } catch (e) { /* the caller's */ } }
  _render(kind);
}

function _end(kind, error) {
  const s = S[kind];
  const j = s.job;
  s.job = null;
  if (j && typeof j.onEnd === 'function') { try { j.onEnd(error || ''); } catch (e) { /* the caller's */ } }
}

async function _follow(kind, id) {
  const s = S[kind];
  const j = s.job;
  try {
    const rec = await API.follow(id);
    const made = String((rec.result || {}).path || '');
    s.list = await KINDS[kind].list().catch(() => s.list);
    s.base = made || s.base;                  // the next change builds on it
    s.ref = null;
    s.note = '';
    _forget(s);
    s.status = 'in Alerts · done - it is on the left';
    s.making = false;
    _end(kind, '');
    if (made && j && typeof j.onMade === 'function') { try { await j.onMade(made); } catch (e) { /* the caller's */ } }
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    s.making = false;
    s.status = '';
    s.said = 'The ' + KINDS[kind].noun + ' failed: ' + msg;
    _end(kind, msg);
  }
  _render(kind);
}

/** A row of a bench found running by the caller (talking head opened after a reload, wk-setup.js) - followed to its end
 *  with `o` (its `where`, `onStart`, `onEnd`, `onMade`), whether or not its window is open. */
export function adopt(kind, row, o) {
  const s = S[kind];
  if (!s || s.making || !row) return;
  const where = typeof o.where === 'function' ? o.where() : (o.where || null);
  s.looked = _spotKey(where && where.spot);
  _begin(kind, o, 'Making the ' + KINDS[kind].noun, Date.parse(row.startedAt) || 0, where);
  _follow(kind, row.id);
}

// A row of this bench running already - started before a reload, or before the window was closed - is followed to its end.
// Asked once per place it is opened from.
const _spotKey = (spot) => JSON.stringify(spot || null);
function _pickUp(kind, o) {
  const s = S[kind];
  const where = typeof o.where === 'function' ? o.where() : (o.where || null);
  const key = _spotKey(where && where.spot);
  if (s.making || s.looked === key) return;
  s.looked = key;
  API.alerts().then((d) => {
    if (s.making) return;
    const mine = (d.items || []).find(r => r.state === 'running' && r.what === KINDS[kind].what && r.where && _spotKey(r.where.spot) === key);
    if (!mine) return;
    _begin(kind, o, 'Making the ' + KINDS[kind].noun, Date.parse(mine.startedAt) || 0, where);
    _follow(kind, mine.id);
  }).catch(() => { /* without the list the bench simply shows nothing running */ });
}
