/* ════════════════════════════════════════════════════════════════════════════
   HOME'S WINDOWS - the generations open OVER HOME, as the Library opens them (js/library/main.js _openChat, _openMusic,
   _openGen, _openProp) - the same modules, untouched:

     openChat('pictures' | 'videos')   the pictures chat / the video chat (js/merge-v3/chat-window.js) on THE DRAFT's
                                       conversation - the unbound one, Merge's draft's and the Library's (chat-owner.js
                                       useDraft); what they make lies in IMAGES → Generated and VIDEO → Generated → <model>,
                                       and their Alerts rows lead to the Library (chat-owner.js whereOf, alerts-bell.js _hrefOf)
     openSound()                       the sound window (js/sound/sound-window.js), told a host like the Library's: music into
                                       Music's root, sounds into SFX → My sounds → Generated, the rows to those folders
     openGen('environment' | 'lookbook')   the generators' window (js/gen-window.js openGenerator), the Library's `where`
     openProp()                        New prop (js/prop-window.js)
   (New Character is main.js's.)

   Home loads none of their sheets up front: each window's are put in at its first opening, waited for, then it opens - a
   chat's window shows at once with "loading…" meanwhile (chat-window.js openEarly).
     preload()       Home drawn and idle: the chats' and the sound window's code and sheets read beforehand
     setOnMade(fn)   something a window made landed - Home's blocks read again
   ════════════════════════════════════════════════════════════════════════════ */

import { openGenerator } from '../gen-window.js';
import * as W from '../merge-v3/chat-window.js';
import { showError } from '../notice.js';
import { t } from '../i18n/t.js';

let _onMade = () => {};
export function setOnMade(fn) { _onMade = typeof fn === 'function' ? fn : () => {}; }
const _made = () => { try { _onMade(); } catch (e) { /* a block says so itself */ } };

// The sheets a window needs, put in once and waited for (the chats' own list - chat-window.js CHAT_CSS - is put in HERE first,
// so ensureChatCss finds them there and the window does not open bare).
const _sheets = new Map();          // name -> a promise of its load
function _css(names) {
  const have = new Map([...document.querySelectorAll('link[rel="stylesheet"]')].map(l => [String(l.getAttribute('href') || '').split('/').pop(), l]));
  return Promise.all(names.map((name) => {
    if (_sheets.has(name)) return _sheets.get(name);
    if (have.has(name)) { _sheets.set(name, Promise.resolve()); return _sheets.get(name); }
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = '/css/' + name;
    const p = new Promise((res) => { l.onload = l.onerror = () => res(); });
    document.head.appendChild(l);
    _sheets.set(name, p);
    return p;
  }));
}
/** The same for Home's quick-start popups (js/home/start.js) - the sheets a window needs, put in once and waited for. */
export const sheets = (names) => _css(names);
// The chats: Merge's sheets (chat-window.js CHAT_CSS), the attachment window's tree, the viewer's rows, a REFERENCES post.
const CHAT_SHEETS = ['merge-v3.css', 'mv3-imagen.css', 'folder-column.css', 'media-tree.css', 'dialog.css',
  'references.css', 'made-rows.css'];
// The sound window: the Library's sheets of it (library.html) - and Video to Music's VIDEO tree.
const SOUND_SHEETS = ['sound-window.css', 'sound.css', 'media-tree.css', 'dialog.css'];

// ── the chats ────────────────────────────────────────────────────────────────
// The window at once (its frame, "loading…"); the sheets, the code and the conversation into it; closed meanwhile - nothing.
const _chatOn = {};
export async function openChat(which) {
  W.openEarly(which);
  try {
    await _css(CHAT_SHEETS);
    await W.ensureChatCss();
    const O = await import('../merge-v3/chat-owner.js');
    await O.useDraft();
    if (which === 'videos') {
      const V = await import('../merge-v3/vidchat.js');
      if (!_chatOn.videos) { _chatOn.videos = true; V.initVidChat(); }
      if (W.wanted(which)) await V.openVideos();
    } else {
      const P = await import('../merge-v3/picchat.js');
      if (!_chatOn.pictures) { _chatOn.pictures = true; P.initPicChat(); }
      if (W.wanted(which)) await P.openPictures();
    }
  } catch (e) { W.dropEarly(which); showError(t('The chat did not open: {why}', { why: (e && e.message) || e })); }
}

