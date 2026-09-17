/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the workshop's first step: WHO says it, WHERE, and HOW IT IS READ.

   Loaded when the step is opened (js/merge-v3/workshop.js), because this is the
   heaviest part of the page and most visits never come here.

   The step is a stack that reveals itself as it is answered: pick a character and
   that character's looks appear under it; pick a look and the place is asked for;
   and so on to the voice. A question you have not reached yet is not on screen -
   the column is 280px wide and a form of everything at once is unreadable in it.

   THE READ BELONGS HERE (decided with the owner 2026-09-18, docs/local-app/PLAN.md
   "Setting & voice"): a voice is a property of the character speaking, not a stage
   of its own, and the frames it used to precede are made in `fragments` now, where
   each clip is built from a frame and the read of one line.

   WHAT IS SAVED. Only ids, and on the scenario project, where casting has always
   lived: characterId / characterName, then obrazId / obrazImage, then the location
   pair (routes/scen3.js, _normCasting). Nothing here owns a character or a look -
   they belong to the Character tab and to the looks library, and this only points
   at them.

   THE PREVIEW SHOWS WHO IS PICKED. The stage is lent to this step while it is open
   (PV.borrow), and at this point the timeline is empty anyway, so the frame that
   would otherwise be black shows the choice being made.

   MAKING A LOOK IS THE SAME STEP, not a window over it. "+" in the drawer turns the panel
   into the lookbook shelf; picking one and pressing apply dresses the character in it. The
   waiting happens on the STAGE - the blurred overlay with the countdown that the rest of the
   app uses - because that is where the answer will appear, and because a panel that freezes
   while a minute passes says nothing about what it is doing.

   The look belongs to the CHARACTER when it is done (obraz-save), not to this project. The
   project only points at it, so the next talking head cast with the same person finds the
   wardrobe already there.

   MAKING A LOOKBOOK is the third face of the panel: a reference to take an outfit from, a
   sentence about what is wanted, or both - the server decides what that means (extract the
   outfit, draw one, or read the photo and apply the sentence). Deliberately not the old
   generator: no count, no variants, no gallery of candidates. One picture, made to be worn
   by the character already standing in the panel.

   THE PLACE is its own module (js/merge-v3/wk-env.js): the environments shelf and the maker of
   new ones. It is handed what it needs from here - the casting, the way to save it, the stage -
   and this file only decides when it is showing. What the two makers share (the picture field,
   the twenty-character rule, the tile menu) is js/merge-v3/wk-maker.js.

   PHASE SCOPE (docs/local-app/PLAN.md, phases C4, C5 and V1). The voice is V2-V3; the frames
   are not made here at all any more - they are phase F, in `fragments`.
   ════════════════════════════════════════════════════════════════════════════ */

import { loadCharacters, filterByGender, byLooks, derived } from '../chars-store.js';
import * as API from './scen-api.js';
import * as PV from './preview-b.js';
import { askDelete } from './ask.js';
import * as ENV from './wk-env.js';
import * as VOICE from './wk-voice.js';
import {
  MIN_WORDS_ALONE, nonsense, readPicture, dropField, showPicture, tileMenu,
  holdProgress, endProgress, onlyHere,
} from './wk-maker.js';

const PEEK_MS = 260;                     // hover before the enlargement appears

let _chars = null;
let _state = 'idle';                     // 'idle' | 'loading' | an error to show
let _all = false;                        // the gender filter lifted by hand
let _ctx = null;                         // { project, repaint } from the workshop
let _saving = false;
// The panel has two faces: the casting, and the shelf of outfits to make a look from. Not a
// window over it - a 280px column has no room for a window, and this is the same question
// ("what does this person wear") one level down.
// Where in the step the panel is. The hub is the top of it; the rest are branches under the
// two things the setting is made of:
//
//   hub
//   ├── cast ── lookbooks ── newlb      the character, its looks, making a lookbook
//   ├── env  ── newenv                  the environment, making one
//   └── voice                           the voice this character is read in
//
// ?view= in the address opens one of them directly: that is how the Alerts list takes somebody
// back to the place a generation was started from (js/alerts-bell.js). Read once, when this module
// is first loaded - which is when the step is opened. Checked against this list rather than
// against WHERE below it: that one is declared further down, and reading it here would be reading
// it before it exists.
const VIEWS = ['hub', 'cast', 'lookbooks', 'newlb', 'env', 'newenv', 'voice'];
function _urlView() {
  try {
    const v = new URLSearchParams(location.search).get('view') || '';
    return VIEWS.includes(v) ? v : '';
  } catch (e) { return ''; }
}
let _view = _urlView() || 'hub';
// What the next lookbook is made FROM: either a file the person chose here, or one the
// library already holds. Never both - choosing on one side clears the other, because the
// question "what is this based on" has one answer.
let _ref = null;                          // { name, dataUrl } - a picture from this computer
let _refLb = '';                          // ...or the path of a lookbook already on the shelf
let _lbNote = '';                         // what is wanted, in words
let _making = false;
let _lbs = null;                         // the lookbook shelf, read once
let _lbPick = '';                         // the outfit selected in that shelf
let _dressing = false;                    // one at a time: it is a minute and it is paid for

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const _casting = () => (_ctx && _ctx.project && _ctx.project.casting) || {};

// ── Reading the shelf ───────────────────────────────────────────────────────
async function _load(repaint) {
  if (_state === 'loading') return;
  _state = 'loading';
  repaint();
  try {
    _chars = byLooks(await loadCharacters());
    _state = 'idle';
  } catch (e) {
    _chars = [];
    _state = 'Could not read the characters: ' + e.message;
  }
  repaint();
}

