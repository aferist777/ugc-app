/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — THE FONTS TAB (phase V68 P4, the owner 2026-11-01: "шрифты нужно отобразить так же плиткой, как пресеты и анимации.
   типа отрисовать"; (хп8), (хп12), (хп47)). ONE module for the highlights popup (hl-popup.js) and Merge's captions view
   (captions-view.js).

   A tile is the font itself: "Captions" and under it "Субтитры" in white with a black outline on the dark square - the Russian
   word in the font's twin when it has no Cyrillic (fonts.js drawnFamily: how a Russian line is drawn). A PICTURE, drawn with the
   render's own libass by tools/font-tiles.js and shipped in public/fonts/captions/tiles/ (fonts.js tileName): the owner's check
   2026-11-02 found the tab drawn in the live fonts slow to open and to scroll - All loaded 33 MB of fonts and repainted outlined
   letters of thousands of contours; 101 pictures are 450 KB, asked for only once the tab is on screen, the ones in view first
   (loading=lazy). The name under it; the chips over the grid are All and the font groups (fonts.js GROUPS).

   A press chooses ONE font; Shift adds one to those chosen or takes it away - each page one of them, two in a row never the
   same (captions/mix.js). What a choice does is the caller's (`onPick(families, { shift, family })`).
   ═══════════════════════════════════════════════════════════════════════════ */

import { FONTS, GROUPS, groupOf, drawnFamily, TILE_DIR, tileName } from '../captions/fonts.js';

const RU = 'Субтитры';
const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** A font's label as the tab shows it ('' for one the app does not ship). */
export const fontLabel = (family) => { const f = FONTS.find((x) => x.family === family); return f ? f.label : ''; };

/**
 * The fonts tab in `host`. `onPick(families, { shift, family })` on a press (`family` the one pressed); `note` - a line over the
 * chips. Returns { set(families), getAll(), reveal(family) - its group open, the tile scrolled to and outlined in gold,
 * openFirst(), shown(on), recommend(groups) - (phase V69 P12) the kind's recommended groups marked and first among the chips }.
 */
export function fontPicker(host, { onPick, note } = {}) {
  let cat = '';
  let chosen = [];
  let visible = false;
  const tiles = new Map();         // family -> { btn, box, img }
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
    tiles.set(f.family, { btn, box, img: null, fam: f.family });
    grid.appendChild(btn);
  }

  // The pictures are put in once the tab is on screen; the browser asks for those in view first (loading=lazy).
  function fitShown() {
    if (!visible) return;
    for (const t of tiles.values()) {
      if (t.img) continue;
      const img = new Image();
      img.className = 'mv3-cap-img mv3-fnt-img';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.width = 96;
      img.height = 96;
      img.src = TILE_DIR + tileName(t.fam);
      t.box.appendChild(img);
      t.img = img;
    }
  }
  function paintCat() {
    for (const b of top.children) b.classList.toggle('is-on', (b.dataset.cat || '') === cat);
    for (const t of tiles.values()) t.btn.hidden = !!cat && t.btn.dataset.cat !== cat;
    fitShown();
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
    /** The tab is on screen (or not): only then are its pictures asked for. */
    shown(on) { visible = !!on; fitShown(); },
    recommend(groups) {
      const rec = Array.isArray(groups) ? groups : [];
      const rank = (b) => { const id = b.dataset.cat || ''; if (!id) return -1; const i = rec.indexOf(id); return i >= 0 ? i : 100 + order.indexOf(id); };
      for (const b of top.children) {
        const on = rec.includes(b.dataset.cat || '');
        b.classList.toggle('is-rec-cat', on);
        b.title = on ? 'Recommended for this kind of video' : '';
      }
      for (const b of [...top.children].sort((x, y) => rank(x) - rank(y))) top.appendChild(b);
    },
  };
}
