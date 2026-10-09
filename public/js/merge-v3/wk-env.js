/* ════════════════════════════════════════════════════════════════════════════
   MERGE — where a first frame is set: the environments shelf, and the maker of new ones.

   The branch under setting & voice that is not the character (docs/local-app/PLAN.md, "create
   environment"):

     environment          the saved places. Picking one sets the project in it.
     create environment   the maker - the same bench as create lookbook: a shelf to draw a base
                          from on the left, a field for a photo and a sentence on the right.

   WHAT THE MAKER CAN BE GIVEN, and what each means (the server decides the details,
   routes/scen3.js POST /scen3/gen/env):
     a photo of a place            that place, emptied of people, continued out to 3:2
     a photo and words             that place, changed as the words say
     an environment off the shelf  changed as the words say - words are required
     words alone                   a place drawn from them (twenty characters at least)
     a picture with no place       the agent names a few places; the person picks any number and
                                   presses create again; the picture lends only its atmosphere

   What is made lands on the shelf, becomes the base for the next change, and goes ON TRIAL on the
   lower half of the stage. `select` STANDS ON THE PICKED TILE (the owner, 2026-09-21) - the one
   click that sets the project in that place and goes back to the hub - and the stage's own cross
   takes the trial back off. A tile pressed on the shelf goes on trial the same way; nothing here
   writes into the project by itself (decided with the owner 2026-09-21, docs/local-app/PLAN.md
   "Сцена, setup и таймлайн-зеркало"). The stage itself is painted by the step
   (js/merge-v3/wk-setup.js, _stage); this module only says what is on trial.
   ════════════════════════════════════════════════════════════════════════════ */

