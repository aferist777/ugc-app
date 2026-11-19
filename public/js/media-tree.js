/* ═══════════════════════════════════════════════════════════════════════════
   THE MEDIA TREE - one module for both places that show the library's
   media: Merge's Library panel (js/merge-v3/library.js) and the Library's Media shelf (js/library/main.js). The
   gallery is on the left, this tree on the right:

     REFERENCES -> Files, Instagram (Posts, Reels), YouTube (Shorts, Videos), TikTok (Posts, Videos), Other
     VIDEO   -> Generated (the models' folders -> groups, Talking heads -> projects), Hooks, Uploads -> categories
     IMAGES  -> its categories
     AUDIO   -> Music (-> highlights -> ten moods), SFX -> ★ Favorites, Built-in (the program's set, read only),
                My sounds (categories)

   It is read in one answer (GET /api/library/tree, routes/library.js _tree): every node { key, label, count, q?, kind?,
   cat?, locked?, empty?, loose?, children? }.

   FOLDERS. A node is a folder, as in
   Explorer: pressing it SELECTS it, and the page shows its folders first as FOLDER TILES (foldersEl), then what lies
   directly in it - what has no category of its kind (`q` is what the shelf is asked for that; a node with no `q` holds
   only folders: VIDEO, AUDIO, SFX, Built-in, Talking heads, REFERENCES). There is no "Uncategorized" node and no
   "everything under it". A folder tile pressed opens it - the tree opens to it; a tile let go on a folder tile
   or on a word of the PATH over the gallery (crumbsEl - "AUDIO / SFX / My sounds", each word a press away) goes there
   as on its row. A branch opens on a DOUBLE press of its row or a press of its ▸ - and
   under a tile dragged and held over its row for 0.6 s -, and what is open is remembered, so is the node selected -
   per page.

   ONE PATH OPEN. What is open
   is always one path from a top node down: a node opened (▸, a double press, a folder tile, a word of the path, a folder
   made or moved into it, the page's select) folds everything off its line - the other top nodes with everything in them,
   its sibling folders with theirs -, and a folded node folds what was open in it, so opened again it shows its first level
   only. A TOP NODE (REFERENCES, IMAGES, VIDEO, AUDIO) opens on ONE press - selected and opened (a double press on
   one that was OPEN folds it - `pressWas`; a folded one stays opened by its first press); deeper a press only
   selects (the rows stay, a double press must find its row) and a double press or ▸ opens. A branch opened under a drag
   folds nothing; the next opening makes it one path again. The same rule wherever the tree is drawn - the
   Library, Merge's Library panel, the attachment window, Video to Music; `roots` show some top nodes only and the rule
   works among them.

   CATEGORIES, both ways: the chips' gestures - "+" on a kind's row makes one, a double press on
   its name renames it, the ✕ on hover deletes it (the media moved out of it into the kind itself, or deleted with them -
   then the projects using them are named) - and the same in a menu under the right button (on a folder tile too). The
   order is the server's: the locked first, the rest alphabetical, the EMPTY ones pale and last (no order
   by hand). A REQUIRED category (lib/library-cats.js REQUIRED) - and Generated, Hooks, Uploads - carries a
   lock. A project of Talking heads is not a category: nothing is made, renamed or deleted there.

   A TILE LET GO ON A NODE: on a category of its kind - filed under it; on the kind itself - its category taken off (on
   Generated: a B-roll with none - the server files it into its model's folder); on another kind of video (or one of its
   categories) - moved to that kind. A picture never becomes a clip, nor a clip a picture; a talking head is its
   project's and goes nowhere. A TRACK: on Music - out of highlights; on highlights - into its
   root; on a mood - only the track that mood's preset made (lib/music-store.js `place`; refused in words
   otherwise). A SOUND AND A TRACK go between Music, SFX -> My sounds and AUDIO's own root, either way (AUDIO holds what
   "Save audio" took out of a video, to be filed from there - `aroot`; a sound let go
   on Music becomes a track, a track on My sounds or AUDIO a sound - routes/library.js _audioMove, lib/audio-kind.js); a
   built-in sound goes nowhere. A tile says what it is with setMediaDrag(); the kind rides in a type of its own, the only part of a drag a
   page can read before the drop. SEVERAL TILES (js/tile-select.js): a picked tile dragged carries the others
   (`many`) and they go in ONE request (POST /api/library/batch/move) - each as one would; what cannot go stays and the
   status says why. Whether the node takes the drop is the dragged tile's question.

   FOLDERS IN FOLDERS: every kind with
   categories and Music hold folders in one another, with no limit of depth - they open ▸ one inside another. The word is
   "folder" everywhere. "New folder" - the "+" of a kind's row (at its top), the right button on a kind or a folder
   (inside it; a required one too), and the right button on the gallery's empty space (inside the open one; the page
   asks newFolder) - never in highlights, its moods, the sources' folders of REFERENCES, Built-in or a project of
   Talking heads (`holds`). A folder is renamed (a double press on its name, or the menu), deleted (✕, or the menu: what
   is in it goes up a level - its folders stay folders - or it goes with everything in it and under it, the projects using
   them named) and DRAGGED by its row or its tile onto another folder of its kind, or onto the kind's row (to its top);
   a branch held over opens as for a tile. The server refuses in words what cannot be (a name the place has; a
   required one; into itself; a path too long) and the status line says so. A folder drag carries
   `application/x-ugc-folder` and `application/x-ugc-folder-kind-<kind>`.

   ENVIRONMENTS AND LOOKBOOKS IN IMAGES: two locked folders first in IMAGES
   (routes/library.js _madeFolders) - the pictures their generators made lie in them, and their `references` (the required
   uploads_environments / uploads_lookbooks, an IMAGES folder like any) inside. Such a node carries `make` (its kind) and
   `makeLabel`: its row has a "+" - and its menu an item - that opens the generator where the page says (`onMake`). A made
   picture moves nowhere and nothing is moved in - each refused IN WORDS when let go there.
   A node with `make` that also holds folders of its own - AUDIO -> Music, its generator Generate music -
   has ONE "+" on its row, the generator's (when the page gives `onMake`); its "New folder" is in the menu under the right
   button and on the gallery's empty space. Only Environments / Lookbooks are the generators' own folders (MADE): a
   picture's rules and "Required" belong to them alone.
   Their references, and every folder in them, are `closed` (the server's flag,
   lib/library-cats.js closedWhy): only the photo a generator is given lands there. A tile, several tiles, a post's picture,
   a folder or files from Explorer let go there, and "New folder" in them (the menu, the gallery's empty space), are refused
   in words (`closedSays` - the page says the same for its Upload / "+"); "Move to…" does not offer them
   (js/media-targets.js). Out of them, renamed, deleted - as any folder.
   AUDIO -> Music -> Lyrics (`lyrics`, kind `lyrics`, routes/library.js _lyricsNode): the texts
   Generate music saved - locked, no "+", no folder of its own. A tile, several, a folder or files from Explorer let go
   on it are refused in words (LYRICS_TAKE); a text let go anywhere else too (LYRICS_STAY); "Move to…" does not offer it.

   GOLD IS WHERE A GENERATOR'S BUTTON IS - one look in every
   tree that is given the openers: Environments / Lookbooks / Props have their names gold and "create" - always
   there - in a blue frame with round ends (filled gold under the pointer
   itself) - `onMake`; the roots IMAGES / VIDEO / AUDIO
   have their names gold and "generate" always there, gold in a gold frame (all gold, dark text, under the pointer) -
   `onGenerate`: the pictures chat, the video chat, the sound. IMAGES' "New folder" is then in its menu only. Music has
   neither gold nor a button: its "Generate music" and "New folder" are in its menu.

   THE ROOTS. With `home` - the Library's Media shelf only, never Merge's panel - the tree
   may have NOTHING selected: the page is then at the roots, its gallery the top nodes as folder tiles (foldersEl(null)),
   every branch folded. It starts there unless the page names a node (`start` - an address); what was selected last is
   not read. The path over the gallery begins with the `home` word ("Media / AUDIO / SFX"), and that word pressed goes
   back to the roots (home()). A root's tile opens it as its row's press does - the others fold (one path).
   Merge's Library panel has the roots too, with `home: true` - no word in the path
   (the panel's own "Library" crumb leads there) - and starts on the node it names (`start`: the last one, or the roots).

   THIS PROJECT: Merge's tree, given `plinks` (the open project's key),
   starts with THIS PROJECT (kind `plinks`, routes/library.js _plinksNode): the project's own folders - made, renamed, moved,
   deleted as any folder, through /api/plinks/* (lib/project-links.js) - holding LINKS. A tile (or several) let go on it or on
   one of its folders is LINKED there, never moved: the file stays where it lies in the library; a link of this project let go
   on another of its folders moves there. A folder of it deleted takes only its links - the files stay.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as A from './library/actions.js';
import * as Layers from './layers.js';
import { askName } from './name-box.js';
import { menuIcons, iconEl } from './icons.js';
import { int } from './num.js';
import { since as newsSince } from './references/news.js';
import * as KG from './key-gate.js';
// The app's words as T.t / T.tn: this module's own `t`s are tiles and targets.
import * as T from './i18n/t.js';

export const MEDIA_DRAG = 'application/x-ugc-media';
const KIND_TYPE = 'application/x-ugc-kind-';
const UNCAT = '__uncat__';
const VIDEO = new Set(['birols', 'hooks', 'uploads']);
const CATABLE = new Set(['birols', 'hooks', 'uploads', 'images', 'sounds', 'references', 'music', 'plinks']);
// A folder being dragged: what it is, and its kind as a type of its own (readable before the drop).
const FOLDER_DRAG = 'application/x-ugc-folder';
const FOLDER_KIND = 'application/x-ugc-folder-kind-';
let _dragging = null;       // { kind, id, key, label } while a folder of this page is dragged
const NOUN = { birols: 'clip', hooks: 'clip', uploads: 'clip', images: 'picture', sounds: 'sound', music: 'track', references: 'post', sfx: 'sound', plinks: 'link' };
// What the generators of IMAGES -> Environments / Lookbooks made: their own kinds, never moved.
// And IMAGES -> Props: the products, added by New prop.
const MADE = { environments: T.t('Environments'), lookbooks: T.t('Lookbooks'), props: T.t('Props') };
const MADE_BY = { environments: T.t('New environment'), lookbooks: T.t('New lookbook'), props: T.t('New prop') };
// The roots that make what lies in them - their "generate" (`onGenerate`).
const GEN_ROOTS = new Set(['images', 'video', 'audio']);
const GEN_TIP = { images: T.t('Generate pictures - the pictures chat'), video: T.t('Generate video - the video chat'), audio: T.t('Generate music and sounds') };
const MADE_SAYS = {
  props: T.t('A prop stays in Props - its description is kept by its place there'),
  environments: T.t('A made environment stays in Environments - its description, 3D layout and the videos filmed there point at it'),
  lookbooks: T.t('A made lookbook stays in Lookbooks - its description and the looks dressed in it point at it'),
};
// AUDIO -> Music -> Lyrics: the saved texts - nothing goes in by hand, nothing of it goes out.
const LYRICS_STAY = T.t('A text stays in Music → Lyrics - a press opens it; "Use in Custom" takes it into Generate music');
const LYRICS_TAKE = T.t('Music → Lyrics holds only texts - saved from Generate music (its Lyrics, or "save" by Custom\'s Lyrics)');
// What a post of REFERENCES holds, readable while it is dragged: one video, one picture, or 'several'.
const REF_TYPE = 'application/x-ugc-refmedia-';

// A count with its noun, in the app's language: each noun's forms are the dictionary's.
const COUNT = {
  clip: (n) => T.tn(n, '{n} clip', '{n} clips'), picture: (n) => T.tn(n, '{n} picture', '{n} pictures'),
  sound: (n) => T.tn(n, '{n} sound', '{n} sounds'), track: (n) => T.tn(n, '{n} track', '{n} tracks'),
  post: (n) => T.tn(n, '{n} post', '{n} posts'), link: (n) => T.tn(n, '{n} link', '{n} links'),
  item: (n) => T.tn(n, '{n} item', '{n} items'), folder: (n) => T.tn(n, '{n} folder', '{n} folders'),
  project: (n) => T.tn(n, '{n} project', '{n} projects'),
};
const _plural = (n, word) => (COUNT[word] ? COUNT[word](n) : n + ' ' + word + (n === 1 ? '' : 's'));
// "The clips stay on the disk." - a noun's plural with no number.
const STAY = {
  clip: T.t('The clips stay on the disk.'), picture: T.t('The pictures stay on the disk.'), sound: T.t('The sounds stay on the disk.'),
  track: T.t('The tracks stay on the disk.'), post: T.t('The posts stay on the disk.'), link: T.t('The links stay on the disk.'),
  item: T.t('The items stay on the disk.'),
};
// The kinds that go into one another: a sound and a track.
const AUDIO_KINDS = new Set(['sounds', 'music']);

/** A tile being dragged says what it is - for a tree's node to take it. `it` is a shelf item; `many` - the
 *  picked tiles it is one of, when there are several (js/tile-select.js). */
