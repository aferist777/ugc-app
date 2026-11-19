/* ═══════════════════════════════════════════════════════════════════════════
   SOUND ON A SHELF - what Merge's Library panel and the Library's Media shelf share about AUDIO's nodes
   (routes/library.js _tree): Music; SFX ('sfx-all') -> ★ Favorites ('sfx-fav'), Built-in ('sfx', 'sfx:<category>' - the
   program's set, read only), My sounds ('sounds', 'sounds:<category>').

     isSfx(node)          a node of SFX: the search and "find online…" stand over its grid
     filesTo(node)        what a file brought in on this node becomes: { kind: 'music' | 'sounds', cat } - or null
     searchHead({ q, found, onSearch, onOnline })
                          the search over the grid - every word in a name, a tag or the category, as typed (Escape
                          clears) - and ONE button "find online…"; when the words found nothing here it turns gold itself
                          and reads "find «words» online", opening the online search with them already in it (one
                          button, not a second one beside it); and a "?" right of the field - the sites to download free sounds from by hand, searching for
                          the words typed (js/sound/sites.js)
   ═══════════════════════════════════════════════════════════════════════════ */

import { openSites } from './sites.js';
import { t } from '../i18n/t.js';

export const UNCAT = '__uncat__';

export function isSfx(n) {
  if (!n) return false;
  const k = String(n.key || '');
  return k === 'sfx-all' || k === 'sfx-fav' || k === 'sfx' || k.startsWith('sfx:') || n.kind === 'sounds';
}
export const isBuiltin = (n) => !!n && (n.key === 'sfx' || String(n.key || '').startsWith('sfx:'));

export function filesTo(n) {
  if (!n) return null;
  // An own folder of Music takes them into itself; highlights and its moods - into Music.
  if (n.kind === 'music') return { kind: 'music', cat: n.cat && !n.noAdd ? n.cat : '' };
  if (n.key === 'sfx-all' || n.kind === 'sounds') return { kind: 'sounds', cat: n.cat && n.cat !== UNCAT ? n.cat : '' };
  return null;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// The search is drawn again with the shelf it searched: typed into a moment ago and nothing else took the caret since,
// the new field takes it where it was (a removed field's blur is not to be relied on).
let _typedAt = 0;
let _caret = 0;

export function searchHead(o) {
  const head = el('div', 'snd-shelf-head');
  const s = el('input', 'snd-search u-in');
  s.type = 'search';
  s.placeholder = t('search SFX - name or tag (whoosh, click, pop…)');
  s.value = o.q || '';
  let timer = 0;
  s.addEventListener('input', () => {
    _typedAt = Date.now(); _caret = s.selectionStart;
    clearTimeout(timer);
    timer = setTimeout(() => o.onSearch(s.value.trim()), 200);
  });
  s.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && s.value) { e.preventDefault(); e.stopPropagation(); _typedAt = Date.now(); _caret = 0; s.value = ''; o.onSearch(''); }
  });
  head.appendChild(s);
  // "?" - the sites to download from by hand, with the words as typed now.
  const help = el('button', 'snd-btn snd-help u-btn is-icon', '?');
  help.type = 'button';
  help.title = t('Where else to find free sounds - the sites open in your browser');
  help.addEventListener('click', () => openSites(help, s.value));
  head.appendChild(help);
  // One button: found nothing - it turns gold with the words in it.
  const missed = !!(o.q && !o.found);
  const on = el('button', 'snd-btn u-btn' + (missed ? ' is-gold is-gen' : ''),
    missed ? t('find «{words}» online', { words: o.q.length > 28 ? o.q.slice(0, 26) + '…' : o.q }) : t('find online…'));
  on.type = 'button';
  on.title = missed ? t('Nothing here - search the free (CC0) libraries with these words')
    : t('Search free (CC0) sounds online - Freesound (with its key on Admin -> API keys), else Openverse');
  on.addEventListener('click', () => o.onOnline(o.q || ''));
  head.appendChild(on);
  // Typing goes on where it was: the shelf is painted again under the caret.
  if (Date.now() - _typedAt < 5000) {
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== document.body && a !== s) return;
      s.focus();
      try { s.setSelectionRange(_caret, _caret); } catch (e) { /* a search field */ }
    }, 0);
  }
  return head;
}
