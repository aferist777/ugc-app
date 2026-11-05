/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the BACKGROUND MUSIC of a highlights project, chosen in its popup by MOOD (phase V68 P3, the owner 2026-11-01,
   (хп6): "пользователь будет выбирать не конкретно трек, а под конкретный тип проекта"; (хп20): "кнопки настроений вместо
   треков"; (хп39): "каждому свой"; (хп51)).

   Buttons: "no music", then the ten moods of Music -> highlights (GET /api/audio/music/highlights, phase V34.F - each with how
   many tracks it has, its words under the pointer), then "yours" - the root of Music -> highlights - only when it has tracks.
   Several moods may be on; "no music" is on when none is. A mood with no tracks yet is greyed. The press sends the moods; the
   server gives each fragment ONE track of them, none twice while there are enough (lib/highlights-music.js ofMoods, deal).
   Until phase V68 the popup listed the tracks themselves, each with ▶ and a tick (phase V33.8, H3) - gone with it.
   What each kind remembers is merge-v3/hl-kinds.js.
   (phase V69 P12, (хп93)) auto's row starts with "by the video" - the kind it finds gives its own moods (its standard by default) -
   and each kind's recommended moods are marked (public/js/highlights/kinds.js `moods.rec`).
   ═══════════════════════════════════════════════════════════════════════════ */

import { YOURS, BY_VIDEO } from './hl-kinds.js';
// (phase V73 block 2, step 2b) Being read, could not be read - the shared parts; the reason a popup in the corner.
import { loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/**
 * The mood buttons in `host`. `onChange(moods)` on a press; `onReady(moodOf)` once Music -> highlights is read - `moodOf(trackId)`
 * gives a track's mood (YOURS for the root, '' for none). Returns { set(moods), get(), have(id), byVideo(on), recommend(ids) }.
 */
export function moodPicker(host, { onChange, onReady } = {}) {
  let data = null;          // { moods: [{ id, label, about, tracks }], root: [tracks] }
  let err = '';
  let chosen = [];
  let byVideoOn = false;           // (V69 P12) auto's "by the video" button
  let rec = [];                    // (V69 P12) the kind's recommended moods
  const row = _el('div', 'mv3-hlp-chips mv3-hlp-moods');
  host.appendChild(row);

  const count = (id) => {
    if (!data) return 0;
    if (id === YOURS) return data.root.length;
    const m = data.moods.find((x) => x.id === id);
    return m && Array.isArray(m.tracks) ? m.tracks.length : 0;
  };
  /** Has mood `id` any track now (before Music -> highlights is read - yes); "by the video" while it is offered. */
  const have = (id) => (id === BY_VIDEO ? byVideoOn : (!data || count(id) > 0));

  function paint() {
    row.textContent = '';
    if (!data) {
      row.appendChild(err ? failedEl('Music → highlights', () => read(), { line: true })
        : loadingEl('reading Music → highlights…', { line: true }));
      return;
    }
    if (byVideoOn) {
      const by = _el('button', 'mv3-hlp-chip u-chip mv3-hlp-byvideo' + (chosen.includes(BY_VIDEO) ? ' is-on' : ''), 'by the video');
      by.type = 'button';
      by.title = 'The kind of video auto finds gives its own moods - as you last chose them for that kind (its standard at first)';
      by.addEventListener('click', () => { chosen = [BY_VIDEO]; paint(); if (onChange) onChange(chosen.slice()); });
      row.appendChild(by);
    }
    const none = _el('button', 'mv3-hlp-chip u-chip' + (chosen.length ? '' : ' is-on'), 'no music');
    none.type = 'button';
    none.title = 'No background music';
    none.addEventListener('click', () => { chosen = []; paint(); if (onChange) onChange([]); });
    row.appendChild(none);
    const list = data.moods.map((m) => ({ id: m.id, label: m.label, about: m.about }));
    if (data.root.length) list.push({ id: YOURS, label: 'yours', about: 'Your own tracks in the root of Music → highlights' });
    for (const m of list) {
      const n = count(m.id);
      const r = rec.includes(m.id);
      const b = _el('button', 'mv3-hlp-chip u-chip' + (chosen.includes(m.id) ? ' is-on' : '') + (r ? ' is-rec' : ''), m.label);
      b.type = 'button';
      b.appendChild(_el('span', 'mv3-cap-n', ' ' + n));
      b.disabled = !n;
      b.title = (r ? 'Recommended for this kind of video. ' : '') + (n ? (m.about ? m.about + ' - ' : '') + n + (n === 1 ? ' track' : ' tracks') + '; each fragment gets one of them'
        : 'No tracks in this mood yet - make them in Music → highlights');
      b.addEventListener('click', () => {
        chosen = chosen.filter((x) => x !== BY_VIDEO);
        chosen = chosen.includes(m.id) ? chosen.filter((x) => x !== m.id) : chosen.concat([m.id]);
        paint();
        if (onChange) onChange(chosen.slice());
      });
      row.appendChild(b);
    }
  }

  // (phase V73 block 2, (б2-18)) A read that fails: the row says "did not load" with Try again, the reason is a popup.
  const SAID = 'Music → highlights could not be read';
  async function read() {
    if (err) { err = ''; paint(); }
    try {
      const r = await fetch('/api/audio/music/highlights');
      const d = await r.json();
      if (!d || !d.success) throw new Error((d && d.error) || SAID);
      data = { moods: Array.isArray(d.moods) ? d.moods : [], root: Array.isArray(d.root) ? d.root : [] };
    } catch (e) {
      err = e.message || SAID;
      showError(SAID, err === SAID ? {} : { detail: err });
    }
    if (data && onReady) {
      const of = new Map();
      for (const m of data.moods) for (const t of (m.tracks || [])) of.set(String(t.id), m.id);
      for (const t of data.root) of.set(String(t.id), YOURS);
      onReady((id) => of.get(String(id)) || '');
    }
    paint();
  }
  read();

  paint();
  return {
    // The moods chosen - those with no track now are let go of once Music -> highlights is read.
    set: (ids) => { chosen = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(have); paint(); },
    get: () => chosen.filter(have),
    have,
    /** (V69 P12) Offer "by the video" (auto) or not - taken away, it is let go of. */
    byVideo: (on) => { byVideoOn = !!on; if (!byVideoOn) chosen = chosen.filter((x) => x !== BY_VIDEO); paint(); },
    /** (V69 P12) The kind's recommended moods - marked. */
    recommend: (ids) => { rec = Array.isArray(ids) ? ids.slice() : []; paint(); },
  };
}
