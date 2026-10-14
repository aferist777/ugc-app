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
let _cur = null;          // { kind, id } of the tile the column is about

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
  // No "Save image as" on the column's copy (phase I): the window's own menu would save the 1920px
  // copy, not the picture.
  b.addEventListener('contextmenu', (e) => e.preventDefault());
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

// ── What is known about a place, or an outfit ───────────────────────────────
// Shown, and written by hand when wanted (phase I, the owner: "показывай, но заполнение этих полей
// необязательно"): a lookbook's gender and description, a place's description. Empty is fine - nothing
// asks for them. How a place MOVES is written by the agent the first time a video is filmed there, and
// put right HERE (phase V26.8, the owner 2026-10-14: "сделай how it moves редактируемым") - the talking
// head's video field no longer has a box for it.
const GENDERS = ['male', 'female', 'unisex'];

const _sent = (r) => r.json().then((d) => { if (!d || !d.success) throw new Error((d && d.error) || 'not saved'); return d; });

function _patch(kind, id, body) {
  return fetch('/api/library/meta/' + encodeURIComponent(kind) + '/' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(_sent);
}

// How a place moves keeps its own route, the one the agent writes through (routes/scen3.js, /scen3/env/motion):
// with `motion` given it is kept as written, an empty one included - then the agent writes it again when the place
// is next filmed.
function _motion(path, motion) {
  return fetch('/api/scen3/env/motion', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, motion }),
  }).then(_sent);
}

// One text written by hand: its box, and `save` beside it only while the box differs from what is kept. `store`
// sends it and answers with what the store now holds; `said` is where the outcome is told.
function _textEdit(value, placeholder, rows, said, store) {
  const ta = _el('textarea', 'lib-info-edit');
  ta.value = value || '';
  ta.placeholder = placeholder;
  ta.rows = rows;
  ta.spellcheck = true;
  const save = _el('button', 'lib-btn lib-info-save', 'save');
  save.type = 'button';
  save.hidden = true;
  let kept = ta.value;
  ta.addEventListener('input', () => { save.hidden = ta.value.trim() === kept.trim(); said.textContent = ''; });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      kept = await store(ta.value);
      ta.value = kept;
      save.hidden = true;
      said.textContent = 'saved';
    } catch (e) {
      said.textContent = e.message;
    }
    save.disabled = false;
  });
  const foot = _el('div', 'lib-info-editfoot');
  foot.append(said, save);
  return { ta, foot };
}

function _about(kind, it, d) {
  const box = _el('div', 'lib-info-part');
  box.appendChild(_el('div', 'lib-info-sec', kind === 'lookbooks' ? 'The outfit' : 'The place'));
  const id = String(it.id);
  const said = _el('div', 'lib-info-said');

  if (kind === 'lookbooks') {
    const row = _el('div', 'lib-info-genders');
    row.appendChild(_el('span', 'lib-info-k', 'gender'));
    let cur = GENDERS.includes(d.gender) ? d.gender : '';
    const paint = () => row.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.g === cur));
    for (const g of GENDERS.concat([''])) {
      const b = _el('button', 'lib-info-chip', g || '—');
      b.type = 'button';
      b.dataset.g = g;
      b.title = g ? 'Worn by ' + (g === 'unisex' ? 'either' : 'a ' + g + ' character') : 'Not said';
      b.addEventListener('click', async () => {
        if (g === cur) return;
        const was = cur;
        cur = g;
        paint();
        try { await _patch(kind, id, { gender: g }); said.textContent = 'saved'; }
        catch (e) { cur = was; paint(); said.textContent = e.message; }
      });
      row.appendChild(b);
    }
    paint();
    box.appendChild(row);
  }

  const what = _textEdit(d.description, kind === 'lookbooks'
    ? 'What it is - not written yet. Optional: the dressing reads it.'
    : 'What the place is - not written yet. Optional: the first frames are composed from it.',
  4, said, async (text) => (await _patch(kind, id, { description: text })).description);
  box.appendChild(_el('div', 'lib-info-k', 'what it is'));
  box.append(what.ta, what.foot);

  if (kind === 'environments') {
    const moved = _el('div', 'lib-info-said');
    const how = _textEdit(d.motion,
      'How it moves - not written yet. The agent writes it the first time a video is filmed here.',
      3, moved, async (text) => String(((await _motion(d.media, text)).entry || {}).motion || ''));
    how.ta.title = 'What moves in the background by itself. Every video filmed here animates by it, word for word -'
      + ' a prompt written with the old words is written again.';
    box.appendChild(_el('div', 'lib-info-k', 'how it moves'));
    box.append(how.ta, how.foot);
  }
  if (d.from) {
    const t = _el('div', 'lib-info-text');
    t.appendChild(_el('b', null, 'made from'));
    t.appendChild(document.createTextNode(String(d.from).split('/').pop()));
    t.title = d.from;
    box.appendChild(t);
  }
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
  _cur = { kind, id: String(it.id) };
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
    body.appendChild(_about(kind, it, d));
    body.appendChild(_looks(d.looks || [], hooks, 'Nothing has been dressed in this lookbook yet.'));
  } else if (kind === 'environments') {
    body.appendChild(_about(kind, it, d));
  }
}

/** The column's picture again, for a tile whose picture changed under it (a character's sheet landed) -
 *  without painting the column again, so its voices, a search and a Save in progress stay. */
export function setPicture(kind, it) {
  if (!_cur || _cur.kind !== kind || _cur.id !== String(it.id) || !it.media) return;
  const img = document.querySelector('#lib-info-body .lib-info-ref img');
  if (img) img.src = _big(it.media);
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
