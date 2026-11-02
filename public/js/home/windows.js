/* ════════════════════════════════════════════════════════════════════════════
   HOME'S WINDOWS (phase V70, P13, the owner 2026-11-01, (хп27): "зона генераторов - чаты картинок, видео и музыки (и звуков).
   в отдельном поле персонаж, предмет, look, окружение") - the generations open OVER HOME, as the Library opens them (phase
   V64 block 4, js/library/main.js _openChat, _openMusic, _openGen, _openProp) - the same modules, untouched:

     openChat('pictures' | 'videos')   the pictures chat / the video chat (js/merge-v3/chat-window.js) on THE DRAFT's
                                       conversation - the unbound one, Merge's draft's and the Library's (chat-owner.js
                                       useDraft); what they make lies in IMAGES → Generated and VIDEO → Generated → <model>,
                                       and their Alerts rows lead to the Library (chat-owner.js whereOf, alerts-bell.js _hrefOf)
     openSound()                       the sound window (js/sound/sound-window.js), told a host like the Library's: music into
                                       Music's root, sounds into SFX → My sounds → Generated, the rows to those folders
     openGen('environment' | 'lookbook')   the generators' window (js/gen-window.js openGenerator), the Library's `where`
     openProp()                        New prop (js/prop-window.js)
   (New Character is main.js's - its window was on Home since phase V60.1.)

   Home loads none of their sheets up front: each window's are put in at its first opening, waited for, then it opens.
     setOnMade(fn)   something a window made landed - Home's blocks read again
   ════════════════════════════════════════════════════════════════════════════ */

import { openGenerator } from '../gen-window.js';
import { showError } from '../notice.js';

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
// The chats: Merge's sheets (chat-window.js CHAT_CSS), the attachment window's tree, the viewer's rows, a REFERENCES post.
const CHAT_SHEETS = ['merge-v3.css', 'mv3-imagen.css', 'mv3-catalog.css', 'folder-column.css', 'media-tree.css', 'dialog.css',
  'references.css', 'made-rows.css'];
// The sound window: the Library's sheets of it (library.html) - and Video to Music's VIDEO tree.
const SOUND_SHEETS = ['mv3-audio.css', 'music-window.css', 'sound.css', 'media-tree.css', 'dialog.css'];

// ── the chats ────────────────────────────────────────────────────────────────
const _chatOn = {};
export async function openChat(which) {
  try {
    await _css(CHAT_SHEETS);
    const W = await import('../merge-v3/chat-window.js');
    W.ensureChatCss();
    const O = await import('../merge-v3/chat-owner.js');
    await O.useDraft();
    if (which === 'videos') {
      const V = await import('../merge-v3/vidchat.js');
      if (!_chatOn.videos) { _chatOn.videos = true; V.initVidChat(); }
      await V.openVideos();
    } else {
      const P = await import('../merge-v3/picchat.js');
      if (!_chatOn.pictures) { _chatOn.pictures = true; P.initPicChat(); }
      await P.openPictures();
    }
  } catch (e) { showError('The chat did not open: ' + ((e && e.message) || e)); }
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
    const g = s ? (s.children || []).find(c => c.label === 'Generated') : null;
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
    label: 'Library · ' + (d.label || 'Generate audio') + ' · ' + label, spot: { view: 'musicmake', key: d.node, label: d.label },
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
    await _soundsGen();
    await SW.open({ place: () => ({ key: 'music', label: 'Music' }) });
  } catch (e) { showError('The sound window did not open: ' + ((e && e.message) || e)); }
}

// ── New environment, New lookbook ────────────────────────────────────────────
// The Library's `where` (js/library/main.js GEN_WHERE): a row running opens the generator in the Library, one that ended
// leads to the picture outlined in IMAGES → Environments / Lookbooks.
const GEN_WHERE = {
  environment: { page: 'library', href: '/library?shelf=media&kind=environments&make=1', label: 'Library · New environment', spot: { view: 'envmake' } },
  lookbook: { page: 'library', href: '/library?shelf=media&kind=lookbooks&make=1', label: 'Library · New lookbook', spot: { view: 'lbmake' } },
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
  } catch (e) { showError('The generator did not open: ' + ((e && e.message) || e)); }
}

// ── New prop ─────────────────────────────────────────────────────────────────
export async function openProp() {
  try {
    await _css(['media-tree.css', 'dialog.css']);
    const { openNewProp } = await import('../prop-window.js');
    openNewProp({ onAdded: () => _made() });
  } catch (e) { showError('New prop did not open: ' + ((e && e.message) || e)); }
}
