/* ════════════════════════════════════════════════════════════════════════════
   MERGE — what the two makers share: create lookbook and create environment.

   Both are the same bench (docs/local-app/PLAN.md): a shelf to draw a base from, a field that
   takes a picture, a sentence, and a button that says what is missing. The pieces that must
   behave identically in both live here, so a rule learned on one - the owner's twenty
   characters, a field that opens its picture when clicked - cannot drift on the other.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { openViewer } from '../library/viewer.js';
import { startProgress } from '../progress.js';

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ── A gentler wheel ─────────────────────────────────────────────────────────
// A touchpad in this window moves the workshop a long way for a short gesture: the panel is a tall
// column of small rows, and one flick jumps past the whole thing (the owner, 2026-09-22). So the
// boxes that scroll in `setup` take the wheel themselves and move by a fraction of what was asked.
//
// Only a wheel in PIXELS is touched (`deltaMode` 0 - a touchpad and every modern mouse), never a
// zoom gesture, and never a wheel at either end of the box: there the event is left alone, so the
// page behind can scroll instead of the gesture dying here. Trackpad inertia is traded for an even
// step - that is the point of it.
const WHEEL_EASE = 0.4;

export function softScroll(box, factor) {
  const k = factor || WHEEL_EASE;
  box.addEventListener('wheel', (e) => {
    if (e.deltaMode !== 0 || e.ctrlKey || !e.deltaY) return;
    const max = box.scrollHeight - box.clientHeight;
    if (max <= 0) return;
    const at = box.scrollTop;
    if ((e.deltaY < 0 && at <= 0) || (e.deltaY > 0 && at >= max - 0.5)) return;
    e.preventDefault();
    box.scrollTop = Math.max(0, Math.min(max, at + e.deltaY * k));
  }, { passive: false });
}

// ── Words that are words ────────────────────────────────────────────────────
// With a picture in the field the sentence is an edit - "red shoes" is a complete instruction -
// but with nothing else to go on, a handful of characters describes nothing, and twenty is the
// owner's number.
//
// The nonsense test is deliberately shallow and LOCAL: it catches a fist on the keyboard for
// free and instantly. Anything subtler - a real sentence about nothing, a shopping list, a
// question - is the agent's to refuse, and it does that before an image is paid for
// (routes/scen3.js, _readLookbookIdea / _readEnvironmentIdea).
export const MIN_WORDS_ALONE = 20;

export function nonsense(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return false;
  const letters = t.replace(/[^a-zа-яё]/gi, '');
  if (!letters) return true;                               // digits and punctuation only
  if (/^(.)\1+$/.test(letters)) return true;               // one character, held down
  const vowels = (letters.match(/[aeiouyаеёиоуыэюя]/gi) || []).length;
  if (vowels / letters.length < 0.15) return true;         // no vowels worth the name
  const words = t.split(/\s+/).filter(Boolean);
  // One long unbroken run of letters is a keyboard, not a sentence.
  if (words.length === 1 && letters.length >= 12) return true;
  return false;
}

// ── A picture from this computer ────────────────────────────────────────────
// Read once and kept as a data URL: it is what the server takes, and holding the File would mean
// reading it again on every repaint. Anything that is not an image is simply not taken.
export function readPicture(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('that is not a picture'));
    const fr = new FileReader();
    fr.onload = () => resolve({ name: file.name || 'photo', dataUrl: String(fr.result || '') });
    fr.onerror = () => reject(new Error('could not read the file'));
    fr.readAsDataURL(file);
  });
}

/**
 * The field a base picture goes into.
 *
 * EMPTY, a click opens the file picker. HOLDING A PICTURE, a click opens that picture large - the
 * owner's rule (2026-09-17): what is in the field is the thing being judged, and a click that
 * threw it away for another file dialog was the wrong answer to "let me look at it". The cross
 * takes it off; dropping a file onto the field replaces it either way.
 *
 * @returns { drop, input } - the input goes NEXT to the field, never inside it: its own click
 *   would bubble back into the field's handler.
 */