// ── Saving a choice ─────────────────────────────────────────────────────────
// Straight to the project and straight away: a casting choice is one click and the
// next thing the person does is act on it, so a debounce here would only be a window
// in which the two disagree.
// ONLY WHAT CHANGED goes up, and the server merges it into the casting as it stands
// (routes/scen3.js): a finished look is written into the project by the server while this panel is
// open, and sending the whole casting from here would put this panel's older copy back over it.
async function _patch(casting) {
  if (!_ctx || !_ctx.project) return;
  const next = { ..._casting(), ...casting };
  _ctx.project.casting = next;                 // shown now; confirmed below
  _saving = true;
  _ctx.repaint();
  try {
    const r = await fetch('/api/scen3/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: _ctx.project.id, casting }),
    }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || 'refused');
    _ctx.project = r.project;
  } catch (e) {
    _state = 'Could not save the casting: ' + e.message;
  }
  _saving = false;
  _ctx.repaint();
}

// ── The picture of a character ──────────────────────────────────────────────
// The portrait when there is one. When there is not, the 4K reference sheet - three
// full bodies side by side - pushed LEFT, because the head this is being chosen by is
// at that end of it. (Decided with the owner: everyone gets a portrait eventually, so
// this is a fallback and not a second design.)
function _faceOf(c) {
  return { src: c.face || c.sheet || '', left: !c.face && !!c.sheet };
}

function _tileImg(c, variant) {
  const f = _faceOf(c);
  const img = _el('img', 'mv3-wk-face' + (f.left ? ' is-left' : ''));
  img.alt = '';
  img.loading = 'lazy';
  img.src = derived(f.src, variant || 'card');
  return img;
}

// ── The enlargement under the pointer ───────────────────────────────────────
// Not a layer (js/layers.js): it takes no keyboard and answers no question - it is a
// bigger look at what is already on screen. It follows the tile it belongs to, and it
// goes the moment the pointer leaves, on a scroll, or when the panel is rebuilt.
let _peek = null;
let _peekT = 0;

function _peekHide() {
  clearTimeout(_peekT);
  if (!_peek) return;
  _peek.el.remove();
  window.removeEventListener('scroll', _peekHide, true);
  _peek = null;
}

function _peekShow(tile, c) {
  _peekHide();
  const el = _el('div', 'mv3-wk-peek');
  el.appendChild(_tileImg(c, 'main'));
  el.appendChild(_el('span', null, c.name));
  document.body.appendChild(el);
  const r = tile.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  // Beside the tile, on the side with room; clamped so it is never half off screen.
  const left = r.right + 8 + w <= window.innerWidth - 6 ? r.right + 8 : Math.max(6, r.left - w - 8);
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, r.top - 10))) + 'px';
  _peek = { el, tile };
  window.addEventListener('scroll', _peekHide, true);
}

// ── The panel ───────────────────────────────────────────────────────────────
// Two parts, and the lower one is a DRAWER. The faces need the height, the looks need to be
// big enough to tell apart, and a column 280px wide has not got both - so the looks live at
// the foot of the panel and open OVER the faces when there is a character to show them for.
// Shut, they are a strip that still says what it is: an empty band at the bottom of a panel
// explains nothing, and a row of looks that appears from nowhere is worse.
export function paint(host, ctx) {
  _ctx = ctx;
  _peekHide();
  host.classList.add('is-wk');

  const root = _el('div', 'mv3-wk-setting');
  host.appendChild(root);

  // The title line carries the filter: both answer "which faces am I looking at", and a
  // second line of labels would cost the grid a row of them.
  const head = _el('div', 'mv3-ins-head is-wk');
  const txt = _el('div', 'mv3-ins-head-txt');
  txt.appendChild(_el('div', 'mv3-ins-title', 'setting & voice'));
  txt.appendChild(_el('div', 'mv3-ins-sub', _saving ? 'saving…' : 'Who says it, where, and how it is read'));
  head.appendChild(txt);
  root.appendChild(head);

  if (!ctx.project) { root.appendChild(_note('Reading the project…')); return; }
  if (_chars === null) { _load(ctx.repaint); root.appendChild(_note('reading the characters…')); return; }
  if (_state !== 'idle' && _state !== 'loading') root.appendChild(_note(_state, true));

  const chosen = _chars.find(c => c.id === String(_casting().characterId || ''));
  const scroll = _el('div', 'mv3-wk-scroll');
  root.appendChild(scroll);
  // The waiting animation stays with the place that started the generation: painting another one
  // takes it off the stage (js/merge-v3/wk-maker.js). The server keeps working either way.
  onlyHere(_view);
  // The sample a voice was being listened to stops when the panel leaves that level: a voice
  // still talking over the environments is a sound with nothing on screen to explain it.
  if (_view !== 'voice') VOICE.leave();
  // Arriving somewhere is when to ask the journal whether something of that place is running;
  // a repaint is not.
  if (_view !== _lastView) { _lastView = _view; _lookedFor = {}; }
  if (_view === 'hub') {
    _paintHub(scroll, chosen);
  } else if (_view === 'env') {
    ENV.paintShelf(scroll, head, _envApi(chosen));
  } else if (_view === 'newenv') {
    ENV.paintMaker(scroll, head, _envApi(chosen));
  } else if (_view === 'voice' && chosen) {
    _stageButton(null);
    _showChoice(chosen);
    VOICE.paintPicker(scroll, head, _voiceApi(chosen));
  } else if (_view === 'newlb' && chosen) {
    _paintNewLookbook(scroll, head, chosen);
  } else if (_view === 'lookbooks' && chosen) {
    // No drawer here at all. It is the character's wardrobe, and what is being answered on
    // this face of the panel is which outfit to make the next one from.
    _paintLookbooks(scroll, head, chosen);
    _showDressing(chosen);
  } else {
    _view = 'cast';
    _paintCharacters(scroll, head);
    _paintLooks(root, chosen);
    _stageButton(null);
    _showChoice(chosen);
  }
}

