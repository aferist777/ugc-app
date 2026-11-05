/* ═══════════════════════════════════════════════════════════════════════════
   SAVED LYRICS ON THE SHELVES (phase V59.1, the owner 2026-10-29: "текста песен ... давай в music будет своя папка еще
   для lyrics"; (мз6а)) - AUDIO -> Music -> Lyrics in the Library's Media and in Merge's Library panel: ONE module for
   both pages. The texts are saved by Generate music (its Lyrics' "save", Custom's "save" by the Lyrics field - sub-session
   P's) into data/lyrics.json (lib/lyrics-store.js, /api/audio/lyrics); the shelf gives them as tiles of kind `lyrics`
   with no file (routes/library.js _lyricItems).

   A tile: the title and the first lines (no [Verse]/[Chorus] tags), and where it came from. A press opens the text whole
   in the app's viewer (js/library/viewer.js - the text on its stage, the arrows through the folder's texts, its facts in
   the right column), with four actions in its head:
     Copy           the text into the clipboard
     Use in Custom  the viewer closes and the page is told - window event `ugc:lyric-use` { id, title, text }; Generate
                    music opens Custom with that text (the Library's music window, Merge's "/ generate audio")
     Rename         the app's name box, PATCH /api/audio/lyrics/:id
     Delete         as every tile is deleted: the question (js/library/actions.js deleteQuestion), then
                    DELETE /api/library/item/lyrics/:id
   Never laid on a lane, never moved, no star; several picked are deleted with "Delete N" (js/tile-select.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import { openViewer, closeViewer } from '../library/viewer.js';
import { deleteQuestion, deleteItem } from '../library/actions.js';
import { askName } from '../name-box.js';
// (phase V73 block 2, step 2b) the question at the viewer's Delete in place of the browser's confirm()
import { ask } from '../ask.js';

export const KIND = 'lyrics';
export const isLyrics = (it) => !!it && it.kind === KIND;
/** The window event "Use in Custom" sends - Generate music listens. */
export const USE_EVENT = 'ugc:lyric-use';

const FROM = { suno: 'Suno · Lyrics', own: 'your own' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const textOf = (it) => String((it && it.meta && it.meta.text) || '');

/** The lines a tile shows: the first ones that are words, not [tags]. */
export function firstLines(text, n) {
  return String(text || '').split('\n').map(s => s.trim()).filter(s => s && !/^\[[^\]]*\]$/.test(s)).slice(0, n || 6);
}

/** A tile's face - its title, its first lines, where it came from (css/sound.css .lyr-*). */
export function tileFace(it) {
  const face = el('div', 'lyr-face');
  face.appendChild(el('b', 'lyr-title', it.name || 'lyrics'));
  const lines = el('div', 'lyr-lines');
  for (const l of firstLines(textOf(it), 6)) lines.appendChild(el('span', null, l));
  face.appendChild(lines);
  const m = it.meta || {};
  face.appendChild(el('span', 'lyr-from', FROM[m.from] || ''));
  return face;
}

/** What a tile says under the pointer. */
export const tileTitle = (it) => (it.name || 'lyrics') + '\n' + firstLines(textOf(it), 2).join(' / ') + '\na press opens the text';

/** "Use in Custom": the page is told; Generate music opens Custom with the text (sub-session P's). */
export function useInCustom(it) {
  window.dispatchEvent(new CustomEvent(USE_EVENT, { detail: { id: String(it.id), title: it.name || '', text: textOf(it) } }));
}

async function _copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    // The clipboard refused (no focus, an old window): the old way, through a field.
    const ta = el('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    ta.remove();
    return ok;
  }
}

const ACTIONS = [
  { id: 'lycopy', label: 'Copy', title: 'The whole text into the clipboard' },
  { id: 'lyuse', label: 'Use in Custom', title: 'Generate music opens Custom with this text in its Lyrics field' },
  { id: 'lyrename', label: 'Rename' },
  { id: 'lydel', label: 'Delete', danger: true },
];

// The right column: where it came from, when, how long.
function _rows(it) {
  const m = it.meta || {};
  const t = textOf(it);
  const lines = t ? t.split('\n').filter(s => s.trim()).length : 0;
  return [['kind', 'lyrics · Music → Lyrics'], ['from', FROM[m.from] || ''], ['length', lines + (lines === 1 ? ' line' : ' lines') + ' · ' + t.length + ' characters']];
}

/**
 * Open a text of the folder in the app's viewer, paging through `list` (the texts the gallery shows).
 * o: { status(text, bad), changed({ removed, renamed }) - the page reads its gallery (and the tree) again }
 */
export function openLyrics(list, it, o) {
  const opt = o || {};
  const texts = (list || []).filter(isLyrics);
  let at = texts.findIndex(x => String(x.id) === String(it.id));
  if (at < 0) { texts.unshift(it); at = 0; }
  const say = (t, bad) => { if (typeof opt.status === 'function') opt.status(t, !!bad); };
  openViewer(texts, at, {
    actionsFor: (x) => (isLyrics(x) ? ACTIONS : []),
    extraRows: (x) => (isLyrics(x) ? _rows(x) : []),
    onAction: async (id, x) => {
      if (id === 'lycopy') {
        say(await _copy(textOf(x)) ? 'Copied "' + x.name + '"' : 'The clipboard refused - select the text and press Ctrl+C', false);
        return { actionsOnly: true };
      }
      if (id === 'lyuse') {
        closeViewer();
        useInCustom(x);
        return null;
      }
      if (id === 'lyrename') {
        const name = await askName({
          title: 'Rename', value: x.name || '', okLabel: 'Rename', maxLength: 120,
          submit: async (n) => {
            const r = await fetch('/api/audio/lyrics/' + encodeURIComponent(x.id), {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: n }),
            });
            const d = await r.json().catch(() => null);
            if (!d || !d.success) throw new Error((d && d.error) || 'not renamed');
            return d.item.title;
          },
        });
        if (!name) return { actionsOnly: true };
        x.name = name;
        // The page reads its gallery again first - that read clears its status line.
        if (typeof opt.changed === 'function') await opt.changed({ renamed: x });
        say('Renamed', false);
        return null;
      }
      if (id === 'lydel') {
        // At the viewer's Delete (js/library/viewer.js draws the row - the action's label is its button).
        const label = (ACTIONS.find(a => a.id === 'lydel') || {}).label;
        const btn = [...document.querySelectorAll('.lib-view-acts button')].find(b => b.textContent === label) || null;
        if (!await ask(btn, await deleteQuestion(x), { yes: 'Delete', danger: true, stay: true })) return { actionsOnly: true };
        await deleteItem(x);
        if (typeof opt.changed === 'function') await opt.changed({ removed: x });
        say('Deleted "' + x.name + '"', false);
        return { removed: true };
      }
      return null;
    },
  });
}
