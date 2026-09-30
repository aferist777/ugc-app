// LIBRARY — the right column of the picture shelves (phase B, the owner 2026-09-29).
//
// On Characters, Lookbooks and Environments one tile is always selected, and this column says what
// it is. At the top the picture itself - a copy sized for the column, never the original, and the
// way into the enlarged view - then what belongs to it: a character's voices and looks, the looks
// dressed in a lookbook, what is known about an environment (how the agent read the place and how
// it moves - the sentence every video filmed there animates by).
//
// Read from the server on EVERY selection, a second press on the same tile included
// (/api/library/info): a voice given or a look made on the Character page shows up the next time
// the tile is pressed, without reloading the page. The Voices shelf paints its own info into the
// same column (js/library/voices.js); the page decides which of the two has it.

import * as CV from './char-voices.js';

const $ = (id) => document.getElementById(id);

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let _seq = 0;             // an answer for a tile no longer selected is dropped

// The picture as the column shows it: sized for a third of a wide screen, twice over (lib/thumbs.js
// `sheet`, 1920px), and made once.
const _big = (src) => '/api/thumb?src=' + encodeURIComponent(src) + '&v=sheet';

function _date(s) {
  const d = s ? new Date(s) : null;
  return (d && !isNaN(d)) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
}

// What the head says. A lookbook's or an environment's name is the hash of its file, so those two
// say what they are and when they were made instead.
function _title(kind, it) {
  if (kind === 'characters') return it.name || 'character';
  const when = _date(it.meta && it.meta.date);
  return (kind === 'lookbooks' ? 'lookbook' : 'environment') + (when ? ' · ' + when : '');
}

const _note = (text) => _el('div', 'lib-info-note', text);

// ── The top: the picture, and the way into the enlarged view ────────────────
function _ref(kind, it, hooks) {
  const b = _el('button', 'lib-info-ref is-' + kind);
  b.type = 'button';
  b.title = 'Open it large';
  const img = _el('img');
  img.alt = it.name || '';
  img.decoding = 'async';
  img.src = _big(it.media);
  b.appendChild(img);
  b.addEventListener('click', () => hooks.open(it));
  return b;
}

// ── A character's gender and voices ─────────────────────────────────────────
// Chosen here since the Character page moved into the Library (phase H7): js/library/char-voices.js.

// ── Looks: a character's own, or the ones dressed in a lookbook ─────────────
function _looks(list, hooks, none) {
  const box = _el('div', 'lib-info-part');
  box.appendChild(_el('div', 'lib-info-sec', list.length ? 'Looks · ' + list.length : 'Looks'));
  if (!list.length) { box.appendChild(_note(none)); return box; }
  const grid = _el('div', 'lib-info-looks');
  for (const l of list) {
    const c = hooks.card(l);
    c.addEventListener('click', () => hooks.openLook(l, list));
    grid.appendChild(c);
  }
  box.appendChild(grid);
  return box;
}

// ── What is known about a place ─────────────────────────────────────────────
function _place(d) {
  const box = _el('div', 'lib-info-part');
  box.appendChild(_el('div', 'lib-info-sec', 'The place'));
  if (!d.description && !d.motion) { box.appendChild(_note('Nothing is written about this place yet.')); return box; }
  const text = (label, value) => {
    const t = _el('div', 'lib-info-text');
    t.appendChild(_el('b', null, label));
    t.appendChild(document.createTextNode(value));
    box.appendChild(t);
  };
  if (d.description) text('what it is', d.description);
  if (d.motion) text('how it moves', d.motion);
  return box;
}

// ── Painting it ─────────────────────────────────────────────────────────────
/**
 * The column for one tile. `hooks` is the page's: open(it) - the enlarged view of the tile,
 * openLook(look, list) - of a look, card(look) - a look's card as the grid draws it.
 */
export async function show(kind, it, hooks) {
  const pane = $('lib-info'), head = $('lib-info-head'), body = $('lib-info-body');
  if (!pane || !body) return;
  leave();
  const my = _seq;
  pane.hidden = false;
  body.className = 'lib-info-body is-' + kind;
  body.textContent = '';
  if (head) head.textContent = _title(kind, it);
  // The picture straight away, from the tile's own record; the rest is one read behind it.
  body.appendChild(_ref(kind, it, hooks));
  let d = null;
  try {
    d = await fetch('/api/library/info/' + encodeURIComponent(kind) + '/' + encodeURIComponent(it.id)).then(r => r.json());
  } catch (e) { d = { success: false, error: e.message }; }
  if (my !== _seq) return;
  if (!d || !d.success) { body.appendChild(_note((d && d.error) || 'It could not be read.')); return; }
  if (kind === 'characters') {
    CV.paint(body, it, d.voices || [], { changed: hooks.changed, alive: () => my === _seq });
    body.appendChild(_looks(d.looks || [], hooks, 'No looks for this character yet.'));
  } else if (kind === 'lookbooks') {
    body.appendChild(_looks(d.looks || [], hooks, 'Nothing has been dressed in this lookbook yet.'));
  } else if (kind === 'environments') {
    body.appendChild(_place(d));
  }
}

/** A shelf with nothing on it: the column says so rather than showing the last tile. */
export function empty(label) {
  const pane = $('lib-info'), head = $('lib-info-head'), body = $('lib-info-body');
  if (!pane || !body) return;
  leave();
  pane.hidden = false;
  body.className = 'lib-info-body';
  body.textContent = '';
  if (head) head.textContent = label || '';
  body.appendChild(_note('Nothing on this shelf yet.'));
}

/** Stop what the column is doing - a demo playing, an answer still on its way. */
export function leave() {
  _seq++;
  CV.stop();
}

/** Leave, and give the width back to the grid. */
export function hide() {
  leave();
  const pane = $('lib-info');
  if (pane) pane.hidden = true;
}