// ── The hub ─────────────────────────────────────────────────────────────────
// What a first frame is made of, and what to do about it. On the left the two sources as
// pictures - the character in the look it will wear, the place it will stand in - each one a
// door into its own branch. On the right what happens next: the explanation while either is
// missing, and the read - the voice and the lines - once both are there.
function _paintHub(host, chosen) {
  host.classList.add('is-split');
  const cast = _casting();

  const left = _el('div', 'mv3-wk-half is-sources');
  left.appendChild(_source({
    label: 'character',
    // The 4K reference in the look it will wear, which is the picture every frame is made
    // from. Without a look, the character as they are; without a character, nothing yet.
    src: cast.obrazImage || (chosen ? _faceOf(chosen).src : ''),
    left: !cast.obrazImage && chosen ? _faceOf(chosen).left : false,
    caption: cast.characterName ? cast.characterName + (cast.obrazImage ? '' : ' - no look yet') : '',
    empty: 'Who is speaking?',
    go: () => { _view = 'cast'; _ctx.repaint(); },
  }));
  left.appendChild(_source({
    label: 'environment',
    src: cast.locationImage || '',
    caption: '',
    empty: 'Where are they?',
    go: () => { _view = 'env'; _ctx.repaint(); },
  }));
  host.appendChild(left);

  const right = _el('div', 'mv3-wk-half is-guide');
  const haveWho = !!cast.obrazImage;
  const haveWhere = !!cast.locationImage;
  if (haveWho && haveWhere && chosen) {
    // The read's side of the step: the voice now (V2), the lines under it next (V3).
    VOICE.paintHub(right, _voiceApi(chosen));
    right.appendChild(_el('p', 'mv3-wk-guide-p is-soon', 'Reading the script line by line is the next thing being built.'));
  } else {
    _guide(right, haveWho, haveWhere);
  }
  host.appendChild(right);

  // The stage shows what the hub is made of: the character in the look on top, the place
  // below - the two halves every frame is composed from.
  _stageButton(null);
  _shownFor = '';
  if (cast.obrazImage || cast.locationImage) {
    PV.showPair(cast.obrazImage ? derived(cast.obrazImage, 'main') : '',
      cast.locationImage ? derived(cast.locationImage, 'main') : '');
  } else {
    PV.showStill('', '');
  }
}

function _source(o) {
  const box = _el('button', 'mv3-wk-source' + (o.src ? ' is-full' : ''));
  box.type = 'button';
  box.title = o.src ? 'Change the ' + o.label : 'Choose the ' + o.label;
  box.appendChild(_el('span', 'mv3-wk-lbl', o.label));
  if (o.src) {
    const img = _el('img', o.left ? 'is-left' : '');
    img.alt = '';
    img.src = derived(o.src, 'card');
    box.appendChild(img);
    if (o.caption) box.appendChild(_el('span', 'mv3-wk-source-cap', o.caption));
  } else {
    box.appendChild(_el('span', 'mv3-wk-source-empty', o.empty));
  }
  box.addEventListener('click', o.go);
  return box;
}

// What to do, said in the order it is done, and narrowed as it gets done: a list of five
// things where two are finished is a list you have to read to find the next one.
function _guide(host, haveWho, haveWhere) {
  host.appendChild(_el('div', 'mv3-wk-guide-h', 'Making a talking head'));
  host.appendChild(_el('p', 'mv3-wk-guide-p',
    'Three steps, in this order. SETTING & VOICE: who is speaking, where, and the voice the script is read in. FRAGMENTS: the picture each fragment opens on, and the clip animated to its read. TIMELINE: the finished cut, to edit and render.'));
  host.appendChild(_el('div', 'mv3-wk-guide-h', 'Now'));
  const ol = _el('ol', 'mv3-wk-guide-list');
  const li = (text, done) => { const e = _el('li', done ? 'is-done' : '', text); ol.appendChild(e); };
  li('Choose who is speaking: click the character field. Pick a look for them, or dress them in a lookbook - or make a new lookbook first.', haveWho);
  li('Choose where: click the environment field and pick a place - or create one.', haveWhere);
  li('With both set, give the character a voice and read the script.', false);
  host.appendChild(ol);
}

// ── The environment branch ──────────────────────────────────────────────────
// Its own module (js/merge-v3/wk-env.js). This is everything it may reach in here: the casting
// and the way to save it, where to go next, the stage's button, and who the place is for.
// Where a generation was started, as the Alerts list needs it: the address that opens this very
// place again, a line a person can read, and the place itself - so the panel can ask the journal
// "is one of these running rows mine?" (lib/alerts.js).
function _where(view) {
  const key = (_ctx && _ctx.key) || '';
  const p = (_ctx && _ctx.project) || {};
  const name = String(p.title || p.name || 'talking head');
  return {
    page: 'merge',
    href: '/merge?p=' + encodeURIComponent(key) + '&step=setting&view=' + encodeURIComponent(view),
    label: 'Merge · ' + name + ' · setting & voice' + (WHERE[view] ? ' › ' + WHERE[view] : ''),
    spot: { key, step: 'setting', view },
  };
}