export function setMediaDrag(dt, it, many) {
  if (!dt || !it || !it.kind) return;
  const m = it.meta || {};
  // A track says where it lies in Music: in highlights (`folder`), in a mood of it (`mood`).
  const several = Array.isArray(many) && many.length > 1
    ? many.map(x => ({ kind: x.kind, id: String(x.id), ...(x.link ? { link: x.link } : {}) })) : null;
  // A tile of THIS PROJECT carries its link: let go on another of its folders, the link moves.
  // A sound of AUDIO's own root says so (`aroot`): let go on My sounds itself it still moves.
  dt.setData(MEDIA_DRAG, JSON.stringify({ kind: it.kind, id: String(it.id), name: it.name || '', cat: m.categoryId || '', link: it.link || '',
    folder: m.folder || '', mood: m.mood || '', ...(m.inAudio ? { aroot: true } : {}), ...(several ? { many: several } : {}) }));
  dt.setData(KIND_TYPE + it.kind, '1');
  if (it.kind === 'references') {
    const files = (it.meta && it.meta.items) || [];
    dt.setData(REF_TYPE + (files.length === 1 && !(it.meta && it.meta.remote) ? files[0].type : 'several'), '1');
  }
}

function _refType(dt) {
  const t = Array.from((dt && dt.types) || []).find(x => x.startsWith(REF_TYPE));
  return t ? t.slice(REF_TYPE.length) : '';
}

function _dragKind(dt) {
  const t = Array.from((dt && dt.types) || []).find(x => x.startsWith(KIND_TYPE));
  return t ? t.slice(KIND_TYPE.length) : '';
}

// Where a node files what is let go on it: { kind, cat } ('' = no category), or null where nothing goes. Generated is a
// B-roll with no category (the server files it into its model's folder); a kind takes it with no category; Talking heads
// takes nothing; Music and its folders take a track (`folder`, `mood`).
function _target(n) {
  if (!n) return null;
  // THIS PROJECT and its folders: a link, whatever the kind.
  if (n.kind === 'plinks') return { kind: 'plinks', cat: n.cat || '', plinks: true };
  if (n.key === 'generated') return { kind: 'birols', cat: '' };
  // AUDIO itself: a sound lying there - one let go on it, a track made a sound.
  if (n.aroot) return { kind: 'sounds', cat: '', aroot: true };
  // Music -> Lyrics: only Generate music saves there - what is let go is refused in words.
  if (n.lyrics) return { kind: 'lyrics', cat: '', lyrics: true };
  // Environments / Lookbooks: only their generator files there - what is let go is refused in words.
  if (MADE[n.kind]) return { kind: n.kind, cat: '', made: true };
  // Their references and the folders in them: closed to the hand - refused in words too.
  if (n.closed) return { kind: n.kind, cat: n.cat || '', closed: true };
  if (n.kind === 'music') return { kind: 'music', cat: n.cat || '', name: n.cat ? (n.name || n.label) : '', folder: n.folder || '', mood: n.mood || '' };
  // REFERENCES: its own categories file a post; the root and the sources' folders let it go back to
  // its source's folder.
  if (n.kind === 'references') { const c = n.cat && n.cat !== UNCAT ? n.cat : ''; return { kind: 'references', cat: c, name: c ? (n.name || n.label) : '' }; }
  // Built-in (kind `sfx`) is the program's: nothing is filed into it.
  if (!n.kind || n.kind === 'heads' || n.kind === 'sfx') return null;
  const cat = n.cat && n.cat !== UNCAT ? n.cat : '';
  return { kind: n.kind, cat, name: cat ? (n.name || n.label) : '' };
}

// What letting an item of kind `from` go on a node does: 'cat' (file it there), 'kind' (another kind of video), 'ref' (a
// post within REFERENCES), 'out' (a post of one video or one picture out of it - a post of several goes by its
// files, from its viewer), or ''.
function _dropAction(n, from, refType) {
  const t = _target(n);
  if (!t || !from) return '';
  // Into THIS PROJECT anything but a saved text goes - as a link.
  if (t.plinks) return from === 'lyrics' ? '' : 'link';
  // A saved text goes nowhere; nothing goes into Lyrics - both refused in words (on Lyrics itself, nothing).
  if (from === 'lyrics' || t.lyrics) return from === 'lyrics' && t.lyrics ? '' : 'refuse';
  // A built-in sound let go on My sounds is refused - in words (on Music and AUDIO too).
  if (from === 'sfx') return t.kind === 'sounds' || t.kind === 'music' ? 'refuse' : '';
  // A made environment or lookbook goes nowhere - refused in words wherever it is let go but its own
  // folder; a picture let go on Environments / Lookbooks is refused in words too (a photo goes into references).
  if (MADE[from]) return t.kind === from ? '' : 'refuse';
  if (t.made || t.closed) return (from === 'images' || (from === 'references' && refType === 'photo')) ? 'refuse' : '';
  // A sound and a track go between Music, My sounds and AUDIO's root - the server's move
  // (POST /api/library/batch/move); a track within Music and a sound within My sounds as any tile.
  if (AUDIO_KINDS.has(from) && AUDIO_KINDS.has(t.kind)) return from !== t.kind || t.aroot ? 'audio' : from === 'music' ? 'place' : 'cat';
  // A track goes between Music, highlights and its moods - and nowhere else; nothing else goes there.
  if (from === 'music' || t.kind === 'music') return from === t.kind ? 'place' : '';
  if (from === 'references') {
    if (t.kind === 'references') return 'ref';
    if (refType === 'video' && VIDEO.has(t.kind)) return 'out';
    if (refType === 'photo' && t.kind === 'images') return 'out';
    return '';
  }
  if (t.kind === 'references') return '';
  if (t.kind === from) return 'cat';
  if (VIDEO.has(t.kind) && VIDEO.has(from)) return 'kind';
  return '';
}

