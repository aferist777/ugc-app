/* ═══════════════════════════════════════════════════════════════════════════
   A SOUND'S MENU UNDER THE RIGHT BUTTON (phase V34.E; the owner 2026-10-23, (р2): "правая кнопка мыши") - the one menu a
   tile has in Merge's Library panel and on the Library's Media shelf, and only a sound's or a track's (the rule of V23 -
   no menu on a tile - stays for every other tile). What a sound has no window to do in:

     Cut…        a piece as a new sound (js/sound/cut-window.js) - of a track a new    every sound, every track
                 track in Music, of the rest a sound in My sounds (V54); a track in the
                 Library opens in its player instead (the page's `cut`)
     Rename      its name (PATCH /api/library/item/:kind/:id)                          own sounds, tracks
     Move to     another category of My sounds, or My sounds itself                     own sounds
     highlights  a track into Music -> highlights (its root), out of it, or back into
                 the mood its preset made it for (V34.F: a mood folder takes nothing
                 else - routes/music.js, lib/music-store.js `place`)                   tracks
     About       where it came from: its author, licence and page, what it was asked,
                 the sound a piece was cut from, its tags                               every one
     Delete      the page's own delete - it asks with the projects that use it          own sounds, tracks

   A built-in sound (kind `sfx`) is the app's: a piece of it, its star and its "About" only.

     soundMenu(item, event, { status(text, bad), changed(), del(item), stop(), cut(item), toTimeline(piece) })
                          changed() reads the shelf again (awaited - the word about what was done comes after it);
                          cut(item) - the page's own way to cut it (true: done; the Library's player for a track);
                          toTimeline(piece) - Merge's "to timeline" in the Cut window (timeline-b.js placeSoundPiece)
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { askName } from '../name-box.js';
import { openCut } from './cut-window.js';
import { secs } from './wave.js';
import { menuIcons } from '../icons.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
async function _api(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => null);
  if (!d || d.success === false) throw new Error((d && d.error) || ('status ' + r.status));
  return d;
}
const _patch = (it, body) => _api('/api/library/item/' + encodeURIComponent(it.kind) + '/' + encodeURIComponent(it.id),
  { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** The categories of My sounds a sound may go into - the locked one (Generated) is what the engines make. */
export async function myCats() {
  try {
    const d = await _api('/api/library/cats');
    // (phase V54) A folder in a folder reads as its path.
    return ((d.byKind && d.byKind.sounds) || []).filter(c => !c.locked)
      .map(c => ({ id: c.id, label: Array.isArray(c.trail) && c.trail.length ? c.trail.join(' / ') : (c.title || c.label) }));
  } catch (e) { return []; }
}

let _m = null;
function _close() {
  if (!_m) return;
  _m.el.remove();
  document.removeEventListener('mousedown', _m.away, true);
  window.removeEventListener('scroll', _close, true);
  Layers.close(_m.layer);
  _m = null;
}

function _place(box, x, y) {
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, x))) + 'px';
  box.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, y))) + 'px';
}

