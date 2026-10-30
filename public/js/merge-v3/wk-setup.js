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

   THE DOORS ARE WINDOWS (phase V57; phase V58 - one window each, its content changing, with
   CRUMBS in its head, js/gen-window.js openFrame). "Who":
     characters / Mute (+ new look)          the characters on the left - the most looks first, the
                                             scenario's gender with "all" beside it -, the one the
                                             pointer rests on shows its 4K sheet and its looks (wk-maker.js
                                             paintChoose); A PRESS ON A LOOK CASTS IT AT ONCE and closes the
                                             window (V57, (ок5)); a look's ✕ pressed twice deletes it from the
                                             character - one a talking head is cast in is refused by the
                                             server with the project's name ((лк3), lib/casting-use.js);
                                             "+ new look" stands right of the name ((п. 11-12): "кнопка прямо
                                             напротив имени будет в самый раз")
     characters / Mute / new look            the lookbooks to dress them in, the one picked, `apply`
     … / new look / create lookbook          the generator's bench (js/gen-window.js paintBench)
   Each crumb but the last goes back. "Where" is js/merge-v3/wk-env.js, the same way.

   THE WINDOWS DO NOT CLOSE BY THEMSELVES AFTER A GENERATION IS STARTED ((лк5)): `apply` and the
   benches' `create` put the work into Alerts, the window says so on its line ("in Alerts · …"),
   and the person closes it. THE HALVES OF THE STAGE WAIT APART (the owner 2026-10-29): a look or a
   lookbook is waited for on the UPPER half only, an environment on the LOWER (wk-maker.js holdHalf);
   while one is made, the other half's window opens and its choice is written.

   A WINDOW OVER A WINDOW (the owner 2026-10-29: "пользователь кликает по алерту и нужно открыть попап
   "кто" поверх рабочего попапа "где""): a row of Alerts (or its popup) of THIS project's "who" or
   "where" asks the page first (js/alerts-bell.js `ugc:goto`); this step opens that window over what
   is open, and closing it shows the one under it as it was.

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

   Built in phases C4, C5, V1-V3, F1-F3, S, M, V57 and V58 (docs/local-app/PLAN.md).
   ════════════════════════════════════════════════════════════════════════════ */

import { loadCharacters, filterByGender, byLooks, derived } from '../chars-store.js';
import * as API from './scen-api.js';
import * as PV from './preview-b.js';
import * as ENV from './wk-env.js';
import * as VOICE from './wk-voice.js';
import * as FRAG from './wk-fragments.js';
import * as GW from '../gen-window.js';
import { delX } from '../del-x.js';
import {
  showPicture, tileMenu, onlyHere, heldPlace, softScroll, paintChoose,
  holdHalf, endHalf, dropHalf, dropHalves, halfPlace,
} from './wk-maker.js';

let _chars = null;
let _state = 'idle';                     // 'idle' | 'loading' | an error to show
let _all = false;                        // the gender filter lifted by hand
let _ctx = null;                         // { project, repaint } from the workshop
let _host = null;                        // the panel - the windows stand over it
let _active = false;                     // this step is the one painted (for `ugc:goto`)
let _saving = false;
let _picShown = false;                   // the stage shows a line's frame or clip - not the halves
// Where in the step the panel is. The hub is the script (js/merge-v3/wk-fragments.js); beside it:
//
//   hub      the voice, the lines, the open line
//   voice    the voice this character is read in
//
// The character, the environment and their makers are WINDOWS since phase V57, and so is the frames chat since phase V61
// (js/merge-v3/fchat.js, opened by js/merge-v3/wk-fragments.js openChat). ?view= in the address opens one of the places
// directly - that is how the Alerts list takes somebody back to where a generation was started (js/alerts-bell.js); the old
// shelves' names open their windows: cast "who", lookbooks "new look", newlb "create lookbook", env "where", newenv "new
// environment", fchat the frames chat. Read once, when this module is first loaded - which is when the step is opened.
const VIEWS = ['hub', 'voice'];
const WINDOWS = ['cast', 'lookbooks', 'newlb', 'env', 'newenv', 'fchat'];
let _view = 'hub';
let _ask = '';                           // a window the address asked for, opened at the first paint
(function _urlView() {
  let v = '';
  try { v = new URLSearchParams(location.search).get('view') || ''; } catch (e) { v = ''; }
  // (phase V62, (во17)) The voices are a window now: an address that asks for them opens it.
  if (v === 'voice' || WINDOWS.includes(v)) _ask = v;
  else if (VIEWS.includes(v)) _view = v;
})();
let _lbs = null;                          // the lookbooks to dress in, read when that page opens
let _lbPick = '';                         // the outfit picked to dress in
let _dressing = false;                    // one at a time: it is a minute and it is paid for
let _dressSaid = '';                      // the line of the dressing page - in Alerts, done, failed
// The window of "who": its page ('list' | 'look' | 'lookbook') and the character the pages after the list are for.
let _who = null;                          // { win, page, char }
const _whoState = {};                     // the list's group (the character shown), filter, search
// The dressing being waited for on the stage's upper half (the benches' own: GW.running).
let _dress = null;                        // { label, estimateMs, startedAt, key }

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

// (phase V61, (т9а)) "saving…" at the right of the panel's head while the casting is saved; gone with the save, and with the step.
function _savingWord() {
  const head = document.querySelector('#mv3-inspector .mv3-panel-head');
  if (!head) return;
  let w = head.querySelector('.mv3-wk-saving');
  if (!_saving || !_active) { if (w) w.remove(); return; }
  if (!w) head.appendChild(_el('span', 'mv3-wk-saving', 'saving…'));
}

// ── The panel ───────────────────────────────────────────────────────────────
export function paint(host, ctx) {
  _ctx = ctx;
  _host = host;
  _active = true;
  host.classList.add('is-wk');

  const root = _el('div', 'mv3-wk-setup');
  host.appendChild(root);

  // NO TITLE LINE OF ITS OWN (phase V61, the owner 2026-10-30, (т9): "давай всю строку удалим вместе с кнопкой generate all и
  // header setup с описанием"): the panel's own head says "Setup" and carries the crumbs (js/merge-v3/workshop.js), and
  // "saving…" stands grey at its right while the casting is saved ((т9а)).
  _savingWord();

  if (!ctx.project) { root.appendChild(_note('Reading the project…')); return; }
  if (_chars === null) { _load(ctx.repaint); root.appendChild(_note('reading the characters…')); return; }
  if (_state !== 'idle' && _state !== 'loading') root.appendChild(_note(_state, true));

  const chosen = _castChar();
  const scroll = _el('div', 'mv3-wk-scroll');
  softScroll(scroll);                       // a touchpad moves this step too far per flick (V5)
  root.appendChild(scroll);
  // The sample a voice was being listened to stops when the panel leaves that level: a voice
  // still talking over the script is a sound with nothing on screen to explain it.
  if (!_voiceOpen()) VOICE.leave();
  // The stage is painted AFTER the panel, from the same state (this file, _stage).
  FRAG.paint(scroll, ctx, _fragApi(chosen));
  _paintVoices(chosen);
  _stage(chosen);
  // The casting's own countdowns, each on its half, when the stage shows the halves (V58).
  _syncHalves();
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
  // (phase V62, (во17)) The voices open in a window over the setup - a talking head's and a voiceover's alike.
  if (view === 'voice') { _openVoices(); return; }
  if (view === 'hub' && _voiceOpen()) { _voiceWin.close(); return; }
  _view = VIEWS.includes(view) ? view : 'hub';
  _ctx.repaint();
}

// An old shelf's name - from the address, a row of Alerts, a crumb - opens its window, over what is open.
function _openAsked(v) {
  if (!_ctx || !_ctx.project) return;
  // (phase V62) A voiceover has no who, where or frames chat - only the voices.
  if (_ctx.project.type === 'voiceover' && v !== 'voice') return;
  const c = _castChar();
  if (v === 'cast') _openWho('list');
  else if (v === 'lookbooks') _openWho(c ? 'look' : 'list', c);
  else if (v === 'newlb') _openWho(c ? 'lookbook' : 'list', c);
  else if (v === 'env') ENV.openWhere(_envApi(), 'list');
  else if (v === 'newenv') ENV.openWhere(_envApi(), 'make');
  else if (v === 'fchat') FRAG.openChat();          // (phase V61) its rows of Alerts, the address
  else if (v === 'voice') _openVoices();            // (phase V62)
}

// ── THE VOICES, A WINDOW (phase V62, the owner 2026-10-30, (во2): "нужен поиск по голосам в elevenlabs как в talking head но
// поиск в попапе будет"; (во17) "в обоих") ──
// What stood in the right column - the saved voices and the ElevenLabs library with its filters and its search
// (js/merge-v3/wk-voice.js paintPicker) - in the window of js/gen-window.js, over the setup. Field 1's "change" opens it; it
// stays open after a voice is taken, and is painted again with every repaint of the step, where it was scrolled to.
let _voiceWin = null;
const _voiceOpen = () => !!(_voiceWin && _voiceWin.alive());
function _openVoices() {
  if (!_ctx || !_ctx.project) return;
  if (_voiceOpen()) return;
  // (phase V62, (во41) а) The library's language filter starts at the script's: Cyrillic - Russian, plain English letters - English,
  // anything else - every language; a talking head is English (V29).
  const p = _ctx.project;
  const text = (p.lines || []).map(l => String((l && l.text) || '')).join(' ').replace(/\s+/g, ' ');
  const lang = p.type !== 'voiceover' ? 'en'
    : /\p{Script=Cyrillic}/u.test(text) ? 'ru'
      : !text.trim() || !/[^ -~‘’“”–—…]/.test(text) ? 'en' : '';
  VOICE.languageFor(String(p.id), lang);
  _voiceWin = GW.openFrame({
    name: 'voices', size: { w: 900, h: 660 },
    onClose: () => { _voiceWin = null; VOICE.leave(); },
  });
  _voiceWin.setCrumbs([{ label: 'voices' }]);
  _paintVoices(_castChar());
}
function _paintVoices(chosen) {
  if (!_voiceOpen()) return;
  const body = _voiceWin.body;
  // What scrolls is the list above the foot; the foot - the library's pages - stays at the window's bottom (the owner:
  // "кнопки страниц показаны всегда снизу попапа").
  const was = body.querySelector('.mv3-wk-vwin');
  const at = was ? was.scrollTop : 0;
  body.textContent = '';
  const box = _el('div', 'mv3-wk-vwin');
  const foot = _el('div', 'mv3-wk-vwinfoot');
  body.append(box, foot);
  VOICE.paintPicker(box, { ..._voiceApi(chosen), inWindow: true, pagerHost: foot });
  if (at) box.scrollTop = at;
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
    // 'hub' or 'voice': the fields, or the voices being chosen.
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
  // (phase V62) A VOICEOVER has nobody and nowhere to choose: the stage stays empty - its picture is the B-roll.
  if ((_ctx.project || {}).type === 'voiceover') {
    PV.cropOff();
    PV.showStill('', '');
    _picShown = false;
    _stageClears(false, false);
    return;
  }
  // A line open in the script with a clip or a frame shows THAT: it is what is being judged. The
  // doors are back the moment the line is closed (a second press on its row).
  const pic = FRAG.openPicture(_ctx.project);
  _picShown = !!pic;
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
  if (half === 'top') _openWho('list'); else ENV.openWhere(_envApi(), 'list');
}

// ── The environment ─────────────────────────────────────────────────────────
// Its own module (js/merge-v3/wk-env.js). This is everything it may reach in here: the casting and
// the way to save it, where it was started from, the panel the windows stand over, and the stage's
// lower half.
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
    // The lower half of the stage waits for the place being made (V58).
    onStart: () => _syncHalves(),
    onEnd: (place, error) => { endHalf(place, error); _syncHalves(); },
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
const WHERE = { voice: 'voice' };
const PATH = { hub: [], voice: ['voice'] };

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

// ── "WHO": THE WINDOW (phase V57; V58 - crumbs, the ✕ of a look, a new look in the same window) ──
/** The window of "who" on `page` ('list' | 'look' | 'lookbook'), for `char` on the pages after the list - over everything
 *  open; opened while it is under another window, it comes up over it. */
function _openWho(page, char) {
  if (!_chars) return;
  if (_who && _who.win.alive() && !_who.win.isTop()) _who.win.close();
  if (!_who || !_who.win.alive()) {
    const win = GW.openFrame({ name: 'character and look', anchor: _host, onClose: () => { if (_who && _who.win === win) _who = null; } });
    _who = { win, page: 'list', char: null };
    // Opened on the one cast, else the first.
    const c = _castChar();
    if (c) _whoState.group = c.id;
  }
  _who.page = page || 'list';
  if (char) { _who.char = char; _whoState.group = char.id; }
  _paintWho();
}

function _whoGo(page) {
  if (!_who || !_who.win.alive()) return;
  _who.page = page;
  _paintWho();
}

// The character shown: the one hovered last in the list, else the one the pages were opened for.
const _shownChar = () => (_chars || []).find(c => c.id === _whoState.group) || (_who && _who.char) || _castChar() || (_chars || [])[0] || null;

function _whoCrumbs() {
  const win = _who.win;
  const c = _shownChar();
  const list = { label: 'characters', on: () => _whoGo('list') };
  if (_who.page === 'list') {
    win.setCrumbs([{ label: 'characters' }].concat(c ? [{
      label: c.name,
      act: { label: '+ new look', title: 'Dress ' + c.name + ' in a lookbook - or make a lookbook first', on: () => { _who.char = c; _whoGo('look'); } },
    }] : []));
    return;
  }
  const name = { label: c ? c.name : 'character', on: () => _whoGo('list') };
  if (_who.page === 'look') win.setCrumbs([list, name, { label: 'new look' }]);
  else win.setCrumbs([list, name, { label: 'new look', on: () => _whoGo('look') }, { label: 'create lookbook' }]);
}

function _paintWho() {
  if (!_who || !_who.win.alive()) return;
  const body = _who.win.body;
  body.textContent = '';
  body.className = 'gw-body';
  if (_who.page !== 'list' && !_shownChar()) _who.page = 'list';
  _whoCrumbs();
  if (_who.page === 'look') { _paintDress(body, _shownChar()); return; }
  if (_who.page === 'lookbook') { GW.paintBench(body, _lbOpts()); return; }
  _paintCharacters(body);
}

// The characters and their looks (wk-maker.js paintChoose): the 4K sheet first - there to be seen, a person is cast in a
// look, never bare, because that look is what every frame is made from -, then the looks.
function _paintCharacters(body) {
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
        say: c.name + ' is cast in a look - press one of the looks, or "+ new look" by the name to dress them in a new one.' });
    }
    for (const o of c.obrazy) {
      items.push({ path: o.image, name: o.name || 'look', sub: 'look', thumb: derived(o.image, 'card'), char: c, look: o });
    }
    return { key: c.id, label: c.name, n: c.obrazy.length, sub: nLooks(c.obrazy.length), items, char: c };
  });
  paintChoose(body, {
    state: _whoState,
    groups,
    filter: want ? {
      label: want,
      on: !_all,
      test: (g) => g.key === castId || filterByGender([g.char], want).length > 0,
      onChange: (on) => { _all = !on; },
    } : null,
    // The crumb follows the character shown - "+ new look" stands by THAT name.
    onGroup: () => _whoCrumbs(),
    mark: (it) => (it.look && cast.obrazImage && it.path === cast.obrazImage ? 'cast' : ''),
    press: (it) => {
      if (!it.look) return;
      _castLook(it.char, it.look);
      if (_who) _who.win.close();
    },
    del: (it) => (it.look ? {
      title: 'Delete this look of ' + it.char.name,
      run: async () => {
        const d = await fetch('/api/library/item/obrazy/' + encodeURIComponent(it.look.id), { method: 'DELETE' })
          .then(r => r.json()).catch(() => null);
        return d && d.success ? '' : ((d && d.error) || 'the app did not answer');
      },
      done: async () => {
        _chars = byLooks(await loadCharacters(true));
        _paintWho();
        _ctx.repaint();
      },
    } : null),
    empty: _chars.length ? 'No looks yet - "+ new look" by the name dresses them in one.'
      : 'No characters yet - make one with New Character on the Characters shelf of the Library.',
  });
}

