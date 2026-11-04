/* ════════════════════════════════════════════════════════════════════════════
   THE INTERFACE SHOWCASE /lab/ui (phase V73 block 1, the owner 2026-11-04, (к11а), (б1-5)).

   One page that shows every part in the new look (css/ui-v73.css, only under .ui-v73) before it goes onto the pages.
   This module only fills it: the icons (js/icons.js), the swatches and the type rows, and the few things a part does
   when pressed - tabs, chips, toggles, sliders with their units, the menu, the question at its button, "Really?" by
   two presses, the window over the page (on the layer stack, js/layers.js, so Escape closes the top one). Nothing is
   asked of the server.
   ════════════════════════════════════════════════════════════════════════════ */
import { icon, ICON_NAMES } from './icons.js';
import * as Layers from './layers.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ── icons: <i data-ico="x"> becomes the svg; a button with data-ico gets it as its content ──────────
function paintIcons(root = document) {
  for (const n of $$('[data-ico]', root)) {
    const size = +n.dataset.size || 16;
    const svg = icon(n.dataset.ico, size);
    if (n.tagName === 'I') n.outerHTML = svg;
    else n.insertAdjacentHTML('afterbegin', svg);
  }
}

// ── the swatches: every colour token with its value ───────────────────────────────────────────────
const SWATCHES = [
  ['--bg-deep', '#0a0a0b', 'around the frame'], ['--bg', '#0f0f10', 'the base, the gap'], ['--surface', '#19191b', 'panel, window'],
  ['--surface-2', '#232325', 'raised: field, head'], ['--surface-3', '#2c2c2f', 'hover on raised'],
  ['--ink', '#ededed', 'main text'], ['--muted', '#a1a1a6', 'second text'], ['--faint', '#85858b', 'quiet: counts, meta'],
  ['--border-soft', 'text at 8 %', 'the hairline'], ['--border', 'text at 12 %', "a control's edge"],
  ['--gold', 'oklch(.78 .12 85)', 'main button, generators, your move'], ['--gold-hover', 'oklch(.83 .12 85)', 'main button hovered'],
  ['--gold-soft', 'gold at 14 %', 'found in the text'], ['--warn', '= --gold', 'look here'],
  ['--danger', 'oklch(.66 .15 25)', 'delete, error'], ['--danger-fill', 'oklch(.55 .17 25)', 'armed delete'],
  ['--success', 'oklch(.74 .13 158)', 'done, on'], ['--sel-bg', 'text at 9 %', 'selected: a step'],
  ['--sel-line', 'text at 24 %', 'selected: a line'], ['--focus', 'text at 70 %', 'keyboard focus'],
  ['--scrim', 'black at 60 %', 'under marks on pictures'],
];
function paintSwatches() {
  const box = $('#lab-swatches');
  for (const [name, value, role] of SWATCHES) {
    const s = el('div', 'lab-swatch');
    const c = el('div');
    // a line is shown as a line on a panel; every other token as a fill
    if (name === '--border-soft' || name === '--border' || name === '--sel-line') {
      c.style.background = 'var(--surface)';
      c.style.boxShadow = 'inset 0 0 0 1px var(' + name + ')';
    } else {
      c.style.background = 'var(' + name + ')';
    }
    s.append(c, el('b', null, name), el('span', null, value + ' · ' + role));
    box.append(s);
  }
}

// ── the type: seven sizes (and 8 for the timeline's clip labels only) in three weights ─────────────
const SIZES = [[20, 'Page title'], [15, 'A window or panel title'], [13, 'Body text, the window name'], [12, 'Buttons, fields, tabs'],
  [11, 'Second text, menu rows'], [10, 'Field labels'], [9, 'Small counts'], [8, 'Timeline clip labels only']];
