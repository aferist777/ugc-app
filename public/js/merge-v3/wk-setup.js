/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the workshop's one step, SETUP: who says it, where, in what voice, and the
   frame and the clip of every fragment.

   Loaded when the step is opened (js/merge-v3/workshop.js), because this is the
   heaviest part of the page and most visits never come here.

   THE STAGE IS WHERE THE CASTING IS SEEN (decided with the owner 2026-09-21,
   docs/local-app/PLAN.md "Сцена, setup и таймлайн-зеркало"). The preview is lent to this
   step while it is open (PV.borrow) and shows two halves: who on top, where below. Each
   half is a door and a field: empty, it says what it is waiting for. Each half carries a
   CROSS while it holds a choice, which takes that choice off the project.

   THE DOORS ARE WINDOWS (phase V57, the owner 2026-10-29: "весь setup замызавыется плиткой
   персонажей и много пустых пространств из-за этого. давай сделаем попап, как в чате генерации
   изображений"). "Who" opens the attachment window's frame (js/merge-v3/chat-pick.js openChoose):
   the characters on the left - the ones with the most looks first, the first shown at once, the
   scenario's gender with "all" beside it -, the one the pointer rests on shows its 4K sheet and
   its looks on the right, and A PRESS ON A LOOK CASTS IT AT ONCE and closes the window (the owner's
   (ок5)). "Where" is the made environments' window (js/merge-v3/wk-env.js). There is no trial on
   the stage any more and no `select`: the stage shows what is written.

   MAKING A LOOK IS A WINDOW OVER IT (the owner's (ок7): "окно закрывается а сверху открывается new
   look / new environment"). "+ new look" at the foot of "who" closes it and opens the maker's
   window (wk-maker.js openWindow) for the character shown: "create look" - the lookbooks to dress
   them in, the one picked and `apply` - and "create lookbook" - a reference to take an outfit from,
   a sentence about what is wanted, or both (the server decides what that means: extract the outfit,
   draw one, or read the photo and apply the sentence). The waiting happens on the STAGE - the
   blurred overlay with the countdown the rest of the app uses - because that is where the answer
   will appear: `apply` closes the window as soon as the server took it; a lookbook being made keeps
   its window (the next one is usually made from it), and the countdown is on the stage behind it.

   The look belongs to the CHARACTER when it is done (obraz-save), not to this project. The
   server puts one made for this project on it (routes/scen3.js), so the next talking head cast
   with the same person finds the wardrobe already there.

   THE PANEL IS THE SCRIPT (the hub of this step - js/merge-v3/wk-fragments.js, decided
   with the owner 2026-09-21, phase M): the voice it is read in over one list of lines,
   each with its read, its shot, its frame and its clip; on the right the open line, or
   the settings of the whole video, the voices (wk-voice.js) or the frames chat (fchat.js).

   THE READ BELONGS TO THE CHARACTER (decided with the owner 2026-09-18): a voice is a
   property of the one speaking, not a stage of its own - js/merge-v3/wk-voice.js keeps
   the voices and speaks the lines; this file only decides when its faces are showing.

   WHAT IS SAVED. Only ids, and on the scenario project, where casting has always
   lived: characterId / characterName, then obrazId / obrazImage, then the location
   pair (routes/scen3.js, _normCasting). Nothing here owns a character or a look -
   they belong to the Character tab and to the looks library, and this only points
   at them.

   Built in phases C4, C5, V1-V3, F1-F3, S, M and V57 (docs/local-app/PLAN.md).
   ════════════════════════════════════════════════════════════════════════════ */

import { loadCharacters, filterByGender, byLooks, derived } from '../chars-store.js';
import * as API from './scen-api.js';
import * as PV from './preview-b.js';
import { askDelete } from './ask.js';
import * as ENV from './wk-env.js';
import * as VOICE from './wk-voice.js';
import * as FRAG from './wk-fragments.js';
import * as Pick from './chat-pick.js';
import { showToast } from '../notice.js';
import {
  MIN_WORDS_ALONE, nonsense, readPicture, dropField, showPicture, tileMenu,
  holdProgress, endProgress, onlyHere, heldPlace, softScroll, openWindow, closeWindow,
} from './wk-maker.js';

let _chars = null;
let _state = 'idle';                     // 'idle' | 'loading' | an error to show
let _all = false;                        // the gender filter lifted by hand
let _ctx = null;                         // { project, repaint } from the workshop
let _host = null;                        // the panel - the windows stand over it
let _saving = false;
// Where in the step the panel is. The hub is the script (js/merge-v3/wk-fragments.js); beside it:
//
//   hub      the voice, the lines, the open line
//   voice    the voice this character is read in
//   fchat    the frames chat, in place of the fields (phase V26.5)
//
// The character, the environment and their makers are WINDOWS since phase V57. ?view= in the address
// opens one of the places directly - that is how the Alerts list takes somebody back to where a
// generation was started (js/alerts-bell.js); the old shelves' names open their windows: cast and
// lookbooks / newlb "who" and "new look", env and newenv "where" and "new environment". Read once,
// when this module is first loaded - which is when the step is opened.
const VIEWS = ['hub', 'voice', 'fchat'];
const WINDOWS = ['cast', 'lookbooks', 'newlb', 'env', 'newenv'];
let _view = 'hub';
let _ask = '';                           // a window the address asked for, opened at the first paint
(function _urlView() {
  let v = '';
  try { v = new URLSearchParams(location.search).get('view') || ''; } catch (e) { v = ''; }
  if (VIEWS.includes(v)) _view = v;
  else if (WINDOWS.includes(v)) _ask = v;
})();
// What the next lookbook is made FROM: either a file the person chose here, or one the
// library already holds. Never both - choosing on one side clears the other, because the
// question "what is this based on" has one answer.
let _ref = null;                          // { name, dataUrl } - a picture from this computer
let _refLb = '';                          // ...or the path of a lookbook already on the shelf
let _lbNote = '';                         // what is wanted, in words
let _making = false;
let _lbs = null;                          // the lookbook shelf, read once
let _lbPick = '';                         // the outfit picked to dress in
let _dressing = false;                    // one at a time: it is a minute and it is paid for
// The window of a new look: who it is for and which of its two faces shows.
let _look = null;                         // { win, char, tab: 'look' | 'lookbook' }
// The casting's own work being waited for on the stage - put back after the script's paint (wk-maker.js).
const _jobs = { look: null, lookbook: null };   // { label, estimateMs, startedAt }

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
// full bodies side by side. (Decided with the owner: everyone gets a portrait eventually,
// so this is a fallback and not a second design.)
function _faceOf(c) {
  return { src: c.face || c.sheet || '', left: !c.face && !!c.sheet };
}

// ── The panel ───────────────────────────────────────────────────────────────
export function paint(host, ctx) {
  _ctx = ctx;
  _host = host;
  host.classList.add('is-wk');

  const root = _el('div', 'mv3-wk-setup');
  host.appendChild(root);

  // THE TITLE LINE IS TWO COLUMNS (the owner, 2026-09-22; turned round in phase V24, 2026-10-09):
  // on the left `generate all` and where the whole script stands - the counters, hung there by the
  // script pane itself (js/merge-v3/wk-fragments.js, _counters) - and what this step is on the right.
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
  const scroll = _el('div', 'mv3-wk-scroll');
  softScroll(scroll);                       // a touchpad moves this step too far per flick (V5)
  root.appendChild(scroll);
  // The sample a voice was being listened to stops when the panel leaves that level: a voice
  // still talking over the script is a sound with nothing on screen to explain it.
  if (_view !== 'voice') VOICE.leave();
  // The stage is painted AFTER the panel, from the same state (this file, _stage).
  FRAG.paint(scroll, ctx, _fragApi(chosen), head);
  _stage(chosen);
  // The casting's own countdown, when the script's left the stage to it (wk-maker.js).
  _reHold();
  // Arriving at the project is when to ask the journal whether a look, a lookbook or an environment of this
  // place is being made; a repaint is not.
  _pickUpRunning();
  if (_ask) {
    const a = _ask;
    _ask = '';
    setTimeout(() => _openAsked(a), 0);
  }
}

const _castChar = () => (_chars || []).find(c => c.id === String(_casting().characterId || '')) || null;

// Every move inside the step goes through here.
function _go(view) {
  if (WINDOWS.includes(view)) { _openAsked(view); return; }
  _view = VIEWS.includes(view) ? view : 'hub';
  _ctx.repaint();
}

// An old shelf's name - from the address, or a crumb - opens its window.
function _openAsked(v) {
  if (!_ctx || !_ctx.project) return;
  if (v === 'cast') _openWho();
  else if (v === 'lookbooks' || v === 'newlb') {
    const c = _castChar();
    if (c) _openNewLook(c, v === 'newlb' ? 'lookbook' : 'look'); else _openWho();
  } else if (v === 'env') ENV.openPlaces(_envApi());
  else if (v === 'newenv') ENV.openMaker(_envApi());
}

// ── The hub: the script ─────────────────────────────────────────────────────
// Painted by js/merge-v3/wk-fragments.js. What it may reach in here: the character cast (the
// voice row is theirs), the voice module's api (the row and the reads speak through it), and the
// way to the other places of the step.
function _fragApi(chosen) {
  return {
    char: () => chosen || null,
    voiceApi: () => _voiceApi(chosen),
    go: _go,
    // 'hub', 'voice' or 'fchat': the fields, the voices being chosen, or the frames chat.
    view: () => _view,
  };
}

// ── The stage ───────────────────────────────────────────────────────────────
// Two halves, always the same two: who on top, where below - what the project says.
function _whoHalf(chosen) {
  const cast = _casting();
  if (cast.obrazImage) return { src: cast.obrazImage, caption: cast.characterName || '' };
  if (chosen) return { src: _faceOf(chosen).src, caption: chosen.name + ' · no look yet' };
  return { src: '', caption: '' };
}
// ...and the lower, with no caption (phase V24, the owner 2026-10-09: the word "environment" under the
// place said nothing the picture did not).
function _whereHalf() {
  return { src: _casting().locationImage || '', caption: '' };
}

function _stage(chosen) {
  // A line open in the script with a clip or a frame shows THAT: it is what is being judged. The
  // doors are back the moment the line is closed (a second press on its row).
  const pic = FRAG.openPicture(_ctx.project);
  if (pic) {
    // A clip PLAYS here (X4) - and ONLY here: it is put up stopped, with its triangle, and the
    // press that starts it is a press on the stage (the owner, 2026-09-22).
    if (pic.film) PV.showFilm(pic.film, pic.caption, pic.poster);
    else PV.showStill(pic.src, pic.caption);
    // A picture that can be REFRAMED brings a selection with it (V9): the panel says the shape - the
    // project's format - and this puts the frame on the stage and the acts along its foot. The order
    // matters: `showStill` with a new picture drops any selection, so the crop is asked for after it.
    if (pic.crop) PV.cropOn(pic.crop.aspect); else PV.cropOff();
    _stageClears(false, false);
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
  // A CROSS in the corner of each half that holds a choice takes it off the project. In the corner of
  // the half, not of the picture: the picture moves under the zoom, the cross does not.
  const cast = _casting();
  _stageClears(!!(cast.characterId || cast.obrazImage), !!cast.locationImage);
}

// A half's cross: the choice is taken off the project; the frames and the reads already made stay what
// they are - they are files - and nothing else moves.
function _clearHalf(half) {
  if (_saving) return;
  if (half === 'top') _patch({ characterId: '', characterName: '', obrazId: '', obrazImage: '' });
  else _patch({ locationId: '', locationImage: '' });
}

// THE BUTTONS THIS STEP LAYS OVER THE STAGE - a half's cross, the acts along a picture's foot - all
// wear `mv3-stage-ctl`: the stage given back to the timeline drops them (js/merge-v3/preview-b.js,
// borrow), and so does leaving the step or the project (phase V24).
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
  const mk = (half, title) => {
    const b = _el('button', 'mv3-wk-clear mv3-stage-ctl' + (half === 'bottom' ? ' is-bottom' : ''), '✕');
    b.type = 'button';
    b.title = title;
    b.disabled = _saving;
    b.addEventListener('click', (e) => { e.stopPropagation(); _clearHalf(half); });
    stage.appendChild(b);
  };
  if (top) mk('top', 'Take ' + (cast.characterName || 'the character') + ' off this project');
  if (bottom) mk('bottom', 'Take the environment off this project');
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

// A half of the stage was pressed. The left button opens its window; the right one offers the
// picture itself, full size, the way a tile does.
function _pick(half, ev) {
  if (ev && ev.type === 'contextmenu') {
    const src = half === 'top' ? _whoHalf(_castChar()).src : _whereHalf().src;
    if (!src) return;
    tileMenu(ev, [{ label: 'open', sub: 'look at it, full size', on: () => showPicture({ src, name: src.split('/').pop() }) }],
      half === 'top' ? 'character menu' : 'environment menu');
    return;
  }
  if (half === 'top') _openWho(); else ENV.openPlaces(_envApi());
}

// ── "Who": the characters and their looks, in a window (phase V57, (ок5), (ок6)) ──
// The attachment window's frame (chat-pick.js openChoose): the characters on the left, the most looks
// first (chars-store.js byLooks), the scenario's gender with "all" beside it (whoever is cast is always
// among them); the one shown - the cast one, else the first - shows its 4K sheet and its looks; a look
// pressed is cast at once. The sheet is there to be seen: a person is cast in a look, never bare,
// because that look is what every frame is made from.
function _openWho(startId) {
  if (!_chars) return;
  const want = String((_ctx.project && _ctx.project.gender) || '').toLowerCase();
  const cast = _casting();
  const castId = String(cast.characterId || '');
  const nLooks = (n) => (n === 1 ? '1 look' : n ? n + ' looks' : 'no looks yet');
  const groups = _chars.map((c) => {
    const sheet = c.sheet || c.face || '';
    const items = [];
    if (sheet) {
      items.push({ path: sheet, name: c.name, sub: c.sheet ? '4K sheet' : 'portrait', aspect: c.sheet ? '16:9' : '',
        thumb: derived(sheet, 'card'), char: c,
        say: c.name + ' is cast in a look - press one of the looks, or "+ new look" to dress them in a new one.' });
    }
    for (const o of c.obrazy) {
      items.push({ path: o.image, name: o.name || 'look', sub: 'look', thumb: derived(o.image, 'card'), char: c, look: o });
    }
    return { key: c.id, label: c.name, n: c.obrazy.length, sub: nLooks(c.obrazy.length), items, char: c };
  });
  Pick.openChoose({
    title: 'character & look',
    crumb: 'characters',
    hint: 'press a look - it is cast at once',
    name: 'character and look',
    anchor: _host,
    load: async () => ({ groups }),
    filter: want ? {
      label: want,
      test: (g) => g.key === castId || filterByGender([g.char], want).length > 0,
      on: !_all,
      onChange: (on) => { _all = !on; },
    } : null,
    start: startId || castId,
    mark: (path) => (cast.obrazImage && path === cast.obrazImage ? 'cast' : ''),
    press: (it) => { if (it.look) _castLook(it.char, it.look); },
    make: {
      label: '+ new look',
      title: 'Dress the character shown in a lookbook - or make a lookbook first',
      on: (g) => { const c = (g && g.char) || _castChar() || (_chars || [])[0] || null; if (c) _openNewLook(c, 'look'); },
    },
    empty: 'No characters yet - make one with New Character on the Characters shelf of the Library.',
  });
}

// The one write of "who": the look with its character - it belongs to them.
function _castLook(c, o) {
  if (!c || !o) return;
  _patch({ characterId: c.id, characterName: c.name, obrazId: o.id, obrazImage: o.image });
}

// ── The environment ─────────────────────────────────────────────────────────
// Its own module (js/merge-v3/wk-env.js). This is everything it may reach in here: the casting and
// the way to save it, where it was started from, and the panel the windows stand over.
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
    label: 'Merge · ' + name + ' · setup' + (WHERE_WIN[view] ? ' › ' + WHERE_WIN[view] : ''),
    spot: { key, step: 'setup', view },
  };
}
// What a window's work is called in the Alerts row ("Merge · <name> · setup › new look").
const WHERE_WIN = { lookbooks: 'new look', newlb: 'new lookbook', newenv: 'new environment' };

function _envApi() {
  return {
    casting: _casting,
    patch: _patch,
    key: () => (_ctx && _ctx.key) || '',
    where: _where,
    repaint: () => _ctx.repaint(),
    anchor: () => _host,
    saving: () => _saving,
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

// ── Where you are inside the step ───────────────────────────────────────────
// The route in the panel header: `setup`, then the place inside it, drawn by the workshop on one
// tint (js/merge-v3/workshop.js, _paintRoute). At the hub there is none - the panel's own title says
// where you are. The character and the environment are windows (V57), not places of the panel.
const WHERE = { voice: 'voice', fchat: 'frames chat' };
const PATH = { hub: [], voice: ['voice'], fchat: ['fchat'] };

/** The route from the top of the step to where you are - the workshop paints it. */
export function crumbs() {
  return (PATH[_view] || []).map((id, i, all) => ({ id, label: WHERE[id], here: i === all.length - 1 }));
}

/** Pressing one of them - or `setup` at the start of the route, which is the hub. */
export function goCrumb(id) {
  const want = id === 'hub' ? 'hub' : id;
  if (want !== 'hub' && !WHERE[want] && !WINDOWS.includes(want)) return;
  if (want === _view) return;
  _go(want);
}

// ── THE NEW LOOK'S WINDOW (phase V57, (ок7)) ────────────────────────────────
// Over the page, for one character: "create look" - the lookbooks, the one picked, `apply` - and
// "create lookbook" - the bench that makes one. "+" on the first leads to the second.
function _openNewLook(c, tab) {
  if (!c) return;
  const win = openWindow({
    title: 'new look · ' + c.name, name: 'new look', anchor: _host,
    onClose: () => { if (_look && _look.win === win) _look = null; },
  });
  _look = { win, char: c, tab: tab === 'lookbook' ? 'lookbook' : 'look' };
  _paintLook();
}

function _paintLook() {
  if (!_look || !_look.win.alive()) return;
  const { win, char: c, tab } = _look;
  win.tabs.textContent = '';
  win.body.textContent = '';
  win.body.className = 'mk-body';
  const mk = (label, title, id) => {
    const b = _el('button', 'mv3-sc-tab' + (tab === id ? ' is-on' : ''), label);
    b.type = 'button';
    b.title = title;
    if (tab === id) b.disabled = true;
    else b.addEventListener('click', () => { _look.tab = id; _paintLook(); });
    return b;
  };
  win.tabs.append(
    mk('create look', 'Dress ' + c.name + ' in one of these', 'look'),
    mk('create lookbook', 'Make one from a photo and a sentence', 'lookbook'),
  );
  if (tab === 'lookbook') _paintNewLookbook(win.body, c);
  else _paintLookbooks(win.body, c);
}

// The shelf of outfits: picking one is the question "what should they wear"; `apply` at the foot - with
// who and what side by side - dresses them. An empty shelf offers the way to fill it.
function _paintLookbooks(host, c) {
  const list = _el('div', 'mk-scroll');
  softScroll(list);
  host.appendChild(list);
  if (_lbs === null) {
    list.appendChild(_note('reading the lookbooks…'));
    _readLbs();
  } else {
    const grid = _el('div', 'mv3-wk-grid is-lb');
    const add = _el('button', 'mv3-wk-tile is-add', '+');
    add.type = 'button';
    add.title = 'Make a lookbook from a photo and a sentence';
    add.addEventListener('click', () => { _look.tab = 'lookbook'; _paintLook(); });
    grid.appendChild(add);
    for (const p of _lbs) {
      const path = String((p && p.path) || p || '');
      if (!path) continue;
      grid.appendChild(_lbTile(path, path === _lbPick, () => {
        _lbPick = (_lbPick === path ? '' : path);
        _paintLook();
      }, true));
    }
    list.appendChild(grid);
    if (!_lbs.length) list.appendChild(_note('No lookbooks yet. Make one with "create lookbook".'));
  }

  // The foot: who, in what, and the press that dresses them.
  const foot = _el('div', 'mk-foot');
  const pair = _el('div', 'mk-pair');
  const face = _el('img', 'mk-pair-img');
  face.alt = '';
  face.src = derived(_faceOf(c).src, 'card');
  pair.appendChild(face);
  pair.appendChild(_el('span', 'mk-pair-plus', '+'));
  if (_lbPick) {
    const fit = _el('img', 'mk-pair-img');
    fit.alt = '';
    fit.src = derived(_lbPick, 'card');
    pair.appendChild(fit);
  } else pair.appendChild(_el('span', 'mk-pair-img is-empty', 'outfit'));
  const said = _el('span', 'mk-said', _dressing ? 'dressing ' + c.name + '… - the stage says how far' : (_lbPick ? '' : 'pick an outfit'));
  const go = _el('button', 'mv3-wk-create', _dressing ? 'dressing…' : 'apply');
  go.type = 'button';
  go.disabled = _dressing || !_lbPick;
  go.title = 'Dress ' + c.name + ' in this outfit and save it as a look - this spends credits';
  go.addEventListener('click', () => _apply(c));
  foot.append(pair, said, go);
  host.appendChild(foot);
}

function _readLbs() {
  _needLbMeta();
  API.lookbooks().then((files) => { _lbs = files; _paintLook(); })
    .catch((e) => { _lbs = []; _state = 'Could not read the lookbooks: ' + e.message; _paintLook(); _ctx.repaint(); });
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

// The agent's refusal or what failed, said above the sentence it is about.
let _lbSaid = '';

function _paintNewLookbook(host, c) {
  host.classList.add('mv3-wk-scroll', 'is-split');
  // LEFT: the shelf this one is drawn from. Picking a lookbook here puts it in the field on
  // the right as the base - which is what "make another one like that, but ..." means - and
  // the new lookbook joins this same shelf when it is done, so the pile grows while you work.
  const left = _el('div', 'mv3-wk-half is-shelf');
  if (_lbs === null) {
    left.appendChild(_note('reading the lookbooks…'));
    _readLbs();
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
        _paintLook();
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
        .then((p) => { _ref = p; _refLb = ''; _lbSaid = ''; _paintLook(); })
        .catch((e) => { _lbSaid = e.message; _paintLook(); });
    },
    onClear: () => { _ref = null; _refLb = ''; _lbSaid = ''; _paintLook(); },
    onOpen: () => (_ref ? showPicture({ src: _ref.dataUrl, name: _ref.name }) : _openLb(_refLb)),
  });
  right.append(drop, input);
  host.appendChild(right);

  // The sentence and its button at the foot of the RIGHT half - under the field they are about.
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
    hint.textContent = _making ? 'the stage says how far' : (why || (_mode() ? _MODE_LABEL[_mode()] : ''));
    hint.classList.toggle('is-why', !!why && !_making);
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
}

// ── One tile on a lookbook shelf ────────────────────────────────────────────
// Used by both faces of the window - the one that picks what to WEAR and the one that picks what a new
// lookbook is BASED on - because a lookbook is the same thing on either, and so is getting rid of one.
// The cross asks first; deleting is the only act here that cannot be undone. `dim`: the dressing shelf
// dims the picture of the PICKED outfit (phase V24, the owner 2026-10-09).
function _lbTile(path, on, pick, dim) {
  const tile = _el('button', 'mv3-wk-tile is-lb' + (on ? ' is-on' : '') + (on && dim ? ' is-dim' : ''));
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
// was made from. READ AGAIN AT EVERY OPEN: the lookbook most likely to be opened is the one just made.
async function _openLb(path) {
  try { _lbMetaMap = (await API.lookbookMeta()) || {}; } catch (e) { /* what was known before */ }
  const meta = (_lbMetaMap && _lbMetaMap[path]) || {};
  showPicture({
    src: path, name: path.split('/').pop(),
    rows: [['description', meta.description], ['suits', meta.gender]],
    from: meta.from,
  });
}

// Read once beside the shelf itself: both answer "what is on this shelf".
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
        _lbSaid = 'Could not delete it: ' + e.message;
      }
      _lbs = await API.lookbooks().catch(() => _lbs);
      if (_lbPick === path) _lbPick = '';
      if (_refLb === path) _refLb = '';
      _paintLook();
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
  _paintLook();
  _hold('lookbook', { label: LB_LABEL[mode] || 'Making the lookbook', estimateMs: 45000 });
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
    await _followLb(r.alertId, c);
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    _end('lookbook', msg);
    _making = false;
    // A refusal from the agent is not a failure of the machinery - it is an answer about what
    // was asked for, and it reads better as that than as an error.
    _lbSaid = e && e.refused ? msg : 'The lookbook failed: ' + msg;
    _paintLook();
  }
}