import * as API from './scen-api.js';
import { askDelete } from './ask.js';
import { derived } from '../chars-store.js';
import {
  el, MIN_WORDS_ALONE, nonsense, readPicture, dropField, showPicture, tileMenu,
  holdProgress, endProgress, shelfHead,
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
let _made = '';                    // the last one made here, on trial on the stage with `select`
let _said = '';                    // the agent's answer or what failed, said above the sentence
let _lookedForRunning = false;     // the journal has been asked once whether something of ours runs

const LABEL = {
  picked: 'Making the place you picked',
  edit: 'Changing the environment',
  draw: 'Drawing the place',
  photo: 'Reading the photo',
  photoWords: 'Reading the photo',
};

const _pathOf = (p) => String((p && p.path) || p || '');
const _nameOf = (path) => String(path || '').split('/').pop();

function _needEnvs(api) {
  if (_envs !== null || _loading) return;
  _loading = true;
  API.environments()
    .then((files) => { _envs = files; })
    .catch((e) => { _envs = []; _said = 'Could not read the environments: ' + e.message; })
    .finally(() => { _loading = false; api.repaint(); });
}

// A new picture in the field is a new question: what was offered and said about the last one
// does not carry over.
function _forget() {
  _options = null;
  _optionsWhy = '';
  _picked.clear();
  _said = '';
}

// ── The head of the panel ───────────────────────────────────────────────────
// The tabs on the left and the title on the right, as on the looks (phase V24; js/merge-v3/wk-maker.js).
function _bar(head, api, here) {
  const tab = (label, title, id) => {
    const b = el('button', 'mv3-sc-tab' + (here === id ? ' is-on' : ''), label);
    b.type = 'button';
    b.title = title;
    if (here === id) b.disabled = true;
    else b.addEventListener('click', () => api.go(id));
    return b;
  };
  const x = el('button', 'mv3-iconbtn', '✕');
  x.type = 'button';
  x.title = 'Back to setting & voice';
  x.addEventListener('click', () => api.go('hub'));
  shelfHead(head, [
    tab('environment', 'The saved environments', 'env'),
    tab('create environment', 'Make one from a photo or a sentence', 'newenv'),
  ], x);
}

// ── One place on a shelf ────────────────────────────────────────────────────
// Landscape, the shape they are made in now; an older upright one is shown whole inside it
// rather than cut down to a strip. The cross and the menu are the lookbook tile's, and so is
// `act` - the button the PICKED tile carries, which here is `select`.
function _tile(path, on, pick, api, act) {
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
  x.addEventListener('click', (e) => { e.stopPropagation(); _askDelete(tile, path, api); });
  tile.appendChild(x);

  if (act) {
    const b = el('button', 'mv3-wk-tileact', act.label);
    b.type = 'button';
    b.title = act.title || '';
    b.disabled = !!act.busy;
    b.addEventListener('click', (e) => { e.stopPropagation(); act.on(); });
    tile.appendChild(b);
  }

  tile.addEventListener('click', pick);
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tileMenu(e, [
      { label: 'open', sub: 'look at it, full size', on: () => _open(path) },
      { label: 'delete', sub: 'for good', on: () => _askDelete(tile, path, api), danger: true },
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

function _askDelete(anchor, path, api) {
  const current = String(api.casting().locationImage || '') === path;
  askDelete(anchor, 'Delete "' + _nameOf(path) + '"?',
    current ? 'It is where this project is set: the environment field on setting & voice will be empty again.'
      : 'The picture goes from the shelf for good.',
    async () => {
      try {
        const r = await fetch('/api/library/item/environments/' + encodeURIComponent(_nameOf(path)), { method: 'DELETE' })
          .then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || 'refused');
        if (_base === path) { _base = ''; _forget(); }
        if (_made === path) _made = '';
        if (api.trying() === path) api.tryPlace('');
        if (current) await api.patch({ locationId: '', locationImage: '' });
      } catch (e) {
        _said = 'Could not delete it: ' + e.message;
      }
      _envs = await API.environments().catch(() => _envs);
      api.repaint();
    });
}

// ── The shelf ───────────────────────────────────────────────────────────────
export function paintShelf(host, head, api) {
  _bar(head, api, 'env');
  // Leaving the maker forgets what it found there: coming back asks the journal again.
  _lookedForRunning = false;
  if (_envs === null) {
    host.appendChild(api.note('reading the environments…'));
    _needEnvs(api);
    return;
  }
  if (_said) host.appendChild(api.note(_said, true));
  const current = String(api.casting().locationImage || '');
  const trial = String(api.trying() || '');
  const grid = el('div', 'mv3-wk-grid is-env');
  const add = el('button', 'mv3-wk-tile is-add', '+');
  add.type = 'button';
  add.title = 'Create an environment from a photo or a sentence';
  add.addEventListener('click', () => api.go('newenv'));
  grid.appendChild(add);
  for (const p of _envs) {
    const path = _pathOf(p);
    if (!path) continue;
    // Lit: the one on trial, else the one the project is set in. A press puts a place on trial on
    // the stage and `select` on the tile itself (the owner, 2026-09-21) - that is the write; a
    // second press on the same tile takes the trial off again.
    grid.appendChild(_tile(path, path === (trial || current), () => {
      api.tryPlace(path === trial ? '' : path);
      api.repaint();
    }, api, path === trial ? {
      label: 'select', title: 'Set this project in this environment', busy: api.saving(), on: () => api.select(),
    } : null));
  }
  host.appendChild(grid);
  if (!_envs.length) host.appendChild(api.note('No environments yet - the + makes the first one.'));
}

// ── The maker ───────────────────────────────────────────────────────────────
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

export function paintMaker(host, head, api) {
  host.classList.add('is-split');
  _bar(head, api, 'newenv');
  _pickUpRunning(api);

  // LEFT: the shelf a base is drawn from. What is made joins it, so the pile grows while you work.
  const left = el('div', 'mv3-wk-half is-shelf');
  if (_envs === null) {
    left.appendChild(api.note('reading the environments…'));
    _needEnvs(api);
  } else if (!_envs.length) {
    left.appendChild(api.note('No environments yet. The first one is made on the right.'));
  } else {
    const grid = el('div', 'mv3-wk-grid is-env');
    const here = String(api.casting().locationImage || '');
    for (const p of _envs) {
      const path = _pathOf(p);
      if (!path) continue;
      // The one just made is on trial on the stage, and carries the `select` that sets the project
      // in it - the same button the shelf's picked tile has, in the place where the answer landed.
      grid.appendChild(_tile(path, path === _base && !_ref, () => {
        _base = (_base === path ? '' : path);
        if (_base) _ref = null;                    // one base, not two
        _forget();
        api.repaint();
      }, api, (path === _made && path !== here) ? {
        label: 'select', title: 'Set this project in this environment', busy: api.saving(), on: () => api.select(),
      } : null));
    }
    left.appendChild(grid);
  }
  host.appendChild(left);

  // RIGHT: the field. A photo from this computer replaces whatever was chosen on the left.
  const right = el('div', 'mv3-wk-half is-make');
  const { drop, input } = dropField({
    src: _ref ? _ref.dataUrl : (_base ? derived(_base, 'card') : ''),
    empty: 'a photo from this computer, or pick an environment on the left',
    onFile: (file) => {
      readPicture(file)
        .then((p) => { _ref = { ...p, token: '' }; _base = ''; _forget(); api.repaint(); })
        .catch((e) => { _said = e.message; api.repaint(); });
    },
    onClear: () => { _ref = null; _base = ''; _forget(); api.repaint(); },
    onOpen: () => (_ref ? showPicture({ src: _ref.dataUrl, name: _ref.name }) : _open(_base)),
  });
  right.append(drop, input);
  host.appendChild(right);

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
    hint.textContent = _making ? '' : (why || MODE_LABEL[_mode()] || '');
    hint.classList.toggle('is-why', !!why);
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

  // THE STAGE shows the place just made, on trial with `select` under it - unless it is already
  // the project's, in which case it is simply there. The step paints the stage right after this
  // (js/merge-v3/wk-setup.js, _stage), so the trial is only stated here, not painted.
  if (_made && _made !== String(api.casting().locationImage || '') && api.trying() !== _made) api.tryPlace(_made);
}

async function _make(api) {
  const mode = _mode();
  if (!mode || _why() || _making) return;
  _making = true;
  _made = '';
  _said = '';
  api.repaint();
  holdProgress('newenv', { label: LABEL[mode] || 'Making the place', estimateMs: 120000 });

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
      // Nothing was made and nothing spent: the agent is asking which place. Not a duration worth
      // learning either, so the overlay is let go rather than finished.
      endProgress('newenv', '');
      _options = r.options || [];
      _optionsWhy = r.why || '';
      _picked.clear();
      _making = false;
      api.repaint();
      return;
    }
    // From here the server owns it: it waits, files the place on the shelf with its description and
    // the photo it came from, and writes the answer into the journal. This only watches.
    await _followMake(api, r.alertId);
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    endProgress('newenv', msg);
    _making = false;
    // An agent that refused has answered the question, and it reads better as that than as an error.
    _said = e && e.refused ? msg : 'The environment failed: ' + msg;
    api.repaint();
  }
}

// Watching one row of the journal to its end. Started by `create`, and again by the panel itself
// when it finds a row of its own already running - after a reload, or after somebody walked away
// and came back.
async function _followMake(api, id) {
  try {
    const rec = await API.follow(id);
    endProgress('newenv');
    _envs = await API.environments().catch(() => _envs);
    _made = String((rec.result || {}).path || '');
    _base = _made;                                 // the next change builds on it
    _ref = null;
    _note = '';
    _forget();
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    endProgress('newenv', msg);
    _said = 'The environment failed: ' + msg;
  }
  _making = false;
  api.repaint();
}

// Is something of ours already running? Asked once per visit to the maker: the journal knows, and
// the page may have been reloaded since it was started.
function _pickUpRunning(api) {
  if (_lookedForRunning || _making) return;
  _lookedForRunning = true;
  API.alerts().then((d) => {
    const key = api.key();
    const mine = (d.items || []).find(r => r.state === 'running' && r.what === 'environment'
      && r.where && r.where.spot && r.where.spot.key === key && r.where.spot.view === 'newenv');
    if (!mine || _making) return;
    _making = true;
    api.repaint();
    holdProgress('newenv', {
      label: 'Making the place', estimateMs: 120000,
      startedAt: Date.parse(mine.startedAt) || 0,
    });
    _followMake(api, mine.id);
  }).catch(() => { /* the list is not the work: without it the panel simply shows nothing */ });
}
