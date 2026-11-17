/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — the gallery of scenes.

   Every scene as a tile: the photo it was built from when it has one, otherwise what its camera saw when it
   was last saved; its name, when it was changed, how many things and fragments it holds. A press opens it; under
   each tile: rename, copy, delete - delete in two presses ("really?" for three seconds, as the scenario archive).
   The first tile makes a new scene. Scenes save themselves, so there is no "save" here; "save as" is the copy.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { askName } from '../name-box.js';

let G = null;             // { ov, grid, layer }
let A = null;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const thumbOf = (p) => '/api/thumb?src=' + encodeURIComponent(p) + '&v=strip';
function _when(iso) {
  const d = new Date(iso || 0);
  if (!+d) return '';
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function closeGallery() {
  if (!G) return;
  Layers.close(G.layer);
  G.ov.remove();
  G = null;
}

export async function openGallery(app) {
  A = app;
  if (!G) {
    const ov = el('div', 's3-gal-ov');
    const box = el('div', 's3-gal');
    const head = el('div', 's3-gal-head');
    head.appendChild(el('h3', '', 'Scenes'));
    head.appendChild(el('span', 's3-fw-hint', 'Each scene saves itself as you work.'));
    head.appendChild(el('span', 'sp'));
    const x = el('button', 'lib-btn', 'Close');
    x.type = 'button';
    head.appendChild(x);
    const grid = el('div', 's3-gal-grid');
    box.append(head, grid);
    ov.appendChild(box);
    document.body.appendChild(ov);
    // Nothing open behind it: it cannot be closed into an empty studio.
    const close = () => { if (A.scene) closeGallery(); };
    G = { ov, grid, layer: Layers.open(ov, { onEsc: close, name: 'scenes' }), x };
    x.addEventListener('click', close);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  }
  G.x.hidden = !A.scene;
  await _fill();
}

async function _fill() {
  if (!G) return;
  const r = await A.api('GET', '/api/3d/scenes');
  if (!G) return;
  const grid = G.grid;
  grid.textContent = '';
  const add = el('button', 's3-gal-tile is-new');
  add.type = 'button';
  add.append(el('div', 's3-gal-pic', '+'), el('div', 's3-gal-n', 'New scene'));
  add.addEventListener('click', () => A.newScene());
  grid.appendChild(add);
  if (!r.ok) { grid.appendChild(el('div', 's3-none', r.j.error || 'The scenes could not be read.')); return; }
  for (const s of r.j.scenes) grid.appendChild(_tile(s));
}

function _tile(s) {
  const t = el('div', 's3-gal-tile' + (A.scene && A.scene.id === s.id ? ' on' : ''));
  const open = el('button', 's3-gal-open');
  open.type = 'button';
  const pic = el('div', 's3-gal-pic');
  const src = s.source ? thumbOf(s.source) : s.thumb ? s.thumb + '?v=' + encodeURIComponent(s.updatedAt || '') : '';
  if (src) { const im = el('img'); im.src = src; im.alt = ''; im.loading = 'lazy'; pic.appendChild(im); }
  else pic.appendChild(el('span', 's3-gal-empty', 'no picture yet'));
  open.append(pic, el('div', 's3-gal-n', s.name || 'Untitled'),
    el('div', 's3-gal-s', [_when(s.updatedAt), s.objects + (s.objects === 1 ? ' thing' : ' things'), s.fragments ? s.fragments + ' fragments · ' + s.length + ' s' : ''].filter(Boolean).join(' · ')));
  open.addEventListener('click', () => A.openScene(s.id));
  const acts = el('div', 's3-gal-acts');
  const ren = el('button', 's3-gal-a', 'rename');
  ren.type = 'button';
  ren.addEventListener('click', async () => {
    const name = await askName({ title: 'Scene name', value: s.name, okLabel: 'Rename', anchor: ren });
    if (!name || name.trim() === s.name) return;
    if (A.scene && A.scene.id === s.id) await A.saveNow();
    const r = await A.api('PATCH', '/api/3d/scenes/' + encodeURIComponent(s.id), { name: name.trim() });
    if (!r.ok) { A.status(r.j.error || 'Not renamed.', true); return; }
    // The open scene's folder moved: its copy here is the server's now.
    if (A.scene && A.scene.id === s.id) await A.openScene(s.id).then(() => openGallery(A));
    else _fill();
  });
  const cp = el('button', 's3-gal-a', 'copy');
  cp.type = 'button';
  cp.title = 'A copy under a new name - "save as"';
  cp.addEventListener('click', async () => {
    const name = await askName({ title: 'Name of the copy', value: (s.name || 'Scene') + ' copy', okLabel: 'Copy', anchor: cp });
    if (!name) return;
    if (A.scene && A.scene.id === s.id) await A.saveNow();
    const r = await A.api('POST', '/api/3d/scenes/' + encodeURIComponent(s.id) + '/copy', { name: name.trim() });
    if (!r.ok) { A.status(r.j.error || 'Not copied.', true); return; }
    _fill();
  });
  const del = el('button', 's3-gal-a is-del', 'delete');
  del.type = 'button';
  let armed = 0;
  del.addEventListener('click', async () => {
    if (!armed) {
      del.textContent = 'really?';
      del.classList.add('armed');
      armed = setTimeout(() => { armed = 0; del.textContent = 'delete'; del.classList.remove('armed'); }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    const r = await A.api('DELETE', '/api/3d/scenes/' + encodeURIComponent(s.id));
    if (!r.ok) { A.status(r.j.error || 'Not deleted.', true); return; }
    A.forget(s.id);
    G.x.hidden = !A.scene;
    _fill();
  });
  acts.append(ren, cp, del);
  t.append(open, acts);
  return t;
}
