/* ════════════════════════════════════════════════════════════════════════════
   MERGE — "where" of talking head: the window of the made environments, and new environment in it.

   ONE WINDOW, ITS CONTENT CHANGES (phase V58, the owner 2026-10-29, п. 11-12: "после клика ... хлебными крошками переходы
   сопровождать сверху в хэдере, чтобы пользователь мог вернуться назад"; "с environments аналогично"). The lower half of
   the stage pressed (js/merge-v3/wk-setup.js) opens it over the page (js/gen-window.js openFrame, the almanac's size):

     environments (+ new environment)    only the environments their generator made (IMAGES -> Environments; the
                                         references are photos, not places), wide tiles, a search (wk-maker.js
                                         paintChoose). A press SETS THE PROJECT IN IT and the window closes (V57, (ок5));
                                         the ✕ of a tile pressed twice deletes it - one a project stands on is refused
                                         by the server with that project's name (lib/casting-use.js, (лк4)).
     environments / new environment      the generator's bench (js/gen-window.js paintBench). `create` puts the work into
                                         Alerts and the window STAYS ((лк5)); the countdown is on the stage's LOWER half
                                         only (wk-maker.js holdHalf) - "who" goes on meanwhile. The place made is set in
                                         the project it was made for, unless another place was chosen there meanwhile.

   Opened again while it is under "who" (a row of Alerts pressed, wk-setup.js), it comes up over it.
   ════════════════════════════════════════════════════════════════════════════ */

import * as API from './scen-api.js';
import { derived } from '../chars-store.js';
import { paintChoose } from './wk-maker.js';
import { openFrame, paintBench } from '../gen-window.js';
// (phase V73 block 2, step 2b) Being read, could not be read - the shared parts; the reason a popup in the corner.
import { loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';

let _api = null;                   // the step's (wk-setup.js _envApi), as the window was last opened with it
let _w = null;                     // { win, page: 'list' | 'make' }
let _envs = null;                  // the made environments; read when the window opens, again after a change - false: not read
const _state = {};                 // the list's search
let _was = null;                   // { key, loc } - where the project was set when a place began to be made for it

const _pathOf = (p) => String((p && p.path) || p || '');
const _nameOf = (path) => String(path || '').split('/').pop();

/** The window of "where" - `page` 'list' (the environments) or 'make' (new environment). Over everything open. */
export function openWhere(api, page) {
  _api = api;
  const want = page === 'make' ? 'make' : 'list';
  if (_w && _w.win.alive() && !_w.win.isTop()) _w.win.close();
  if (!_w || !_w.win.alive()) {
    // (phase V64, fix (л), (зг14)) "where": moved, its place kept; its size as it is.
    const win = openFrame({ name: 'environment', anchor: api.anchor(), geom: { key: 'where', move: true, keepPos: true },
      onClose: () => { if (_w && _w.win === win) _w = null; } });
    _w = { win, page: want };
    _envs = null;
  }
  _w.page = want;
  _paint();
}

/** The bench's options for this project - also for a row of it found running (wk-setup.js _pickUpRunning). */
export function benchOpts(api) {
  return {
    kind: 'environment',
    where: () => api.where('newenv'),
    onStart: (spec) => {
      _was = { key: api.key(), loc: String(api.casting().locationImage || '') };
      api.onStart('environment', spec);
    },
    onEnd: (error) => api.onEnd('environment', error),
    // Set in the project it was made for - unless that is not the one open, or another place was chosen there meanwhile.
    onMade: async (path) => {
      _envs = null;
      const was = _was;
      _was = null;
      if (was && api.key() === was.key && String(api.casting().locationImage || '') === was.loc) {
        await api.patch({ locationId: '', locationImage: path });
      }
      if (_w && _w.win.alive() && _w.page === 'list') _paint();
    },
  };
}

function _go(page) {
  if (!_w || !_w.win.alive()) return;
  _w.page = page;
  _paint();
}

function _paint() {
  if (!_w || !_w.win.alive()) return;
  const { win, page } = _w;
  const api = _api;
  win.body.textContent = '';
  win.body.className = 'gw-body';
  if (page === 'make') {
    win.setCrumbs([{ label: 'environments', on: () => _go('list') }, { label: 'new environment' }]);
    paintBench(win.body, benchOpts(api));
    return;
  }
  win.setCrumbs([{ label: 'environments', act: { label: '+ new environment', title: 'Make one from a photo or a sentence', on: () => _go('make') } }]);
  if (_envs === null) {
    win.body.appendChild(loadingEl('reading the environments…'));
    API.environments().then((files) => { _envs = files || []; _paint(); })
      // (phase V73 block 2, (б2-19)) Not read is not "No environments yet": "did not load" with Try again, the reason a popup.
      .catch((e) => { _envs = false; showError('Could not read the environments: ' + e.message); _paint(); });
    return;
  }
  if (_envs === false) { win.body.appendChild(failedEl('The environments', () => { _envs = null; _paint(); })); return; }
  const here = String(api.casting().locationImage || '');
  paintChoose(win.body, {
    state: _state,
    items: _envs.map(_pathOf).filter(Boolean).map(path => ({
      path, name: _nameOf(path).replace(/\.[^.]+$/, ''), aspect: '3:2', thumb: derived(path, 'card'),
    })),
    mark: (it) => (it.path === here ? 'set here' : ''),
    press: (it) => {
      if (it.path !== here) api.patch({ locationId: '', locationImage: it.path });
      win.close();
    },
    del: (it) => ({
      title: 'Delete this environment from the library',
      run: async () => {
        const d = await fetch('/api/library/item/environments/' + encodeURIComponent(_nameOf(it.path)), { method: 'DELETE' })
          .then(r => r.json()).catch(() => null);
        return d && d.success ? '' : ((d && d.error) || 'the app did not answer');
      },
      done: () => { _envs = null; _paint(); },
    }),
    empty: 'No environments yet - "+ new environment" makes the first one.',
  });
}

/** The step is left: its windows go with it (wk-setup.js leave); the work goes on (the server's). */
export function leave() {
  if (_w && _w.win.alive()) _w.win.close();
  _w = null;
}