// The one write of "who": the look with its character - it belongs to them.
function _castLook(c, o) {
  if (!c || !o) return;
  _patch({ characterId: c.id, characterName: c.name, obrazId: o.id, obrazImage: o.image });
}

// ── NEW LOOK: dress the character in a lookbook ─────────────────────────────
// The lookbooks ("+" leads to the bench that makes one), the one picked, and at the foot who + what and `apply`. After
// `apply` the window stays ((лк5)): its line says the dressing is in Alerts, the stage's upper half how far.
function _paintDress(body, c) {
  const list = _el('div', 'mk-scroll');
  softScroll(list);
  body.appendChild(list);
  if (_lbs === null) {
    list.appendChild(_el('div', 'gw-note', 'reading the lookbooks…'));
    API.lookbooks().then((files) => { _lbs = files || []; _paintWho(); })
      .catch((e) => { _lbs = []; _dressSaid = 'Could not read the lookbooks: ' + e.message; _paintWho(); });
  } else {
    const grid = _el('div', 'gw-grid is-lookbook');
    const add = _el('button', 'gw-tile is-add', '+');
    add.type = 'button';
    add.title = 'Make a lookbook from a photo and a sentence';
    add.addEventListener('click', () => _whoGo('lookbook'));
    grid.appendChild(add);
    for (const p of _lbs) {
      const path = String((p && p.path) || p || '');
      if (path) grid.appendChild(_lbTile(path));
    }
    list.appendChild(grid);
    if (!_lbs.length) list.appendChild(_el('div', 'gw-note', 'No lookbooks yet - the "+" makes one.'));
  }

  // The foot: who, in what, the line, and the press that dresses them.
  const foot = _el('div', 'gw-foot mk-dress');
  const row = _el('div', 'gw-row');
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
  const said = _el('span', 'gw-hint' + (_dressing ? ' is-on' : ''), _dressSaid || (_lbPick ? '' : 'pick an outfit'));
  const go = _el('button', 'gw-create', _dressing ? 'dressing…' : 'apply');
  go.type = 'button';
  go.disabled = _dressing || !_lbPick;
  go.title = 'Dress ' + c.name + ' in this outfit and save it as a look - this spends credits';
  go.addEventListener('click', () => _apply(c));
  row.append(pair, said, go);
  foot.appendChild(row);
  body.appendChild(foot);
}