// ── the sound window ─────────────────────────────────────────────────────────
// The Library's tree key of SFX → My sounds → Generated, where every sound made is filed - its Alerts row leads there.
let _soundsKey = '';
async function _soundsGen() {
  if (_soundsKey) return _soundsKey;
  try {
    const d = await fetch('/api/library/tree').then(r => r.json());
    const find = (ns) => { for (const n of ns || []) { if (n.key === 'sounds') return n; const f = find(n.children); if (f) return f; } return null; };
    const s = find(d && d.nodes);
    // Found by its stored name: the label is said in the interface's language.
    const g = s ? (s.children || []).find(c => (c.name || c.label) === 'Generated') : null;
    _soundsKey = g ? g.key : '';
  } catch (e) { _soundsKey = ''; }
  return _soundsKey || 'sounds';
}
// The host: the Library's (js/library/main.js _soundHost) with no folder open - music into Music's root; its press remembered
// with the Library's (`lib_music_v1` - one window on both pages); the rows lead into the Library with the window open again.
const HOST = {
  page: 'library', view: 'musicmake', store: 'lib_music_v1',
  key: () => '', title: () => '', writerKind: () => 'blank', videoSecs: () => 0,
  soundsNode: () => _soundsKey || 'sounds',
  where: (d, label) => ({
    page: 'library', href: '/library?shelf=media&kind=' + encodeURIComponent(d.node),
    label: t('Library') + ' · ' + (d.label || t('Generate audio')) + ' · ' + label, spot: { view: 'musicmake', key: d.node, label: d.label },
  }),
  onLanded: () => _made(),
};
let SW = null;
export async function openSound() {
  try {
    await _css(SOUND_SHEETS);
    if (!SW) {
      SW = await import('../sound/sound-window.js');
      SW.configure(HOST);
    }
    await SW.open({ place: () => ({ key: 'music', label: t('Music') }) });
    // The key is wanted only by a sound's Alerts row, and the tree is a long read: asked once the window shows.
    _soundsGen();
  } catch (e) { showError(t('The sound window did not open: {why}', { why: (e && e.message) || e })); }
}

// Home drawn and idle: the chats' and the sound window's code and sheets read beforehand, so a first opening is
// like a second. Code and CSS only - the conversation is asked for at a press (useDraft).
export function preload() {
  const quiet = () => {};
  _css(CHAT_SHEETS.concat(SOUND_SHEETS)).then(() => W.ensureChatCss()).catch(quiet);
  import('../merge-v3/chat-owner.js').catch(quiet);
  import('../merge-v3/picchat.js').catch(quiet);
  import('../merge-v3/vidchat.js').catch(quiet);
  import('../sound/sound-window.js').catch(quiet);
}

// ── New environment, New lookbook ────────────────────────────────────────────
// The Library's `where` (js/library/main.js GEN_WHERE): a row running opens the generator in the Library, one that ended
// leads to the picture outlined in IMAGES → Environments / Lookbooks.
const GEN_WHERE = {
  environment: { page: 'library', href: '/library?shelf=media&kind=environments&make=1', label: t('Library · New environment'), spot: { view: 'envmake' } },
  lookbook: { page: 'library', href: '/library?shelf=media&kind=lookbooks&make=1', label: t('Library · New lookbook'), spot: { view: 'lbmake' } },
};
const _gens = {};
export function openGen(kind) {
  if (!GEN_WHERE[kind]) return;
  if (_gens[kind] && _gens[kind].alive()) return;
  try {
    _gens[kind] = openGenerator({
      kind,
      where: () => GEN_WHERE[kind],
      onMade: () => _made(),
      onClose: () => { _gens[kind] = null; },
    });
  } catch (e) { showError(t('The generator did not open: {why}', { why: (e && e.message) || e })); }
}

// ── New prop ─────────────────────────────────────────────────────────────────
export async function openProp() {
  try {
    await _css(['media-tree.css', 'dialog.css']);
    const { openNewProp } = await import('../prop-window.js');
    openNewProp({ onAdded: () => _made() });
  } catch (e) { showError(t('New prop did not open: {why}', { why: (e && e.message) || e })); }
}
