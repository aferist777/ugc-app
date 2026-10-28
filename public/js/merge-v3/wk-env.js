/* ════════════════════════════════════════════════════════════════════════════
   MERGE — where a first frame is set: the window of the made environments, and the maker of new ones.

   Both are WINDOWS since phase V57 (the owner 2026-10-29, (ок5), (ок7), (ок8)):

     where            the lower half of the stage pressed (js/merge-v3/wk-setup.js): the attachment window's
                      frame with no tree and no left side (chat-pick.js openChoose) - only the environments
                      their generator made (IMAGES -> Environments; the references are photos, not places),
                      in wide tiles, with a search. A press SETS THE PROJECT IN IT at once and the window
                      closes. "+ new environment" at its foot closes it and opens the maker's window.
     new environment  the maker - the same bench as create lookbook: a shelf to draw a base from on the left, a
                      field for a photo and a sentence on the right (wk-maker.js openWindow over the page).

   WHAT THE MAKER CAN BE GIVEN, and what each means (the server decides the details,
   routes/scen3.js POST /scen3/gen/env):
     a photo of a place            that place, emptied of people, continued out to 3:2
     a photo and words             that place, changed as the words say
     an environment off the shelf  changed as the words say - words are required
     words alone                   a place drawn from them (twenty characters at least)
     a picture with no place       the agent names a few places; the person picks any number and
                                   presses create again; the picture lends only its atmosphere

   As soon as the server has taken the work the window goes and the countdown is on the stage, where the answer
   lands. The place made IS SET IN THE PROJECT it was made for - as a look made for a project is put on it -
   unless meanwhile another place was chosen there; it is the base of the next change when the maker is opened
   again.
   ════════════════════════════════════════════════════════════════════════════ */

import * as API from './scen-api.js';
import * as Pick from './chat-pick.js';
import { askDelete } from './ask.js';
import { derived } from '../chars-store.js';
import { showToast } from '../notice.js';
import {
  el, MIN_WORDS_ALONE, nonsense, readPicture, dropField, showPicture, tileMenu,
  holdProgress, endProgress, openWindow, closeWindow,
} from './wk-maker.js';

let _envs = null;                  // the shelf; read when first needed, again after every change
let _loading = false;
let _ref = null;                   // { name, dataUrl, token } - a photo from this computer
let _base = '';                    // ...or an environment already on the shelf, never both
let _note = '';
let _options = null;               // the places offered for a picture with no place in it
let _optionsWhy = '';
const _picked = new Set();
let _making = false;
let _said = '';                    // the agent's answer or what failed, said above the sentence
let _job = null;                   // { label, estimateMs, startedAt, key, was } - the place being made, for the stage
let _win = null;                   // the maker's window while it is open
let _api = null;                   // the step's api, as the maker's window was opened with it

const LABEL = {
  picked: 'Making the place you picked',
  edit: 'Changing the environment',
  draw: 'Drawing the place',
  photo: 'Reading the photo',
  photoWords: 'Reading the photo',
};

const _pathOf = (p) => String((p && p.path) || p || '');
const _nameOf = (path) => String(path || '').split('/').pop();

function _readEnvs() {
  if (_loading) return Promise.resolve(_envs);
  _loading = true;
  return API.environments()
    .then((files) => { _envs = files; return files; })
    .catch((e) => { _envs = _envs || []; _said = 'Could not read the environments: ' + e.message; return _envs; })
    .finally(() => { _loading = false; });
}

// A new picture in the field is a new question: what was offered and said about the last one
// does not carry over.
function _forget() {
  _options = null;
  _optionsWhy = '';
  _picked.clear();
  _said = '';
}