// THE VOICE LEVEL (js/merge-v3/wk-voice.js). All it may reach in here is the character whose
// voice it is and the one door that edits a character - the Character page's own endpoint, so a
// voice taken here is on that page the moment it is taken and the two cannot disagree.
function _voiceApi(chosen) {
  return {
    char: () => chosen || null,
    go: (view) => { _view = view; _ctx.repaint(); },
    repaint: () => _ctx.repaint(),
    note: _note,
    patchChar: async (fields) => {
      const d = await fetch('/api/char-store/' + encodeURIComponent(chosen.id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
      }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'the character could not be updated');
      // The record this panel holds is the one js/chars-store.js cached for every page that casts
      // somebody, so it is updated in place rather than re-read: a second read of forty-odd
      // characters to learn one field that just came back in the answer.
      const rec = d.char || {};
      chosen.voice = rec.voice || '';
      chosen.voices = Array.isArray(rec.voices) ? rec.voices : [];
      return rec;
    },
  };
}

function _envApi(chosen) {
  return {
    casting: _casting,
    patch: _patch,
    key: () => (_ctx && _ctx.key) || '',
    where: _where,
    go: (view) => { _view = view; _ctx.repaint(); },
    repaint: () => _ctx.repaint(),
    stageButton: _stageButton,
    note: _note,
    // The character in the look they will wear there; without a look, the character as they are.
    who: () => {
      const cast = _casting();
      if (cast.obrazImage) return { src: cast.obrazImage, caption: cast.characterName || '' };
      return chosen ? { src: _faceOf(chosen).src, caption: chosen.name } : { src: '', caption: '' };
    },
  };
}

// ── Where you are inside the step ───────────────────────────────────────────
// The step chip in the panel header says WHICH step is open; these say where inside it. They
// are drawn by the workshop, under that chip and bracketed to it, so the two read as one thing
// at two depths (js/merge-v3/workshop.js, _paintChips).
const WHERE = {
  cast: 'character',
  voice: 'voice',
  lookbooks: 'looks',
  newlb: 'create lookbook',
  env: 'environment',
  newenv: 'create environment',
};
// Each place, and the places above it. The header draws this as a route with arrows, so what
// led to what is read left to right.
const PATH = {
  hub: [],
  cast: ['cast'],
  lookbooks: ['cast', 'lookbooks'],
  newlb: ['cast', 'lookbooks', 'newlb'],
  env: ['env'],
  newenv: ['env', 'newenv'],
  voice: ['voice'],
};

/** The route from the top of the step to where you are - the workshop paints it. */
export function crumbs() {
  return (PATH[_view] || []).map((id, i, all) => ({ id, label: WHERE[id], here: i === all.length - 1 }));
}

/** Pressing one of them - or the step's own chip, which is the hub. */
export function goCrumb(id) {
  const want = id === 'hub' ? 'hub' : id;
  if (want !== 'hub' && !WHERE[want]) return;
  if (want === _view) return;
  _view = want;
  _ctx.repaint();
}

// ── The shelf of outfits ────────────────────────────────────────────────────
// Two buttons at the top, as agreed: this one, and the generator that makes a lookbook out of
// a reference and a sentence (C4). The first tile leads to that generator too, because an
// empty shelf has to offer the way to fill it.
function _paintLookbooks(host, head, c) {
  _pickUpRunning('look', 'lookbooks', (rec) => {
    if (_dressing) return;
    _dressing = true;
    _ctx.repaint();
    holdProgress('lookbooks', { label: 'Dressing ' + c.name, estimateMs: 90000, startedAt: Date.parse(rec.startedAt) || 0 });
    _followDress(rec.id, c.id);
  });
  const acts = _el('div', 'mv3-wk-bar');
  const mk = (label, title, on, primary) => {
    const b = _el('button', 'mv3-sc-tab' + (primary ? ' is-on' : ''), label);
    b.type = 'button';
    b.title = title;
    if (on) b.addEventListener('click', on); else b.disabled = true;
    return b;
  };
  acts.append(
    mk('create look', 'Dress ' + c.name + ' in one of these', null, true),
    mk('create lookbook', 'Make one from a photo and a sentence',
      () => { _view = 'newlb'; _ctx.repaint(); }, false),
  );
  const back = _el('button', 'mv3-iconbtn', '\u2715');
  back.type = 'button';
  back.title = 'Back to the casting';
  back.addEventListener('click', () => { _view = 'cast'; _ctx.repaint(); });
  acts.appendChild(back);
  head.appendChild(acts);

  if (_lbs === null) {
    host.appendChild(_note('reading the lookbooks…'));
    _needLbMeta();
    API.lookbooks().then((files) => { _lbs = files; _ctx.repaint(); })
      .catch((e) => { _lbs = []; _state = 'Could not read the lookbooks: ' + e.message; _ctx.repaint(); });
    return;
  }

  const grid = _el('div', 'mv3-wk-grid is-lb');
  const add = _el('button', 'mv3-wk-tile is-add', '+');
  add.type = 'button';
  add.title = 'Make a lookbook from a photo and a sentence';
  add.addEventListener('click', () => { _view = 'newlb'; _ctx.repaint(); });
  grid.appendChild(add);
  for (const p of _lbs) {
    const path = String((p && p.path) || p || '');
    if (!path) continue;
    grid.appendChild(_lbTile(path, path === _lbPick, () => {
      _lbPick = (_lbPick === path ? '' : path);
      _ctx.repaint();
    }));
  }
  host.appendChild(grid);
  if (!_lbs.length) host.appendChild(_note('No lookbooks yet. Make one with "create lookbook".'));
}

