/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the workshop's one step, SETUP: who says it, where, in what voice, and the
   frame and the clip of every fragment.

   Loaded when the step is opened (js/merge-v3/workshop.js), because this is the
   heaviest part of the page and most visits never come here.

   THE STAGE IS WHERE THE CHOOSING HAPPENS (decided with the owner 2026-09-21,
   docs/local-app/PLAN.md "Сцена, setup и таймлайн-зеркало"). The preview is lent to this
   step while it is open (PV.borrow) and shows two halves: who on top, where below. Each
   half is a door - a press on it opens the shelf it is filled from, in this panel - and
   each is a field: empty, it says what it is waiting for. A tile on a shelf writes
   nothing: it puts a TRIAL on the stage - the character's 4K sheet, a look, a place - and
   `select`, which stands ON the picked tile, is what writes it into the project. Leaving
   the shelf without pressing it puts the stage back to what is written. Each half of the
   stage carries a CROSS while it holds anything: over a trial it takes the trial off the
   stage, over a written choice it takes that choice off the project.

   THE PANEL IS THE SCRIPT (the hub of this step - js/merge-v3/wk-fragments.js, decided
   with the owner 2026-09-21, phase M): the voice it is read in over one list of lines,
   each with its read, its shot, its frame and its clip; on the right the open line, or
   the settings of the whole video. The shelves the halves open onto - the characters
   with their looks, the lookbooks, the environments, the voices - take the panel whole
   while they are open and give it back with their ✕. A shelf you have not opened is not
   on screen: the column is narrow, and a form of everything at once is unreadable in it.

   THE READ BELONGS TO THE CHARACTER (decided with the owner 2026-09-18): a voice is a
   property of the one speaking, not a stage of its own - js/merge-v3/wk-voice.js keeps
   the voices and speaks the lines; this file only decides when its faces are showing.

   WHAT IS SAVED. Only ids, and on the scenario project, where casting has always
   lived: characterId / characterName, then obrazId / obrazImage, then the location
   pair (routes/scen3.js, _normCasting). Nothing here owns a character or a look -
   they belong to the Character tab and to the looks library, and this only points
   at them.

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

   Built in phases C4, C5, V1-V3, F1-F3, S and M (docs/local-app/PLAN.md).
   ════════════════════════════════════════════════════════════════════════════ */