// ── "Where": the made environments, in a window ─────────────────────────────
/** The window of the environments: a press sets the project in one. `api` - wk-setup.js _envApi. */
export function openPlaces(api) {
  const here = String(api.casting().locationImage || '');
  Pick.openChoose({
    title: 'environment',
    crumb: 'Environments',
    hint: 'press one - the project is set in it at once',
    name: 'environment',
    anchor: api.anchor(),
    load: async () => {
      const files = await _readEnvs();
      return { items: (files || []).map(_pathOf).filter(Boolean).map(path => ({
        path, name: _nameOf(path).replace(/\.[^.]+$/, ''), aspect: '3:2', thumb: derived(path, 'card'),
      })) };
    },
    mark: (path) => (path === here ? 'set here' : ''),
    press: (it) => { if (it.path !== here) api.patch({ locationId: '', locationImage: it.path }); },
    make: { label: '+ new environment', title: 'Make one from a photo or a sentence', on: () => openMaker(api) },
    empty: 'No environments yet - "+ new environment" makes the first one.',
  });
}

// ── One place on the maker's shelf ──────────────────────────────────────────
// Landscape, the shape they are made in now; an older upright one is shown whole inside it
// rather than cut down to a strip. The cross and the menu are the lookbook tile's.
function _tile(path, on, pick) {
  const tile = el('button', 'mv3-wk-tile is-env' + (on ? ' is-on' : ''));
  tile.type = 'button';
  tile.title = _nameOf(path);
  const img = el('img', 'mv3-wk-face');
  img.alt = '';
  img.loading = 'lazy';
  img.src = derived(path, 'card');
  tile.appendChild(img);

  const x = el('button', 'mv3-wk-tilex', '✕');
  x.type = 'button';
  x.title = 'Delete this environment';
  x.addEventListener('click', (e) => { e.stopPropagation(); _askDelete(tile, path); });
  tile.appendChild(x);

  tile.addEventListener('click', pick);
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tileMenu(e, [
      { label: 'open', sub: 'look at it, full size', on: () => _open(path) },
      { label: 'delete', sub: 'for good', on: () => _askDelete(tile, path), danger: true },
    ], 'environment menu');
  });
  return tile;
}

// What the agent wrote about it is read at the moment it is opened - one made a minute ago is
// the one most likely to be looked at.
async function _open(path) {
  let meta = {};
  try { meta = (await API.envMeta())[path] || {}; } catch (e) { /* nothing known */ }
  showPicture({ src: path, name: _nameOf(path), rows: [['description', meta.description]], from: meta.from });
}

function _askDelete(anchor, path) {
  const api = _api;
  const current = !!api && String(api.casting().locationImage || '') === path;
  askDelete(anchor, 'Delete "' + _nameOf(path) + '"?',
    current ? 'It is where this project is set: the lower half of the stage will be empty again.'
      : 'The picture goes from the shelf for good.',
    async () => {
      try {
        const r = await fetch('/api/library/item/environments/' + encodeURIComponent(_nameOf(path)), { method: 'DELETE' })
          .then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || 'refused');
        if (_base === path) { _base = ''; _forget(); }
        if (current) await api.patch({ locationId: '', locationImage: '' });
      } catch (e) {
        _said = 'Could not delete it: ' + e.message;
      }
      _envs = await API.environments().catch(() => _envs);
      _paint();
    });
}

// ── The maker's window ──────────────────────────────────────────────────────
const MODE_LABEL = {
  picked: 'make the place you picked',
  photoWords: 'read the photo and apply the words',
  photo: 'take the place out of the photo',
  edit: 'change this environment',
  draw: 'draw it from the words',
};

function _mode() {
  const note = _note.trim();
  if (_picked.size) return 'picked';
  if (_ref) return note ? 'photoWords' : 'photo';
  if (_base) return note ? 'edit' : '';
  return note ? 'draw' : '';
}

// What stops the button, in words. Empty means nothing does.
function _why() {
  const note = _note.trim();
  if (_options && _options.length && !_picked.size) return 'pick a place above';
  if (!_ref && !_base && !note) return 'a photo or a sentence';
  if (_base && !_ref && !note) return 'say what to change';
  if (!_ref && !_base) {
    if (note.length < MIN_WORDS_ALONE) return (MIN_WORDS_ALONE - note.length) + ' more characters';
    if (nonsense(note)) return 'that is not a description';
  } else if (note && nonsense(note)) {
    return 'that is not a description';
  }
  return '';
}

/** The maker's window, over the page. `api` - wk-setup.js _envApi. */
export function openMaker(api) {
  _api = api;
  const win = openWindow({
    title: 'new environment', name: 'new environment', anchor: api.anchor(),
    onClose: () => { if (_win === win) _win = null; },
  });
  _win = win;
  if (_envs === null) _readEnvs().then(_paint);
  _paint();
}

