// LIBRARY — the voices shelf.
//
// The only shelf that is not pictures, so it is the only one that does not draw cards: a
// voice is a name, a set of tags and our own demo, which is a ROW. The right column is
// permanent here and holds everything about the selected voice — the tags at the top and,
// underneath, the 4K sheets of the characters who speak with it.
//
// Two gestures, kept apart on purpose:
//   click a row      select it, and the info column follows. Nothing plays.
//   click play       play or pause the demo. It selects too, because you are looking at
//                    the voice you just started.
//
// The play button's label is driven by the AUDIO's own events, not by the click - a row also
// stops when another row's play pauses it and when the demo runs out, and either would leave
// a pause sign standing over silence.

const $ = (id) => document.getElementById(id);

let _sel = '';          // the selected voiceId
let _items = [];
let _hooks = {};

const _pretty = (s) => String(s || '').replace(/_/g, ' ');

// The tail on a row: enough of the tags to tell two voices apart at a glance, in the order
// you would say them out loud. The full set is in the info column.
function _tail(m) {
  const l = m.labels || {};
  return [l.gender, l.age, l.accent, l.descriptive].filter(Boolean).map(_pretty).join(' · ');
}

function _stopAll(except) {
  document.querySelectorAll('#lib-grid audio').forEach(a => {
    if (a !== except) { a.pause(); a.currentTime = 0; }
  });
}

function _row(it) {
  const m = it.meta || {};
  const row = document.createElement('div');
  row.className = 'lib-vrow' + (m.voiceId === _sel ? ' cur' : '');
  row.title = it.name;

  const audio = document.createElement('audio');
  audio.src = it.media; audio.preload = 'none';

  const play = document.createElement('button');
  play.type = 'button'; play.className = 'lib-vplay u-btn is-s is-icon'; play.textContent = '▶';
  play.title = 'Play our demo';
  play.addEventListener('click', (e) => {
    e.stopPropagation();
    _stopAll(audio);
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    _select(m.voiceId);            // looking at what you just started is the point
  });
  const mark = () => {
    const on = !audio.paused;
    play.textContent = on ? '❚❚' : '▶';
    play.title = (on ? 'Pause' : 'Play') + ' our demo';
    play.classList.toggle('is-playing', on);
    row.classList.toggle('is-playing', on);
  };
  for (const ev of ['play', 'pause', 'ended']) audio.addEventListener(ev, mark);
  row.appendChild(play); row.appendChild(audio);

  const txt = document.createElement('div');
  txt.className = 'lib-vtxt';
  const nm = document.createElement('div');
  nm.className = 'lib-vname';
  nm.textContent = it.name;
  const sub = document.createElement('div');
  sub.className = 'lib-vsub';
  sub.textContent = _tail(m) || m.voiceId;
  txt.appendChild(nm); txt.appendChild(sub);
  row.appendChild(txt);

  // Who speaks with it. A voice nobody uses says so rather than showing nothing, because
  // "free" is the state that decides whether it can be taken off the shelf.
  const use = document.createElement('span');
  use.className = 'lib-vuse' + (m.characters && m.characters.length ? '' : ' is-free');
  use.textContent = (m.characters && m.characters.length)
    ? (m.characters.length === 1 ? m.characters[0].name : m.characters.length + ' characters')
    : 'free';
  row.appendChild(use);

  // The slot in the account, which is the thing this whole shelf exists to let you free.
  if (m.accountRemoved) {
    const rel = document.createElement('span');
    rel.className = 'lib-vslot';
    rel.textContent = 'slot freed';
    rel.title = 'Released from the ElevenLabs account. The demo still plays; the voice cannot speak until it is added back.';
    row.appendChild(rel);
  }

  const x = document.createElement('button');
  x.type = 'button'; x.className = 'lib-vx'; x.textContent = '✕';
  x.title = 'Forget this voice and delete its demo';
  x.addEventListener('click', (e) => { e.stopPropagation(); _del(it); });
  row.appendChild(x);

  row.addEventListener('click', () => _select(m.voiceId));
  return row;
}

async function _del(it) {
  const m = it.meta || {};
  try {
    const r = await fetch('/api/library/voices/' + encodeURIComponent(m.voiceId), { method: 'DELETE' });
    const d = await r.json();
    if (!d || !d.success) throw new Error((d && d.error) || 'it could not be removed');
    if (_hooks.status) _hooks.status('Removed "' + it.name + '" from the shelf'
      + (d.removed && d.removed.length ? ' with its demo' : ''));
    if (_sel === m.voiceId) _sel = '';
    if (_hooks.reload) _hooks.reload();
  } catch (e) {
    if (_hooks.status) _hooks.status(e.message, 'err');
  }
}

function _select(voiceId) {
  if (_sel === voiceId) { _info(); return; }      // repaint anyway: the row may have changed
  _sel = String(voiceId || '');
  document.querySelectorAll('#lib-grid .lib-vrow').forEach(r => r.classList.remove('cur'));
  const rows = [...document.querySelectorAll('#lib-grid .lib-vrow')];
  const at = _items.findIndex(i => i.meta.voiceId === _sel);
  if (at >= 0 && rows[at]) rows[at].classList.add('cur');
  _info();
}

