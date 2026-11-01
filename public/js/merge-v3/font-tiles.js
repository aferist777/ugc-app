/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — THE FONTS TAB (phase V68 P4, the owner 2026-11-01: "шрифты нужно отобразить так же плиткой, как пресеты и анимации.
   типа отрисовать"; (хп8), (хп12), (хп47)). ONE module for the highlights popup (hl-popup.js) and Merge's captions view
   (captions-view.js).

   A tile is the font itself, drawn here: "Captions" and under it "Субтитры" in white with a black outline on the dark square -
   the Russian word in the font's twin when it has no Cyrillic (fonts.js drawnFamily: how a Russian line is drawn), each word
   scaled to the square's width, as a page in the font keeps its preset's width. The name under it; the chips over the grid are
   All and the font groups (fonts.js GROUPS). A font's file is loaded only when its tile is shown (css/caption-fonts.css,
   document.fonts.load) - All loads them all.

   A press chooses ONE font; Shift adds one to those chosen or takes it away - each page one of them, two in a row never the
   same (captions/mix.js). What a choice does is the caller's (`onPick(families, { shift, family })`).
   ═══════════════════════════════════════════════════════════════════════════ */

import { FONTS, GROUPS, groupOf, drawnFamily, cssWeight } from '../captions/fonts.js';

const EN = 'Captions';
const RU = 'Субтитры';
const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** A font's label as the tab shows it ('' for one the app does not ship). */
export const fontLabel = (family) => { const f = FONTS.find((x) => x.family === family); return f ? f.label : ''; };

// One word of a tile in `family`, scaled to the box once its file is in (a font not loaded yet measures in the fallback).
function _word(text, family, cls) {
  const w = _el('span', 'mv3-fnt-w ' + cls, text);
  w.style.fontFamily = '"' + family + '", "Liberation Sans", sans-serif';
  w.style.fontWeight = String(cssWeight(family, true));
  return w;
}

function _fit(box, w, base) {
  w.style.fontSize = base + 'px';
  const room = box.clientWidth * 0.86;
  const have = w.scrollWidth;
  if (room > 0 && have > 0) w.style.fontSize = Math.max(6, Math.min(base * 1.6, base * room / have)).toFixed(1) + 'px';
}

/**
 * The fonts tab in `host`. `onPick(families, { shift, family })` on a press (`family` the one pressed); `note` - a line over the
 * chips. Returns { set(families), getAll(), reveal(family) - its group open, the tile scrolled to and outlined in gold,
 * openFirst(), shown(on) }.
 */
export function fontPicker(host, { onPick, note } = {}) {
  let cat = '';
  let chosen = [];
  let visible = false;
  const tiles = new Map();         // family -> { btn, box, en, ru, fitted }
  if (note) host.appendChild(_el('div', 'mv3-cap-note', note));
  const top = _el('div', 'mv3-cap-cats mv3-fnt-cats');
  const grid = _el('div', 'mv3-cap-grid mv3-fnt-grid');
  host.append(top, grid);

  const order = GROUPS.map((g) => g[0]);
  const list = FONTS.slice().sort((a, b) => order.indexOf(groupOf(a)) - order.indexOf(groupOf(b)));
  const chips = [['', 'All', list.length]].concat(GROUPS.map(([id, label]) => [id, label, list.filter((f) => groupOf(f) === id).length]));
  for (const [id, label, n] of chips) {
    const b = _el('button', 'mv3-cap-cat', label);
    b.type = 'button';
    b.dataset.cat = id;
    b.appendChild(_el('span', 'mv3-cap-n', ' ' + n));
    b.addEventListener('click', () => { cat = id; _spot(null); paintCat(); });
    top.appendChild(b);
  }

  for (const f of list) {
    const btn = _el('button', 'mv3-cap-tile mv3-fnt-tile');
    btn.type = 'button';
    btn.dataset.family = f.family;
    btn.dataset.cat = groupOf(f);
    const twin = drawnFamily(f.family, RU);
    btn.title = f.label + (twin !== f.family ? ' - no Russian letters: a Russian line is drawn in ' + twin : '')
      + '. A press - this font; Shift adds it to those chosen, each page one of them';
    const box = _el('div', 'mv3-cap-box mv3-fnt-box');
    const en = _word(EN, f.family, 'is-en');
    const ru = _word(RU, twin, 'is-ru');
    box.append(en, ru);
    const name = _el('div', 'mv3-cap-name');
    name.appendChild(_el('span', 'mv3-cap-nm', f.label));
    if (twin !== f.family) name.appendChild(_el('span', 'mv3-fnt-tw', 'lat'));
    btn.append(box, name);
    btn.addEventListener('click', (e) => {
      const shift = !!(e && e.shiftKey);
      _spot(null);
      chosen = !shift ? [f.family] : chosen.includes(f.family) ? chosen.filter((x) => x !== f.family) : chosen.concat([f.family]);
      paintChosen();
      if (onPick) onPick(chosen.slice(), { shift, family: f.family });
    });
    tiles.set(f.family, { btn, box, en, ru, fitted: false, fam: f.family, twin });
    grid.appendChild(btn);
  }

  // The files of the tiles shown are asked for, and each word fitted once its own is in.
  function fitShown() {
    if (!visible) return;
    for (const t of tiles.values()) {
      if (t.btn.hidden || t.fitted || !t.box.clientWidth) continue;
      t.fitted = true;
      const fits = () => { _fit(t.box, t.en, 22); _fit(t.box, t.ru, 15); };
      fits();
      if (document.fonts && document.fonts.load) {
        Promise.all([document.fonts.load('22px "' + t.fam + '"', EN), document.fonts.load('15px "' + t.twin + '"', RU)])
          .then(fits, fits);
      }
    }
  }
  function paintCat() {
    for (const b of top.children) b.classList.toggle('is-on', (b.dataset.cat || '') === cat);
    for (const t of tiles.values()) t.btn.hidden = !!cat && t.btn.dataset.cat !== cat;
    requestAnimationFrame(fitShown);
  }
  function paintChosen() { for (const [fam, t] of tiles) t.btn.classList.toggle('is-on', chosen.includes(fam)); }
  function _spot(btn) {
    for (const b of grid.querySelectorAll('.is-spot')) b.classList.remove('is-spot');
    if (!btn || btn.hidden) return;
    btn.classList.add('is-spot');
    const g = grid.getBoundingClientRect(), r = btn.getBoundingClientRect();
    if (r.top < g.top || r.bottom > g.bottom) grid.scrollTop += r.top - g.top - (g.height - r.height) / 2;
  }
  paintCat();
  return {
    set(families) { chosen = [...new Set((Array.isArray(families) ? families : []).filter((x) => tiles.has(x)))]; paintChosen(); },
    getAll: () => chosen.slice(),
    reveal(family) {
      const t = tiles.get(family);
      if (!t) return;
      cat = t.btn.dataset.cat;
      paintCat();
      _spot(t.btn);
    },
    /** Open on the group of the first one chosen - none chosen: All. */
    openFirst() {
      const t = chosen.length ? tiles.get(chosen[0]) : null;
      cat = t ? t.btn.dataset.cat : '';
      _spot(null);
      paintCat();
      grid.scrollTop = 0;
      if (t) requestAnimationFrame(() => _spot(t.btn));
    },
    /** The tab is on screen (or not): only then are the files of its tiles asked for. */
    shown(on) { visible = !!on; if (visible) requestAnimationFrame(fitShown); },
  };
}