async function _followLb(id, c) {
  try {
    const rec = await API.follow(id);
    _end('lookbook');
    // The shelf on the left gains a tile and the bench stays where it is: one lookbook is rarely the
    // end of it. The new one is the base of the next, and the outfit picked to dress in.
    _lbs = await API.lookbooks().catch(() => _lbs);
    _refLb = String((rec.result || {}).path || '');
    _lbPick = _refLb || _lbPick;
    _ref = null;
    _lbNote = '';
    // The window was closed meanwhile: the news says where it is.
    if (!_look && c) {
      showToast({ mark: '✓', title: 'The lookbook is made', where: 'Dress ' + c.name + ' in it: "+ new look"',
        act: { label: 'dress', run: () => _openNewLook(c, 'look') }, ms: 9000 });
    }
  } catch (e) {
    const msg = (e && e.message) || 'unknown';
    _end('lookbook', msg);
    _lbSaid = 'The lookbook failed: ' + msg;
  }
  _making = false;
  _paintLook();
}

// ── The dressing itself ─────────────────────────────────────────────────────
// On the stage, because that is where the answer lands: the window goes as soon as the server has
// taken it. The overlay carries the countdown that learns from the last run of the same job
// (js/progress.js), so the second dressing already says roughly how long it will take.
async function _apply(c) {
  if (_dressing) return;
  const base = c.sheet || c.face || '';
  if (!base) { _state = c.name + ' has no reference sheet to dress.'; _paintLook(); return _ctx.repaint(); }
  const lb = _lbPick;
  if (!lb) return;
  _dressing = true;
  _paintLook();
  _hold('look', { label: 'Dressing ' + c.name, estimateMs: 90000 });
  try {
    // The server dresses, files the look under the character and - because this one was asked for
    // by a project - puts it on that project, whether or not anybody is still looking.
    const r = await API.dress({
      basePath: base, lookbookPath: lb, note: '',
      charId: c.id, charName: c.name, gender: c.gender || '',
      projectId: String((_ctx.project || {}).id || ''),
      title: 'Look · ' + c.name, where: _where('lookbooks'),
    });
    if (_look && _look.char === c) closeWindow();
    await _followDress(r.alertId);
  } catch (e) {
    _end('look', (e && e.message) || 'the dressing failed');
    _dressing = false;
    _state = 'The dressing failed: ' + ((e && e.message) || 'unknown');
    _paintLook();
    _ctx.repaint();
  }
}

