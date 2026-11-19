// "THE APP WAS UPDATED".
//
// A new commit lands in the program folder while the app is open (the server says so - lib/app-update.js): a chip
// stands in the strip LEFT of the wait and Alerts, a short notice says it once, and the chip opens a window to restart
// and update. Only in the app window: the restart is the desktop shell's (desktop/preload.js
// `restart`, desktop/main.js) - it asks about a running render first, as closing the window does - and in a browser
// there is nothing to restart from a page.
//
// An installed copy has no .git: there the news is a new VERSION the updater laid down (d.release:
// { version, notes, important }) - the chip says "Update <version>", the window shows the release notes as they were
// written; an important one (nothing is forced) has a gold chip and a notice that stays until it is closed.

import * as Layers from './layers.js';
import { showToast } from './notice.js';
import { t } from './i18n/t.js';

const EVERY_MS = 60000;
const NOTICE_MS = 9000;

let _nav = null;
let _chip = null;
let _state = null;
let _timer = null;
let _open = false;

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** In the app window only: start looking for a new version. */
export function mountUpdate(nav) {
  const W = window.ugcWindow;
  if (!nav || _nav || !W || typeof W.restart !== 'function') return;
  _nav = nav;
  _check();
  _timer = setInterval(_check, EVERY_MS);
  window.addEventListener('beforeunload', () => clearInterval(_timer));
}

async function _check() {
  let d = null;
  try { d = await fetch('/api/app/update').then(r => r.json()); } catch (e) { return; }
  if (!d || !d.success || !d.changed) return;
  _state = d;
  _paintChip();
  if (!d.announced) {
    _notice(d);
    try { await fetch('/api/app/update/announced', { method: 'POST' }); } catch (e) { /* said again next time */ }
  }
}

function _paintChip() {
  if (_chip || !_nav) return;
  const rel = _state && _state.release;
  _chip = _el('button', 'sv3-navbtn sv3-upd' + (rel && rel.important ? ' is-important' : ''), rel ? t('Update {version}', { version: rel.version }) : t('Updated'));
  _chip.type = 'button';
  _chip.title = rel ? t('UGC Studio {version} is downloaded - restart to use it', { version: rel.version }) : t('A new version of the app is in its folder - restart to use it');
  _chip.addEventListener('click', _ask);
  // Left of the wait, which stands left of Alerts: the two read as one thing (js/alerts-bell.js).
  const at = _nav.querySelector('.sv3-al-wait') || _nav.querySelector('.sv3-alerts') || _nav.querySelector('a[href="/admin"]');
  _nav.insertBefore(_chip, at);
}

// Once: the corner of popups, the same look as a finished generation (js/notice.js) - it goes by itself, or by its ✕.
function _notice(d) {
  const rel = d.release;
  if (rel) {
    showToast({ mark: '↻', cls: 'is-update', title: t('An update is ready'), where: t('UGC Studio {version} - restart to use it', { version: rel.version }),
      onClick: _ask, ms: rel.important ? 24 * 3600 * 1000 : NOTICE_MS });
    return;
  }
  showToast({ mark: '↻', cls: 'is-update', title: t('The app was updated'), where: d.subject || t('restart it to use the new version'),
    onClick: _ask, ms: NOTICE_MS });
}

function _ask() {
  if (_open) return;
  _open = true;
  const back = _el('div', 'dr-back');
  const box = _el('div', 'nm-box dr-box u-ask is-float');   // the shared question, in the middle
  box.setAttribute('role', 'dialog');
  const d = _state || {};
  const rel = d.release;
  box.appendChild(_el('b', 'nm-t', rel ? t('UGC Studio {version} is ready', { version: rel.version }) : t('The app was updated')));
  if (d.subject) box.appendChild(_el('div', 'dr-holds', d.subject));
  if (rel && rel.notes) {
    const notes = _el('div', 'dr-holds u-notes', rel.notes);
    notes.style.whiteSpace = 'pre-wrap';
    notes.style.maxHeight = '40vh';
    notes.style.overflow = 'auto';
    box.appendChild(notes);
  }
  box.appendChild(_el('div', 'dr-note', d.renderBusy
    ? t('Restart to use the new version. What you have open is saved; a render is running - you will be asked about it first.')
    : t('Restart to use the new version. What you have open is saved.')));
  const row = _el('div', 'nm-r u-ask-r');
  const go = _el('button', 'nm-b is-ok u-btn is-s is-main', t('Restart and update'));
  const later = _el('button', 'nm-b u-btn is-s', t('Later'));
  for (const b of [go, later]) b.type = 'button';
  // "Later" left, the verb right; the 3D Studio's page keeps an order of its own
  if (document.querySelector('link[href="css/studio3d.css"]')) row.append(go, later); else row.append(later, go);
  box.appendChild(row);
  document.body.append(back, box);
  let layer = null;
  const close = () => { back.remove(); box.remove(); if (layer) Layers.close(layer); _open = false; };
  go.addEventListener('click', () => { close(); window.ugcWindow.restart(); });
  later.addEventListener('click', close);
  back.addEventListener('click', close);
  layer = Layers.open(box, { name: 'the update', onEsc: close });
  go.focus();
}