import { loadCharacters, filterByGender, byLooks, derived } from '../chars-store.js';
import * as API from './scen-api.js';
import * as PV from './preview-b.js';
import { askDelete } from './ask.js';
import * as ENV from './wk-env.js';
import * as VOICE from './wk-voice.js';
import * as FRAG from './wk-fragments.js';
import {
  MIN_WORDS_ALONE, nonsense, readPicture, dropField, showPicture, tileMenu,
  holdProgress, endProgress, onlyHere, softScroll,
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
// Where in the step the panel is. The hub is the script (js/merge-v3/wk-fragments.js); the rest
// are the shelves it opens onto:
//
//   hub                                 the voice, the lines, the open line
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
// What is ON TRIAL on the stage - shown there in place of what the project says, until `select`
// writes it or the shelf is left. A look is tried on its character, so trying one sets both; a
// character alone is tried as their 4K sheet and is never written bare (a frame needs a look).
let _try = { char: null, look: null, place: '' };
const _noTry = () => { _try = { char: null, look: null, place: '' }; };

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

  const root = _el('div', 'mv3-wk-setup');
  host.appendChild(root);

  // THE TITLE LINE IS TWO COLUMNS (the owner, 2026-09-22): what this step is on the left, and on
  // the right where the whole script stands - the counters and `generate all`, hung there by the
  // script pane itself (js/merge-v3/wk-fragments.js, _counters). A shelf hangs its own bar in the
  // same place, and only one of them is ever on screen.
  const head = _el('div', 'mv3-ins-head is-wk');
  const txt = _el('div', 'mv3-ins-head-txt');
  txt.appendChild(_el('div', 'mv3-ins-title', 'setup'));
  txt.appendChild(_el('div', 'mv3-ins-sub', _saving ? 'saving…' : 'Who says it, where, in what voice - and the frame and the clip of each fragment'));
  head.appendChild(txt);
  root.appendChild(head);

  if (!ctx.project) { root.appendChild(_note('Reading the project…')); return; }
  if (_chars === null) { _load(ctx.repaint); root.appendChild(_note('reading the characters…')); return; }
  if (_state !== 'idle' && _state !== 'loading') root.appendChild(_note(_state, true));

  const chosen = _castChar();
  // The character a shelf is about: the one on trial, else the one cast.
  const who = _try.char || chosen;
  const scroll = _el('div', 'mv3-wk-scroll');
  softScroll(scroll);                       // a touchpad moves this step too far per flick (V5)
  root.appendChild(scroll);
  // The waiting animation stays with the place that started the generation: painting another one
  // takes it off the stage (js/merge-v3/wk-maker.js). The server keeps working either way. The
  // hub's own overlay - a frame being drawn - is the script pane's to keep or drop.
  if (_view !== 'hub') onlyHere(_view);
  // The sample a voice was being listened to stops when the panel leaves that level: a voice
  // still talking over the environments is a sound with nothing on screen to explain it. The
  // reads playing in the script stop the same way.
  if (_view !== 'voice') VOICE.leave();
  if (_view !== 'hub' && _view !== 'voice') FRAG.leave();
  // Arriving somewhere is when to ask the journal whether something of that place is running;
  // a repaint is not.
  if (_view !== _lastView) { _lastView = _view; _lookedFor = {}; }
  // The stage is painted AFTER the panel, from the same state (this file, _stage): a shelf may
  // put something on trial while it paints, and the stage has to show it.
  if (_view === 'hub') {
    FRAG.paint(scroll, ctx, _fragApi(chosen), head);
    _stage(chosen);
  } else if (_view === 'env') {
    ENV.paintShelf(scroll, head, _envApi());
    _stage(chosen);
  } else if (_view === 'newenv') {
    ENV.paintMaker(scroll, head, _envApi());
    _stage(chosen);
  } else if (_view === 'voice') {
    // The voices are chosen in the right column, beside the script (owner, 2026-09-21) - with
    // nobody cast too: the project then takes a voice of its own (js/merge-v3/wk-voice.js).
    FRAG.paint(scroll, ctx, _fragApi(chosen), head);
    _stage(chosen);
  } else if (_view === 'newlb' && who) {
    _paintNewLookbook(scroll, head, who);
  } else if (_view === 'lookbooks' && who) {
    // No drawer here at all. It is the character's wardrobe, and what is being answered on
    // this face of the panel is which outfit to make the next one from.
    _paintLookbooks(scroll, head, who);
    _showDressing(who);
  } else {
    _view = 'cast';
    _paintCharacters(scroll, head);
    _paintLooks(root, who);
    _stage(chosen);
  }
}

const _castChar = () => (_chars || []).find(c => c.id === String(_casting().characterId || '')) || null;

// Every move inside the step goes through here. Arriving at the hub is leaving a shelf, and a
// trial left on the stage would be a picture the project does not have - so it goes; the maker of
// environments starts clean for the same reason.
function _go(view) {
  if (view === 'hub' || view === 'newenv') _noTry();
  _view = view;
  _ctx.repaint();
}

// ── The hub: the script ─────────────────────────────────────────────────────
// Painted by js/merge-v3/wk-fragments.js. What it may reach in here: the character cast (the
// voice row is theirs), the voice module's api (the row and the reads speak through it), and the
// way to the shelves.
function _fragApi(chosen) {
  return {
    char: () => chosen || null,
    voiceApi: () => _voiceApi(chosen),
    go: _go,
    // 'hub' or 'voice': the right column is the script's, or the voices being chosen.
    view: () => _view,
  };
}