// ── What the stage shows while an outfit is being chosen ────────────────────
// The person on top, the outfit below, and the button that joins them between the two: the
// dressing IS that sentence, and a button in the panel would be a long way from the thing it
// acts on. Nothing is under the shelf for the same reason - a row that appears there when an
// outfit is picked pushes the shelf about while it is being read.
function _showDressing(c) {
  _shownFor = '';                              // the casting view will paint its own again
  PV.showPair(derived(_faceOf(c).src, 'main'), _lbPick ? derived(_lbPick, 'main') : '');
  _stageButton(_lbPick ? {
    label: _dressing ? 'dressing…' : 'apply',
    title: 'Dress ' + c.name + ' in this outfit and save it as a look',
    busy: _dressing,
    on: () => _apply(c),
  } : null);
}

// The button lives in the stage, between the halves. Rebuilt rather than kept: the stage is
// cleared whenever the preview remounts, and a button that survives its own container is a
// button that outlives the question it asked.
function _stageButton(spec) {
  const stage = document.getElementById('mv3-stage');
  if (!stage) return;
  const old = stage.querySelector('.mv3-wk-apply');
  if (old) old.remove();
  if (!spec) return;
  const b = _el('button', 'mv3-wk-apply' + (spec.cls ? ' ' + spec.cls : ''), spec.label);
  b.type = 'button';
  b.title = spec.title || '';
  b.disabled = !!spec.busy;
  b.addEventListener('click', spec.on);
  stage.appendChild(b);
}

// ── Making a lookbook ───────────────────────────────────────────────────────
// Two fields and one button. What they mean together is the server's rule, and it is worth
// stating where it is read: a photo alone takes the outfit OUT of it, a sentence alone draws
// one, and both together read the photo and apply the sentence to it. So the button says
// which of the three is about to happen instead of a flat "generate".
function _mode() {
  const base = !!(_ref || _refLb);
  if (base && _lbNote.trim()) return 'edit';
  if (base) return 'extract';
  if (_lbNote.trim()) return 'draw';
  return '';
}

// What stops the button, in words. Empty means nothing does. The twenty characters and the
// keyboard-mess test are the rule both makers share (js/merge-v3/wk-maker.js).
function _why() {
  const base = !!(_ref || _refLb);
  const note = _lbNote.trim();
  if (!base && !note) return 'a photo or a sentence';
  if (!base) {
    if (note.length < MIN_WORDS_ALONE) return (MIN_WORDS_ALONE - note.length) + ' more characters';
    if (nonsense(note)) return 'that is not a description';
  } else if (note && nonsense(note)) {
    return 'that is not a description';
  }
  return '';
}
const _MODE_LABEL = {
  edit: 'read the photo and apply the words',
  extract: 'take the outfit out of the photo',
  draw: 'draw it from the words',
};

// The agent's refusal or what failed, said above the sentence it is about - not at the top of the
// panel, where it stayed after the person had long moved on.
let _lbSaid = '';

function _paintNewLookbook(host, head, c) {
  host.classList.add('is-split');
  _pickUpRunning('lookbook', 'newlb', (rec) => {
    if (_making) return;
    _making = true;
    _ctx.repaint();
    holdProgress('newlb', { label: 'Making the lookbook', estimateMs: 45000, startedAt: Date.parse(rec.startedAt) || 0 });
    _followLb(rec.id);
  });
  const acts = _el('div', 'mv3-wk-bar');
  const back = _el('button', 'mv3-sc-tab', 'create look');
  back.type = 'button';
  back.title = 'Back to the shelf of outfits';
  back.addEventListener('click', () => { _view = 'lookbooks'; _ctx.repaint(); });
  const here = _el('button', 'mv3-sc-tab is-on', 'create lookbook');
  here.type = 'button';
  here.disabled = true;
  const x = _el('button', 'mv3-iconbtn', '✕');
  x.type = 'button';
  x.title = 'Back to the casting';
  x.addEventListener('click', () => { _view = 'cast'; _ctx.repaint(); });
  acts.append(back, here, x);
  head.appendChild(acts);

  // LEFT: the shelf this one is drawn from. Picking a lookbook here puts it in the field on
  // the right as the base - which is what "make another one like that, but ..." means - and
  // the new lookbook joins this same shelf when it is done, so the pile grows while you work.
  const left = _el('div', 'mv3-wk-half is-shelf');
  if (_lbs === null) {
    left.appendChild(_note('reading the lookbooks…'));
    _needLbMeta();
    API.lookbooks().then((files) => { _lbs = files; _ctx.repaint(); })
      .catch((e) => { _lbs = []; _state = 'Could not read the lookbooks: ' + e.message; _ctx.repaint(); });
  } else if (!_lbs.length) {
    left.appendChild(_note('No lookbooks yet. The first one is made on the right.'));
  } else {
    const grid = _el('div', 'mv3-wk-grid is-lb');
    for (const p of _lbs) {
      const path = String((p && p.path) || p || '');
      if (path) grid.appendChild(_lbTile(path, path === _refLb, () => {
        _refLb = (_refLb === path ? '' : path);
        if (_refLb) _ref = null;                 // one base, not two
        _lbSaid = '';
        _ctx.repaint();
      }));
    }
    left.appendChild(grid);
  }
  host.appendChild(left);

  // RIGHT: what is being made. The field takes a picture from this computer, which drops whatever
  // was chosen on the left - and, holding a picture, it opens that picture large when clicked.
  const right = _el('div', 'mv3-wk-half is-make');
  const { drop, input } = dropField({
    src: _ref ? _ref.dataUrl : (_refLb ? derived(_refLb, 'card') : ''),
    empty: 'a photo from this computer, or pick a lookbook on the left',
    onFile: (file) => {
      readPicture(file)
        .then((p) => { _ref = p; _refLb = ''; _lbSaid = ''; _ctx.repaint(); })
        .catch((e) => { _lbSaid = e.message; _ctx.repaint(); });
    },
    onClear: () => { _ref = null; _refLb = ''; _lbSaid = ''; _ctx.repaint(); },
    onOpen: () => (_ref ? showPicture({ src: _ref.dataUrl, name: _ref.name }) : _openLb(_refLb)),
  });
  right.append(drop, input);
  host.appendChild(right);

  // The sentence and its button at the foot of the RIGHT half - under the field they are about.
  // The left half is the shelf being drawn from, and a sentence stretched under it would look
  // like it applied to the shelf.
  const foot = _el('div', 'mv3-wk-foot');
  const said = _lbSaid ? _el('div', 'mv3-wk-said', _lbSaid) : null;
  if (said) foot.appendChild(said);
  const note = _el('textarea', 'mv3-sc-lines is-short');
  note.placeholder = 'What should it be? With a photo, say what to change - "shoes to white Nike trainers".';
  note.value = _lbNote;
  const row = _el('div', 'mv3-wk-footrow');
  const hint = _el('span', 'mv3-wk-mode mv3-sc-meta');
  const go = _el('button', 'mv3-wk-create', 'create');
  go.type = 'button';
  const sync = () => {
    const why = _why();
    go.disabled = !!why || _making;
    go.textContent = _making ? 'making…' : 'create';
    go.title = why ? why : 'Make it - this spends credits';
    hint.textContent = _making ? '' : (why || (_mode() ? _MODE_LABEL[_mode()] : ''));
    hint.classList.toggle('is-why', !!why);
  };
  note.addEventListener('input', () => {
    _lbNote = note.value;
    // Typing answers whatever was said, and it goes without a repaint that would lose the cursor.
    if (said && said.isConnected) { said.remove(); _lbSaid = ''; }
    sync();
  });
  go.addEventListener('click', () => _make(c));
  row.append(hint, go);
  foot.append(note, row);
  sync();
  right.appendChild(foot);

  // The stage shows who it is for, and only that: what is being made is already in the field
  // on the right, and a second copy of it on the stage would say nothing new.
  _shownFor = '';
  PV.showStill(derived(_faceOf(c).src, 'main'), c.name);
  _stageButton(null);
}