export async function soundMenu(it, ev, opts) {
  const o = Object.assign({ status: () => {}, changed: () => {}, del: null, stop: () => {} }, opts || {});
  _close();
  const own = it.kind === 'sounds';
  const builtin = it.kind === 'sfx';
  const m = el('div', 'mv3-plus-menu snd-menu u-menu is-float');
  const item = (label, sub, fn, danger) => {
    const b = el('button', 'mv3-plus-item u-mi' + (danger ? ' is-danger' : ''));
    b.type = 'button';
    b.appendChild(el('span', null, label));
    if (sub) b.appendChild(el('small', null, sub));
    if (fn) b.addEventListener('click', (e) => { e.stopPropagation(); _close(); fn(); });
    else b.disabled = true;
    m.appendChild(b);
  };
  // (phase V54, (зв28)) Where the piece goes follows what is cut: a track's into Music, the rest into My sounds - no choice.
  const inPlayer = it.kind === 'music' && typeof o.cut === 'function';
  item('Cut…', inPlayer ? 'in the player - a piece of it as a new track in Music'
    : 'a piece of it as a new ' + (it.kind === 'music' ? 'track in Music' : 'sound in My sounds'), () => {
    if (typeof o.cut === 'function' && o.cut(it)) return;
    openCut({ kind: it.kind, id: it.id, path: it.media, name: it.name, dur: it.dur, wave: (it.meta || {}).wave }, {
      stop: o.stop, toTimeline: o.toTimeline,
      done: async (made, where) => {
        await o.changed();
        o.status('"' + ((made && (made.name || made.title)) || 'The piece') + '" is a new ' + (where === 'music' ? 'track in Music' : 'sound in My sounds'));
      },
    });
  });
  if (!builtin) {
    item('Rename', it.kind === 'music' ? 'the track\'s name' : 'the sound\'s name', async () => {
      const done = await askName({
        anchor: null, title: 'Rename', value: it.name, select: true, okLabel: 'Rename', maxLength: 120,
        submit: async (name) => (name === it.name ? null : _patch(it, { name })),
      });
      if (done) { await o.changed(); o.status('Renamed.'); }
    });
  }
  // (phase V34.F, the owner's (ф3)) A track and the highlights folder: its root takes any track, a mood only its own.
  if (it.kind === 'music') {
    let pl = null;
    try { pl = await _api('/api/audio/music/' + encodeURIComponent(it.id) + '/place'); } catch (e) { pl = null; }
    if (pl) {
      const moodLabel = (id) => ((pl.moods || []).find(m => m.id === id) || { label: id }).label;
      const put = (to, said) => async () => {
        try {
          await _api('/api/audio/music/' + encodeURIComponent(it.id) + '/place',
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(to) });
          await o.changed();
          o.status(said);
        } catch (e) { o.status(e.message, true); }
      };
      if (!pl.folder) item('Into highlights', 'the highlights popup offers it', put({ folder: 'highlights' }, '"' + it.name + '" is in Music → highlights.'));
      if (pl.folder && pl.mood) item('Into highlights itself', 'out of the mood ' + moodLabel(pl.mood), put({ folder: 'highlights' }, '"' + it.name + '" is in Music → highlights.'));
      if (pl.folder && !pl.mood && pl.moodMade) item('Back into ' + moodLabel(pl.moodMade), 'the mood its preset made it for', put({ folder: 'highlights', mood: pl.moodMade }, '"' + it.name + '" is in highlights → ' + moodLabel(pl.moodMade) + '.'));
      if (pl.folder) item('Out of highlights', 'into Music itself - the popup stops offering it', put({ folder: '' }, '"' + it.name + '" is out of highlights.'));
    }
  }
  if (own) {
    const cats = await myCats();
    const here = (it.meta || {}).categoryId || '';
    for (const c of [{ id: '', label: 'My sounds' }].concat(cats)) {
      if (c.id === here) continue;
      item('Move to ' + c.label, c.id ? '' : 'out of its folder', async () => {
        try { await _patch(it, { categoryId: c.id, categoryLabel: c.id ? c.label : '' }); await o.changed(); o.status('"' + it.name + '" is in ' + c.label + '.'); }
        catch (e) { o.status(e.message, true); }
      });
    }
  }
  item('About', builtin ? 'the built-in set: its author and licence' : 'where it came from', () => about(it, ev));
  if (!builtin && typeof o.del === 'function') item('Delete', it.kind === 'music' ? 'the track and its file' : 'the sound and its file', () => o.del(it), true);

  menuIcons(m);
  document.body.appendChild(m);
  _place(m, ev.clientX, ev.clientY);
  const away = (e) => { if (!m.contains(e.target)) _close(); };
  const layer = Layers.open(m, { modal: false, name: 'sound menu', onEsc: _close });
  _m = { el: m, away, layer };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
  window.addEventListener('scroll', _close, true);
}

/** What a sound is: its length, where it lies, where it came from, its licence, what it was asked, its tags. */
export function about(it, ev) {
  const pop = el('div', 'mt-pop snd-about u-ask is-float');
  pop.appendChild(el('b', 'mt-pop-head', it.name));
  const row = (k, v, href) => {
    if (!v) return;
    const r = el('div', 'snd-about-row');
    r.appendChild(el('span', 'snd-muted', k));
    if (href) { const a = el('a', null, v); a.href = href; a.target = '_blank'; a.rel = 'noopener'; r.appendChild(a); }
    else r.appendChild(el('span', null, v));
    pop.appendChild(r);
  };
  const m = it.meta || {};
  const i = m.info || {};
  row('length', secs(it.dur));
  row('where', it.kind === 'sfx' ? 'Built-in · ' + (m.categoryLabel || '') : it.kind === 'music' ? 'Music' : 'My sounds' + (m.categoryLabel ? ' · ' + m.categoryLabel : ''));
  row('file', it.media, it.media);
  row('from', i.from);
  row('author', i.author, i.authorUrl || '');
  row('licence', i.license, i.licenseUrl || '');
  row('page', i.url, i.url);
  if (i.preview) row('note', 'Freesound\'s preview (~128 kbit/s) - the original needs a Freesound sign-in');
  row('credit', i.attribution);
  row('made by', i.engine ? (i.engine === 'eleven' ? 'ElevenLabs' : 'Suno') + (i.mode ? ' · ' + i.mode : '') : '');
  row('asked', i.prompt);
  row('style', i.style || m.style);
  if (m.original) row('cut from', (m.original.name || '') + ' · ' + m.original.in + '–' + m.original.out + ' s');
  if (Array.isArray(m.tags) && m.tags.length) row('tags', m.tags.join(', '));
  const btns = el('div', 'mt-pop-btns u-ask-r');
  const ok = el('button', 'mt-pop-btn u-btn is-s', 'Close');
  ok.type = 'button';
  btns.appendChild(ok);
  pop.appendChild(btns);
  document.body.appendChild(pop);
  _place(pop, (ev && ev.clientX) || window.innerWidth / 2 - 170, (ev && ev.clientY) || 120);
  const close = () => { pop.remove(); document.removeEventListener('mousedown', away, true); Layers.close(layer); };
  const away = (e) => { if (!pop.contains(e.target)) close(); };
  const layer = Layers.open(pop, { modal: false, name: 'about a sound', onEsc: close });
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
  ok.addEventListener('click', close);
}