// A lookbook to dress in: picked, dimmed; its ✕ pressed twice deletes it; its right button opens it large.
function _lbTile(path) {
  const on = path === _lbPick;
  const tile = _el('button', 'gw-tile' + (on ? ' is-on is-dim' : ''));
  tile.type = 'button';
  tile.title = path.split('/').pop();
  const img = _el('img');
  img.alt = '';
  img.loading = 'lazy';
  img.src = derived(path, 'card');
  tile.appendChild(img);
  tile.appendChild(delX({
    host: tile, title: 'Delete this lookbook from the library',
    run: async () => {
      const d = await fetch('/api/library/item/lookbooks/' + encodeURIComponent(path.split('/').pop()), { method: 'DELETE' })
        .then(r => r.json()).catch(() => null);
      return d && d.success ? '' : ((d && d.error) || 'the app did not answer');
    },
    done: async () => {
      if (_lbPick === path) _lbPick = '';
      _lbs = await API.lookbooks().catch(() => _lbs);
      _paintWho();
    },
  }));
  tile.addEventListener('click', () => { _lbPick = on ? '' : path; _dressSaid = _dressing ? _dressSaid : ''; _paintWho(); });
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tileMenu(e, [{ label: 'open', sub: 'look at it, full size', on: () => _openLb(path) }], 'lookbook menu');
  });
  return tile;
}