export function dropField({ src, empty, onFile, onClear, onOpen }) {
  const drop = el('div', 'mv3-wk-drop' + (src ? ' is-full' : ''));
  drop.title = src ? 'Click to look at it large - drop another photo here to replace it'
    : 'Drop a photo here, or click to choose one from this computer';
  if (src) {
    const img = el('img');
    img.alt = '';
    img.src = src;
    drop.appendChild(img);
    const clear = el('button', 'mv3-wk-dropx', '✕');
    clear.type = 'button';
    clear.title = 'Take it off';
    clear.addEventListener('click', (e) => { e.stopPropagation(); onClear(); });
    drop.appendChild(clear);
  } else {
    drop.appendChild(el('span', null, empty || 'a photo from this computer'));
  }
  const input = el('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  input.addEventListener('change', () => { if (input.files && input.files[0]) onFile(input.files[0]); });
  drop.addEventListener('click', () => { if (src) onOpen(); else input.click(); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });
  return { drop, input };
}

/**
 * One picture in the Library's viewer, with what is known about it in the column beside it.
 *
 * @param src   the picture - a library path, or the data URL of one not saved yet
 * @param name  what to call it: a data URL has no file name to show
 * @param rows  [label, text] pairs, first in the column
 * @param from  the picture this one was made from, shown as a thumbnail
 */
export function showPicture({ src, name, rows, from }) {
  if (!src) return;
  // "kind" is claimed with nothing in it, which keeps the viewer's own kind row out, and "file"
  // is claimed with the name, so a data URL's tail never lands in the column as gibberish.
  const extra = (rows || []).filter(r => r && r[1]).concat([['kind', ''], ['file', name || '']]);
  openViewer(
    [{ id: src, name: name || '', kind: 'picture', media: src, meta: from ? { refImage: from } : {} }], 0,
    { extraRows: () => extra },
  );
}

// ── The waiting animation belongs to the PLACE ──────────────────────────────
// Not to the click that started it. The generation itself is the server's (docs/local-app/PLAN.md,
// "Alerts"): the overlay on the stage is only how a panel says that something of ITS OWN is
// running. So whichever place is painted attaches it - with the job's real elapsed time, so coming
// back mid-generation shows a countdown that is still telling the truth - and a place that is left
// takes its overlay with it, because a countdown lying on somebody else's stage is about nothing.
let _held = null;                            // { place, pr }

export function holdProgress(place, spec) {
  if (_held && _held.place === place) return _held.pr;
  onlyHere(null);
  const stage = document.getElementById('mv3-stage');
  if (!stage) return null;
  const s = spec || {};
  const pr = startProgress(stage, {
    label: s.label || 'Making it', total: 1,
    startedAt: s.startedAt || 0, estimateMs: s.estimateMs || 90000,
  });
  _held = { place, pr };
  return pr;
}

/** The place being painted says so; an overlay belonging to anywhere else goes quietly. */
export function onlyHere(place) {
  if (!_held || _held.place === place) return;
  try { _held.pr.detach(); } catch (e) { /* it was already gone */ }
  _held = null;
}

/** It came, or it did not. Without a message the countdown is banked as a real duration. */
export function endProgress(place, error) {
  if (!_held || _held.place !== place) return;
  const pr = _held.pr;
  _held = null;
  try {
    if (error) pr.fail(error);
    else { pr.step(); pr.finish(); }
  } catch (e) { /* the stage was rebuilt under it */ }
}

// ── The menu on a tile ──────────────────────────────────────────────────────
// Not modal (js/layers.js): it takes Escape and leaves the page's shortcuts alone. One at a time -
// opening another closes this one.
let _menu = null;

export function closeMenu() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.away, true);
  Layers.close(_menu.layer);
  _menu = null;
}

/** @param items [{ label, sub, on, danger }] */
export function tileMenu(ev, items, name) {
  closeMenu();
  const box = el('div', 'mv3-plus-menu');
  for (const it of items) {
    const b = el('button', 'mv3-plus-item' + (it.danger ? ' is-danger' : ''));
    b.type = 'button';
    b.appendChild(el('span', null, it.label));
    if (it.sub) b.appendChild(el('small', null, it.sub));
    b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.on(); });
    box.appendChild(b);
  }
  document.body.appendChild(box);
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, ev.clientX))) + 'px';
  box.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, ev.clientY))) + 'px';
  const away = (e) => { if (!box.contains(e.target)) closeMenu(); };
  const layer = Layers.open(box, { modal: false, name: name || 'tile menu', onEsc: closeMenu });
  _menu = { el: box, away, layer };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}