async function _followDress(id) {
  try {
    await API.follow(id);
    _end('look');
    // The wardrobe and the project are read again rather than patched by hand: the server filed
    // the look and wrote it into the casting, and what it wrote is what should be on screen. A look
    // made for this project is chosen by it (decided with the owner 2026-09-21).
    _chars = byLooks(await loadCharacters(true));
    await _ctx.reloadProject();
    _lbPick = '';
  } catch (e) {
    _end('look', (e && e.message) || 'the dressing failed');
    _state = 'The dressing failed: ' + ((e && e.message) || 'unknown');
  }
  _dressing = false;
  _paintLook();
  _ctx.repaint();
}

// ── The countdown of the casting's own work, on the stage ───────────────────
// Each job knows the project it was started in (`key`): another project's stage does not show it.
function _hold(place, spec) {
  _jobs[place] = { label: spec.label, estimateMs: spec.estimateMs, startedAt: spec.startedAt || Date.now(), key: (_ctx && _ctx.key) || '' };
  holdProgress(place, _jobs[place]);
}
function _end(place, error) {
  _jobs[place] = null;
  endProgress(place, error);
}
// After the script's paint: the stage is free (no frame or clip of the script being waited for) - a look,
// a lookbook or an environment of this project being made puts its countdown back, at its real age.
function _reHold() {
  if (heldPlace()) return;
  const key = (_ctx && _ctx.key) || '';
  const mine = (j) => (j && j.key === key ? j : null);
  const env = mine(ENV.running());
  const [place, spec] = mine(_jobs.look) ? ['look', _jobs.look] : mine(_jobs.lookbook) ? ['lookbook', _jobs.lookbook] : env ? ['environment', env] : [];
  if (place) holdProgress(place, spec);
}