// ── The stage ───────────────────────────────────────────────────────────────
// Two halves, always the same two: who on top, where below. Each shows the trial when there is
// one and what the project says when there is not; each is a door into its shelf; and under a
// trial stands the one button that writes it.
// What the upper half shows and says: the trial first, then what is written.
function _whoHalf(chosen) {
  const cast = _casting();
  const tc = _try.char, tl = _try.look;
  if (tl && tc) return { src: tl.image, caption: tc.name + ' · ' + (tl.name || 'look') };
  if (tc) return { src: tc.sheet || tc.face || '', caption: tc.name + ' · reference' };
  if (cast.obrazImage) return { src: cast.obrazImage, caption: cast.characterName || '' };
  if (chosen) return { src: _faceOf(chosen).src, caption: chosen.name + ' · no look yet' };
  return { src: '', caption: '' };
}
// ...and the lower: the place on trial, else the one written - with no caption either way (phase V24,
// the owner 2026-10-09: the word "environment" under the place said nothing the picture did not).
function _whereHalf() {
  const cast = _casting();
  return { src: _try.place || cast.locationImage || '', caption: '' };
}

function _stage(chosen) {
  // A line open in the script with a clip or a frame shows THAT: it is what is being judged. The
  // doors are back the moment the line is closed (a second press on its row).
  const pic = (_view === 'hub' || _view === 'voice') ? FRAG.openPicture(_ctx.project) : null;
  if (pic) {
    // A clip PLAYS here (X4) - and ONLY here: it is put up stopped, with its triangle, and the
    // press that starts it is a press on the stage (the owner, 2026-09-22). Nothing in the panel
    // asks for it to play any more.
    if (pic.film) PV.showFilm(pic.film, pic.caption, pic.poster);
    else PV.showStill(pic.src, pic.caption);
    // A picture that can be REFRAMED brings a selection with it (V9): the panel says the shape - the
    // project's format - and this puts the frame on the stage and the acts along its foot. The order
    // matters: `showStill` with a new picture drops any selection, so the crop is asked for after it.
    if (pic.crop) PV.cropOn(pic.crop.aspect); else PV.cropOff();
    _stageClears('', '');
    _stageActs(pic.actions);
    return;
  }
  PV.cropOff();
  const who = _whoHalf(chosen), where = _whereHalf();
  PV.showPair(
    { src: who.src ? derived(who.src, 'main') : '', caption: who.caption, empty: 'choose a character' },
    { src: where.src ? derived(where.src, 'main') : '', caption: where.caption, empty: 'choose an environment' },
    _pick,
  );
  // THE STAGE HAS NO BUTTON ANY MORE (the owner, 2026-09-21): `select` stands on the picked look
  // and on the picked environment, the act on the thing it acts on. What the stage carries is a
  // CROSS in the corner of each half that holds something - a trial, which it takes back off the
  // stage, or a written choice, which it takes off the project. In the corner of the half, not of
  // the picture: the picture moves under the zoom, the cross does not.
  const cast = _casting();
  _stageClears(
    _try.char ? 'trial' : (cast.characterId || cast.obrazImage) ? 'cast' : '',
    _try.place ? 'trial' : cast.locationImage ? 'cast' : '',
  );
}

// A half's cross. A TRIAL is only taken off the stage - nothing was written, and the shelf stays
// open for the next try. A WRITTEN choice is taken off the project; the frames and the reads
// already made stay what they are - they are files - and nothing else moves.
function _clearHalf(half, what) {
  if (_saving) return;
  if (what === 'trial') {
    if (half === 'top') _try = { char: null, look: null, place: _try.place };
    else _try = { char: _try.char, look: _try.look, place: '' };
    return _ctx.repaint();
  }
  _noTry();
  if (half === 'top') _patch({ characterId: '', characterName: '', obrazId: '', obrazImage: '' });
  else _patch({ locationId: '', locationImage: '' });
}