function _paint() {
  const win = _win;
  if (!win || !win.alive()) return;
  const api = _api;
  win.body.textContent = '';
  win.body.className = 'mk-body mv3-wk-scroll is-split';

  // LEFT: the shelf a base is drawn from. What is made joins it, so the pile grows while you work.
  const left = el('div', 'mv3-wk-half is-shelf');
  if (_envs === null) {
    left.appendChild(_noteEl('reading the environments…'));
  } else if (!_envs.length) {
    left.appendChild(_noteEl('No environments yet. The first one is made on the right.'));
  } else {
    const grid = el('div', 'mv3-wk-grid is-env');
    for (const p of _envs) {
      const path = _pathOf(p);
      if (!path) continue;
      grid.appendChild(_tile(path, path === _base && !_ref, () => {
        _base = (_base === path ? '' : path);
        if (_base) _ref = null;                    // one base, not two
        _forget();
        _paint();
      }));
    }
    left.appendChild(grid);
  }
  win.body.appendChild(left);

  // RIGHT: the field. A photo from this computer replaces whatever was chosen on the left.
  const right = el('div', 'mv3-wk-half is-make');
  const { drop, input } = dropField({
    src: _ref ? _ref.dataUrl : (_base ? derived(_base, 'card') : ''),
    empty: 'a photo from this computer, or pick an environment on the left',
    onFile: (file) => {
      readPicture(file)
        .then((p) => { _ref = { ...p, token: '' }; _base = ''; _forget(); _paint(); })
        .catch((e) => { _said = e.message; _paint(); });
    },
    onClear: () => { _ref = null; _base = ''; _forget(); _paint(); },
    onOpen: () => (_ref ? showPicture({ src: _ref.dataUrl, name: _ref.name }) : _open(_base)),
  });
  right.append(drop, input);
  win.body.appendChild(right);

  // THE FOOT, on the bottom edge: what was said, the places to pick, the sentence, the button.
  const foot = el('div', 'mv3-wk-foot');
  const go = el('button', 'mv3-wk-create', 'create');
  go.type = 'button';
  const hint = el('span', 'mv3-wk-mode mv3-sc-meta');
  const sync = () => {
    const why = _why();
    go.disabled = !!why || _making;
    go.textContent = _making ? 'making…' : 'create';
    go.title = why || 'Make it - this spends credits';
    hint.textContent = _making ? (_job ? 'the stage says how far' : 'asking…') : (why || MODE_LABEL[_mode()] || '');
    hint.classList.toggle('is-why', !!why && !_making);
  };

  const said = _said ? el('div', 'mv3-wk-said', _said) : null;
  if (said) foot.appendChild(said);
  if (_options && _options.length) {
    const ask = el('div', 'mv3-wk-choice');
    ask.appendChild(el('div', 'mv3-wk-choice-why',
      _optionsWhy || 'There is no place in this picture. What should it become?'));
    const chips = el('div', 'mv3-wk-chips');
    for (const o of _options) {
      const c = el('button', 'mv3-sc-tab' + (_picked.has(o) ? ' is-on' : ''), o);
      c.type = 'button';
      c.title = 'Pick any number of them - they are made into one place';
      c.addEventListener('click', () => {
        if (_picked.has(o)) _picked.delete(o); else _picked.add(o);
        c.classList.toggle('is-on', _picked.has(o));
        sync();
      });
      chips.appendChild(c);
    }
    ask.appendChild(chips);
    foot.appendChild(ask);
  }

  const note = el('textarea', 'mv3-sc-lines is-short');
  note.placeholder = 'What place should it be? With a photo, say what to change - "evening, the lamps on".';
  note.value = _note;
  note.addEventListener('input', () => {
    _note = note.value;
    // Typing is the answer to whatever was said: it goes, without a repaint that would take the
    // cursor out of the field.
    if (said && said.isConnected) { said.remove(); _said = ''; }
    sync();
  });
  const row = el('div', 'mv3-wk-footrow');
  go.addEventListener('click', () => _make(api));
  row.append(hint, go);
  foot.append(note, row);
  sync();
  right.appendChild(foot);
}