// Something of this step's casting may be running already - started before a reload, or before
// somebody walked off and came back. The journal knows; asked once per project opened.
let _lookedFor = '';
function _pickUpRunning() {
  const key = (_ctx && _ctx.key) || '';
  if (!key || _lookedFor === key) return;
  _lookedFor = key;
  API.alerts().then((d) => {
    const mine = (what, view) => (d.items || []).find(r => r.state === 'running' && r.what === what
      && r.where && r.where.spot && r.where.spot.key === key && r.where.spot.view === view);
    const look = mine('look', 'lookbooks');
    if (look && !_dressing) {
      _dressing = true;
      _hold('look', { label: 'Dressing ' + ((_castChar() || {}).name || 'the character'), estimateMs: 90000, startedAt: Date.parse(look.startedAt) || 0 });
      _followDress(look.id);
    }
    const lb = mine('lookbook', 'newlb');
    if (lb && !_making) {
      _making = true;
      _hold('lookbook', { label: 'Making the lookbook', estimateMs: 45000, startedAt: Date.parse(lb.startedAt) || 0 });
      _followLb(lb.id, _castChar());
    }
    const env = mine('environment', 'newenv');
    if (env) ENV.pickUp(_envApi(), env);
  }).catch(() => { /* without the list the panel simply shows nothing running */ });
}

function _note(text, bad) {
  return _el('div', 'mv3-ins-note' + (bad ? ' is-err' : ''), text);
}

/** Painted over, or the step is left (js/merge-v3/workshop.js, setStep): stop a voice sample or a read
 *  that was playing, close the windows of this step, and take what it laid over the stage. */
export function leave() {
  VOICE.leave();
  FRAG.leave();
  Pick.closePick();
  closeWindow();
  ENV.leave();
  // What it laid over the stage goes with it, and so does a countdown of its own (the server keeps
  // making it; coming back puts the countdown back at its real age - _reHold).
  _dropStageCtl();
  onlyHere(null, true);
}