// ── One tile on a lookbook shelf ────────────────────────────────────────────
// Used by both shelves - the one that picks what to WEAR and the one that picks what a new
// lookbook is BASED on - because a lookbook is the same thing on either, and so is getting
// rid of one. The cross asks first; deleting is the only act here that cannot be undone.
function _lbTile(path, on, pick) {
  const tile = _el('button', 'mv3-wk-tile is-lb' + (on ? ' is-on' : ''));
  tile.type = 'button';
  tile.title = path.split('/').pop();
  const img = _el('img', 'mv3-wk-face');
  img.alt = '';
  img.loading = 'lazy';
  img.src = derived(path, 'card');
  tile.appendChild(img);

  const x = _el('button', 'mv3-wk-tilex', '✕');
  x.type = 'button';
  x.title = 'Delete this lookbook';
  x.addEventListener('click', (e) => { e.stopPropagation(); _askDeleteLb(tile, path); });
  tile.appendChild(x);

  tile.addEventListener('click', pick);
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tileMenu(e, [
      { label: 'open', sub: 'look at it, full size', on: () => _openLb(path) },
      { label: 'delete', sub: 'for good', on: () => _askDeleteLb(tile, path), danger: true },
    ], 'lookbook menu');
  });
  return tile;
}

// The viewer the Library uses, so a lookbook is looked at the same way wherever it is met -
// with, in the column beside it, what the agent wrote about it when it was made and the photo it
// was made from. One made before that existed has nothing to say, and says nothing rather than
// saying "unknown".
//
// READ AGAIN AT EVERY OPEN. The shelf's copy is taken the first time the shelf is read, and the
// lookbook most likely to be opened is the one just made - after that copy, so it opened with
// an empty column. One small local request per open is the price of never being stale.
async function _openLb(path) {
  try { _lbMetaMap = (await API.lookbookMeta()) || {}; } catch (e) { /* what was known before */ }
  const meta = (_lbMetaMap && _lbMetaMap[path]) || {};
  showPicture({
    src: path, name: path.split('/').pop(),
    rows: [['description', meta.description], ['suits', meta.gender]],
    from: meta.from,
  });
}

// Read once beside the shelf itself: both answer "what is on this shelf", and a second
// request per tile would be a request per tile.
let _lbMetaMap = null;
function _needLbMeta() {
  if (_lbMetaMap) return;
  _lbMetaMap = {};
  API.lookbookMeta().then((m) => { _lbMetaMap = m || {}; }).catch(() => { /* nothing known */ });
}

function _askDeleteLb(anchor, path) {
  const name = path.split('/').pop();
  askDelete(anchor, 'Delete "' + name + '"?',
    'The picture goes from the shelf for good. Looks already made from it keep what they are.',
    async () => {
      try {
        const r = await fetch('/api/library/item/lookbooks/' + encodeURIComponent(name), { method: 'DELETE' })
          .then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || 'refused');
      } catch (e) {
        _state = 'Could not delete it: ' + e.message;
      }
      _lbs = await API.lookbooks().catch(() => _lbs);
      if (_lbPick === path) _lbPick = '';
      if (_refLb === path) _refLb = '';
      _ctx.repaint();
    });
}

const LB_LABEL = {
  extract: 'Taking the outfit out of the photo',
  edit: 'Reading the photo and your words',
  draw: 'Drawing the outfit',
};