// THE BUTTONS THIS STEP LAYS OVER THE STAGE - a half's cross, the acts along a picture's foot, the
// dressing's `apply` - all wear `mv3-stage-ctl`: the stage given back to the timeline drops them
// (js/merge-v3/preview-b.js, borrow), and so does leaving the step or the project (phase V24 - they
// stayed over another project's empty preview).
function _dropStageCtl() {
  const stage = document.getElementById('mv3-stage');
  if (stage) stage.querySelectorAll('.mv3-stage-ctl').forEach(x => x.remove());
}

function _stageClears(top, bottom) {
  const stage = document.getElementById('mv3-stage');
  if (!stage) return;
  // An older paint's buttons, if the stage kept them.
  _dropStageCtl();
  const cast = _casting();
  const mk = (half, what, title) => {
    const b = _el('button', 'mv3-wk-clear mv3-stage-ctl' + (half === 'bottom' ? ' is-bottom' : ''), '✕');
    b.type = 'button';
    b.title = title;
    b.disabled = _saving;
    b.addEventListener('click', (e) => { e.stopPropagation(); _clearHalf(half, what); });
    stage.appendChild(b);
  };
  if (top) {
    mk('top', top, top === 'trial'
      ? 'Take ' + ((_try.char && _try.char.name) || 'them') + ' off the stage - nothing has been written yet'
      : 'Take ' + (cast.characterName || 'the character') + ' off this project');
  }
  if (bottom) {
    mk('bottom', bottom, bottom === 'trial'
      ? 'Take this place off the stage - nothing has been written yet'
      : 'Take the environment off this project');
  }
}

// WHAT CAN BE DONE TO THE PICTURE ON THE STAGE, in a row along its foot (V9). The panel decides
// what those acts are - it knows which picture this is and what state it is in - and each is handed
// the selection as it stands, so `apply` does not have to reach into the preview for it.
function _stageActs(acts) {
  const stage = document.getElementById('mv3-stage');
  if (!stage) return;
  stage.querySelectorAll('.mv3-wk-sacts').forEach(x => x.remove());
  const list = Array.isArray(acts) ? acts.filter(Boolean) : [];
  if (!list.length) return;
  const bar = _el('div', 'mv3-wk-sacts mv3-stage-ctl');
  for (const a of list) {
    const b = _el('button', 'mv3-wk-sact' + (a.go ? ' is-go' : ''), a.label);
    b.type = 'button';
    if (a.title) b.title = a.title;
    b.disabled = !!a.busy;
    b.addEventListener('click', (e) => { e.stopPropagation(); a.on(PV.cropRect()); });
    bar.appendChild(b);
  }
  stage.appendChild(bar);
}

// A half of the stage was pressed. The left button opens its shelf; the right one offers the
// picture itself, full size, the way a tile does.
function _pick(half, ev) {
  if (ev && ev.type === 'contextmenu') {
    const src = half === 'top' ? _whoHalf(_castChar()).src : _whereHalf().src;
    if (!src) return;
    tileMenu(ev, [{ label: 'open', sub: 'look at it, full size', on: () => showPicture({ src, name: src.split('/').pop() }) }],
      half === 'top' ? 'character menu' : 'environment menu');
    return;
  }
  _go(half === 'top' ? 'cast' : 'env');
}

// The one write: the trial becomes the casting. A look is written with its character - it belongs
// to them - and the shelf is left for the hub, where the voice is the next question.
async function _select() {
  const t = _try;
  if (t.look && t.char) {
    _noTry();
    await _patch({ characterId: t.char.id, characterName: t.char.name, obrazId: t.look.id, obrazImage: t.look.image });
  } else if (t.place) {
    _noTry();
    await _patch({ locationId: '', locationImage: t.place });
  } else {
    return;
  }
  _go('hub');
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
    href: '/merge?p=' + encodeURIComponent(key) + '&step=setup&view=' + encodeURIComponent(view),
    label: 'Merge · ' + name + ' · setup' + (WHERE[view] ? ' › ' + WHERE[view] : ''),
    spot: { key, step: 'setup', view },
  };
}