// WHAT IS NEW. The server says when the newest thing under each node came (`newest`); a node
// is NEW - lit - while that is later than when it was last opened. Opening a node sees it and everything under it; a
// branch is lit while any node under it is. Kept for the whole app (the Library and Merge alike): seen in one, seen in
// both. The first time ever, everything there is counts as seen.
// REFERENCES - what comes from outside: a post of the bot, and a
// source downloaded by a link that came after the moment this first ran (js/references/news.js `since`, sent as ?srcFrom=)
// - is new DOWN TO THE INNER FOLDER: a node there is new while what lies DIRECTLY in it (`own`) is newer than when IT was
// opened, as a folder tile of the gallery too; opening a parent sees nothing under it, so a branch stays lit while a folder
// under it holds something unseen and the lit path leads to it. The other roots keep the rule above.
const LS_SEEN = 'ugc_tree_seen_v1';

function _ls(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function _lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* a private window */ } }

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const FOLDER_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4.2c.6 0 1.2.24 1.65.66L12.8 6H18.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11z"/></svg>';
const LOCK_SVG = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 6V4.5a2 2 0 1 1 4 0V7H6z"/></svg>';

/**
 * Build a tree in `host`.
 *   o.page        'mv3' | 'lib' | ... - what it remembers (open branches, the node selected) is kept under this, so two
 *                 trees of different pages never share it (what is NEW stays shared - seen in one, seen in all)
 *   o.roots       only these top nodes, by key - ['video'] shows VIDEO alone; omitted - all of them
 *   o.fallback    the node selected when none is remembered (one of `roots` when they are given)
 *   o.shape(nodes)  async, optional: the nodes as read (after `roots`) -> the nodes to show; it may drop
 *                 folders and set their `count` / `empty` (js/folder-column.js: only folders holding files of its kind,
 *                 counted with their folders inside); what it answers is what the tree indexes and draws. Omitted - as read
 *   o.status(text, bad)   say something
 *   o.onSelect(node)      a node was chosen (also once the first read lands)
 *   o.onChanged(what)     the library changed from here (a category made, renamed, deleted; a tile moved) - read the
 *                         gallery again; the tree reads itself again
 *   o.takesFiles(node)    whether files from Explorer may be let go on this node's row
 *   o.onFiles(node, files)  they were
 *   o.onMake(node, anchor)  a node with `make` - open its generator (node.make): the "create" of IMAGES ->
 *                         Environments / Lookbooks / Props, and Music's "Generate music" in its menu; without it none
 *   o.onGenerate(node, anchor)  the "generate" of a root - IMAGES, VIDEO, AUDIO (node.key); without it none
 *   o.generates   the roots that have it ('images', 'video', 'audio') - all three when omitted
 *   o.home        the word the path begins with ('Media'): nothing selected is allowed - the roots; onSelect(null)
 *                 says the page went back to them (the word pressed). `true` - the roots with no word in the path
 *   o.start       (with `home`) the node to open on - an address's; '' or omitted - the roots
 *   o.plinks()    Merge only: the open project's key - THIS PROJECT is read for it and drawn first; '' - none
 * -> { el, load(), select(key), selectFor(kind, cat), selected(), node(key), kindLabel(kind), holds(node), newFolder(node, anchor),
 *      closedSays(node) - why nothing goes into it by hand, '' when it may; home(fire) - back to the roots }
 */