async function _make(c) {
  const mode = _mode();
  if (!mode || _making || _why()) return;
  _making = true;
  _lbSaid = '';
  _ctx.repaint();
  holdProgress('newlb', { label: LB_LABEL[mode] || 'Making the lookbook', estimateMs: 45000 });
  try {
    const r = await API.makeLookbook({
      prompt: _lbNote.trim(),
      imageBase64: _ref ? _ref.dataUrl : '',
      imagePath: _ref ? '' : _refLb,
      refName: _ref ? _ref.name : '',
      title: 'Lookbook', where: _where('newlb'),
    });
    // The server files it - onto the shelf, with its description and the photo it was made from
    // (Images / uploads_lookbooks) - and this follows the journal row it wrote.
    await _followLb(r.alertId);
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    endProgress('newlb', msg);
    _making = false;
    // A refusal from the agent is not a failure of the machinery - it is an answer about what
    // was asked for, and it reads better as that than as an error.
    _lbSaid = e && e.refused ? msg : 'The lookbook failed: ' + msg;
    _ctx.repaint();
  }
}

async function _followLb(id) {
  try {
    const rec = await API.follow(id);
    endProgress('newlb');
    // The shelf on the left gains a tile and the maker stays where it is: one lookbook is
    // rarely the end of it, and being thrown back to the casting after each would make a
    // second one a journey.
    _lbs = await API.lookbooks().catch(() => _lbs);
    _refLb = String((rec.result || {}).path || '');
    _ref = null;
    _lbNote = '';
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    endProgress('newlb', msg);
    _lbSaid = 'The lookbook failed: ' + msg;
  }
  _making = false;
  _ctx.repaint();
}

// Something of this panel's own may be running already - started before a reload, or before
// somebody walked off and came back. The journal knows; asked once per visit to each maker.
let _lookedFor = {};
let _lastView = '';
function _pickUpRunning(what, view, follow) {
  if (_lookedFor[view]) return;
  _lookedFor[view] = true;
  API.alerts().then((d) => {
    const key = (_ctx && _ctx.key) || '';
    const mine = (d.items || []).find(r => r.state === 'running' && r.what === what
      && r.where && r.where.spot && r.where.spot.key === key && r.where.spot.view === view);
    if (mine) follow(mine);
  }).catch(() => { /* without the list the panel simply shows nothing running */ });
}

// ── The dressing itself ─────────────────────────────────────────────────────
// On the stage, because that is where the answer lands. The overlay carries the countdown
// that learns from the last run of the same job (js/progress.js), so the second dressing
// already says roughly how long it will take.
async function _apply(c) {
  if (_dressing) return;
  const base = c.sheet || c.face || '';
  if (!base) { _state = c.name + ' has no reference sheet to dress.'; return _ctx.repaint(); }
  const lb = _lbPick;
  _dressing = true;
  _ctx.repaint();

  holdProgress('lookbooks', { label: 'Dressing ' + c.name, estimateMs: 90000 });
  try {
    // The server dresses, files the look under the character and - because this one was asked for
    // by a project - puts it on that project, whether or not anybody is still looking.
    const r = await API.dress({
      basePath: base, lookbookPath: lb, note: '',
      charId: c.id, charName: c.name, gender: c.gender || '',
      projectId: String((_ctx.project || {}).id || ''),
      title: 'Look · ' + c.name, where: _where('lookbooks'),
    });
    await _followDress(r.alertId, c.id);
  } catch (e) {
    endProgress('lookbooks', (e && e.message) || 'the dressing failed');
    _dressing = false;
    _state = 'The dressing failed: ' + ((e && e.message) || 'unknown');
    _ctx.repaint();
  }
}

async function _followDress(id, charId) {
  try {
    await API.follow(id);
    endProgress('lookbooks');
    // The wardrobe and the project are read again rather than patched by hand: the server filed
    // the look and wrote it into the casting, and what it wrote is what should be on screen.
    _chars = byLooks(await loadCharacters(true));
    await _ctx.reloadProject();
    // The panel comes back to the faces with the drawer open on the character it was made for,
    // the new look selected in it, and that look on the stage.
    _view = 'cast';
    _lbPick = '';
    _dressing = false;
    _stageButton(null);
    _shownFor = '';
    _showChoice(_chars.find(x => x.id === charId));
    _ctx.repaint();
  } catch (e) {
    endProgress('lookbooks', (e && e.message) || 'the dressing failed');
    _dressing = false;
    _state = 'The dressing failed: ' + ((e && e.message) || 'unknown');
    _ctx.repaint();
  }
}

// Coming back to a project should look like coming back to it: the stage shows what is cast
// without anything being clicked. Tracked by what it is showing, so a repaint - and there is
// one after every save - does not re-load the same picture.
let _shownFor = '';
function _showChoice(chosen) {
  const cast = _casting();
  const id = String(cast.obrazId || cast.characterId || '');
  if (id === _shownFor) return;
  _shownFor = id;
  if (!id) return _showInPreview('', '');
  if (cast.obrazImage) {
    return _showInPreview(cast.obrazImage, (cast.characterName || '') + (chosen ? '' : ' · look'));
  }
  _showInPreview(chosen ? _faceOf(chosen).src : '', cast.characterName || '');
}