// THE VOICE LEVEL (js/merge-v3/wk-voice.js). All it may reach in here is the character whose
// voice it is and the one door that edits a character - the Character page's own endpoint, so a
// voice taken here is on that page the moment it is taken and the two cannot disagree - and,
// with nobody cast, the project's own voice (`voice.pick`, routes/scen3.js).
function _voiceApi(chosen) {
  const setProject = (p) => { if (_ctx && _ctx.project && p) Object.assign(_ctx.project, p); };
  return {
    char: () => chosen || null,
    project: () => (_ctx && _ctx.project) || null,
    projectId: () => String(((_ctx && _ctx.project) || {}).id || ''),
    // INTO the record, not over it. The workshop hands this panel its own copy of the project on
    // every paint (js/merge-v3/workshop.js), so a replacement here would last exactly until the
    // next repaint and then be the old one again.
    setProject,
    // The mood of the video - the tagger marks the script up by it (lib/motion-presets.js).
    mood: () => String((((_ctx && _ctx.project) || {}).video || {}).mood || ''),
    // The project's own voice, and the way to set one: what the reads use while nobody with a
    // voice of their own is cast.
    pick: () => ((((_ctx && _ctx.project) || {}).voice || {}).pick) || null,
    setPick: async (entry) => {
      const r = await fetch('/api/scen3/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: _ctx.project.id, voice: { pick: entry || null } }),
      }).then(x => x.json());
      if (!r || !r.success) throw new Error((r && r.error) || 'refused');
      setProject(r.project);
    },
    go: _go,
    repaint: () => _ctx.repaint(),
    // The SERVER writes the takes now (phase X2), so the panel has to read the project back to see
    // them arrive rather than trust the answer to its own call.
    reload: () => (_ctx.reloadProject ? _ctx.reloadProject() : Promise.resolve()),
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

function _envApi() {
  return {
    casting: _casting,
    patch: _patch,
    key: () => (_ctx && _ctx.key) || '',
    where: _where,
    go: _go,
    repaint: () => _ctx.repaint(),
    note: _note,
    // The place on trial on the stage: a tile pressed on the shelf, or the one the maker just made;
    // '' takes it off. Stated only - the stage is painted by the step right after the shelf - and
    // written into the project by `select`, which stands ON the picked tile (the owner,
    // 2026-09-21) and is this same one write.
    tryPlace: (path) => { _try.place = String(path || ''); },
    trying: () => _try.place,
    select: _select,
    saving: () => _saving,
  };
}

// ── Where you are inside the step ───────────────────────────────────────────
// The route in the panel header: `setup`, then the places inside it, drawn by the workshop on one
// tint so the two read as one thing at two depths (js/merge-v3/workshop.js, _paintRoute). At the
// hub there is none - the panel's own title says where you are.
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

/** Pressing one of them - or `setup` at the start of the route, which is the hub. */
export function goCrumb(id) {
  const want = id === 'hub' ? 'hub' : id;
  if (want !== 'hub' && !WHERE[want]) return;
  if (want === _view) return;
  _go(want);
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
    _followDress(rec.id);
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
    mk('create lookbook', 'Make one from a photo and a sentence', () => _go('newlb'), false),
  );
  const back = _el('button', 'mv3-iconbtn', '\u2715');
  back.type = 'button';
  back.title = 'Back to the casting';
  back.addEventListener('click', () => _go('cast'));
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
  add.addEventListener('click', () => _go('newlb'));
  grid.appendChild(add);
  for (const p of _lbs) {
    const path = String((p && p.path) || p || '');
    if (!path) continue;
    // The first press picks the outfit; `apply` then stands on the picked tile itself (owner,
    // 2026-09-21) - the act on the thing it acts on, not on the stage across the window.
    grid.appendChild(_lbTile(path, path === _lbPick, () => {
      _lbPick = (_lbPick === path ? '' : path);
      _ctx.repaint();
    }, {
      label: _dressing ? 'dressing…' : 'apply',
      title: 'Dress ' + c.name + ' in this outfit and save it as a look',
      busy: _dressing,
      on: () => _apply(c),
    }));
  }
  host.appendChild(grid);
  if (!_lbs.length) host.appendChild(_note('No lookbooks yet. Make one with "create lookbook".'));
}