// The viewer the Library uses, with what the agent wrote about it - read again at every open.
async function _openLb(path) {
  let meta = {};
  try { meta = ((await API.lookbookMeta()) || {})[path] || {}; } catch (e) { /* nothing known */ }
  showPicture({ src: path, name: path.split('/').pop(), rows: [['description', meta.description], ['suits', meta.gender]], from: meta.from });
}

// The lookbook bench's options for this project (js/gen-window.js): a lookbook made is the outfit picked to dress in; its
// countdown is the upper half's.
function _lbOpts() {
  return {
    kind: 'lookbook',
    where: () => _where('newlb'),
    onStart: () => _syncHalves(),
    onEnd: (error) => { endHalf('lookbook', error); _syncHalves(); },
    onMade: (path) => {
      _lbs = null;
      _lbPick = path;
      _dressSaid = '';
      if (_who && _who.win.alive() && _who.page === 'look') _paintWho();
    },
  };
}

// ── The dressing itself ─────────────────────────────────────────────────────
// The server dresses, files the look under the character and - because this one was asked for by a project - puts it
// on that project, whether or not anybody is still looking. The window stays; the upper half of the stage counts down.
async function _apply(c) {
  if (_dressing) return;
  const base = c.sheet || c.face || '';
  if (!base) { _dressSaid = c.name + ' has no reference sheet to dress.'; _paintWho(); return; }
  const lb = _lbPick;
  if (!lb) return;
  _dressing = true;
  _dressSaid = 'asking…';
  _paintWho();
  try {
    const r = await API.dress({
      basePath: base, lookbookPath: lb, note: '',
      charId: c.id, charName: c.name, gender: c.gender || '',
      projectId: String((_ctx.project || {}).id || ''),
      title: 'Look · ' + c.name, where: _where('lookbooks'),
    });
    _beginDress(c.name, Date.now());
    await _followDress(r.alertId);
  } catch (e) {
    _endDress((e && e.message) || 'the dressing failed');
    _dressSaid = 'The dressing failed: ' + ((e && e.message) || 'unknown');
    _paintWho();
  }
}

