/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the BACKGROUND MUSIC of a highlights project, chosen in its popup by MOOD, not by track.

   Buttons: "no music", then the ten moods of Music -> highlights (GET /api/audio/music/highlights - each with how
   many tracks it has, its words under the pointer), then "yours" - the root of Music -> highlights - only when it has tracks.
   Several moods may be on; "no music" is on when none is. A mood with no tracks yet is greyed. The press sends the moods; the
   server gives each fragment ONE track of them, none twice while there are enough (lib/highlights-music.js ofMoods, deal).
   What each kind remembers is merge-v3/hl-kinds.js.
   auto's row starts with "by the video" - the kind it finds gives its own moods (its standard by default) -
   and each kind's recommended moods are marked (public/js/highlights/kinds.js `moods.rec`).
   ═══════════════════════════════════════════════════════════════════════════ */

import { YOURS, BY_VIDEO } from './hl-kinds.js';
// Being read, could not be read - the shared parts; the reason a popup in the corner.
import { loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';
import { t, tc, tn } from '../i18n/t.js';

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** A mood's name and words as shown - its id and label stay English (folder names, the presets' ids); "yours" is the root. */
export const moodName = (id, label) => (id === YOURS ? t('yours') : id === BY_VIDEO ? t('by the video') : tc('mood', String(label || id)));
export const moodAbout = (id, about) => (id === YOURS ? t('Your own tracks in the root of Music → highlights') : (about ? t(about) : ''));

/**
 * The mood buttons in `host`. `onChange(moods)` on a press; `onReady()` once Music -> highlights is read. Returns { set(moods), get(), have(id), byVideo(on), recommend(ids) }.
 */
export function moodPicker(host, { onChange, onReady } = {}) {
  let data = null;          // { moods: [{ id, label, about, tracks }], root: [tracks] }
  let err = '';
  let chosen = [];
  let byVideoOn = false;           // auto's "by the video" button
  let rec = [];                    // the kind's recommended moods
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
      row.appendChild(err ? failedEl(t('Music → highlights'), () => read(), { line: true })
        : loadingEl(t('reading Music → highlights…'), { line: true }));
      return;
    }
    if (byVideoOn) {
      const by = _el('button', 'mv3-hlp-chip u-chip mv3-hlp-byvideo' + (chosen.includes(BY_VIDEO) ? ' is-on' : ''), t('by the video'));
      by.type = 'button';
      by.title = t('The kind of video auto finds gives its own moods - as you last chose them for that kind (its standard at first)');
      by.addEventListener('click', () => { chosen = [BY_VIDEO]; paint(); if (onChange) onChange(chosen.slice()); });
      row.appendChild(by);
    }
    const none = _el('button', 'mv3-hlp-chip u-chip' + (chosen.length ? '' : ' is-on'), t('no music'));
    none.type = 'button';
    none.title = t('No background music');
    none.addEventListener('click', () => { chosen = []; paint(); if (onChange) onChange([]); });
    row.appendChild(none);
    const list = data.moods.map((m) => ({ id: m.id, label: m.label, about: m.about }));
    if (data.root.length) list.push({ id: YOURS, label: 'yours', about: '' });
    for (const m of list) {
      const n = count(m.id);
      const r = rec.includes(m.id);
      const b = _el('button', 'mv3-hlp-chip u-chip' + (chosen.includes(m.id) ? ' is-on' : '') + (r ? ' is-rec' : ''), moodName(m.id, m.label));
      b.type = 'button';
      b.appendChild(_el('span', 'mv3-cap-n', ' ' + n));
      b.disabled = !n;
      const about = moodAbout(m.id, m.about);
      const said = !n ? t('No tracks in this mood yet - make them in Music → highlights')
        : about ? tn(n, '{about} - {n} track; each fragment gets one of them', '{about} - {n} tracks; each fragment gets one of them', { about })
          : tn(n, '{n} track; each fragment gets one of them', '{n} tracks; each fragment gets one of them');
      b.title = r ? t('Recommended for this kind of video. {more}', { more: said }) : said;
      b.addEventListener('click', () => {
        chosen = chosen.filter((x) => x !== BY_VIDEO);
        chosen = chosen.includes(m.id) ? chosen.filter((x) => x !== m.id) : chosen.concat([m.id]);
        paint();
        if (onChange) onChange(chosen.slice());
      });
      row.appendChild(b);
    }
  }

  // A read that fails: the row says "did not load" with Try again, the reason is a popup.
  const SAID = t('Music → highlights could not be read');
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
    if (data && onReady) onReady();
    paint();
  }
  read();

  paint();
  return {
    // The moods chosen - those with no track now are let go of once Music -> highlights is read.
    set: (ids) => { chosen = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter(have); paint(); },
    get: () => chosen.filter(have),
    have,
    /** Offer "by the video" (auto) or not - taken away, it is let go of. */
    byVideo: (on) => { byVideoOn = !!on; if (!byVideoOn) chosen = chosen.filter((x) => x !== BY_VIDEO); paint(); },
    /** The kind's recommended moods - marked. */
    recommend: (ids) => { rec = Array.isArray(ids) ? ids.slice() : []; paint(); },
  };
}