// ── What the stage shows while an outfit is being chosen ────────────────────
// The person on top, the outfit below: the dressing IS that sentence, shown before it is paid
// for. The stage has no button here - `apply` is on the picked tile - so the two pictures are
// all that is on it. Nothing is under the shelf either: a row that appears there when an outfit
// is picked pushes the shelf about while it is being read.
function _showDressing(c) {
  PV.showPair(derived(_faceOf(c).src, 'main'), _lbPick ? derived(_lbPick, 'main') : '');
  _stageClears('', '');
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
  back.addEventListener('click', () => _go('lookbooks'));
  const here = _el('button', 'mv3-sc-tab is-on', 'create lookbook');
  here.type = 'button';
  here.disabled = true;
  const x = _el('button', 'mv3-iconbtn', '✕');
  x.type = 'button';
  x.title = 'Back to the casting';
  x.addEventListener('click', () => _go('cast'));
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
  go.addEventListener('click', _make);
  row.append(hint, go);
  foot.append(note, row);
  sync();
  right.appendChild(foot);

  // The stage shows who it is for, and only that: what is being made is already in the field
  // on the right, and a second copy of it on the stage would say nothing new.
  PV.showStill(derived(_faceOf(c).src, 'main'), c.name);
  _stageClears('', '');
}

