/* ═══════════════════════════════════════════════════════════════════════════
   A RENDER IN THE LIBRARY'S VIEWER (phase V73, the owner's (рф-1) а, (рф-4) а - the "Render finished" window went).

   The one place a render is looked at, from any page: the popup a finished render leaves ("Open"), Queue -> open, a
   highlights fragment's "▶ play". It is the Library's viewer (js/library/viewer.js) of the render as the Renders shelf
   lists it (GET /api/library/shelf/renders), with two actions:
     Rename   the file, its .srt, its poster and every record that names them follow (PATCH /api/library/item/renders/:id,
              lib/relocate.js; " (2)" when the name is taken)
     Delete   by two presses (js/really.js's words and time): the file, its poster, its .srt and its Queue entry
              (DELETE /api/library/item/renders/:id)
   o.onChanged() after either - the page reads what it shows again (Queue, a highlights card).
   ═══════════════════════════════════════════════════════════════════════════ */

import { openViewer, repaint } from './viewer.js';
import { askName } from '../name-box.js';
import { showError } from '../notice.js';
import { REALLY, MS } from '../really.js';

const _plain = (u) => String(u || '').split('?')[0];
const _json = async (url, opts) => {
  let r = null, d = null;
  try { r = await fetch(url, opts); d = await r.json(); } catch (e) { d = null; }
  if (!r || !r.ok || !d || d.success === false) throw new Error((d && d.error) || 'the app did not answer');
  return d;
};

/** The render at `url` (/media/renders/...) in the viewer. Resolves false when it is not on the shelf any more. */
export async function openRender(url, o = {}) {
  const want = _plain(url);
  let it = null;
  try {
    const d = await _json('/api/library/shelf/renders');
    it = (d.items || []).find(x => _plain(x.media) === want) || null;
  } catch (e) { showError('The renders did not load: ' + e.message); return false; }
  if (!it) { showError('That render is no longer on the Renders shelf'); return false; }

  let armed = 0;                       // the timer of a Delete pressed once
  const letGo = () => { if (armed) clearTimeout(armed); armed = 0; };
  const changed = () => { if (typeof o.onChanged === 'function') { try { o.onChanged(); } catch (e) { /* the page's */ } } };
  openViewer([it], 0, {
    actionsFor: () => [
      { id: 'rename', label: 'Rename' },
      { id: 'del', label: armed ? REALLY : 'Delete', danger: true, armed: !!armed, title: 'Delete this render - its file, its .srt and its entry in Queue' },
    ],
    onAction: async (id, item) => {
      if (id === 'rename') {
        letGo();
        const btn = [...document.querySelectorAll('.lib-view-acts button')].find(b => b.textContent === 'Rename') || null;
        const next = await askName({ anchor: btn, title: 'Rename', value: item.name || '', okLabel: 'Rename' });
        const name = String(next == null ? '' : next).trim();
        if (!name || name === item.name) return { changed: false };
        const d = await _json('/api/library/item/renders/' + encodeURIComponent(item.id), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
        });
        Object.assign(item, { id: d.id || item.id, name: d.name || name, media: d.url || item.media, thumb: d.thumb || item.thumb });
        changed();
        return { changed: true };
      }
      if (id === 'del') {
        // the first press arms it ("Really?"), the second within a few seconds deletes
        if (!armed) {
          armed = setTimeout(() => { armed = 0; repaint(); }, MS);
          return { actionsOnly: true };
        }
        letGo();
        await _json('/api/library/item/renders/' + encodeURIComponent(item.id), { method: 'DELETE' });
        changed();
        return { removed: true };
      }
      return { changed: false };
    },
  });
  return true;
}
