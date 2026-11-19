/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — a render finished.

   ONE POPUP in the corner (js/notice.js showToast): "Rendered · <its name>", with
     Open            the Library's viewer of the render - Rename and Delete there (js/library/render-view.js)
     Show in folder  Explorer on the file in the library (the shell's reveal, desktop/preload.js - only in the app's window;
                     a browser has none, and no button)
   The render is on the Renders shelf and in Queue -> open as well. Nothing is copied into Downloads.
   ═══════════════════════════════════════════════════════════════════════════ */

import { showToast, showError } from '../notice.js';
import { openRender } from '../library/render-view.js';
import { t } from '../i18n/t.js';

const _nameOf = (url) => {
  const f = String(url || '').split('?')[0].split('/').pop() || '';
  let s = f;
  try { s = decodeURIComponent(f); } catch (e) { s = f; }
  return s.replace(/\.mp4$/i, '');
};

/** The popup of a finished render at `url` (/media/renders/...). */
export function renderDone(url) {
  const w = window.ugcWindow;
  const reveal = w && typeof w.reveal === 'function' ? w.reveal : null;
  const acts = [{ label: t('Open'), title: t('Watch it in the Library\'s viewer - Rename and Delete are there'), run: () => openRender(url) }];
  if (reveal) {
    acts.push({ label: t('Show in folder'), title: t('Explorer on the file, in the library\'s renders folder'), run: async () => {
      let ok = false;
      try { ok = await reveal(url); } catch (e) { ok = false; }
      if (!ok) showError(t('That render is not in the library any more'));
    } });
  }
  showToast({ mark: '▣', title: t('Rendered'), where: _nameOf(url), ms: 15000, acts });
}
