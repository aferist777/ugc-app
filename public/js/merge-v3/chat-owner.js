/* ═══════════════════════════════════════════════════════════════════════════
   WHOSE CONVERSATION A CHAT IS - in the Library one unbound conversation per chat, the same as Merge's draft's.

   The chats (chat-shell.js, picchat.js, vidchat.js) ask THIS module what their conversation is - never the store directly:
     in Merge        the open project - the store's key, its title, whether it is the draft, its timeline
     in the Library  useDraft(): THE draft's conversation - Merge's draft's key (POST /api/mv3/timeline/new {draft:true}, the
                     one there is, never a new one beside it), so the server keeps it as the drafts' one conversation per
                     chat (lib/mv3-chat.js threadOf); no timeline, nothing laid anywhere - what is made lies in IMAGES ->
                     Generated and VIDEO -> Generated -> <model>, as from Merge.

     key() isReady() isDraft() title() timeline() onChange(fn) openBlank()   - the store's words, either way
     useDraft()      the Library's choice - once, before a chat is opened; -> a promise of the key
     unbound()       the chats are the Library's unbound ones
     whereOf(key, view)   the Alerts row's place of a chat's press - Merge's or the Library's
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { t } from '../i18n/t.js';

export const DRAG_TYPE = Store.DRAG_TYPE;
export const DRAG_MEDIA = Store.DRAG_MEDIA;

let _draft = null;          // { key, ready } - the Library's draft conversation
const _subs = [];

export function useDraft() {
  if (_draft) return _draft.ready;
  _draft = { key: '', ready: null };
  _draft.ready = fetch('/api/mv3/timeline/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: true }) })
    .then(r => r.json())
    .then((d) => {
      if (!d || !d.success || !d.key) throw new Error((d && d.error) || t('the draft did not answer'));
      _draft.key = String(d.key);
      for (const fn of _subs) { try { fn(); } catch (e) { /* one listener's */ } }
      return _draft.key;
    })
    .catch((e) => { _draft = null; throw e; });
  return _draft.ready;
}
export const unbound = () => !!_draft;

export const key = () => (_draft ? _draft.key : Store.key());
export const isReady = () => (_draft ? !!_draft.key : Store.isReady());
export const isDraft = () => (_draft ? true : Store.isDraft());
export const title = () => (_draft ? 'draft' : Store.title());
export const timeline = () => (_draft ? null : Store.timeline());
export function onChange(fn) {
  _subs.push(fn);
  Store.onChange(() => { if (!_draft) fn(); });
  // The Library's draft already known: told at once - a chat set up after useDraft() answered.
  if (_draft && _draft.key) fn();
}
/** Where an Alerts row of a chat's result leads (`view` 'pictures' | 'videos'): Merge's project with the chat open - or, from
 *  the Library, the Library: IMAGES / VIDEO with the window open; once the result is filed the
 *  row leads to the folder it lies in, outlined (js/alerts-bell.js _hrefOf, ?reveal=). */
export function whereOf(key, view) {
  if (_draft) {
    return { page: 'library', href: '/library?shelf=media&kind=' + (view === 'videos' ? 'video' : 'images') + '&open=' + view,
      label: 'Library · ' + (view === 'videos' ? 'video chat' : 'pictures chat'), spot: { key, view } };
  }
  return { page: 'merge', href: '/merge?p=' + encodeURIComponent(key) + '&open=' + view,
    label: 'Merge · ' + (Store.title() || 'project') + ' · ' + view, spot: { key, view } };
}
export async function openBlank() {
  if (_draft) { await _draft.ready; return; }
  await Store.openBlank();
}
