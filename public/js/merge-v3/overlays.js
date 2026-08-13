/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — reusing an overlay arrangement from another project.

   A dropdown in the Timeline bar, opening UPWARD because the bar sits below the space it
   needs. It lists the projects that have Birols / Hooks / Halfers on them, and picking one
   copies that arrangement into the open project: same clips, same order, same seconds.

   IT REPLACES. All three overlay tracks are cleared and refilled, which is what makes the
   result predictable - you get exactly the arrangement you picked, not it merged with
   whatever was already there and two clips fighting over the same stretch of lane. One
   Store.mutate, so one undo step takes it all back.

   The ✕ beside a row stops that project being offered as a source. It does not delete the
   project - that is the delete button in the project bar, and conflating the two would make
   a tidy-up gesture destroy work.

   The Main track is never touched here. An arrangement is the overlays; the spine belongs
   to the project it came from.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';

const OVERLAY_TRACKS = ['biro', 'hook', 'halfer'];
// Copied along with the clips: how loud the overlays were, and what effect they carried, is
// part of the arrangement rather than a separate thing to set up again.
const TRACK_FIELDS = ['volume', 'speed', 'transition', 'animation', 'filter'];

let _panel = null;

function _close() {
  if (!_panel) return;
  _panel.remove();
  _panel = null;
  document.removeEventListener('mousedown', _outside, true);
  document.removeEventListener('keydown', _esc);
}
function _outside(e) {
  if (!_panel) return;
  const btn = document.getElementById('mv3-pull');
  if (_panel.contains(e.target) || (btn && btn.contains(e.target))) return;
  _close();
}
function _esc(e) { if (e.key === 'Escape') { e.preventDefault(); _close(); } }

async function _pull(key) {
  // Asks the server what that project OFFERS, which is its frozen snapshot if a render of
  // it was kept and its live tracks otherwise. Reading the timeline directly would always
  // take the live tracks and quietly ignore the freeze.
  const d = await fetch('/api/mv3/overlays/' + encodeURIComponent(key)).then(r => r.json());
  if (!d || !d.success) throw new Error((d && d.error) || 'could not read that project');
  const src = d.tracks || {};
  Store.mutate(tl => {
    for (const k of OVERLAY_TRACKS) {
      const from = src[k] || {};
      tl.tracks[k].clips = JSON.parse(JSON.stringify(from.clips || []));
      for (const f of TRACK_FIELDS) tl.tracks[k][f] = (from[f] === undefined ? null : from[f]);
    }
  });
}

async function _open() {
  _close();
  const btn = document.getElementById('mv3-pull');
  if (!btn) return;
  const box = document.createElement('div');
  box.className = 'mv3-pull-menu';
  box.appendChild(_row(null, 'Loading…'));
  // Positioned against the button in page coordinates: the bar it lives in scrolls with
  // nothing, but the panel has to escape the panel's overflow to open upward.
  const r = btn.getBoundingClientRect();
  box.style.left = Math.round(r.left) + 'px';
  box.style.bottom = Math.round(window.innerHeight - r.top + 4) + 'px';
  document.body.appendChild(box);
  _panel = box;
  document.addEventListener('mousedown', _outside, true);
  document.addEventListener('keydown', _esc);

  let list = [];
  try {
    const d = await fetch('/api/mv3/overlays').then(x => x.json());
    list = (d && d.list) || [];
  } catch (e) {
    box.textContent = '';
    box.appendChild(_row(null, e.message));
    return;
  }
  const here = Store.key();
  // The open project is not offered: pulling its own arrangement into itself does nothing
  // except cost an undo step.
  list = list.filter(x => x.key !== here);
  box.textContent = '';
  if (!list.length) {
    box.appendChild(_row(null, 'No other project has overlays yet'));
    return;
  }
  for (const p of list) box.appendChild(_entry(p));
}

function _row(cls, text) {
  const d = document.createElement('div');
  d.className = 'mv3-pull-note' + (cls ? ' ' + cls : '');
  d.textContent = text;
  return d;
}

function _entry(p) {
  const row = document.createElement('div');
  row.className = 'mv3-pull-row';

  const take = document.createElement('button');
  take.type = 'button';
  take.className = 'mv3-pull-take';
  const bits = OVERLAY_TRACKS.map(k => p.per[k]).filter(n => n > 0).length;
  take.innerHTML = '';
  const name = document.createElement('span');
  name.className = 'mv3-pull-name';
  name.textContent = p.title;
  const cnt = document.createElement('span');
  cnt.className = 'mv3-pull-cnt';
  // "frozen" means this arrangement was saved when a render of that project was kept, so
  // it will not drift as that project is edited on. Worth saying, because it is the
  // difference between "as it was rendered" and "as it is right now".
  cnt.textContent = p.total + (bits > 1 ? ' on ' + bits + ' tracks' : '') + (p.frozen ? ' · frozen' : '');
  take.appendChild(name);
  take.appendChild(cnt);
  take.title = 'Replace this project\'s overlays with those ' + p.total + ' clips';
  take.addEventListener('click', async () => {
    take.disabled = true;
    try { await _pull(p.key); _close(); }
    catch (e) { take.disabled = false; take.title = e.message; }
  });
  row.appendChild(take);

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'mv3-pull-x';
  x.textContent = '✕';
  x.title = 'Stop offering this project as a source. The project itself is untouched.';
  x.addEventListener('click', async (e) => {
    e.stopPropagation();
    x.disabled = true;
    try {
      await fetch('/api/mv3/overlays/hide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: p.key }),
      });
      row.remove();
      if (_panel && !_panel.querySelector('.mv3-pull-row')) _panel.appendChild(_row(null, 'Nothing left in the list'));
    } catch (err) { x.disabled = false; }
  });
  row.appendChild(x);
  return row;
}

export function initOverlays() {
  const btn = document.getElementById('mv3-pull');
  if (!btn) return;
  btn.addEventListener('click', () => { _panel ? _close() : _open(); });
}
