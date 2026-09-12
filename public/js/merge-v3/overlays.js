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

// WHAT THE MENU OPENS ON. A birol is cut against a particular script, so an arrangement
// from another scenario is timed against speech this project never says - and on real data
// two thirds of the list is exactly that. So the menu opens on the projects that came from
// the same scenario, which are usually the earlier sends of this very cut, and the tick in
// the header gives back the rest. Nothing is removed from the list; only the default view.
//
// The list and the scenario come from the server together (see /api/mv3/overlays), and are
// kept here so the tick re-draws from what is already in hand instead of asking again. The
// tick resets every time the menu is opened: "this scenario" is the answer that is right
// almost always, and a preference remembered from last week would quietly stop being one.
let _list = [];
let _for = null;
let _showAll = false;

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

  const here = Store.key();
  _list = []; _for = null; _showAll = false;
  try {
    // `for` is the open project, so the answer can say which scenario this menu belongs to.
    const d = await fetch('/api/mv3/overlays?for=' + encodeURIComponent(here || '')).then(x => x.json());
    // The open project is not offered: pulling its own arrangement into itself does nothing
    // except cost an undo step.
    _list = ((d && d.list) || []).filter(x => x.key !== here);
    _for = (d && d.for) || null;
  } catch (e) {
    box.textContent = '';
    box.appendChild(_row(null, e.message));
    return;
  }
  _paint(box);
}

// Drawn from _list every time, so the tick costs a redraw and not a request.
function _paint(box) {
  const mine = _for ? _list.filter(x => x.scen && x.scen.id === _for.id) : _list;
  const shown = (_showAll || !_for) ? _list : mine;
  const elsewhere = _list.length - mine.length;

  box.textContent = '';
  if (_for) box.appendChild(_head(box, elsewhere));
  else if (_list.length) {
    // No scenario behind this project - a blank one, or a cut assembled by hand. There is
    // nothing to filter BY, so everything is listed and the reason is said out loud rather
    // than left looking like the filter failed.
    box.appendChild(_row(null, 'This project came from no scenario, so every arrangement is listed.'));
  }

  if (!_list.length) box.appendChild(_row(null, 'No other project has overlays yet'));
  else if (!shown.length) box.appendChild(_row(null, 'Nothing from this scenario yet - tick "show all" for the rest.'));
  else for (const p of shown) box.appendChild(_entry(p));

  // The footer does not belong to the list and does not depend on it: saving THIS
  // project's arrangement is exactly what you do when the list is empty and you would
  // rather it were not. So it is always the last thing in the panel.
  box.appendChild(_saveFooter(Store.key()));
}

// Which scenario the list is showing, and the way out of it.
function _head(box, elsewhere) {
  const h = document.createElement('div');
  h.className = 'mv3-pull-head';

  const name = document.createElement('span');
  name.className = 'mv3-pull-scen';
  name.textContent = _for.name || 'this scenario';
  name.title = 'The scenario this project came from. Its arrangements are the ones timed '
             + 'against the same script.';

  const lab = document.createElement('label');
  lab.className = 'mv3-pull-all' + (elsewhere ? '' : ' is-off');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = _showAll;
  cb.disabled = !elsewhere;
  cb.addEventListener('change', () => { _showAll = cb.checked; _paint(box); });
  lab.appendChild(cb);
  lab.appendChild(document.createTextNode('show all' + (elsewhere ? ' (' + elsewhere + ')' : '')));
  lab.title = elsewhere
    ? elsewhere + ' arrangement' + (elsewhere === 1 ? '' : 's') + ' from other scenarios, hidden'
    : 'Every arrangement there is belongs to this scenario';

  h.appendChild(name);
  h.appendChild(lab);
  return h;
}

// Pin this project's overlays, deliberately. This used to happen by itself every time a
// render was kept, which pinned an arrangement nobody chose to pin and then quietly
// outranked later edits.
function _saveFooter(key) {
  const foot = document.createElement('div');
  foot.className = 'mv3-pull-foot';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'mv3-pull-save';
  save.textContent = 'Save this arrangement';
  save.title = 'Pin the birols, hooks and halfers on this timeline, with their timings, as '
             + 'what other projects pull from here. Editing this timeline afterwards will '
             + 'not change what they get.';
  if (!key) { save.disabled = true; save.title = 'Open a project first'; }

  save.addEventListener('click', async () => {
    save.disabled = true;
    const label = save.textContent;
    save.textContent = 'Saving…';
    try {
      const d = await fetch('/api/mv3/overlays/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'save failed');
      save.textContent = 'Saved · ' + d.total + ' clip' + (d.total === 1 ? '' : 's');
    } catch (e) {
      // The reason stays on screen rather than in a toast that outlives the panel: an
      // empty timeline is the common one, and it is answered by closing this and adding
      // something to the tracks.
      save.textContent = label;
      save.disabled = false;
      foot.appendChild(_row('err', e.message));
    }
  });

  foot.appendChild(save);
  return foot;
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
  // "frozen" means someone pressed Save on that project, so this arrangement will not
  // drift as that project is edited on. Worth saying, because it is the difference between
  // "as it was pinned" and "as it is right now".
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