function paintType() {
  const box = $('#lab-type');
  for (const [px, use] of SIZES) {
    box.append(el('span', 'u-mono', px + '/' + parseInt(getComputedStyle(document.body).getPropertyValue('--lh-' + px), 10)));
    const row = el('div');
    row.style.fontSize = px + 'px';
    row.style.lineHeight = 'var(--lh-' + px + ')';
    const w = [400, 500, 600];
    w.forEach((fw, i) => {
      const s = el('span', null, i === 0 ? use : i === 1 ? ' · Main video' : ' · Видео из 16 строк');
      s.style.fontWeight = fw;
      row.append(s);
    });
    const f = el('em', 'u-mono', ' 0:12.4');
    row.append(f);
    box.append(row);
  }
}

// ── tiles with the favourite star ─────────────────────────────────────────────────────────────────
const TILES = [['havana-bloom', 'Havana bloom', '0:06', true, false], ['kyoto-ink', 'Kyoto ink', '0:04', false, true],
  ['nordic-frost', 'Nordic frost', '0:10', false, true], ['sahel-gold', 'Sahel gold', '0:05', true, false], ['seoul-neon', 'Seoul neon', '0:08', false, false]];
function paintTiles() {
  const box = $('#lab-tiles');
  for (const [f, name, dur, fav, picked] of TILES) {
    const t = el('div', 'u-tile' + (picked ? ' is-picked' : ''));
    const p = el('div', 'u-tile-pic');
    const img = el('img'); img.src = '/presets/' + f + '.jpg'; img.alt = '';
    const star = el('button', 'u-onpic is-star' + (fav ? ' is-fav' : '')); star.type = 'button'; star.title = fav ? 'Favourite' : 'Make it a favourite';
    star.innerHTML = icon('star', 14);
    star.addEventListener('click', (e) => { e.stopPropagation(); star.classList.toggle('is-fav'); });
    const x = el('button', 'u-onpic is-x'); x.type = 'button'; x.title = 'Delete'; x.innerHTML = icon('x', 14);
    p.append(img, star, x, el('span', 'u-dur', dur));
    t.append(p, el('div', 'u-tile-name', name));
    t.addEventListener('click', () => t.classList.toggle('is-picked'));
    box.append(t);
  }
}

// ── the icon set ──────────────────────────────────────────────────────────────────────────────────
function paintIconSet() {
  const box = $('#lab-icons');
  for (const n of ICON_NAMES) {
    const r = el('div', 'lab-icon');
    r.innerHTML = icon(n);
    r.append(n);
    box.append(r);
  }
}

// ── a grey wave in an audio clip (a fixed shape, so the shots match) ──────────────────────────────
function paintWaves() {
  for (const c of $$('[data-wave]')) {
    const seed = +c.dataset.wave;
    const n = 90;
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = Math.abs(Math.sin(i * 0.37 * seed + seed) * Math.cos(i * 0.11 + seed * 2)) * 0.85 + 0.12;
      const h = Math.max(1, a * 16);
      d += 'M' + (i + 0.5) + ' ' + (8 - h / 2).toFixed(2) + 'v' + h.toFixed(2);
    }
    c.insertAdjacentHTML('beforeend', '<svg class="u-wave" viewBox="0 0 ' + n + ' 16" preserveAspectRatio="none" aria-hidden="true">'
      + '<path d="' + d + '" stroke="currentColor" stroke-width="0.55" fill="none"/></svg>');
  }
}