// One line of the text block. `mono` is for the ids, which are read character by character.
function _line(box, label, value, opts) {
  if (!value) return;
  const o = opts || {};
  const r = document.createElement('div');
  r.className = 'lib-vi-row';
  const l = document.createElement('span');
  l.className = 'lib-vi-l';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'lib-vi-v' + (o.mono ? ' is-mono' : '') + (o.warn ? ' is-warn' : '');
  v.textContent = value;
  if (o.copy) {
    v.classList.add('is-copy');
    v.title = 'Click to copy';
    v.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value);
        if (_hooks.status) _hooks.status('Copied ' + value);
      } catch (e) { if (_hooks.status) _hooks.status('Could not copy - select it by hand', 'err'); }
    });
  }
  r.appendChild(l); r.appendChild(v);
  box.appendChild(r);
}

// The permanent right column: the tags at the top, the characters using the voice below.
function _info() {
  const pane = $('lib-info'), head = $('lib-info-head'), body = $('lib-info-body');
  if (!pane || !body) return;
  pane.hidden = false;
  body.textContent = '';
  body.className = 'lib-info-body is-voices';

  const it = _items.find(i => i.meta.voiceId === _sel);
  if (!it) {
    head.textContent = 'Voice';
    const e = document.createElement('div');
    e.className = 'lib-empty';
    e.textContent = _items.length ? 'Pick a voice on the left.' : 'No voices with a demo yet.';
    body.appendChild(e);
    return;
  }
  const m = it.meta;
  head.textContent = it.name;

  const info = document.createElement('div');
  info.className = 'lib-vi';
  _line(info, 'voice id', m.voiceId, { mono: true, copy: true });
  _line(info, 'category', _pretty(m.category));
  for (const k of (_hooks.labelKeys || Object.keys(m.labels || {}))) {
    if (m.labels && m.labels[k]) _line(info, _pretty(k), _pretty(m.labels[k]));
  }
  if (m.verifiedLanguages) _line(info, 'verified', m.verifiedLanguages + ' languages');
  if (m.dur) _line(info, 'our demo', m.dur.toFixed(1) + ' s');
  _line(info, 'account', m.accountRemoved ? 'slot freed - cannot speak until added back' : 'slot present',
    m.accountRemoved ? { warn: true } : undefined);
  // Only useful while it means something: this pair is what adds the voice back.
  _line(info, 'owner id', m.publicOwnerId, { mono: true, copy: true });
  if (m.description) _line(info, 'described', m.description);
  body.appendChild(info);

  const sep = document.createElement('div');
  sep.className = 'lib-vi-sep';
  sep.textContent = m.characters.length
    ? (m.characters.length === 1 ? 'Used by' : 'Used by ' + m.characters.length + ' characters')
    : 'Used by nobody';
  body.appendChild(sep);

  if (!m.characters.length) {
    const e = document.createElement('div');
    e.className = 'lib-vi-none';
    e.textContent = 'Free to take off the shelf.';
    body.appendChild(e);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'lib-vchars';
  for (const c of m.characters) {
    const cell = document.createElement('div');
    cell.className = 'lib-vchar' + (c.gold ? ' is-gold' : '');
    cell.title = c.name + (c.gold ? '\nThis is their voice' : '\nOne of their saved voices');
    if (c.thumb) {
      const img = document.createElement('img');
      img.src = c.thumb; img.alt = c.name; img.decoding = 'async';
      cell.appendChild(img);
      // The sheet itself, full size, in the viewer every other shelf uses.
      cell.addEventListener('click', () => _hooks.openSheet && _hooks.openSheet(c));
    }
    const nm = document.createElement('div');
    nm.className = 'lib-vchar-n';
    nm.textContent = c.name;
    cell.appendChild(nm);
    grid.appendChild(cell);
  }
  body.appendChild(grid);
}

// Called on every shelf read. The selection survives if that voice is still here - a delete
// somewhere else should not throw you back to the top of the list.
export function render(items, hooks) {
  _items = (items || []).filter(i => i && i.meta && i.meta.voiceId);
  _hooks = hooks || {};
  const grid = $('lib-grid');
  if (!grid) return;
  grid.textContent = '';
  grid.className = 'lib-grid is-voices';

  if (!_items.some(i => i.meta.voiceId === _sel)) _sel = _items.length ? _items[0].meta.voiceId : '';

  if (!_items.length) {
    const e = document.createElement('div');
    e.className = 'lib-empty';
    e.textContent = 'No voices with a demo yet. Take one in a character’s Voice panel.';
    grid.appendChild(e);
    _info();
    return;
  }
  for (const it of _items) grid.appendChild(_row(it));
  _info();
}

// Leaving the shelf: stop whatever is playing. Audio outliving the view it belongs to is
// the one thing a list of players must not do.
export function leave() {
  _stopAll(null);
}