function _paintCharacters(host, head) {
  const want = String((_ctx.project && _ctx.project.gender) || '').toLowerCase();
  const castId = String(_casting().characterId || '');
  let shown = _all ? _chars : filterByGender(_chars, want);
  // WHOEVER IS CAST IS ALWAYS ON SCREEN, filter or no filter. A scenario that says female and
  // a project cast with a man is a deliberate choice somebody made; hiding him leaves the panel
  // claiming nobody is cast while the project says otherwise, and the way back is a chip the
  // person has no reason to press.
  if (castId && !shown.some(c => c.id === castId)) {
    const cast = _chars.find(c => c.id === castId);
    if (cast) shown = [cast].concat(shown);
  }

  const bar = _el('div', 'mv3-wk-bar');
  bar.appendChild(_el('span', 'mv3-wk-lbl', 'character'));
  // The filter says what it is hiding. A column that silently shows twelve of
  // twenty-seven reads as a bug the first time somebody looks for a missing face.
  if (want) {
    const t = _el('button', 'mv3-sc-tab' + (_all ? '' : ' is-on'), want + ' · ' + filterByGender(_chars, want).length);
    t.type = 'button';
    t.title = 'Only the gender the scenario states';
    t.addEventListener('click', () => { _all = false; _ctx.repaint(); });
    const a = _el('button', 'mv3-sc-tab' + (_all ? ' is-on' : ''), 'all · ' + _chars.length);
    a.type = 'button';
    a.title = 'Every character on the shelf';
    a.addEventListener('click', () => { _all = true; _ctx.repaint(); });
    bar.append(t, a);
  } else {
    bar.appendChild(_el('span', 'mv3-sc-meta', _chars.length + ' on the shelf'));
  }
  head.appendChild(bar);

  if (!shown.length) {
    host.appendChild(_note(_chars.length
      ? 'Nobody of that gender on the shelf. Show all to cast anyway.'
      : 'No characters yet - make one on the Character tab.'));
    return;
  }

  const grid = _el('div', 'mv3-wk-grid');
  const pickedId = castId;
  for (const c of shown) {
    const tile = _el('button', 'mv3-wk-tile' + (c.id === pickedId ? ' is-on' : ''));
    tile.type = 'button';
    tile.title = c.name + (c.obrazy.length ? ' · ' + c.obrazy.length + ' looks' : ' · no looks yet');
    tile.appendChild(_tileImg(c));
    tile.appendChild(_el('span', 'mv3-wk-name', c.name));
    tile.addEventListener('mouseenter', () => { _peekT = setTimeout(() => _peekShow(tile, c), PEEK_MS); });
    tile.addEventListener('mouseleave', _peekHide);
    tile.addEventListener('click', () => {
      _peekHide();
      // A second press on the face already cast is how you take it back: the drawer shuts
      // with it, which is the whole step saying "nobody yet" again.
      if (c.id === String(_casting().characterId || '')) {
        _patch({ characterId: '', characterName: '', obrazId: '', obrazImage: '' });
        _showInPreview('', '');
        return;
      }
      // A look belongs to one character, so changing who is cast drops it rather than
      // pointing the project at somebody else's wardrobe.
      _patch({ characterId: c.id, characterName: c.name, obrazId: '', obrazImage: '' });
      _showInPreview(_faceOf(c).src, c.name);
    });
    grid.appendChild(tile);
  }
  host.appendChild(grid);
}

// ── The drawer of looks ─────────────────────────────────────────────────────
// Shut when nobody is cast, open over the faces when somebody is. Its height is the height
// of what is in it - one row of 16:9 thumbnails, which is the shape that shows an outfit
// rather than a slice of one.
function _paintLooks(root, c) {
  // Shut while the look is being MADE: the shelf of outfits is the question then, and the
  // wardrobe underneath it is what the answer will join. It opens again on the way back,
  // for the same character - that is where the new look will be.
  const open = !!c && _view !== 'lookbooks';
  const drawer = _el('div', 'mv3-wk-drawer' + (open ? ' is-open' : ''));

  const strip = _el('div', 'mv3-wk-strip');
  strip.appendChild(_el('span', 'mv3-wk-lbl', 'looks'));
  strip.appendChild(_el('span', 'mv3-sc-meta', c
    ? (c.obrazy.length ? c.obrazy.length + ' for ' + c.name : 'none for ' + c.name + ' yet')
    : 'pick a character to see theirs'));
  drawer.appendChild(strip);

  if (open) {
    // One row that scrolls sideways: a wardrobe is a shelf, and a grid of it would need the
    // height the faces above are using.
    const row = _el('div', 'mv3-wk-row');
    // With no looks yet the "+" is the whole shelf rather than a sliver beside nothing:
    // an empty drawer with a thin dash in it reads as something broken.
    const add = _el('button', 'mv3-wk-look is-add' + (c.obrazy.length ? '' : ' is-only'), '+');
    add.type = 'button';
    add.title = 'Dress ' + c.name + ' in a lookbook';
    add.addEventListener('click', () => { _view = 'lookbooks'; _lbPick = ''; _ctx.repaint(); });
    row.appendChild(add);

    const pickedId = String(_casting().obrazId || '');
    for (const o of c.obrazy) {
      const b = _el('button', 'mv3-wk-look' + (o.id === pickedId ? ' is-on' : ''));
      b.type = 'button';
      b.title = o.name || 'look';
      const img = _el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = derived(o.image, 'card');
      b.appendChild(img);
      b.addEventListener('click', async () => {
        await _patch({ obrazId: o.id, obrazImage: o.image });
        // The look is the end of this branch: the character field in the hub now holds the
        // person in what they will wear, and the next question is where.
        _view = 'hub';
        _ctx.repaint();
      });
      row.appendChild(b);
    }
    drawer.appendChild(row);
  }
  root.appendChild(drawer);
}

// ── The stage ───────────────────────────────────────────────────────────────
// What the preview shows while this step is open. The timeline is empty at this point
// in a project's life, so the stage is free for the thing being decided.
function _showInPreview(src, caption) {
  PV.showStill(derived(src, 'main'), caption || '');
}

function _note(text, bad) {
  return _el('div', 'mv3-ins-note' + (bad ? ' is-err' : ''), text);
}

/** Painted over? Drop the enlargement with it. */
export function leave() { _peekHide(); }