function _noteEl(text, bad) {
  return el('div', 'mv3-ins-note' + (bad ? ' is-err' : ''), text);
}

async function _make(api) {
  const mode = _mode();
  if (!mode || _why() || _making) return;
  _making = true;
  _said = '';
  _paint();

  const body = {
    prompt: _note.trim(), choices: [..._picked],
    refName: _ref ? _ref.name : '',
    title: 'Environment', where: api.where('newenv'),
  };
  if (_ref) {
    if (_ref.token) body.refToken = _ref.token;
    else body.imageBase64 = _ref.dataUrl;
  } else if (_base) {
    body.imagePath = _base;
  }

  try {
    let r;
    try {
      r = await API.makeEnvironment(body);
    } catch (e) {
      // The server's copy of the photo has expired: the photo itself goes once more.
      if (!(e && e.gone && _ref)) throw e;
      _ref.token = '';
      delete body.refToken;
      body.imageBase64 = _ref.dataUrl;
      r = await API.makeEnvironment(body);
    }
    if (_ref && r.refToken) _ref.token = r.refToken;

    if (r.choose) {
      // Nothing was made and nothing spent: the agent is asking which place - in the window.
      _options = r.options || [];
      _optionsWhy = r.why || '';
      _picked.clear();
      _making = false;
      _paint();
      return;
    }
    // From here the server owns it: it waits, files the place on the shelf with its description and
    // the photo it came from, and writes the answer into the journal. The window goes; the stage waits.
    _start(api, LABEL[mode] || 'Making the place', Date.now());
    closeWindow();
    await _followMake(api, r.alertId);
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    _stop(msg);
    _making = false;
    // An agent that refused has answered the question, and it reads better as that than as an error.
    _said = e && e.refused ? msg : 'The environment failed: ' + msg;
    _paint();
    if (!_win) showToast({ failed: true, mark: '!', title: 'The environment failed', where: msg, ms: 9000 });
  }
}

// The countdown on the stage, and what the project was set in when it began (`was`) - the place made goes in
// only while nobody chose another meanwhile, in that same project.
function _start(api, label, startedAt) {
  _job = { label, estimateMs: 120000, startedAt: startedAt || Date.now(), key: api.key(), was: String(api.casting().locationImage || '') };
  holdProgress('environment', _job);
}
function _stop(error) {
  _job = null;
  endProgress('environment', error);
}

/** The place being made, for the stage's countdown (wk-setup.js _reHold) - null when nothing is. */
export const running = () => _job;

// Watching one row of the journal to its end. Started by `create`, and again by the step itself when
// it finds a row of its own already running - after a reload, or after somebody walked away and came back.
async function _followMake(api, id) {
  const job = _job;
  try {
    const rec = await API.follow(id);
    _stop();
    _envs = await API.environments().catch(() => _envs);
    const made = String((rec.result || {}).path || '');
    _base = made;                                  // the next change builds on it
    _ref = null;
    _note = '';
    _forget();
    // Set in the project it was made for - unless that is not the one open, or another place was chosen there.
    if (made && job && api.key() === job.key && String(api.casting().locationImage || '') === job.was) {
      await api.patch({ locationId: '', locationImage: made });
    } else if (made) {
      showToast({ mark: '✓', title: 'The environment is made', where: 'It is in IMAGES → Environments - "where" sets a project in it.', ms: 9000 });
    }
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    _stop(msg);
    _said = 'The environment failed: ' + msg;
    if (!_win) showToast({ failed: true, mark: '!', title: 'The environment failed', where: msg, ms: 9000 });
  }
  _making = false;
  _paint();
  api.repaint();
}

/** A row of this step's own found running in the journal (wk-setup.js _pickUpRunning): followed to its end. */
export function pickUp(api, rec) {
  if (_making || !rec) return;
  _making = true;
  _start(api, 'Making the place', Date.parse(rec.startedAt) || 0);
  _followMake(api, rec.id);
}

/** The step is left: the windows go with it (wk-setup.js leave closes them); the work goes on. */
export function leave() {
  _win = null;
}