// ── One tile on a lookbook shelf ────────────────────────────────────────────
// Used by both shelves - the one that picks what to WEAR and the one that picks what a new
// lookbook is BASED on - because a lookbook is the same thing on either, and so is getting
// rid of one. The cross asks first; deleting is the only act here that cannot be undone.
// `act` is the button the PICKED tile carries - the dressing shelf's `apply`; the other shelf
// has none, picking there is the whole act.
function _lbTile(path, on, pick, act) {
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

  if (on && act) {
    const b = _el('button', 'mv3-wk-tileact', act.label);
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

async function _make() {
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
    await _followDress(r.alertId);
  } catch (e) {
    endProgress('lookbooks', (e && e.message) || 'the dressing failed');
    _dressing = false;
    _state = 'The dressing failed: ' + ((e && e.message) || 'unknown');
    _ctx.repaint();
  }
}

async function _followDress(id) {
  try {
    await API.follow(id);
    endProgress('lookbooks');
    // The wardrobe and the project are read again rather than patched by hand: the server filed
    // the look and wrote it into the casting, and what it wrote is what should be on screen.
    _chars = byLooks(await loadCharacters(true));
    await _ctx.reloadProject();
    // The panel comes back to the faces with the drawer open on the character it was made for and
    // the new look lit in it. A look made for this project is chosen by it (decided with the owner
    // 2026-09-21): the server wrote it into the casting, so the trial is over and the stage shows
    // what is written - no `select` to press.
    _view = 'cast';
    _lbPick = '';
    _dressing = false;
    _noTry();
    _ctx.repaint();
  } catch (e) {
    endProgress('lookbooks', (e && e.message) || 'the dressing failed');
    _dressing = false;
    _state = 'The dressing failed: ' + ((e && e.message) || 'unknown');
    _ctx.repaint();
  }
}

function _paintCharacters(host, head) {
  const want = String((_ctx.project && _ctx.project.gender) || '').toLowerCase();
  const castId = String(_casting().characterId || '');
  const tryId = _try.char ? _try.char.id : '';
  let shown = _all ? _chars : filterByGender(_chars, want);
  // WHOEVER IS CAST IS ALWAYS ON SCREEN, filter or no filter. A scenario that says female and
  // a project cast with a man is a deliberate choice somebody made; hiding him leaves the panel
  // claiming nobody is cast while the project says otherwise, and the way back is a chip the
  // person has no reason to press. The one on trial likewise: their looks are in the drawer.
  for (const id of [castId, tryId]) {
    if (!id || shown.some(c => c.id === id)) continue;
    const c = _chars.find(x => x.id === id);
    if (c) shown = [c].concat(shown);
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
      : 'No characters yet - make one with New Character on the Characters shelf of the Library.'));
    return;
  }

  const grid = _el('div', 'mv3-wk-grid');
  // Lit: the one on trial, else the one cast.
  const onId = tryId || castId;
  for (const c of shown) {
    const tile = _el('button', 'mv3-wk-tile' + (c.id === onId ? ' is-on' : ''));
    tile.type = 'button';
    tile.title = c.name + (c.obrazy.length ? ' · ' + c.obrazy.length + ' looks' : ' · no looks yet');
    tile.appendChild(_tileImg(c));
    tile.appendChild(_el('span', 'mv3-wk-name', c.name));
    tile.addEventListener('mouseenter', () => { _peekT = setTimeout(() => _peekShow(tile, c), PEEK_MS); });
    tile.addEventListener('mouseleave', _peekHide);
    tile.addEventListener('click', () => {
      _peekHide();
      // On trial: the 4K sheet on the stage and this character's looks in the drawer. Nothing is
      // written until one of the looks is pressed and selected - a person is cast in a look,
      // never bare, because that look is what every frame is made from.
      _try = { char: c, look: null, place: _try.place };
      _ctx.repaint();
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
    add.addEventListener('click', () => { _lbPick = ''; _go('lookbooks'); });
    row.appendChild(add);

    // Lit: the look on trial, else - for the character who is cast - the look they are cast in.
    const cast = _casting();
    const onTrial = !!(_try.look && _try.char && _try.char.id === c.id);
    const pickedId = _try.look ? _try.look.id
      : (String(cast.characterId || '') === c.id ? String(cast.obrazId || '') : '');
    for (const o of c.obrazy) {
      const on = o.id === pickedId;
      const b = _el('button', 'mv3-wk-look' + (on ? ' is-on' : ''));
      b.type = 'button';
      b.title = o.name || 'look';
      const img = _el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = derived(o.image, 'card');
      b.appendChild(img);
      // `select` STANDS ON THE PICKED LOOK (the owner, 2026-09-21), not on the stage across the
      // window: the act belongs on the thing it acts on. Until it is pressed nothing is written,
      // and leaving the shelf drops the trial.
      if (on && onTrial) {
        const sel = _el('button', 'mv3-wk-tileact is-look', 'select');
        sel.type = 'button';
        sel.title = 'Cast ' + c.name + ' in this look';
        sel.disabled = _saving;
        sel.addEventListener('click', (e) => { e.stopPropagation(); _select(); });
        b.appendChild(sel);
      }
      b.addEventListener('click', () => {
        // On trial, on the stage. `select` on this tile is the write; a second press on the tile
        // it is already on takes the trial off again.
        _try = (on && onTrial) ? { char: c, look: null, place: _try.place } : { char: c, look: o, place: _try.place };
        _ctx.repaint();
      });
      row.appendChild(b);
    }
    drawer.appendChild(row);
  }
  root.appendChild(drawer);
}

function _note(text, bad) {
  return _el('div', 'mv3-ins-note' + (bad ? ' is-err' : ''), text);
}

/** Painted over, or the step is left (js/merge-v3/workshop.js, setStep): drop the enlargement,
 *  stop a voice sample or a read that was playing, and forget what was on trial - it was never
 *  written. */
export function leave() {
  _peekHide();
  VOICE.leave();
  FRAG.leave();
  _noTry();
  // What it laid over the stage goes with it, and so does a countdown of its own (the server keeps
  // making it; coming back puts the countdown back at its real age - wk-maker.js).
  _dropStageCtl();
  onlyHere(null);
}
