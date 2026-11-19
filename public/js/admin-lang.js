/* ═══════════════════════════════════════════════════════════════════════════
   ADMIN -> THIS COMPUTER: THE INTERFACE'S LANGUAGE - the pane's first row.

   "Language · Язык" in both, so it is found whichever one the app speaks; English | Русский each in its own words. A
   press on the other one saves it for the next start (POST /api/i18n/lang, lib/i18n.js) and asks "Restart now?":
   Restart - the shell's own restart (desktop/main.js `restartApp`: a running render is asked about first); Later - the
   language changes at the next start, and the row says so. In a browser there is no window to restart: it says so.
   While the switch is closed (lib/lang-choice.js) the row is grey and says why.
   ═══════════════════════════════════════════════════════════════════════════ */

import { t } from './i18n/t.js';
import { askChoice } from './ask.js';
import { showError } from './notice.js';

const NAMES = { en: 'English', ru: 'Русский' };

const box = document.getElementById('loc-lang');
let st = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function paint() {
  if (!box || !st) return;
  const row = el('div', 'loc-row');
  const lbl = el('div', 'dio-lbl');
  lbl.appendChild(el('b', null, 'Language · Язык'));
  const sub = !st.open ? t('In development - the switch opens once the whole interface is translated.')
    : st.chosen !== st.lang ? t('Switches to {name} at the next start.', { name: NAMES[st.chosen] || st.chosen })
      : t('The interface\'s language. Changing it restarts the app.');
  lbl.appendChild(el('i', null, sub));
  row.appendChild(lbl);
  const seg = el('div', 'u-seg loc-lang-seg');
  seg.setAttribute('role', 'group');
  for (const l of st.langs) {
    const b = el('button', null, NAMES[l] || l);
    b.type = 'button';
    b.lang = l;
    b.setAttribute('aria-pressed', String(l === st.chosen));
    b.disabled = !st.open || st.forced;
    b.addEventListener('click', () => pick(l, b));
    seg.appendChild(b);
  }
  row.appendChild(seg);
  box.replaceChildren(row);
}

async function pick(l, btn) {
  if (!st || l === st.chosen) return;
  let d = null;
  try {
    const r = await fetch('/api/i18n/lang', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: l }) });
    d = await r.json();
    if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
  } catch (e) {
    showError(t('The language was not saved'), { detail: e.message });
    return;
  }
  st = d;
  paint();
  if (st.chosen === st.lang) return;
  const anchor = box.querySelector(`button[lang="${l}"]`) || btn;
  askChoice(anchor, t('Restart now?'), t('The app closes and opens again in {name}. Everything open is saved.', { name: NAMES[l] || l }), [
    { label: t('Later') },
    { label: t('Restart'), kind: 'yes', on: restart },
  ], { stay: true });   // the pane below repaints as its parts are read - that is no reason to close the question
}

function restart() {
  if (window.ugcWindow && typeof window.ugcWindow.restart === 'function') { window.ugcWindow.restart(); return; }
  showError(t('Restart the app to switch the language - here there is no window to restart.'));
}

(async () => {
  if (!box) return;
  try {
    const r = await fetch('/api/i18n');
    st = await r.json();
    paint();
  } catch { /* the pane shows the rest without it */ }
})();