function _beginDress(name, startedAt) {
  _dressing = true;
  _dress = { label: 'Dressing ' + name, estimateMs: 90000, startedAt: startedAt || Date.now(), key: (_ctx && _ctx.key) || '' };
  _dressSaid = 'in Alerts · Dressing ' + name + '…';
  _syncHalves();
  _paintWho();
}

function _endDress(error) {
  _dressing = false;
  _dress = null;
  endHalf('look', error);
  _syncHalves();
}

async function _followDress(id) {
  try {
    await API.follow(id);
    _endDress('');
    // The wardrobe and the project are read again rather than patched by hand: the server filed
    // the look and wrote it into the casting, and what it wrote is what should be on screen. A look
    // made for this project is chosen by it (decided with the owner 2026-09-21).
    _chars = byLooks(await loadCharacters(true));
    await _ctx.reloadProject();
    _lbPick = '';
    _dressSaid = 'in Alerts · done - the new look is cast';
  } catch (e) {
    _endDress((e && e.message) || 'the dressing failed');
    _dressSaid = 'The dressing failed: ' + ((e && e.message) || 'unknown');
  }
  _paintWho();
  _ctx.repaint();
}

// ── THE HALVES OF THE STAGE (phase V58) ─────────────────────────────────────
// Each half waits for its own work: the upper for a look being dressed or a lookbook being made, the lower for an
// environment - only this project's, and only while the stage shows the halves and the script is not counting down on
// the whole of it (a frame or a clip; wk-maker.js heldPlace).
function _syncHalves() {
  if (!_active || !_ctx) return;
  if (_picShown || heldPlace()) { dropHalves(); return; }
  const key = _ctx.key || '';
  const mine = (j) => (j && j.spot && j.spot.key === key ? j : null);
  const lb = mine(GW.running('lookbook'));
  const env = mine(GW.running('environment'));
  const top = _dress && _dress.key === key ? ['look', _dress] : lb ? ['lookbook', lb] : null;
  if (top) holdHalf('top', top[0], top[1]); else if (halfPlace('top')) dropHalf('top');
  if (env) holdHalf('bottom', 'environment', env); else if (halfPlace('bottom')) dropHalf('bottom');
}

