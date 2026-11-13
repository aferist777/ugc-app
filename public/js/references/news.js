/* ═══════════════════════════════════════════════════════════════════════════
   REFERENCES - A NEW FILE'S TILE.

   What comes from OUTSIDE - a post the Telegram bot brought (not moved by hand since), a source downloaded by a link
   (REFERENCES -> YouTube -> Videos; only one that came after `since`, as in the tree) - is marked on its tile with a
   gold dot until it is OPENED (pressed into the viewer:
   the post viewer, js/references/post.js, or the media viewer, js/library/viewer.js). Generations, uploads and stock
   are never marked here.

   ONE key for the Library's gallery and Merge's panel gallery - one origin, as the tree's `ugc_tree_seen_v1`:
     ugc_ref_opened_v1 = { since, ids }
       since  when this was first kept: what arrived before it is not new (nothing lights the day this comes in)
       ids    the tiles opened since - 'ref:<post id>' / 'yt:<source id>' -> when; the oldest dropped past KEEP

     mark(tile, it)   the dot on a new tile (`.ref-new`, top left; a post's badge moves aside), `data-new` to find it
     opened(it)       it was opened: kept, and the dot taken off every tile that shows it
     isNew(it)        whether its tile has the dot
     since()          the moment - the media tree counts sources as news only after it
   ═══════════════════════════════════════════════════════════════════════════ */

const KEY = 'ugc_ref_opened_v1';
const KEEP = 3000;

const keyOf = (it) => (it.kind === 'youtube' ? 'yt:' : 'ref:') + it.id;
const _ts = (d) => (typeof d === 'number' ? d : (Date.parse(d || '') || 0));

/** What came from outside: a post of the bot not moved by hand, or a source downloaded by a link. */
export const fromOutside = (it) => !!it && (it.kind === 'youtube'
  || (it.kind === 'references' && (it.meta || {}).from === 'telegram' && !(it.meta || {}).handled));

function _write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* a private window */ } }
function _read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v === 'object' && +v.since) return { since: +v.since, ids: (v.ids && typeof v.ids === 'object') ? v.ids : {} };
  } catch (e) { /* unreadable - kept again from now */ }
  const s = { since: Date.now(), ids: {} };
  _write(s);
  return s;
}

/** The moment this was first kept - also the moment from which a source downloaded by a link is news in the media tree
 *  (js/media-tree.js sends it as ?srcFrom=, routes/library.js `_isNews`): nothing already there lights. */
export function since() { return _read().since; }

export function isNew(it) {
  if (!fromOutside(it)) return false;
  const s = _read();
  return _ts((it.meta || {}).date) > s.since && !s.ids[keyOf(it)];
}

export function mark(tile, it) {
  if (!tile || !isNew(it)) return;
  tile.dataset.new = keyOf(it);
  tile.classList.add('is-new-file');
  const d = document.createElement('span');
  d.className = 'ref-new';
  d.title = 'New - not opened yet';
  tile.appendChild(d);
}

export function opened(it) {
  if (!fromOutside(it)) return;
  const s = _read();
  const k = keyOf(it);
  if (!s.ids[k]) {
    s.ids[k] = Date.now();
    const keys = Object.keys(s.ids);
    if (keys.length > KEEP) keys.sort((a, b) => s.ids[a] - s.ids[b]).slice(0, keys.length - KEEP).forEach(x => delete s.ids[x]);
    _write(s);
  }
  document.querySelectorAll('[data-new="' + CSS.escape(k) + '"]').forEach((t) => {
    t.removeAttribute('data-new');
    t.classList.remove('is-new-file');
    t.querySelectorAll('.ref-new').forEach(x => x.remove());
  });
}
