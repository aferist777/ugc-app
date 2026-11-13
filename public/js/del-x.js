// ✕ IN THE CORNER OF A PICTURE, PRESSED TWICE. ONE module for the who / where windows of talking head: the looks
// and environments they choose from (js/merge-v3/wk-maker.js paintChoose, given by wk-setup.js and wk-env.js), a lookbook
// to dress in (wk-setup.js) and the generators' shelves (js/gen-window.js). Nothing is deleted from a chat: its folder
// column and attachment window have no ✕.
//
// The first press asks "really?" in its place - with what the deleting touches when the caller says it (`ask`) - and
// the second deletes; it goes back to ✕ after 3 s, when the pointer leaves the tile, or on Escape. A refusal (a look cast
// in a talking head) is said in the corner of the window (js/notice.js).
//
// Its look is its own (a <style> put in once), so it is the same on every page.

import { twoPress, REALLY } from './really.js';
import { showError } from './notice.js';

// The 3D Studio's page draws this cross itself (the shared parts never reach it).
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
  // The shared parts: a 24-px cross on a picture (.u-onpic.is-del.u-x), armed by js/really.js. The 3D
  // Studio's page keeps its own look: the glyph, "really?" and the rules above.
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