// Something of this step's casting may be running already - started before a reload, or before somebody walked off and
// came back. The journal knows; asked once per project opened.
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
      _beginDress(((_castChar() || {}).name || 'the character'), Date.parse(look.startedAt) || 0);
      _followDress(look.id);
    }
    const lb = mine('lookbook', 'newlb');
    if (lb) GW.adopt('lookbook', lb, _lbOpts());
    const env = mine('environment', 'newenv');
    if (env) GW.adopt('environment', env, ENV.benchOpts(_envApi()));
  }).catch(() => { /* without the list the panel simply shows nothing running */ });
}

// ── A WINDOW OVER A WINDOW (phase V58) ──────────────────────────────────────
// A row of Alerts or its popup asks the page before it goes anywhere (js/alerts-bell.js `_goTo` - a cancellable
// `ugc:goto`; js/merge-v3/main.js and library.js hear it for their own addresses, `reveal` and `open`, never a `view`).
// One of THIS project's "who" or "where" (`?p=<key>&...&view=<a window>`) opens that window over what is open, here.
window.addEventListener('ugc:goto', (e) => {
  if (e.defaultPrevented || !_active || !_ctx || !_ctx.project) return;
  let u;
  try { u = new URL((e.detail && e.detail.href) || '', location.href); } catch (err) { return; }
  if (u.pathname !== location.pathname || u.searchParams.get('p') !== (_ctx.key || '')) return;
  const v = u.searchParams.get('view') || '';
  if (!WINDOWS.includes(v)) return;
  e.preventDefault();
  _openAsked(v);
});

function _note(text, bad) {
  return _el('div', 'mv3-ins-note' + (bad ? ' is-err' : ''), text);
}

/** Painted over, or the step is left (js/merge-v3/workshop.js, setStep): stop a voice sample or a read
 *  that was playing, close the windows of this step, and take what it laid over the stage. */
export function leave() {
  _active = false;
  _savingWord();
  if (_voiceOpen()) _voiceWin.close();
  _voiceWin = null;
  VOICE.leave();
  FRAG.leave();
  if (_who && _who.win.alive()) _who.win.close();
  _who = null;
  ENV.leave();
  // What it laid over the stage goes with it, and so do its countdowns (the server keeps making it; coming back puts
  // them back at their real age - _syncHalves).
  _dropStageCtl();
  dropHalves();
  onlyHere(null);
}