export function createTree(host, o) {
  const opt = Object.assign({ page: 'lib', fallback: 'video', status: () => {}, onSelect: () => {}, onChanged: () => {} }, o || {});
  const K_OPEN = opt.page + '_tree_open_v1';
  const K_SEL = opt.page + '_tree_sel_v1';
  let nodes = [];
  const byKey = new Map();
  const parentOf = new Map();
  // one path - made so at the first answer when what was kept is not one (an older page kept several)
  let open = new Set(_ls(K_OPEN, []));
  // With `home` the tree starts at the roots, or on the node the page names - never on the last visit's.
  let sel = opt.home ? String(opt.start || '') : String(_ls(K_SEL, '') || opt.fallback);
  // At the roots: `home` given and nothing selected.
  const atHome = () => !!opt.home && !sel;
  let loaded = false;       // the first answer has been painted
  let lastPress = { key: '', at: 0 };
  let pressWas = { key: '', open: false, at: 0 };   // a top node's state at the first press of a double one
  // A top node's press draws the rows again (it opens, the others fold): the second press of a double one lands
  // on whatever row is under the pointer then - for this long after it no other row is pressed and no branch toggles.
  let settle = { key: '', until: 0 };
  const SETTLE_MS = 450;

  const el = _el('div', 'mt');
  el.setAttribute('role', 'tree');
  host.appendChild(el);

  // Whether folders can be made in a node: a kind's own node, or a folder of one - not the app's (`noAdd`:
  // highlights, its moods, the sources' folders, Built-in) and not a project of Talking heads.
  const holds = (n) => !!n && !!n.kind && CATABLE.has(n.kind) && !n.noAdd && !n.project && !n.builtin && !n.ref
    && (n.cat ? (n.own || n.locked) && !n.orphan : n.key === n.kind);
  // A folder: a category of a kind (an orphan too); one that is the person's to move.
  const isFolder = (n) => !!n && !!n.cat && !n.uncat && !n.project && !n.builtin && CATABLE.has(n.kind);
  const movable = (n) => isFolder(n) && !!n.own && !n.locked;
  const kidFolders = (n) => (((n && byKey.get(n.key)) || {}).children || []).filter(isFolder);
  const isUnderKey = (key, anc) => { for (let k = key; k; k = parentOf.get(k)) if (k === anc) return true; return false; };
  // A dragged folder may go into this node: one of its kind that holds folders, not itself or under it, not where it is.
  const takesFolder = (n) => !!_dragging && !!n && n.kind === _dragging.kind && holds(n) && !isUnderKey(n.key, _dragging.key)
    && parentOf.get(_dragging.key) !== n.key;
  // An IMAGES folder let go on Environments / Lookbooks - refused in words; on their references or a folder
  // in them too - but not where it already is, nor on itself.
  const refusesFolder = (n) => !!_dragging && !!n && ((_dragging.kind === 'images' && ((!!MADE[n.kind] && !!n.make)
    || (!!n.closed && n.key !== _dragging.key && parentOf.get(_dragging.key) !== n.key && !isUnderKey(n.key, _dragging.key))))
    // Music -> Lyrics holds no folder - any folder let go on it is refused in words.
    || !!n.lyrics);
  // Why nothing goes into a closed node by hand, in words - the server's (lib/library-cats.js closedWhy); '' for
  // any other node.
  function closedSays(node) {
    const n = node && byKey.get(node.key);
    if (!n || !n.closed) return '';
    let m = n;
    while (m && !MADE[m.make]) m = byKey.get(parentOf.get(m.key));
    const env = !m || m.make !== 'lookbooks';
    return env ? T.t('Nothing goes into Environments / references by hand - only the photo New environment makes an environment from lands there.')
      : T.t('Nothing goes into Lookbooks / references by hand - only the photo New lookbook makes a lookbook from lands there.');
  }
  const _hasType = (dt, t) => Array.from((dt && dt.types) || []).some(x => x === t || x.startsWith(t));

  function _index(list, parent) {
    for (const n of list) {
      byKey.set(n.key, n);
      if (parent) parentOf.set(n.key, parent.key);
      if (n.children) _index(n.children, n);
    }
  }

  let seen = _ls(LS_SEEN, null);
  let fresh = new Set();          // the keys of the nodes shown lit
  function _computeNew() {
    if (!seen || typeof seen !== 'object') {
      seen = {};
      const all = (list) => { for (const n of list) { seen[n.key] = n.newest || 0; if (n.children) all(n.children); } };
      all(nodes);
      _lsSet(LS_SEEN, seen);
    }
    // A node seen for the first time - an own category just made, a post just filed into it - is seen as it is: nothing
    // came into it from outside (or categories would light after a move).
    let met = false;
    const meet = (list) => { for (const n of list) { if (!(n.key in seen)) { seen[n.key] = n.newest || 0; met = true; } if (n.children) meet(n.children); } };
    meet(nodes);
    if (met) _lsSet(LS_SEEN, seen);
    // The node being looked at sees what lands in it.
    const cur = byKey.get(sel);
    if (cur) _seeAll(cur, false);
    fresh = new Set();
    const walk = (n) => {
      let g = false;
      if (n.children && n.children.length) { for (const c of n.children) if (walk(c)) g = true; }
      // REFERENCES: what lies directly in the node, against when the node itself was opened
      if (_isRef(n.key)) { if ((n.ownNews || 0) > (seen[n.key] || 0)) g = true; }
      else if (!(n.children && n.children.length)) g = (n.newest || 0) > (seen[n.key] || 0);
      if (g) fresh.add(n.key);
      return g;
    };
    for (const n of nodes) walk(n);
  }
  // A node of REFERENCES or under it - its own rule of what is new.
  const _isRef = (key) => isUnderKey(key, 'references');
  // REFERENCES is what the person's Telegram bot receives: without the bot's key it is locked - its row and tile carry
  // the lock, a press on it or on anything under it is the popup (js/key-gate.js), and nothing under it is selected.
  const _refsShut = (key) => !!key && _isRef(key) && !KG.isOpen('references');
  const _refsLock = (box) => {
    const lock = _el('span', 'mt-lock is-key');
    lock.appendChild(iconEl('lock', 12));
    lock.title = T.t('Needs the Telegram bot\'s key - Admin → API keys');
    box.appendChild(lock);
  };
  KG.onChange(() => { if (!loaded || !el.isConnected) return; if (_refsShut(sel)) { if (opt.home) home(true); else select(byKey.has(opt.fallback) ? opt.fallback : (nodes[0] || {}).key, true, true); } else paint(); });
  // Opened: under REFERENCES the node alone sees what lies in it (its folders keep theirs); elsewhere it and
  // everything under it.
  function _seeAll(n, save = true) {
    if (_isRef(n.key)) { if ((n.ownNews || 0) > (seen[n.key] || 0)) seen[n.key] = n.ownNews || 0; }
    else {
      const go = (x) => { if ((x.newest || 0) > (seen[x.key] || 0)) seen[x.key] = x.newest || 0; if (x.children) x.children.forEach(go); };
      go(n);
    }
    if (save) _lsSet(LS_SEEN, seen);
  }

  async function load() {
    let d;
    try { await KG.ready(); } catch (e) { /* unknown is open */ }
    const pk = typeof opt.plinks === 'function' ? String(opt.plinks() || '') : '';
    try { d = await fetch('/api/library/tree?srcFrom=' + newsSince() + (pk ? '&plinks=' + encodeURIComponent(pk) : '')).then(r => r.json()); }
    catch (e) { opt.status(T.t('Could not read the media tree: {why}', { why: e.message }), true); return nodes; }
    if (!d || !d.success) { opt.status((d && d.error) || T.t('Could not read the media tree'), true); return nodes; }
    nodes = d.nodes || [];
    // A tree of some roots only - Merge's Video to Music shows VIDEO alone.
    if (Array.isArray(opt.roots) && opt.roots.length) nodes = nodes.filter(n => opt.roots.includes(n.key));
    // The page's own shape of the nodes - the folder column keeps only folders of its kind of file (`shape`).
    if (typeof opt.shape === 'function') nodes = (await opt.shape(nodes)) || nodes;
    byKey.clear(); parentOf.clear();
    _index(nodes, null);
    // A remembered node that is not there any more (a category deleted, renamed elsewhere): its kind, else the fallback -
    // and the page is told, once it has had its first answer (it reads the gallery for the first one itself).
    const before = sel;
    const shut = _refsShut(sel);
    if (!atHome() && (!byKey.has(sel) || shut)) {
      // A remembered "Uncategorized" is not there either: what it held lies in its kind - a B-roll's in Generated.
      // There is no B-rolls node (VIDEO -> Generated holds the models' folders): a remembered B-roll place that
      // is not there - B-rolls itself, a folder deleted, a model's folder emptied - opens Generated.
      const kind = /^birols(:|$)/.test(String(sel)) ? 'generated' : String(sel).split(':')[0];
      // With `home`, no kind to fall back on is the roots.
      sel = byKey.has(kind) && !shut ? kind : opt.home ? '' : (byKey.has(opt.fallback) ? opt.fallback : ((nodes[0] || {}).key || ''));
      _lsSet(K_SEL, sel);
    }
    // What is open: at the first answer one path to the node selected (what was kept, when it is one); later
    // the path to the node selected only when that node had to change - a reading after a move or a drop folds nothing.
    if (!loaded) _firstOpen();
    else if (sel !== before) { if (atHome()) { open = new Set(); _save(); } else _setOpen(sel, _isTop(sel)); }
    else _dropGone();
    _computeNew();
    paint();
    if (loaded && sel !== before) { if (byKey.has(sel)) opt.onSelect(byKey.get(sel)); else if (atHome()) opt.onSelect(null); }
    loaded = true;
    return nodes;
  }

  // ── One path open ──
  const _isTop = (key) => nodes.some(n => n.key === key);
  const _isUnder = (key, anc) => key !== anc && isUnderKey(key, anc);
  const _save = () => _lsSet(K_OPEN, [...open]);
  // The path to `key` opened - it too with `self` -, everything off its line folded: the other top nodes and the sibling
  // folders with all that is open in them. What is open in `key` stays only when it was open itself. -> whether it changed.
  function _setOpen(key, self) {
    if (!byKey.has(key)) return false;
    const was = open.has(key);
    const next = new Set();
    for (let p = parentOf.get(key); p; p = parentOf.get(p)) next.add(p);
    if (self || was) next.add(key);
    if (was) for (const k of open) if (_isUnder(k, key)) next.add(k);
    const changed = next.size !== open.size || [...next].some(k => !open.has(k));
    open = next;
    if (changed) _save();
    return changed;
  }
  // A node folded folds what was open in it - opened again, it shows its first level only.
  function _fold(key) {
    for (const k of [...open]) if (k === key || _isUnder(k, key)) open.delete(k);
    _save();
  }
  // Whether what is open is one path from a top node down (each open node's parent open, one open child at most).
  function _onePath() {
    const taken = new Set();
    for (const k of open) {
      if (!byKey.has(k)) return false;
      const p = parentOf.get(k) || '';
      if ((p && !open.has(p)) || taken.has(p)) return false;
      taken.add(p);
    }
    return true;
  }
  // Nodes not there any more (a folder deleted) are forgotten.
  function _dropGone() {
    let gone = false;
    for (const k of [...open]) if (!byKey.has(k)) { open.delete(k); gone = true; }
    if (gone) _save();
  }
  // The first answer - the node selected is the address's (the page keeps it under K_SEL first) or the last visit's: the
  // path to it opened and the rest folded, as the page's select does; what was open in it stays while that is one path.
  function _firstOpen() {
    // At the roots everything is folded.
    if (atHome()) { open = new Set(); _save(); return; }
    _dropGone();
    _setOpen(sel, _isTop(sel));
    if (!_onePath()) { const self = open.has(sel); open = new Set(); _setOpen(sel, self || _isTop(sel)); }
    _save();
  }

  // The selection moved, nothing opened: the rows stay - a double press on a name must find the row it began on.
  function _mark() {
    for (const r of el.querySelectorAll('.mt-row')) {
      r.classList.toggle('is-sel', r.dataset.key === sel);
      r.classList.toggle('is-new', fresh.has(r.dataset.key));
    }
  }

  function paint() {
    const top = el.scrollTop;
    el.textContent = '';
    for (const n of nodes) _rows(n, 0);
    el.scrollTop = top;
  }

  function _rows(n, depth) {
    el.appendChild(_row(n, depth));
    if (n.children && n.children.length && open.has(n.key)) for (const c of n.children) _rows(c, depth + 1);
  }

  function _row(n, depth) {
    const isGroup = depth === 0;
    const isCat = !!n.cat && !n.uncat && !n.project;
    // GOLD IS WHERE A GENERATOR'S BUTTON IS, one look in both
    // trees: Environments / Lookbooks / Props - "create" (always there); the roots IMAGES / VIDEO / AUDIO - "generate"
    // (always there) - each only where the page gives the opener (`onMake`, `onGenerate`). Music has neither: its "Generate
    // music" is in the menu under the right button.
    const creates = !!n.make && !!MADE[n.kind] && typeof opt.onMake === 'function';
    const gens = isGroup && GEN_ROOTS.has(n.key) && typeof opt.onGenerate === 'function'
      && (!Array.isArray(opt.generates) || opt.generates.includes(n.key));
    const row = _el('div', 'mt-row' + (isGroup ? ' is-group' : '') + (n.key === sel ? ' is-sel' : '') + (fresh.has(n.key) ? ' is-new' : '')
      + (n.empty ? ' is-empty' : '') + (n.locked ? ' is-locked' : '') + (isCat ? ' is-cat' : '')
      + (creates ? ' is-made' : '') + (gens ? ' is-gen' : ''));
    row.dataset.key = n.key;
    row.setAttribute('role', 'treeitem');
    row.style.paddingLeft = (3 + depth * 11) + 'px';
    const has = !!(n.children && n.children.length);
    if (has) row.setAttribute('aria-expanded', open.has(n.key) ? 'true' : 'false');

    // the twisty is the interface's chevron, turned when open
    const tw = _el('button', 'mt-tw');
    if (has) tw.appendChild(iconEl('chevron-right', 12));
    tw.type = 'button';
    tw.tabIndex = -1;
    if (has) {
      tw.classList.toggle('is-open', open.has(n.key));
      tw.title = open.has(n.key) ? T.t('Fold') : T.t('Open');
      tw.addEventListener('click', (e) => { e.stopPropagation(); toggle(n.key); });
    } else tw.disabled = true;
    row.appendChild(tw);

    const name = _el('span', 'mt-name', n.label);
    name.title = _tipOf(n);
    row.appendChild(name);
    // The count in brackets right after the name - the name is cut, the count never -,
    // and at the right edge two columns of one width on every row: the lock, then the button (a generator's "generate" /
    // "create", or "+" / ✕ under the pointer): locks and buttons one under another whatever the count is.
    row.appendChild(_el('span', 'mt-n', '(' + int(n.count || 0) + ')'));   // in mono, "(1,260)"
    const side = _el('span', 'mt-side');
    const lockCol = _el('span', 'mt-lk');
    const btnCol = _el('span', 'mt-bt');
    side.append(lockCol, btnCol);
    row.appendChild(side);
    if (n.key === 'references' && _refsShut(n.key)) { _refsLock(lockCol); row.classList.add('is-keyshut'); }
    else if (n.locked) {
      const lock = _el('span', 'mt-lock');
      lock.innerHTML = LOCK_SVG;
      lock.title = n.tip || (n.builtin ? T.t('Built into the app - read only') : T.t('Required - it cannot be renamed, moved or deleted'));
      lockCol.appendChild(lock);
    }
    // A kind that can have folders: "+" makes one at its top - unless a generator has the row (a root's "generate";
    // Music, whose generator is in its menu - as its "New folder" is): then "New folder" is in the
    // menu under the right button and on the gallery's empty space.
    if (holds(n) && !n.cat && !(n.make && typeof opt.onMake === 'function') && !gens) {
      const add = _el('button', 'mt-act mt-add u-btn is-s is-icon is-quiet');
      add.appendChild(iconEl('plus', 14));
      add.type = 'button';
      add.tabIndex = -1;
      add.title = T.t('New folder in {place}', { place: n.label || n.kind });
      add.addEventListener('click', (e) => { e.stopPropagation(); if (_refsShut(n.key)) KG.explain('references', add); else _newFolder(n, add); });
      btnCol.appendChild(add);
    }
    // Environments / Lookbooks / Props: "create", in a blue frame
    // (gold under the pointer itself), opens their generator - where, the page says (`onMake`).
    if (creates) {
      const mk = _el('button', 'mt-make u-btn is-s is-gen', T.t('Create'));
      mk.type = 'button';
      mk.tabIndex = -1;
      mk.title = T.t('{what} - opens the generator', { what: n.makeLabel });
      mk.addEventListener('click', (e) => { e.stopPropagation(); opt.onMake(n, mk); });
      mk.addEventListener('dblclick', (e) => e.stopPropagation());
      btnCol.appendChild(mk);
    }
    // A root's "generate" - IMAGES the pictures chat, VIDEO the video chat, AUDIO the sound window.
    if (gens) {
      const g = _el('button', 'mt-gen u-btn is-s is-gen', T.t('Generate'));
      g.type = 'button';
      g.tabIndex = -1;
      g.title = GEN_TIP[n.key];
      g.addEventListener('click', (e) => { e.stopPropagation(); opt.onGenerate(n, g); });
      g.addEventListener('dblclick', (e) => e.stopPropagation());
      btnCol.appendChild(g);
    }
    if (isCat && n.own && !n.locked) {
      const x = _el('button', 'mt-act mt-x u-btn is-s is-icon is-quiet is-del u-x', '');
      x.type = 'button';
      x.tabIndex = -1;
      x.title = T.t('Delete this folder');
      x.addEventListener('mousedown', (e) => e.stopPropagation());
      x.addEventListener('click', (e) => { e.stopPropagation(); _askDelete(n, row); });
      btnCol.appendChild(x);
    }

    // A press selects; the second press of a double one does not read the gallery again.
    row.addEventListener('click', () => {
      if (_refsShut(n.key)) { KG.explain('references', row); return; }
      const now = Date.now();
      // Right after a top node's press drew the rows again, the row now under the pointer is not pressed.
      if (now < settle.until && n.key !== settle.key) return;
      const again = lastPress.key === n.key && now - lastPress.at < 450;
      // Whether a top node was open before the first press of a double one - the double press folds only that.
      if (!again) pressWas = { key: n.key, open: open.has(n.key), at: now };
      lastPress = { key: n.key, at: now };
      if (again && n.key === sel) return;
      // A top node opens on ONE press - selected and opened, the others folded with all in them.
      if (isGroup && has) {
        if (_choose(n.key, { fire: true, open: true })) settle = { key: n.key, until: now + SETTLE_MS };
        return;
      }
      // Deeper a press only selects: nothing opens or folds, the rows stay (a double press must find its row).
      _choose(n.key, { fire: true });
    });
    // A double press opens or folds a branch; on a category's name it renames it.
    // Not on a top node - one press opened it -, and not on the rows a top node's press has just drawn under the pointer.
    const settled = () => Date.now() >= settle.until;
    // A top node OPEN
    // before the double press is folded by it (its first press only selected it); a folded one stays opened by its first press.
    if (has) {
      row.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (isGroup) {
          if (pressWas.key === n.key && pressWas.open && Date.now() - pressWas.at < 700 && open.has(n.key)) toggle(n.key);
          return;
        }
        if (settled()) toggle(n.key);
      });
    }
    if (isCat && n.own && !n.locked) name.addEventListener('dblclick', (e) => { e.stopPropagation(); if (settled()) _rename(n, row); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); _menu(n, row, e.clientX, e.clientY); });
    _takesDrops(row, n);
    if (has) row.addEventListener('dragover', (e) => _spring(n, e));
    if (movable(n)) _draggable(row, n);
    return row;
  }

  // ── A folded branch opens under a drag ──
  // A tile - or files from Explorer - held over a folded branch's row for 0.6 s opens it: a root or a category, whether it
  // takes the drop itself or not (VIDEO, AUDIO do not), so the drop can go straight into a folder under it. Only rows below
  // it come out, so the row under the pointer stays where it is: no accordion fold of the other roots mid-drag. What
  // opened stays open. Keyed by the node, not its row - a paint replaces every row; any dragover off that row, a drop or
  // the drag's end forgets it.
  const SPRING_MS = 600;
  let spring = null;            // { key, timer, watch }
  function _unspring() {
    if (!spring) return;
    clearTimeout(spring.timer);
    document.removeEventListener('dragover', spring.watch, true);
    document.removeEventListener('drop', _unspring, true);
    document.removeEventListener('dragend', _unspring, true);
    spring = null;
  }
  function _spring(n, e) {
    if (open.has(n.key) || (spring && spring.key === n.key)) return;
    const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
    if (!types.includes(MEDIA_DRAG) && !types.includes('Files') && !types.includes(FOLDER_DRAG)) return;
    _unspring();
    const watch = (ev) => {
      const r = ev.target && ev.target.closest ? ev.target.closest('.mt-row') : null;
      if (!r || r.dataset.key !== n.key || !el.contains(r)) _unspring();
    };
    const timer = setTimeout(() => {
      _unspring();
      if (open.has(n.key) || !byKey.has(n.key)) return;
      // Under a drag nothing folds - the next opening makes it one path again.
      open.add(n.key);
      _save();
      paint();
    }, SPRING_MS);
    spring = { key: n.key, timer, watch };
    document.addEventListener('dragover', watch, true);
    document.addEventListener('drop', _unspring, true);
    document.addEventListener('dragend', _unspring, true);
  }

  // A tile let go here - or files from Explorer, on a node that takes them (the page says, `takesFiles`).
  // The same on a node's row, its folder tile and its word in the path.
  function _takesDrops(target, n) {
    const _anyFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
    const _files = (e) => _anyFiles(e) && typeof opt.takesFiles === 'function' && opt.takesFiles(n);
    target.addEventListener('dragover', (e) => {
      // Files from Explorer over a closed node: taken here (not lit), to be refused in words - so the page under
      // it does not upload them either.
      // Music -> Lyrics the same: it takes no file.
      if ((n.closed || n.lyrics) && _anyFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; return; }
      // A folder dragged onto a folder of its kind, or the kind's row.
      if (_hasType(e.dataTransfer, FOLDER_DRAG)) {
        // An IMAGES folder over Environments / Lookbooks: taken, to be refused in words (not lit).
        if (refusesFolder(n)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; return; }
        if (!takesFolder(n)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        target.classList.add('is-drop');
        return;
      }
      if (_files(e)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        target.classList.add('is-drop');
        return;
      }
      if (!_dropAction(n, _dragKind(e.dataTransfer), _refType(e.dataTransfer))) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      target.classList.add('is-drop');
    });
    target.addEventListener('dragleave', () => target.classList.remove('is-drop'));
    target.addEventListener('drop', (e) => {
      target.classList.remove('is-drop');
      if ((n.closed || n.lyrics) && _anyFiles(e)) { e.preventDefault(); e.stopPropagation(); opt.status(n.lyrics ? LYRICS_TAKE : closedSays(n), true); return; }
      if (_hasType(e.dataTransfer, FOLDER_DRAG)) {
        if (refusesFolder(n)) {
          e.preventDefault();
          e.stopPropagation();
          _dragging = null;
          opt.status(n.lyrics ? LYRICS_TAKE : n.closed ? closedSays(n) : T.t('{place} holds only what its generator made - a folder does not go into it', { place: MADE[n.kind] }), true);
          return;
        }
        if (!takesFolder(n)) return;
        e.preventDefault();
        e.stopPropagation();
        const d = _dragging;
        _dragging = null;
        _moveFolder(d, n);
        return;
      }
      if (_files(e)) {
        e.preventDefault();
        e.stopPropagation();
        opt.onFiles(n, Array.from(e.dataTransfer.files || []));
        return;
      }
      if (!_dropAction(n, _dragKind(e.dataTransfer), _refType(e.dataTransfer))) return;
      e.preventDefault();
      e.stopPropagation();
      let it = null;
      try { it = JSON.parse(e.dataTransfer.getData(MEDIA_DRAG)); } catch (err) { return; }
      if (it) _take(n, it, _refType(e.dataTransfer));
    });
  }

  // ── Folders in the gallery ──
  // A node opened from its folder tile or its word in the path: selected, its own branch opened too, as Explorer's tree
  // follows the folder you went into - and what is off its line folded.
  function openNode(key) {
    const n = byKey.get(key);
    if (!n) return;
    _choose(key, { fire: true, repaint: true, path: true, open: !!(n.children && n.children.length) });
  }

  // What a node's tooltip says: the server's own word (`tip`), else what it is.
  const _tipOf = (n) => n.tip || (n.builtin ? T.t('{name} - built into the app: read only', { name: n.label })
    : n.locked ? T.t('{name} - required: it cannot be renamed, moved or deleted', { name: n.label })
    : n.empty ? T.t('{name} - empty', { name: n.label }) : n.label);

  /** The folders of a node, as tiles - first in its gallery. null when it has none. With `home` and no node:
   *  the roots - REFERENCES, VIDEO, IMAGES, AUDIO. */
  function foldersEl(node) {
    const n = node && byKey.get(node.key);
    const list = n ? n.children : (!node && opt.home ? nodes : null);
    if (!list || !list.length) return null;
    const box = _el('div', 'mt-folders' + (n ? '' : ' is-roots'));
    for (const c of list) {
      const t = _el('button', 'mt-ftile' + (c.empty ? ' is-empty' : '') + (c.locked ? ' is-locked' : '') + (fresh.has(c.key) ? ' is-new' : ''));
      t.type = 'button';
      t.dataset.key = c.key;
      t.title = _tipOf(c) + ' · ' + _plural(c.count || 0, 'item');
      const ic = _el('span', 'mt-ficon');
      ic.innerHTML = FOLDER_SVG;
      t.appendChild(ic);
      const nm = _el('span', 'mt-fname', c.label);
      t.appendChild(nm);
      if (c.key === 'references' && _refsShut(c.key)) { _refsLock(t); t.classList.add('is-keyshut'); }
      else if (c.locked) {
        const lock = _el('span', 'mt-lock');
        lock.innerHTML = LOCK_SVG;
        t.appendChild(lock);
      }
      t.appendChild(_el('span', 'mt-fn', int(c.count || 0)));
      t.addEventListener('click', () => { if (_refsShut(c.key)) KG.explain('references', t); else openNode(c.key); });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); _menu(c, t, e.clientX, e.clientY); });
      _takesDrops(t, c);
      if (movable(c)) _draggable(t, c);
      box.appendChild(t);
    }
    return box;
  }

  /** The path to a node over its gallery - "AUDIO / SFX / My sounds"; every word but the last opens its folder.
   *  With `home` it begins with that word - "Media / AUDIO / SFX" -, which goes back to the roots; at the roots it is alone. */
  function crumbsEl(node) {
    const box = _el('div', 'mt-crumbs');
    const chain = [];
    for (let k = node && node.key; k && byKey.has(k); k = parentOf.get(k)) chain.unshift(byKey.get(k));
    const word = typeof opt.home === 'string' ? opt.home : '';
    if (word) {
      const here = !chain.length;
      const w = _el(here ? 'span' : 'button', 'mt-crumb is-home' + (here ? ' is-here' : ''), word);
      if (!here) {
        w.type = 'button';
        w.title = T.t('Back to {place} - REFERENCES, VIDEO, IMAGES, AUDIO', { place: word });
        w.addEventListener('click', () => home(true));
      }
      box.appendChild(w);
    }
    chain.forEach((c, i) => {
      if (i || word) box.appendChild(_el('span', 'mt-crumb-sep', '/'));
      const last = i === chain.length - 1;
      const w = _el(last ? 'span' : 'button', 'mt-crumb' + (last ? ' is-here' : '') + (i === 0 ? ' is-top' : ''), c.label);
      if (!last) {
        w.type = 'button';
        w.title = T.t('Open {name}', { name: c.label });
        w.addEventListener('click', () => openNode(c.key));
      }
      _takesDrops(w, c);
      box.appendChild(w);
    });
    return box;
  }

  // ▸ or a double press: folded - with what was open in it -, or opened with everything off its line folded.
  function toggle(key) {
    if (open.has(key)) _fold(key); else _setOpen(key, true);
    paint();
  }

  // A node chosen. `how`: fire - the page is told; repaint - the rows drawn again anyway; path - the path to it opened and
  // what is off its line folded; open - it opens too. Neither: a row's own press - nothing opens or folds, so the
  // rows stay. -> whether what is open changed.
  function _choose(key, how) {
    if (!byKey.has(key)) return false;
    if (_refsShut(key)) return false;
    const h = how || {};
    sel = key;
    _lsSet(K_SEL, sel);
    // Opened: it is seen (under REFERENCES only what lies in it; elsewhere everything under it too) - and its branch
    // is lit only while something else in it is new.
    _seeAll(byKey.get(key));
    _computeNew();
    const changed = h.path || h.open ? _setOpen(key, !!h.open) : false;
    if (changed || h.repaint) paint(); else _mark();
    const row = el.querySelector('.mt-row.is-sel');
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (h.fire) opt.onSelect(byKey.get(key));
    return changed;
  }

  // The page selects a node - an address, a file that landed, files let go on a row: the path to it opens and
  // the rest folds; a top node opens itself, as its press does.
  function select(key, fire, repaint) {
    _choose(key, { fire, repaint, path: true, open: _isTop(key) });
  }

  // Back to the roots - the shelf pressed, the path's first word: nothing selected, every branch
  // folded. `fire` - the page is told (onSelect(null)). Only with `home`.
  function home(fire) {
    if (!opt.home) return;
    sel = '';
    _lsSet(K_SEL, sel);
    open = new Set();
    _save();
    _computeNew();
    paint();
    el.scrollTop = 0;
    if (fire) opt.onSelect(null);
  }

  // A kind and a category, as a node: no category is the kind itself - a B-roll's is Generated (no Uncategorized node).
  function selectFor(kind, cat, fire = true) {
    const none = !cat || cat === UNCAT;
    const want = none ? (kind === 'birols' ? 'generated' : kind) : kind + ':' + cat;
    // B-rolls has no node of its own: a B-roll place not shown is Generated.
    select(byKey.has(want) ? want : (kind === 'birols' ? 'generated' : kind), fire);
  }

  const kindLabel = (kind) => ((byKey.get(kind) || {}).label) || kind;
  // Where what has no category of a kind lies, in words: the kind itself - a B-roll's, Generated.
  const homeName = (kind) => (kind === 'birols' ? T.t('Generated') : kindLabel(kind));
  // A place in Music, in words: "Music", "Music · highlights", "highlights · calm".
  const musicPlace = (folder, mood) => (mood ? T.t('highlights') + ' · ' + (((byKey.get('music:highlights:' + mood)) || {}).label || mood)
    : folder ? T.t('Music') + ' · ' + T.t('highlights') : T.t('Music'));

  // After the page has read its gallery again - a read may end by clearing the status line.
  async function _after(msg, what) {
    await load();
    try { await opt.onChanged(what || {}); } catch (e) { /* the page says its own */ }
    if (msg) opt.status(msg);
  }

  // ── A tile let go on a node ──
  async function _take(n, it, refType) {
    const act = _dropAction(n, it.kind, refType);
    const t = _target(n);
    if (!act || !t) return;
    if (act === 'refuse') {
      // A picture let go on the closed folder it already lies in: nothing to say.
      if (t.closed && !MADE[it.kind] && !(Array.isArray(it.many) && it.many.length > 1) && (it.cat || '') === t.cat) return;
      opt.status(it.kind === 'lyrics' ? LYRICS_STAY : t.lyrics ? LYRICS_TAKE
        : MADE[it.kind] ? MADE_SAYS[it.kind]
        : t.made ? T.t('Only {maker} puts pictures into {place} (+ on it)', { maker: MADE_BY[t.kind], place: MADE[t.kind] })
        : t.closed ? closedSays(n)
        : T.t('A built-in sound stays in Built-in - ★ puts it in Favorites, Cut… (the right button) makes a piece of your own'), true);
      return;
    }
    // THIS PROJECT: linked there (or, a link of it, moved there) - the file stays where it lies.
    if (act === 'link') { await _link(n, it); return; }
    const item = { kind: it.kind, id: it.id, meta: { categoryId: it.cat || '' } };
    // Where it is now, in words: a B-roll with no category lies in Generated, the rest in their kind.
    const where = t.aroot ? 'AUDIO' : t.cat ? n.label : homeName(t.kind);
    // Several picked tiles: one request; each goes as it would alone, or stays and says why.
    if (Array.isArray(it.many) && it.many.length > 1) { await _takeMany(n, t, it.many, where); return; }
    // A sound or a track into the other, or into AUDIO's root, or out of it: the server
    // moves it (its record changes store, its file follows) - one request, as for several.
    if (act === 'audio' || (act === 'cat' && it.aroot)) { await _takeMany(n, t, [{ kind: it.kind, id: String(it.id) }], where, it.name); return; }
    try {
      // A track: into Music, the highlights folder, or the one mood its preset made it for -
      // the rule is the store's (lib/music-store.js place); a refusal comes back in words.
      if (act === 'place') {
        // An own folder of Music: the track is filed there (and leaves highlights).
        if (t.cat) {
          if ((it.cat || '') === t.cat) return;
          await A.setCategory(item, t.cat, t.name);
          await _after(T.t('"{name}" is in {place}', { name: it.name || T.t('It'), place: n.label }), { moved: it });
          return;
        }
        if ((it.folder || '') === t.folder && (it.mood || '') === t.mood && !it.cat) return;
        const r = await fetch('/api/audio/music/' + encodeURIComponent(it.id) + '/place', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: t.folder, mood: t.mood }),
        }).then(x => x.json()).catch(() => null);
        if (!r || !r.success) { opt.status((r && r.error) || T.t('Could not move the track'), true); return; }
        await _after(T.t('"{name}" is in {place}', { name: it.name || T.t('It'), place: musicPlace(r.folder, r.mood) }), { moved: it });
        return;
      }
      // A post: filed within REFERENCES, or - one video, one picture - out of it into VIDEO or IMAGES.
      if (act === 'ref' || act === 'out') {
        if (act === 'ref' && (it.cat || '') === t.cat) return;
        const r = await fetch('/api/references/' + encodeURIComponent(it.id) + '/move', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: 'all', to: { kind: t.kind, cat: t.cat, label: t.name } }),
        }).then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || T.t('not moved'));
        if (r.skipped && r.skipped.length && !r.moved) throw new Error(r.skipped[0].why);
        const there = act === 'ref' ? (t.cat ? T.t('REFERENCES') + ' · ' + n.label : T.t('its source\'s folder in REFERENCES')) : where;
        await _after(T.t('"{name}" is in {place}', { name: it.name || T.t('It'), place: there }), { moved: it });
        return;
      }
      if (act === 'cat') {
        if ((it.cat || '') === t.cat) return;
        await A.setCategory(item, t.cat, t.name);
        await _after(T.t('"{name}" is in {place}', { name: it.name || T.t('It'), place: where }), { moved: it });
      } else if (act === 'kind') {
        // Off its own kind's category first: a category is one kind's, and kept across it would come back as a stray.
        if (it.cat) await A.setCategory(item, '', '');
        await A.setKind(item, t.kind);
        if (t.cat) await A.setCategory({ kind: t.kind, id: it.id }, t.cat, t.name);
        await _after(T.t('"{name}" moved to {place}', { name: it.name || T.t('It'), place: t.kind === 'birols' && !t.cat ? where : kindLabel(t.kind) + (t.cat ? ' · ' + n.label : '') }), { moved: it });
      }
    } catch (e) { opt.status(T.t('Could not move it: {why}', { why: e.message }), true); await load(); }
  }

  // Things let go on THIS PROJECT or one of its folders: links there - one request for all.
  async function _link(n, it) {
    const key = typeof opt.plinks === 'function' ? String(opt.plinks() || '') : '';
    if (!key) { opt.status(T.t('Open a project first - THIS PROJECT is its own'), true); return; }
    const many = Array.isArray(it.many) && it.many.length > 1 ? it.many : [{ kind: it.kind, id: it.id, link: it.link || '' }];
    let r = null;
    try {
      r = await fetch('/api/plinks/put', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, folder: n.cat || '', items: many.map(x => ({ kind: x.kind, id: x.id, ...(x.link ? { link: x.link } : {}) })) }) }).then(x => x.json());
      if (!r || !r.success) throw new Error((r && r.error) || T.t('not linked'));
    } catch (e) { opt.status(T.t('Could not put it there: {why}', { why: e.message }), true); return; }
    const said = [r.added ? T.t('{what} in {place}', { what: _plural(r.added, 'link'), place: n.label }) : '',
      r.moved ? T.t('{what} moved to {place}', { what: _plural(r.moved, 'link'), place: n.label }) : '',
      r.had ? T.tn(r.had, 'one was there already', '{n} were there already') : ''].filter(Boolean).join(' · ');
    await _after(said || T.t('Already in {place}', { place: n.label }), { linked: true });
  }

  // `one` - the name of the one tile moved this way (a sound or a track): said by its name.
  async function _takeMany(n, t, many, where, one) {
    const there = t.kind === 'music' ? (t.cat ? n.label : musicPlace(t.folder, t.mood))
      : t.kind === 'references' ? (t.cat ? T.t('REFERENCES') + ' · ' + n.label : T.t('their sources\' folders in REFERENCES')) : where;
    let r = null;
    try {
      r = await fetch('/api/library/batch/move', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: many, to: { kind: t.kind, cat: t.cat || '', label: t.name || '', folder: t.folder || '', mood: t.mood || '',
          ...(t.aroot ? { aroot: true } : {}) } }),
      }).then(x => x.json());
      if (!r || !r.success) throw new Error((r && r.error) || T.t('not moved'));
    } catch (e) { opt.status((one ? T.t('Could not move it: {why}', { why: e.message }) : T.t('Could not move them: {why}', { why: e.message })), true); await load(); return; }
    const sk = r.skipped || [];
    const whys = [...new Set(sk.map(x => x.why))].slice(0, 3).join('; ');
    const msg = one != null && many.length === 1
      ? (r.done ? T.t('"{name}" is in {place}', { name: one || T.t('It'), place: there }) : T.t('Not moved: {why}', { why: whys }))
      : (r.done ? T.t('{what} in {place}', { what: _plural(r.done, 'item'), place: there }) : T.t('Nothing moved'))
        + (sk.length ? ' · ' + T.t('{n} stayed: {why}', { n: sk.length, why: whys }) : '');
    await _after(sk.length && !r.done ? '' : msg, { moved: { many } });
    if (sk.length && !r.done) opt.status(msg, true);
  }

  // ── Folders ──
  const _lcName = (c) => String(c.name || c.label).toLowerCase();

  // A folder dragged by its row or its tile.
  function _draggable(target, n) {
    target.draggable = true;
    target.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      _dragging = { kind: n.kind, id: n.cat, key: n.key, label: n.label };
      e.dataTransfer.setData(FOLDER_DRAG, JSON.stringify(_dragging));
      e.dataTransfer.setData(FOLDER_KIND + n.kind, '1');
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
      document.addEventListener('dragend', () => { _dragging = null; }, { once: true });
    });
  }

  async function _newFolder(n, anchor) {
    if (!holds(n)) return;
    const kind = n.kind;
    const cat = await askName({
      anchor, title: T.t('New folder in {place}', { place: n.label || kind }), okLabel: T.t('Create'), maxLength: 60,
      check: (name) => {
        const taken = kidFolders(n).find(c => _lcName(c) === name.toLowerCase());
        return taken ? T.t('There is already a folder called {name} here.', { name: taken.label }) : '';
      },
      submit: async (name) => (kind === 'plinks' ? (await _pl('POST', '/api/plinks/folder', { name, parent: n.cat || '' })) : await A.addFolder(kind, name, n.cat || '')).cat,
    });
    if (!cat) return;
    _setOpen(n.key, true);
    await _after(T.t('Made the folder "{name}"', { name: cat.label }), { cats: kind });
  }

  async function _rename(n, anchor) {
    const parent = byKey.get(parentOf.get(n.key));
    const next = await askName({
      anchor, title: T.t('Rename folder'), value: n.name || n.label, okLabel: T.t('Rename'), maxLength: 60,
      check: (name) => {
        const taken = kidFolders(parent).find(c => c.key !== n.key && _lcName(c) === name.toLowerCase());
        return taken ? T.t('There is already a folder called {name} here.', { name: taken.label }) : '';
      },
      submit: async (name) => {
        if (name === (n.name || n.label)) return null;
        return (n.kind === 'plinks' ? await _pl('PATCH', '/api/plinks/folder/' + encodeURIComponent(n.cat), { name }) : await A.renameCat(n.kind, n.cat, name)).cat;
      },
    });
    if (!next) return;
    await _after(T.t('Renamed to "{name}"', { name: next.label }), { cats: n.kind });
  }

  // Into another folder of its kind, or the kind's top (`t` is the kind's own node). Refused in words by the server.
  async function _moveFolder(d, t) {
    if (!d || !t) return;
    let r = null;
    // A folder of THIS PROJECT moves among its folders.
    if (d.kind === 'plinks') {
      try { r = await _pl('PATCH', '/api/plinks/folder/' + encodeURIComponent(d.id), { parent: t.cat || '' }); }
      catch (e) { opt.status(e.message || T.t('Could not move the folder'), true); return; }
      _setOpen(t.key, true);
      await _after(T.t('"{name}" is in {place} now', { name: d.label, place: t.label }), { cats: 'plinks' });
      return;
    }
    try {
      r = await fetch('/api/library/cats/' + encodeURIComponent(d.id) + '/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: d.kind, parent: t.cat || '' }),
      }).then(x => x.json());
    } catch (e) { r = { success: false, error: e.message }; }
    if (!r || !r.success) { opt.status((r && r.error) || T.t('Could not move the folder'), true); return; }
    _setOpen(t.key, true);
    await _after(T.t('"{name}" is in {place} now', { name: d.label, place: t.cat ? t.label : (t.label || kindLabel(d.kind)) }), { cats: d.kind, moved: { folder: d.id } });
  }

  // Delete: what is in it ONE LEVEL UP - its files into the folder it is in (at the top, the kind
  // itself), its folders that folder's (the safe one, chosen) - or deleted with everything in it and under it, and then the
  // projects using them are named (lib/timeline-media.js usage): there they turn red.
  let _pop = null;
  function _closePop() {
    if (!_pop) return;
    _pop.el.remove();
    document.removeEventListener('mousedown', _pop.away, true);
    Layers.close(_pop.layer);
    _pop = null;
  }

  // A request about THIS PROJECT's folders - the open project's key added; refused in words.
  async function _pl(method, url, body) {
    const key = typeof opt.plinks === 'function' ? String(opt.plinks() || '') : '';
    const r = await fetch(url + (method === 'DELETE' ? (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key) : ''), {
      method, headers: { 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : JSON.stringify(Object.assign({ key }, body || {})),
    }).then(x => x.json()).catch(() => null);
    if (!r || !r.success) throw new Error((r && r.error) || T.t('the server did not answer'));
    return r;
  }
  // A folder of THIS PROJECT: only its links go - the files stay where they lie in the library.
  function _askDeleteLinks(n, anchor) {
    const box = _el('div', 'mt-pop u-ask is-float');
    let folders = 0;
    const walk = (x) => { for (const c of kidFolders(x)) { folders++; walk(c); } };
    walk(n);
    box.appendChild(_el('b', 'mt-pop-head', T.t('Delete "{name}"?', { name: n.label })));
    box.appendChild(_el('div', 'mt-pop-note', T.t('{what} go with it - the files stay in the library.', {
      what: (n.count ? _plural(n.count, 'link') : T.t('No links')) + (folders ? ' ' + T.t('and') + ' ' + _plural(folders, 'folder') : '') })));
    const btns = _el('div', 'mt-pop-btns u-ask-r');
    const cancel = _el('button', 'mt-pop-btn u-btn is-s', T.t('Cancel'));
    cancel.type = 'button';
    const go = _el('button', 'mt-pop-btn u-btn is-s', T.t('Delete folder'));
    go.type = 'button';
    btns.append(cancel, go);
    box.appendChild(btns);
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    const w = box.getBoundingClientRect();
    box.style.left = Math.round(Math.max(6, Math.min(r.right - w.width, window.innerWidth - w.width - 6))) + 'px';
    box.style.top = Math.round(Math.min(r.bottom + 4, window.innerHeight - w.height - 6)) + 'px';
    const away = (e) => { if (!box.contains(e.target)) _closePop(); };
    const layer = Layers.open(box, { modal: false, name: 'delete a folder', onEsc: _closePop });
    _pop = { el: box, away, layer };
    document.addEventListener('mousedown', away, true);
    cancel.addEventListener('click', _closePop);
    go.addEventListener('click', async () => {
      go.disabled = true; cancel.disabled = true;
      try {
        const d = await _pl('DELETE', '/api/plinks/folder/' + encodeURIComponent(n.cat));
        _closePop();
        await _after(d.links ? T.t('Deleted the folder and {what} - the files stay', { what: _plural(d.links, 'link') }) : T.t('Deleted the folder'), { cats: 'plinks' });
      } catch (e) { _closePop(); opt.status(e.message, true); }
    });
  }

  function _askDelete(n, anchor) {
    _closePop();
    _closeMenu();
    if (n && n.kind === 'plinks') { _askDeleteLinks(n, anchor); return; }
    const box = _el('div', 'mt-pop u-ask is-float');      // the shared question
    const count = n.count || 0;
    const noun = NOUN[n.kind] || 'item';
    // Its folders, all the way down.
    let folders = 0;
    const walk = (x) => { for (const c of kidFolders(x)) { folders++; walk(c); } };
    walk(n);
    // Where what is in it goes - the folder it is in; at the top, the kind itself (no Uncategorized), a post back to
    // its source's folder, a track into Music.
    const up = byKey.get(parentOf.get(n.key));
    const home = up && up.cat ? '"' + up.label + '"'
      : n.kind === 'references' ? T.t('their sources\' folders') : n.kind === 'music' ? T.t('Music') : homeName(n.kind);
    box.appendChild(_el('b', 'mt-pop-head', T.t('Delete "{name}"?', { name: n.label })));
    if (count || folders) box.appendChild(_el('div', 'mt-pop-note', T.t('Inside: {what}.', { what: [count ? _plural(count, noun) : '', folders ? _plural(folders, 'folder') : ''].filter(Boolean).join(' ' + T.t('and') + ' ') })));
    const lab = _el('label', 'mt-pop-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.classList.add('u-check');
    cb.checked = true;                       // the safe branch is the default
    lab.appendChild(cb);
    lab.appendChild(_el('span', null, (count || folders)
      ? (folders ? T.t('Move what is in it up into {place} - its folders stay folders', { place: home }) : T.t('Move what is in it up into {place}', { place: home }))
      : T.t('Nothing in it to move')));
    box.appendChild(lab);
    const note = _el('div', 'mt-pop-note');
    box.appendChild(note);
    const used = _el('div', 'mt-pop-used');
    box.appendChild(used);
    const btns = _el('div', 'mt-pop-btns u-ask-r');
    const cancel = _el('button', 'mt-pop-btn u-btn is-s', T.t('Cancel'));
    cancel.type = 'button';
    const go = _el('button', 'mt-pop-btn u-btn is-s', '');
    go.type = 'button';
    btns.appendChild(cancel);
    btns.appendChild(go);
    box.appendChild(btns);

    let projects = null;
    const paintPop = () => {
      const keep = cb.checked || (!count && !folders);
      note.textContent = keep ? (count ? (STAY[noun] || STAY.item) : '')
        : count ? (folders ? T.t('Its {what} - in it and in every folder under it - will be deleted from the disk. This cannot be undone.', { what: _plural(count, noun) })
          : T.t('Its {what} will be deleted from the disk. This cannot be undone.', { what: _plural(count, noun) }))
        : T.t('Its folders go with it.');
      go.textContent = keep ? T.t('Delete folder') : count ? T.t('Delete folder and {what}', { what: _plural(count, noun) }) : T.t('Delete folder and its folders');
      go.classList.toggle('is-danger', !keep);           // red only when files go
      go.classList.toggle('is-armed', !keep);
      used.textContent = '';
      used.hidden = keep || !projects || !projects.length;
      if (!used.hidden) {
        used.appendChild(_el('div', 'mt-pop-used-head', T.t('Used in {what} - there it turns red, to be replaced or removed:', { what: _plural(projects.length, 'project') })));
        for (const p of projects.slice(0, 8)) used.appendChild(_el('div', 'mt-pop-used-row', '«' + p.title + '» · ' + _plural(p.clips, 'clip')));
        if (projects.length > 8) used.appendChild(_el('div', 'mt-pop-used-row', T.t('… and {n} more', { n: projects.length - 8 })));
      }
    };
    cb.addEventListener('change', paintPop);
    paintPop();
    if (count) {
      fetch('/api/library/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: n.kind, cat: n.cat }) })
        .then(r => r.json()).then(d => { projects = (d && d.projects) || []; if (_pop && _pop.el === box) paintPop(); })
        .catch(() => { /* named only when it can be */ });
    }

    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    const w = box.getBoundingClientRect();
    box.style.left = Math.round(Math.max(6, Math.min(r.right - w.width, window.innerWidth - w.width - 6))) + 'px';
    box.style.top = Math.round(Math.min(r.bottom + 4, window.innerHeight - w.height - 6)) + 'px';
    const away = (e) => { if (!box.contains(e.target)) _closePop(); };
    const layer = Layers.open(box, { modal: false, name: 'delete a folder', onEsc: _closePop });
    _pop = { el: box, away, layer };
    document.addEventListener('mousedown', away, true);
    cancel.addEventListener('click', _closePop);
    go.addEventListener('click', async () => {
      const mode = (cb.checked || (!count && !folders)) ? 'move' : 'delete';
      go.disabled = true; cancel.disabled = true;
      try {
        const d = await A.deleteCat(n.kind, n.cat, mode);
        _closePop();
        const msg = d.mode === 'delete'
          ? T.t('Deleted the folder and {what}', { what: _plural(d.affected || 0, noun) })
          : (d.affected || d.folders ? T.t('Deleted the folder; what was in it is in {place}', { place: home }) : T.t('Deleted the folder'));
        await _after(msg, { cats: n.kind, deleted: d.mode === 'delete' });
      } catch (e) {
        _closePop();
        opt.status(e.message, true);
      }
    });
  }

  // ── The menu under the right button ──
  let _m = null;
  function _closeMenu() {
    if (!_m) return;
    _m.el.remove();
    document.removeEventListener('mousedown', _m.away, true);
    window.removeEventListener('scroll', _closeMenu, true);
    Layers.close(_m.layer);
    _m = null;
  }

  function _menu(n, row, x, y) {
    if (_refsShut(n.key)) { KG.explain('references', row); return; }
    _closeMenu();
    const items = [];
    // A new folder INSIDE the one pressed; none in the references of Environments / Lookbooks.
    if (holds(n)) items.push([T.t('New folder'), T.t('in {place}', { place: n.label }), () => _newFolder(n, row)]);
    else if (n.closed) items.push([T.t('New folder'), T.t('not here - nothing goes into references by hand'), null]);
    // Environments / Lookbooks: their generator; what they hold is the app's to keep where it is.
    if (n.make && typeof opt.onMake === 'function') {
      items.push([n.makeLabel, T.t('opens the generator'), () => opt.onMake(n, row)]);
      // Only the generators' own folders keep what they made; Music's tracks move as any.
      if (MADE[n.kind]) items.push([T.t('Required'), T.t('what its generator made stays here - open it or delete it'), null]);
    }
    if (n.cat && !n.uncat && !n.project) {
      if (n.builtin) items.push([T.t('Built-in'), T.t('part of the app - read only'), null]);
      else if (n.locked) items.push([T.t('Required'), T.t('it cannot be renamed, moved or deleted'), null]);
      else if (n.own) {
        items.push([T.t('Rename'), n.label, () => _rename(n, row)]);
        items.push([T.t('Delete'), n.kind === 'plinks' ? T.t('the folder and its links - the files stay') : T.t('the folder - what is in it goes up a level, or with it'), () => _askDelete(n, row)]);
      }
    }
    if (!items.length) return;
    const m = _el('div', 'mv3-plus-menu mt-menu u-menu is-float');
    for (const [label, sub, on] of items) {
      const b = _el('button', 'mv3-plus-item u-mi');
      b.type = 'button';
      b.appendChild(_el('span', null, label));
      if (sub) b.appendChild(_el('small', null, sub));
      if (on) b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); on(); });
      else b.disabled = true;
      m.appendChild(b);
    }
    menuIcons(m);
    document.body.appendChild(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, x))) + 'px';
    m.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, y))) + 'px';
    const away = (e) => { if (!m.contains(e.target)) _closeMenu(); };
    const layer = Layers.open(m, { modal: false, name: 'folder menu', onEsc: _closeMenu });
    _m = { el: m, away, layer };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('scroll', _closeMenu, true);
  }

  return {
    el, load, select, selectFor, kindLabel, openNode, foldersEl, crumbsEl, homeName, home,
    // the gallery's empty space: "New folder" inside the open node, when it holds folders
    holds: (node) => holds(node && byKey.get(node.key)),
    newFolder: (node, anchor) => _newFolder(node && byKey.get(node.key), anchor),
    // why nothing goes into this node by hand ('' - it may): the page's Upload, "+" and empty-space menu
    closedSays,
    selected: () => byKey.get(sel) || null,
    node: (key) => byKey.get(key) || null,
  };
}
