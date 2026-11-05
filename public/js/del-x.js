// ✕ IN THE CORNER OF A PICTURE, PRESSED TWICE (phase V58, the owner 2026-10-29: "добавь в правый верхний угол картинок
// крестик для удаления файла с даблкликом "really?""). ONE module for every place a picture is pointed at to delete it:
// the folder column (the pictures chat's right column, the Images column of the generators - js/folder-column.js), the
// attachment window (js/merge-v3/chat-pick.js), the looks and environments of talking head (js/merge-v3/wk-setup.js,
// wk-env.js) and the generators' shelves (js/gen-window.js).
//
// The first press asks "really?" in its place - with what the deleting touches (`ask`: "used in 2 projects", (лк2)) - and
// the second deletes; it goes back to ✕ after 3 s, when the pointer leaves the tile, or on Escape. A refusal (a look cast
// in a talking head, (лк3)) is said in the corner of the window (js/notice.js).
//
// Its look is its own (a <style> put in once), so it is the same on every page.

import { twoPress, REALLY } from './really.js';
import { showError } from './notice.js';

// The 3D Studio's page draws this cross itself (the shared parts never reach it, (б1-13а)).
const OLD_LOOK = () => !!document.querySelector('link[href="css/studio3d.css"]');
const CSS = `
.dx{position:absolute; top:4px; right:4px; z-index:3; opacity:0; transition:opacity .12s; white-space:nowrap}
.dx-host:hover > .dx, .dx:focus-visible, .dx.is-ask, .dx.is-armed{opacity:1}
:root:has(link[href="css/studio3d.css"]) .dx{min-width:20px; height:20px; padding:0 5px; border-radius:10px;
  border:1px solid var(--on-media-line); background:var(--scrim); color:var(--on-media); font:600 11px/18px var(--font, system-ui); cursor:pointer}
:root:has(link[href="css/studio3d.css"]) .dx:hover{background:var(--danger-fill); border-color:var(--danger-fill); color:var(--on-danger)}
:root:has(link[href="css/studio3d.css"]) .dx.is-ask{background:var(--danger-fill); border-color:var(--danger-fill); color:var(--on-danger); padding:0 8px}
:root:has(link[href="css/studio3d.css"]) .dx[disabled]{opacity:.5; cursor:default}
.dx-host{position:relative}
`;
let _css = false;
function _ensureCss() {
  if (_css || document.getElementById('dx-css')) { _css = true; return; }
  const s = document.createElement('style');
  s.id = 'dx-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  _css = true;
}

/**
 * The ✕ for one thing. `o`:
 *   title       what the ✕ says under the pointer
 *   ask()       -> Promise<words> - said after "really?" ('' - nothing to add)
 *   run()       -> Promise<'' | words> - the deleting; words are its refusal or failure
 *   done()      after a delete that went through
 *   host        the tile it stands in (made a positioning box; the pointer leaving it takes "really?" back)
 */
export function delX(o) {
  _ensureCss();
  // (phase V73 block 2) The shared parts: a 24-px cross on a picture (.u-onpic.is-del.u-x), armed by js/really.js. The 3D
  // Studio's page keeps its own look ((б1-13а)): the glyph, "really?" and the rules above.
  const old = OLD_LOOK();
  const x = document.createElement('button');
  x.type = 'button';
  x.className = old ? 'dx' : 'dx u-onpic is-del u-x';
  x.textContent = old ? '✕' : '';
  x.title = o.title || 'Delete it from the library';
  x.draggable = false;
  if (o.host) o.host.classList.add('dx-host');
  const stop = (e) => { e.stopPropagation(); };
  x.addEventListener('pointerdown', stop);
  x.addEventListener('mousedown', stop);
  x.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
  twoPress(x, {
    text: old ? 'really?' : REALLY,
    host: o.host,
    extra: typeof o.ask === 'function' ? o.ask : null,
    armed: () => { if (old) x.classList.add('is-ask'); },
    rest: () => { x.classList.remove('is-ask'); if (old) x.classList.remove('is-armed', 'is-danger'); },
    go: async (e) => {
      e.preventDefault();
      e.stopPropagation();
      x.disabled = true;
      let why = '';
      try { why = await o.run(); } catch (err) { why = (err && err.message) || 'it could not be deleted'; }
      if (why) {
        x.disabled = false;
        showError('Not deleted: ' + why);
        return;
      }
      if (typeof o.done === 'function') o.done();
    },
  });
  return x;
}

const _json = (url, opt) => fetch(url, opt).then(r => r.json()).catch(() => null);

/** "used in N projects" for some files (POST /api/library/usage - the projects whose timelines hold them), '' for none. */
export async function usageWords(paths) {
  const media = [].concat(paths || []).filter(Boolean);
  if (!media.length) return '';
  const d = await _json('/api/library/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media }) });
  const n = (d && d.success && Array.isArray(d.projects)) ? d.projects.length : 0;
  return n ? 'used in ' + n + (n === 1 ? ' project' : ' projects') : '';
}

/**
 * Whether a file of the media tree (js/folder-column.js filesOf) can be deleted from where it is shown, and how: a
 * picture of IMAGES (its record), a made environment or lookbook (its file), a REFERENCES post (the whole post - its
 * files with it).
 */
export function canDelete(f) {
  if (!f) return false;
  if (f.kind === 'images') return !!f.libId;
  if (f.kind === 'environments' || f.kind === 'lookbooks') return !!f.path;
  if (f.kind === 'references') return !!(f.item && f.item.id);
  return false;
}

/** The files a delete takes with it - what "used in N projects" is asked about. */
export function filesOf(f) {
  if (f && f.kind === 'references' && f.item) {
    const m = f.item.meta || {};
    return (Array.isArray(m.items) ? m.items : []).map(x => x && x.path).filter(Boolean).concat(f.path ? [f.path] : []);
  }
  return f && f.path ? [f.path] : [];
}

/** Deletes it the way its shelf does (routes/library.js _deleteOne, routes/references.js). -> '' | words */
export async function deleteFile(f) {
  let url = '';
  if (f.kind === 'images') url = '/api/library/item/images/' + encodeURIComponent(f.libId);
  else if (f.kind === 'environments' || f.kind === 'lookbooks') url = '/api/library/item/' + f.kind + '/' + encodeURIComponent(String(f.path).split('?')[0].split('/').pop());
  else if (f.kind === 'references') url = '/api/references/' + encodeURIComponent(f.item.id);
  if (!url) return 'it cannot be deleted from here';
  const d = await _json(url, { method: 'DELETE' });
  return d && d.success ? '' : ((d && d.error) || 'the app did not answer');
}

/** What the ✕ says under the pointer for such a file. */
export function titleOf(f) {
  if (f && f.kind === 'references') {
    const n = filesOf(f).length;
    return n > 1 ? 'Delete this post from REFERENCES - all ' + n + ' of its files' : 'Delete this post from REFERENCES';
  }
  return 'Delete it from the library';
}