// ── what the parts do when pressed ────────────────────────────────────────────────────────────────
function wireParts() {
  for (const a of $$('[data-no]')) a.addEventListener('click', (e) => e.preventDefault());
  for (const box of $$('[data-tabs]')) {
    box.addEventListener('click', (e) => {
      const t = e.target.closest('.u-tab'); if (!t) return;
      for (const x of $$('.u-tab', box)) x.classList.toggle('is-cur', x === t);
    });
  }
  for (const box of $$('[data-chips]')) {
    box.addEventListener('click', (e) => {
      const c = e.target.closest('.u-chip'); if (!c) return;
      for (const x of $$('.u-chip', box)) x.classList.toggle('is-on', x === c);
    });
  }
  for (const box of $$('[data-list]')) {
    box.addEventListener('click', (e) => {
      const r = e.target.closest('.u-row'); if (!r) return;
      for (const x of $$('.u-row', box)) x.classList.toggle('is-sel', x === r);
    });
  }
  for (const s of $$('.u-switch')) s.addEventListener('click', () => s.setAttribute('aria-checked', String(s.getAttribute('aria-checked') !== 'true')));
  const FMT = {
    speed: (v) => (v / 100).toFixed(2) + '×',
    db: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' dB',
    pct: (v) => Math.round(v) + '%',
  };
  for (const r of $$('.u-range')) {
    const out = r.parentElement.querySelector('output');
    const paint = () => {
      const v = +r.value, lo = +r.min, hi = +r.max;
      r.style.setProperty('--p', (100 * (v - lo) / (hi - lo)) + '%');
      if (out) out.textContent = (FMT[r.dataset.fmt] || String)(v);
    };
    r.addEventListener('input', paint);
    paint();
  }
  for (const c of $$('.u-clip')) {
    c.addEventListener('click', () => {
      const lane = c.parentElement;
      for (const x of $$('.u-clip', lane)) x.classList.toggle('is-sel', x === c);
    });
  }
}

// ── a floating thing on the layer stack: closed by Escape, a press away, or its own buttons ───────
function float(node, opts) {
  let layer = null;
  const away = (e) => { if (!node.contains(e.target) && !(opts.keep && opts.keep.contains(e.target))) close(); };
  function close() {
    if (!layer) return;
    Layers.close(layer); layer = null;
    document.removeEventListener('pointerdown', away, true);
    node.remove();
  }
  layer = Layers.open(node, { modal: !!opts.modal, onEsc: close, name: opts.name });
  document.body.append(node);
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  return close;
}
function placeUnder(node, btn) {
  const r = btn.getBoundingClientRect();
  node.style.left = Math.min(r.left, innerWidth - node.offsetWidth - 8) + 'px';
  node.style.top = (r.bottom + 6) + 'px';
}

function wireFloats() {
  $('#lab-open-win').addEventListener('click', () => {
    const ov = el('div', 'u-ov');
    const win = $('#lab-win').cloneNode(true);
    win.removeAttribute('id'); win.style.width = ''; win.classList.add('is-float');
    ov.append(win);
    const close = float(ov, { modal: true, name: 'lab-window' });
    for (const b of $$('[data-close]', win)) b.addEventListener('click', close);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  });

  const menuBtn = $('#lab-open-menu');
  menuBtn.addEventListener('click', () => {
    const m = $('#lab-menu').cloneNode(true);
    m.removeAttribute('id'); m.classList.add('is-float');
    for (const x of $$('.is-hover', m)) x.classList.remove('is-hover');
    const close = float(m, { modal: false, name: 'lab-menu', keep: menuBtn });
    placeUnder(m, menuBtn);
    m.addEventListener('click', (e) => { if (e.target.closest('.u-mi')) close(); });
  });

  const askBtn = $('#lab-open-ask');
  askBtn.addEventListener('click', () => {
    const a = $('#lab-ask').cloneNode(true);
    a.removeAttribute('id'); a.classList.add('is-float');
    const close = float(a, { modal: false, name: 'lab-ask', keep: askBtn });
    placeUnder(a, askBtn);
    for (const b of $$('button', a)) b.addEventListener('click', close);
  });

  // "Really?" by two presses: the first arms it, the second does it; it lets go by itself after 3 s
  const really = $('#lab-really'), say = $('#lab-really-say');
  let armed = null;
  really.addEventListener('click', () => {
    if (!armed) {
      really.classList.add('is-armed'); really.textContent = 'Really?';
      armed = setTimeout(() => { armed = null; really.classList.remove('is-armed'); really.textContent = 'Delete'; }, 3000);
      return;
    }
    clearTimeout(armed); armed = null;
    really.classList.remove('is-armed'); really.textContent = 'Delete';
    say.textContent = 'deleted (a sample - nothing is touched)';
    setTimeout(() => { say.textContent = 'press twice'; }, 2000);
  });
}

paintSwatches();
paintType();
paintTiles();
paintIconSet();
paintWaves();
paintIcons();
wireParts();
wireFloats();
