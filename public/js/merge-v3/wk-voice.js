/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the voice of the character who speaks.

   Two faces, and they are the same question one level apart:

     the voice row      which voice this character speaks in - our demo to listen to and a menu of
                        the voices to choose from (paintRow) - in field 1 of the setup
                        (js/merge-v3/wk-fragments.js)
     the voices window  the saved voices in full, and under them the ElevenLabs shared library with
                        its filters, to take a new one (openVoices, paintPicker)

   THE READS ARE SPOKEN FROM HERE (generate, readLine, readAll, saveText): the fragments pane shows
   the lines and their buttons, and this module is what those buttons call - a take is the voice's
   business, whichever panel asks for it. ONE MODEL, ElevenLabs v3 with tags: a line is tagged by the
   mood of the video before it is read, the words with their tags are what the take says, and a line
   read without tags keeps that read until it is read again.

   A VOICE BELONGS TO THE CHARACTER, not to this project: changing the
   voice here is ADDING one to that character. `voices` is everything they have, `voice` is the
   one every read uses, and both are written through the door the Library's Characters shelf uses
   (PATCH /api/char-store/:id) - so a voice taken here is on that shelf the moment it
   is taken, and the two cannot disagree.

   BEFORE THERE IS A CHARACTER the project may choose a voice of its own: `choose a voice` opens
   the same library, and the voice taken is written on the
   project (`voice.pick`, routes/scen3.js) - the reads use it until a character with a voice of
   their own is cast, and a character's voice wins the moment they are. A character without one
   reads in the project's pick too.

   TAKING IS THE ONLY PAID THING HERE, and it is small: the account gains a voice slot and the
   server records our own 30-second demo with it (routes/scen3.js, /scen3/voices/take). A voice
   the library already holds keeps the demo it has and costs nothing. Searching and listening to
   the owners' samples is free, which is why the search is free to be pressed as often as it takes.
   Nothing on this level goes into Alerts: a voice answers in seconds, and a row that is finished
   before it can be read is noise.
   ════════════════════════════════════════════════════════════════════════════ */

import { el } from './wk-maker.js';
import { isRead, plainWords, isLive, takeOf } from './scen-api.js';
import { hint } from '../bubble.js';
import * as Layers from '../layers.js';
import * as GW from '../gen-window.js';
// Being read, nothing found - the shared parts (rows in the voice menu; the library window's list
// in the big form, the same on Home's quick start).
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';
import { icon } from '../icons.js';
import { allow } from '../key-gate.js';
// The app's words as T.t: this module's own `t`s are answers and rows.
import * as T from '../i18n/t.js';

const PAGE = 20;                       // results per page

let _filters = null;                   // the vocabularies, read once per page load
let _res = null;                       // the last search: { voices, total, hasMore }
let _page = 1;
let _busy = '';                        // 'search' | 'take:<voice id>' | 'star' - one at a time
let _said = '';                        // what the panel says under the bar
let _bad = false;                      // ...and whether that is a failure
let _asked = false;                    // a search has been run, so the pager means something
// A read that failed is said - a popup with the reason, and in its place "did not
// load" with Try again; what was shown stays. The filters, the search and the saved voices.
let _filtersFailed = false;
let _searchFailed = false;
let _shelfFailed = false;
// English by default: every script is English, so is the voice that reads it.
let _q = { search: '', gender: '', age: '', accent: '', descriptives: '', use_cases: '', language: 'en' };

// The reads. "generate" hands the WHOLE script to the server and watches it (readAll
// below); what is left here is the one-line read of a fragment's own button, which answers with the
// take and so can be awaited.
let _reading = [];                      // the lines being spoken now
let _batch = null;                      // { done, total } while every stale line is being read
let _tagging = false;                   // the tagger is marking the script up
// WHEN THE WORK STARTED: the field it belongs to fills its bottom border as it goes, and
// the two things that cannot be counted - one agent call, one line spoken - are drawn from an
// estimate that has to be measured from somewhere.
let _tagAt = 0;
let _readAt = 0;
let _rsaid = '';                        // what the reads have to say, and whether it is bad
let _rbad = false;

// One player for the whole panel: two voices at once is not a comparison, it is noise. The row
// that owns the sound is remembered so a repaint can put the pause sign back where it was.
let _audio = null;
let _playing = '';

// A repaint is the step's: the list the reads change lives in the fragments pane, which keeps its
// own scroll offset across repaints (js/merge-v3/wk-fragments.js, _listAt).
const _repaint = (api) => api.repaint();

function _play(src) {
  if (!src) return;
  if (!_audio) {
    _audio = new Audio();
    _audio.addEventListener('ended', () => { _playing = ''; _mark(); });
    _audio.addEventListener('pause', () => { _mark(); });
    _audio.addEventListener('play', () => { _mark(); });
  }
  if (_playing === src && !_audio.paused) { _audio.pause(); return; }
  _playing = src;
  _audio.src = src;
  _audio.play().catch(() => { _playing = ''; _mark(); });
}

// The buttons follow the SOUND, not the click: a sample that will not play must not leave a
// pause sign standing over silence.
// Only the voices' buttons: the reads in the script have a player of their own
// (js/merge-v3/wk-fragments.js, .is-read).
function _mark() {
  const on = !!(_audio && !_audio.paused) ? _playing : '';
  document.querySelectorAll('.mv3-wk-vplay:not(.is-read)').forEach((b) => {
    const is = b.dataset.src && b.dataset.src === on;
    // the voices window's buttons draw the icons (play / pause) at 14 px; setup's at 12
    b.innerHTML = icon(is ? 'pause' : 'play', b.dataset.ico ? 14 : 12);
    b.classList.toggle('is-playing', !!is);
  });
}

function _playBtn(src, what, ico) {
  const b = el('button', 'mv3-wk-vplay u-btn is-s is-icon');
  if (ico) b.dataset.ico = '1';
  b.innerHTML = icon('play', ico ? 14 : 12);
  b.type = 'button';
  b.disabled = !src;
  b.dataset.src = src || '';
  b.title = src ? T.t('Play {what}', { what }) : T.t('It has no sample');
  b.addEventListener('click', (e) => { e.stopPropagation(); _play(src); });
  return b;
}

// What a voice is, in one line: the tags that are actually set, in the order they read.
const _sub = (v) => [v.descriptive, v.gender, v.age && String(v.age).replace(/_/g, ' '), v.accent, v.language]
  .map(x => String(x || '').trim()).filter(Boolean).join(' · ');

const _saved = (rec) => (rec && Array.isArray(rec.voices) ? rec.voices : []);
// What the character HAS, as the panel shows it: their list - and a `voice` the list does not hold
// as itself, with no demo of ours. The server reads
// in it (routes/scen3.js, _castVoiceOf), so the panel must not say they have none and paint the field
// red. Shown only: what is written back is the list as it is (_take).
const _mine = (rec) => {
  const list = _saved(rec);
  const id = String((rec && rec.voice) || '');
  return (id && !list.some(v => v && String(v.voiceId) === id))
    ? list.concat([{ voiceId: id, name: T.t('their voice'), sample: '' }]) : list;
};
const _active = (rec) => {
  const id = String((rec && rec.voice) || '');
  return _mine(rec).find(v => String(v.voiceId) === id) || null;
};

// ── The voice row ───────────────────────────────────────────────────────────
// The character has a voice or they have not, and both answers lead to the same place: the
// sub-level where voices are chosen. The dropdown is only for the ones already theirs - picking
// a NEW one is a search, not a choice from a list. With nobody cast, or a character with no
// voice of their own, the row is the project's own pick - or the way to one.
// ONE LINE in the field "mood & voice", and it never wraps: ▶ the voice that reads, and its name with ▾ - a long name ends
// in an ellipsis. Whose voice this is is said in a bubble over the name when the pointer rests on it, and the news of a
// voice just taken is not said at all. `o.notes` - where the notes go (the row's host when not given): the field keeps its
// one line and puts them under it.
// THE VOICE IS A LIST, in a talking head and a voiceover alike: the name pressed opens the menu (_voiceMenu): "ElevenLabs
// library…" (the window of the search), the character's voices, the saved ones - each with ▶ our own demo, a press chooses
// it. It stays after a voice is chosen.
export function paintRow(host, api, o) {
  const rec = api.char();
  const pick = api.pick();
  const mine = _mine(rec);
  const now = _active(rec);
  const notes = (o && o.notes) || host;
  // What reads now: the character's voice, else - nobody cast, or a character with none - the project's own pick.
  const cur = now || (!mine.length ? pick : null);

  const row = el('div', 'mv3-wk-vrow is-now');
  row.appendChild(_playBtn((cur && cur.sample) || '', T.t('our own demo')));
  const btn = el('button', 'mv3-wk-vpickbtn u-btn is-s is-field' + (cur ? '' : ' is-need'));
  btn.type = 'button';
  btn.appendChild(el('span', 'mv3-wk-vpickname', cur ? (cur.name || cur.voiceId) : (_busy.startsWith('saved:') ? T.t('taking it…') : T.t('choose a voice'))));
  btn.appendChild(el('span', 'mv3-wk-vpickarrow')).innerHTML = icon('chevron-down', 12);   // Lucide's
  btn.disabled = !!_busy;
  const who = (rec && rec.name) || '';
  hint(btn, (now
    ? (who ? T.t('The voice {name} is read in.', { name: who }) : T.t('The voice the character is read in.'))
    : cur
      ? (rec ? (who ? T.t('The project’s voice - {name} has none of their own.', { name: who }) : T.t('The project’s voice - the character has none of their own.'))
        : T.t('The project’s voice - a character with one of their own will speak in theirs.'))
      : rec ? (who ? T.t('{name} has no voice yet - every line is read in the one chosen here.', { name: who })
        : T.t('This character has no voice yet - every line is read in the one chosen here.'))
        : T.t('No voice yet - choose one: a saved voice, or one from the ElevenLabs library.'))
    + (cur && _sub(cur) ? '\n' + _sub(cur) : '') + '\n' + T.t('Press for the saved voices and the ElevenLabs library.'));
  btn.addEventListener('click', (e) => { e.stopPropagation(); _voiceMenu(btn, api); });
  row.appendChild(btn);
  host.appendChild(row);

  if (mine.length && !now) notes.appendChild(api.note(T.t('None of them is set as the voice - pick one in the menu.'), true));
  // What the sub-level had to say - a voice that could not be taken, or a demo that failed - is said ONCE here, on the way
  // back, and then let go: it is news about what just happened, not a label.
  if (_said) { notes.appendChild(api.note(_said, _bad)); _said = ''; _bad = false; }
  if (_rsaid) notes.appendChild(api.note(_rsaid, _rbad));
}

/** Does the character have a voice to read in? */
export const hasVoice = (rec) => !!_active(rec);
/** Is there a voice to read in at all - the character's, or the project's own pick? The field's
 *  `generate` and every read button wait for one. The server applies the same rule
 *  (routes/scen3.js, _castVoiceOf). */
export const canRead = (api) => hasVoice(api.char()) || !!api.pick();

// THE LIBRARY'S LANGUAGE, BY THE TEXT: the window's language filter starts at the language of
// the script - a voiceover in Russian looks among Russian voices, a talking head (always English) among English ones. Set
// when the window opens for another project than last time; a filter changed by hand stays for that project.
let _langFor = '';
/** The library's language for a script - one rule for the setup and Home's quick start: a talking
 *  head - English; a voiceover by its text - Cyrillic Russian, plain English letters (or no text yet) English, else every
 *  language (''). */
export function scriptLang(voiceover, text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  if (!voiceover) return 'en';
  if (/\p{Script=Cyrillic}/u.test(t)) return 'ru';
  return !t.trim() || !/[^ -~‘’“”–—…]/.test(t) ? 'en' : '';
}
export function languageFor(key, lang) {
  if (_langFor === key) return;
  _langFor = key;
  const want = String(lang == null ? 'en' : lang);   // '' - every language
  if (_q.language === want) return;
  _q.language = want;
  _asked = false;                        // searched again, in that language, as the window opens
  _res = null;
  _page = 1;
}

// ── THE VOICES' MENU ────────────────────────────────────────────────────────
// Under field 1's voice: "ElevenLabs library…" first, then the character's own voices (a talking head with somebody cast), then
// every SAVED voice - the shelf of the voices taken before (lib/voice-shelf.js, the Library's Voices; read once, again after a
// voice is taken) - each a row: ▶ our own demo, the name, its tags. A press on a row chooses it; ▶ only plays. A layer
// (js/layers.js): Escape and a press outside close it.
let _shelf = null;                       // the saved voices, as the Library's shelf lists them - null until read
let _shelfLoading = false;
let _menu = null;                        // { el, layer, away }
function _closeMenu() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.away, true);
  Layers.close(_menu.layer);
  _menu = null;
}
async function _loadShelf() {
  if (_shelfLoading) return;
  _shelfLoading = true;
  _shelfFailed = false;
  try {
    const d = await (await fetch('/api/library/shelf/voices')).json();
    if (!d || !d.success || !Array.isArray(d.items)) throw new Error((d && d.error) || T.t('the app did not answer'));
    _shelf = d.items;
  } catch (e) {
    // Not read is not "No saved voices yet": the menu says it did not load, read again next time (`_shelf` stays null).
    _shelfFailed = true;
    showError(T.t('Could not read the saved voices'), { detail: e.message });
  }
  _shelfLoading = false;
}
const _labelsSub = (L) => _sub({ descriptive: L.descriptive, gender: L.gender, age: L.age, accent: L.accent, language: L.language });

async function _voiceMenu(anchor, api) {
  if (_menu) { _closeMenu(); return; }
  const box = el('div', 'mv3-plus-menu mv3-wk-vmenu u-menu is-float');
  const rec = api.char();
  const mine = _mine(rec);
  const now = _active(rec);
  const pick = api.pick();
  const curId = String((now && now.voiceId) || (!mine.length && pick ? pick.voiceId : '') || '');

  const lib = el('button', 'mv3-plus-item u-mi is-lib');
  lib.type = 'button';
  lib.appendChild(el('span', '', T.t('ElevenLabs library…')));
  lib.appendChild(el('small', '', T.t('thousands of voices - search and listen free, take one')));
  lib.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); api.go('voice'); });
  box.appendChild(lib);

  const row = (src, name, sub, on, isOn, disabled) => {
    const r = el('div', 'mv3-wk-vmrow' + (isOn ? ' is-on' : '') + (disabled ? ' is-off' : ''));
    r.appendChild(_playBtn(src || '', T.t('our own demo')));
    const t = el('div', 'mv3-wk-vtxt');
    t.appendChild(el('div', 'mv3-wk-vname', name));
    if (sub) t.appendChild(el('div', 'mv3-wk-vsub', sub));
    r.appendChild(t);
    if (isOn) r.appendChild(el('span', 'mv3-wk-vtag', T.tc('voices menu', 'The voice')));
    if (!disabled && !isOn) r.addEventListener('click', () => { _closeMenu(); on(); });
    box.appendChild(r);
  };
  if (rec && mine.length) {
    box.appendChild(el('div', 'mv3-sc-menu-sep', rec.name ? T.t('{name}’s voices', { name: rec.name }) : T.t('the character’s voices')));
    for (const v of mine) row(v.sample, v.name || v.voiceId, _sub(v), () => _star(api, v.voiceId), String(v.voiceId) === curId);
  }
  box.appendChild(el('div', 'mv3-sc-menu-sep', T.t('Saved voices')));
  const savedAt = box.childNodes.length;
  if (_shelf === null) _shelfFailed = false;      // read again now: "Reading…" until its answer
  const paintSaved = () => {
    while (box.childNodes.length > savedAt) box.lastChild.remove();
    if (_shelf === null && _shelfFailed) {
      box.appendChild(failedEl(T.t('The saved voices'), async () => {
        _shelfFailed = false;
        paintSaved();
        await _loadShelf();
        if (_menu && _menu.el === box) { paintSaved(); place(); _mark(); }
      }, { line: true, cls: 'mv3-wk-vmnote' }));
      return;
    }
    if (_shelf === null) { box.appendChild(loadingEl(T.t('reading the saved voices…'), { line: true, cls: 'mv3-wk-vmnote' })); return; }
    const have = new Set(mine.map(v => String(v.voiceId)));
    const list = _shelf.filter(it => !have.has(String(it.id)));
    if (!list.length) { box.appendChild(emptyEl(T.t('No saved voices yet - take one from the ElevenLabs library.'), { line: true, cls: 'mv3-wk-vmnote' })); return; }
    for (const it of list) {
      const m = it.meta || {};
      row(it.media, it.name, [_labelsSub(m.labels || {}), m.accountRemoved ? T.t('out of the account - taken back free when chosen') : ''].filter(Boolean).join(' · '),
        () => _useSaved(api, it), String(it.id) === curId);
    }
  };
  paintSaved();

  document.body.appendChild(box);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - box.offsetWidth - 6, r.left))) + 'px';
    const below = window.innerHeight - r.bottom - 10;
    box.style.maxHeight = Math.max(220, Math.min(560, below > 260 ? below : r.top - 10)) + 'px';
    box.style.top = Math.round(below > 260 ? r.bottom + 4 : Math.max(6, r.top - 4 - box.offsetHeight)) + 'px';
  };
  place();
  const away = (e) => { if (!box.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) _closeMenu(); };
  _menu = { el: box, away, layer: Layers.open(box, { modal: false, name: 'voices menu', onEsc: _closeMenu }) };
  document.addEventListener('mousedown', away, true);
  _mark();
  if (_shelf === null) {
    await _loadShelf();
    if (_menu && _menu.el === box) { paintSaved(); place(); _mark(); }
  }
}

// A SAVED VOICE CHOSEN: the project's voice (nobody cast), or the character's - added to their list and made theirs, as a
// voice taken from the library is (_take). One released from the account to free its slot is taken back first - free, the
// same request as a take, our demo kept (routes/scen3.js /scen3/voices/take) - and read by the id ElevenLabs gives back.
async function _useSaved(api, it) {
  if (_busy) return;
  const m = it.meta || {};
  _busy = 'saved:' + it.id;
  _said = ''; _bad = false;
  _repaint(api);
  try {
    let id = String(it.id), sample = it.media || '', dur = +m.dur || 0;
    if (m.accountRemoved) {
      if (!m.publicOwnerId) throw new Error(T.t('it is out of the account and there is no way to take it back - take another'));
      const t = await (await fetch('/api/scen3/voices/take', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: m.publicOwnerId, voiceId: m.sharedVoiceId || it.id, name: it.name }),
      })).json();
      if (!t || !t.success) throw new Error((t && t.error) || T.t('it could not be taken back into the account'));
      id = String(t.voiceId || id);
      sample = t.sample || sample;
      dur = t.dur || dur;
      _shelf = null;                                   // its slot is ours again: read the shelf afresh next time
    }
    const L = m.labels || {};
    const entry = {
      voiceId: id, name: it.name, gender: L.gender || '', age: L.age || '', accent: L.accent || '',
      descriptive: L.descriptive || '', language: L.language || '', sample, dur,
    };
    const rec = api.char();
    if (!rec) await api.setPick(entry);
    else {
      const all = _saved(rec);
      await api.patchChar({ voice: id, voices: all.filter(v => String(v.voiceId) !== id).concat([entry]) });
    }
  } catch (e) {
    _said = T.t('Could not take it: {why}', { why: e.message });
    _bad = true;
  }
  _busy = '';
  _repaint(api);
}

// In its window (openVoices, below) the window's own ✕ closes it - no bar of its own.
export function paintPicker(host, api) {
  const rec = api.char();
  if (_filters === null) { _loadFilters(api); host.appendChild(loadingEl(T.t('reading the filters…'))); return; }

  const mine = _mine(rec);
  const now = String((rec && rec.voice) || '');
  const own = api.pick();

  if (rec) {
    host.appendChild(el('div', 'mv3-wk-vhead', mine.length
      ? (rec.name ? T.t('{name}’s voices', { name: rec.name }) : T.t('This character’s voices'))
      : (rec.name ? T.t('{name} has no voice yet', { name: rec.name }) : T.t('This character has no voice yet'))));
  } else {
    host.appendChild(el('div', 'mv3-wk-vhead', own ? T.t('The project’s voice') : T.t('No voice yet')));
  }
  // The project's own pick, when it is what the reads use: no character, or one without a voice.
  if (own && !mine.length) {
    const row = el('div', 'mv3-wk-vrow is-on');
    row.appendChild(_playBtn(own.sample || '', T.t('our own demo'), true));
    const txt = el('div', 'mv3-wk-vtxt');
    txt.appendChild(el('div', 'mv3-wk-vname', own.name || own.voiceId));
    txt.appendChild(el('div', 'mv3-wk-vsub', _sub(own) || T.t('no tags')));
    row.appendChild(txt);
    row.appendChild(el('span', 'mv3-wk-vtag', T.t('Selected')));
    host.appendChild(row);
    host.appendChild(api.note(rec
      ? (rec.name ? T.t('Every line is read in it until {name} is given a voice of their own.', { name: rec.name })
        : T.t('Every line is read in it until the character is given a voice of their own.'))
      : T.t('Every line is read in it. A character cast with a voice of their own speaks in theirs.')));
  } else if (!rec && !own) {
    host.appendChild(api.note(T.t('Take one from the library below - it becomes the project’s voice. A character cast later with a voice of their own speaks in theirs.')));
  }
  for (const v of mine) {
    const row = el('div', 'mv3-wk-vrow' + (String(v.voiceId) === now ? ' is-on' : ''));
    row.appendChild(_playBtn(v.sample || '', T.t('our own demo'), true));
    const txt = el('div', 'mv3-wk-vtxt');
    txt.appendChild(el('div', 'mv3-wk-vname', v.name || v.voiceId));
    txt.appendChild(el('div', 'mv3-wk-vsub', _sub(v) || T.t('no tags')));
    row.appendChild(txt);
    if (String(v.voiceId) === now) {
      row.appendChild(el('span', 'mv3-wk-vtag', T.t('Selected')));
    } else {
      const use = el('button', 'mv3-wk-vuse u-btn is-s is-quiet', T.t('use'));
      use.type = 'button';
      use.title = T.t('Read every line in this one');
      use.disabled = !!_busy;
      use.addEventListener('click', () => _star(api, v.voiceId));
      row.appendChild(use);
    }
    host.appendChild(row);
  }

  if (_said) host.appendChild(api.note(_said, _bad));

  // ── the library ──
  host.appendChild(el('div', 'mv3-wk-vhead is-lib', T.t('The ElevenLabs library')));
  const f = el('div', 'mv3-wk-vfilters');
  const search = el('input', 'mv3-wk-vsearch u-in is-s');
  search.type = 'search';
  search.placeholder = T.t('a name, or a word from the description');
  search.value = _q.search;
  search.addEventListener('input', () => { _q.search = search.value; });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _search(api, 1); } });
  f.appendChild(search);

  // Each filter's name over its menu.
  const NAMES = { gender: T.t('Gender'), age: T.t('Age'), descriptives: T.t('Style'), use_cases: T.t('Use case'), accent: T.t('Accent'), language: T.t('Language') };
  const pick = (key, label, list) => {
    const cell = el('label', 'mv3-wk-vfcell');
    cell.appendChild(el('span', 'mv3-wk-vfname', NAMES[key] || key));
    const s = el('select', 'mv3-wk-vfilter u-in is-s');
    s.title = label;
    const any = el('option', '', label);
    any.value = '';
    s.appendChild(any);
    for (const it of list) {
      const id = typeof it === 'string' ? it : it.id;
      const o = el('option', '', typeof it === 'string' ? it : it.label);
      o.value = id;
      if (_q[key] === id) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener('change', () => { _q[key] = s.value; _search(api, 1); });
    cell.appendChild(s);
    f.appendChild(cell);
  };
  // What each filter says while nothing is chosen in it; the values themselves are ElevenLabs' words, as they come.
  pick('gender', T.t('any gender'), _filters.genders || []);
  pick('age', T.t('any age'), _filters.ages || []);
  pick('descriptives', T.t('any manner'), _filters.descriptives || []);
  pick('use_cases', T.t('any use'), _filters.useCases || []);
  pick('accent', T.t('any accent'), _filters.accents || []);
  pick('language', T.t('any language'), _filters.languages || []);
  host.appendChild(f);
  // the filters not read: their menus are empty, and the window says so - with Try again
  if (_filtersFailed) host.appendChild(failedEl(T.t('The filters'), () => { _filters = null; _filtersFailed = false; api.repaint(); }, { line: true }));

  const go = el('button', 'mv3-wk-vsearchbtn u-btn is-s', _busy === 'search' ? T.t('searching…') : T.t('search'));
  go.type = 'button';
  go.disabled = !!_busy;
  go.addEventListener('click', () => _search(api, 1));
  const foot = el('div', 'mv3-wk-vfoot');
  foot.appendChild(go);
  host.appendChild(foot);

  // In its window the library is searched the moment it opens - with the
  // filters as they stand - and its pages, 20 voices each, are always at the window's foot (`api.pagerHost`).
  const pagerHost = api.pagerHost || null;
  if (pagerHost) pagerHost.textContent = '';
  if (!_asked && !_busy) { _asked = true; setTimeout(() => _search(api, 1), 0); }
  if (!_asked) {
    host.appendChild(api.note(T.t('The library is thousands of voices. Narrow it with the filters, then search - listening costs nothing.')));
    if (pagerHost) _pager(pagerHost, api);
    return;
  }
  const found = (_res && _res.voices) || [];
  if (!found.length) {
    host.appendChild(_busy === 'search' || (!_res && !_searchFailed) ? loadingEl(T.t('searching…'))
      : _searchFailed ? failedEl(T.t('The search'), () => _search(api, _page))
        : emptyEl(T.t('Nothing matches all of those. Drop a filter.'), { icon: 'search' }));
    if (pagerHost) _pager(pagerHost, api);
    return;
  }
  const have = new Set(mine.map(v => String(v.voiceId)));
  for (const v of found) {
    const row = el('div', 'mv3-wk-vrow');
    row.appendChild(_playBtn(v.preview_url || '', T.t('the owner’s sample'), true));
    const txt = el('div', 'mv3-wk-vtxt');
    txt.appendChild(el('div', 'mv3-wk-vname', v.name || v.voice_id));
    txt.appendChild(el('div', 'mv3-wk-vsub', _sub(v) || T.t('no tags')));
    row.appendChild(txt);
    const take = el('button', 'mv3-wk-vuse u-btn is-s', _busy === 'take:' + v.voice_id ? '…' : T.t('take'));
    take.type = 'button';
    take.title = !rec ? T.t('Add it to the account and make it the project’s voice')
      : have.has(String(v.voice_id))
        ? T.t('This character already has it - taking it again only makes it their voice')
        : T.t('Add it to the account and to this character');
    take.disabled = !!_busy;
    take.addEventListener('click', () => _take(api, v));
    row.appendChild(take);
    host.appendChild(row);
  }
  _pager(pagerHost || host, api);
}

// The pages of the library's search: ‹ "N voices · page k of n" ›. In the window it stands at the foot always - greyed while
// there is nothing to page through yet.
function _pager(host, api) {
  const found = (_res && _res.voices) || [];
  const total = (_res && _res.total) || found.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pager = el('div', 'mv3-wk-vpager');
  const step = (label, to, can) => {
    const b = el('button', 'mv3-wk-vpage u-btn is-s is-icon', label);
    b.type = 'button';
    b.disabled = !can || !!_busy;
    b.addEventListener('click', () => _search(api, to));
    pager.appendChild(b);
  };
  step('‹', _page - 1, !!_res && _page > 1);
  pager.appendChild(el('span', 'mv3-wk-vcount', _busy === 'search' ? T.t('searching…')
    : !_res ? T.t('the ElevenLabs library') : T.t('{n} voices · page {k} of {pages}', { n: total, k: _page, pages })));
  step('›', _page + 1, !!_res && (_page < pages || !!_res.hasMore));
  host.appendChild(pager);
}

// ── What it does ────────────────────────────────────────────────────────────
function _loadFilters(api) {
  if (_filters !== null) return;
  _filters = {};                                  // once, even if it fails: no retry storm
  _filtersFailed = false;
  fetch('/api/scen3/voices/filters').then(r => r.json()).then((d) => {
    _filters = (d && d.success) ? d : {};
    if (!d || !d.success) { _filtersFailed = true; showError(T.t('Could not read the filters'), { detail: (d && d.error) || T.t('refused') }); }
  }).catch((e) => { _filtersFailed = true; showError(T.t('Could not read the filters'), { detail: e.message }); })
    .finally(() => api.repaint());
}

async function _search(api, page) {
  if (_busy) return;
  _busy = 'search';
  _asked = true;
  const was = _page;
  _page = Math.max(1, page || 1);
  _said = ''; _bad = false;
  _repaint(api);
  try {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(_q)) if (String(v || '').trim()) p.set(k, String(v).trim());
    p.set('page', String(_page - 1));             // the API counts from zero
    p.set('page_size', String(PAGE));
    const d = await (await fetch('/api/scen3/voices/library?' + p)).json();
    if (!d || !d.success) throw new Error((d && d.error) || T.t('the library did not answer'));
    _res = { voices: d.voices || [], total: d.total || 0, hasMore: !!d.hasMore };
    _searchFailed = false;
  } catch (e) {
    // said in the corner; the voices found before stay, with none the list says it did not load
    showError(T.t('The search failed'), { detail: e.message });
    if (!(_res && _res.voices && _res.voices.length)) { _res = null; _searchFailed = true; } else _page = was;   // the page shown stays
  }
  _busy = '';
  _repaint(api);
}

// The voice of the character, from one they already have. `voices` is untouched - this says
// only which of them is THE one.
async function _star(api, voiceId) {
  if (_busy || !voiceId) return;
  _busy = 'star';
  _said = ''; _bad = false;
  _repaint(api);
  try {
    await api.patchChar({ voice: String(voiceId) });
  } catch (e) {
    _said = T.t('Could not set the voice: {why}', { why: e.message });
    _bad = true;
  }
  _busy = '';
  _repaint(api);
}

// Taking ADDS the voice to the account - ElevenLabs answers voice_not_found for a library id
// that is not in it - and the account-side id it hands back is the one that goes on the
// character, or on the project when nobody is cast. It becomes the voice straight away: the one
// just chosen on purpose is the one meant to be used.
async function _take(api, card) {
  if (_busy) return;
  _busy = 'take:' + card.voice_id;
  _said = ''; _bad = false;
  _repaint(api);
  try {
    const t = await (await fetch('/api/scen3/voices/take', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: card.public_owner_id, voiceId: card.voice_id, name: card.name }),
    })).json();
    if (!t || !t.success) throw new Error((t && t.error) || T.t('the voice could not be taken'));
    _shelf = null;                                   // it is a saved voice now: field 1's menu reads the shelf afresh

    const rec = api.char();
    const entry = {
      voiceId: t.voiceId, name: t.name || card.name, gender: card.gender || '',
      age: card.age || '', accent: card.accent || '', descriptive: card.descriptive || '',
      language: card.language || '', sample: t.sample || '', dur: t.dur || 0,
    };
    if (!rec) {
      // Nobody cast: the project's own voice (routes/scen3.js, voice.pick).
      await api.setPick(entry);
      // Taken is said by the row itself - the name is there now; only a demo that failed is news.
      _said = t.sampleError ? T.t('Taken. Its demo failed to record, which is cosmetic.') : '';
      _bad = false;
      _busy = '';
      return _repaint(api);
    }
    const all = _saved(rec);
    const had = all.some(v => String(v.voiceId) === String(t.voiceId));
    await api.patchChar({
      voice: t.voiceId,
      voices: all.filter(v => String(v.voiceId) !== String(t.voiceId)).concat([entry]),
    });
    // Three different things can have happened, and a sentence that blurs them sends somebody
    // looking for a second copy that does not exist.
    // The row shows the voice taken; only a demo that failed is said.
    _said = !had && t.sampleError ? T.t('Taken. Its demo failed to record, which is cosmetic.') : '';
    _bad = false;
  } catch (e) {
    _said = T.t('Could not take it: {why}', { why: e.message });
    _bad = true;
  }
  _busy = '';
  _repaint(api);
}

// ── The reads ───────────────────────────────────────────────────────────────
// A take is STALE when the words are no longer the ones that were spoken - the server keeps what
// it said in each take (routes/scen3.js, /scen3/voice/speak) - so nothing has to be marked by
// hand, and editing a line makes its read stale by itself. Unread or stale is the one rule,
// shared with the fragments pane (js/merge-v3/scen-api.js, isRead).
//
// The read is ElevenLabs v3 by the tags of the mood, with the project's stability and
// speed (below). A setting changed after a read does not make the read stale - it is still
// the line's words - it only leaves the line to be redone by the voice field's `generate`.
const _needs = (l) => isLive(l) && !isRead(l);
const _tagged = (l) => !!String((l && l.tagged) || '').trim();

// HOW THE SCRIPT IS SPOKEN: one stability and one speed for the
// video, kept on the project (`voice.ttsParams`, normalised by routes/scen3.js). A take remembers what
// it was spoken with; one that does not say was spoken at natural and 1.
export const params = (p) => {
  const t = ((p && p.voice) || {}).ttsParams || {};
  return { stability: Number.isFinite(+t.stability) ? +t.stability : 0.5, speed: +t.speed || 1 };
};
/** What a READ line was spoken with that the project no longer says: 'stability' (read it again -
 *  ElevenLabs), 'speed' (retimed here, free) or '' - the same rule as the server's _unsettled. */
export const unsettledBy = (p, l) => {
  if (!isLive(l) || !isRead(l)) return '';
  const { take } = takeOf(l);
  const want = params(p);
  const st = take.stability === undefined ? 0.5 : +take.stability;
  if (st !== want.stability) return 'stability';
  return (+take.speed || 1) !== speedOf(p, l) ? 'speed' : '';
};
/** The speed a line is read at: its own, set in its fragment, else the project's. */
export const speedOf = (p, l) => (+(l && l.speed) || params(p).speed);
/** The lines of the video still waiting for their tags - stage 1 (the mood field) is about these. */
export const untagged = (p) => (Array.isArray(p && p.lines) ? p.lines : [])
  .map((l, i) => ((isLive(l) && !_tagged(l)) ? i : -1)).filter(i => i >= 0);
/** Can anything be read at all? Not until the script is marked up: v3 reads the tagged words, and
 *  a line spoken without them is a line spoken in another performance (no silent tagging inside
 *  the read). */
export const canSpeak = (p) => untagged(p).length === 0;

/** What went wrong with the last tagging or read, for the open fragment to say too - a `mood` or a `read`
 *  pressed there failed out of sight, in the fields of the whole video. null when nothing did. */
export const failed = () => (_rsaid && _rbad ? _rsaid : null);

/** What the reads are doing: the tagger at work, the lines being spoken (none, one, or a chunk
 *  of three), and the batch "generate" is walking, if any. */
export const reading = () => ({
  tagging: _tagging, lines: _reading, busy: _tagging || _reading.length > 0 || !!_batch, batch: _batch,
  tagAt: _tagAt, readAt: _readAt,       // when each started, for the field's own progress
});

/** The words of a line, changed - with their [tags] when the line has tags, which the server keeps
 *  as long as the words in them are these words. What the take said stays with the take, which is
 *  what makes the line stale until it is read again - or the words are put back. */
export async function saveText(api, i, text) {
  const raw = String(text || '').trim();
  const words = plainWords(raw);
  if (!words) { _rsaid = T.t('A line cannot be empty.'); _rbad = true; return _repaint(api); }
  const p = api.project() || {};
  const l = (Array.isArray(p.lines) ? p.lines : [])[i];
  _rsaid = ''; _rbad = false;
  _repaint(api);
  try {
    const d = await (await fetch('/api/scen3/projects/' + encodeURIComponent(api.projectId()) + '/line', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_tagged(l) ? { index: i, text: words, tagged: raw } : { index: i, text: words }),
    })).json();
    if (!d || !d.success) throw new Error((d && d.error) || T.t('refused'));
    api.setProject(d.project);
  } catch (e) {
    _rsaid = T.t('Could not save the words: {why}', { why: e.message });
    _rbad = true;
  }
  _repaint(api);
}

// ── The tags ────────────────────────────────────────────────────────────────
// The tagger marks the script up by the mood of the video (routes/scen3.js, /scen3/voice/tag): the
// whole script when nothing is tagged yet - the arc is a property of the sequence - and only the
// lines that lack tags when some are, so what was approved stays as it is. The server switches the
// project to the tagged read as it does.
/**
 * THE MARK-UP, stage 1: the analysis and the tags, on their own. The read is stage 2
 * (markAndRead runs both, one after the other).
 */
export async function tagAll(api) {
  if (_tagging || _reading.length || _batch) return;
  const p = api.project() || {};
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const want = untagged(p);
  if (!want.length) return;
  _tagging = true;
  _tagAt = Date.now();
  _rsaid = ''; _rbad = false;
  _repaint(api);
  try {
    // Nothing tagged yet: the whole script at once, because the mood briefs describe an ARC and a
    // line marked on its own argues with its neighbours. Otherwise only what is missing.
    await _tag(api, want.length === lines.length ? [] : want);
  } catch (e) {
    _rsaid = T.t('The tagging failed: {why}', { why: e.message });
    _rbad = true;
  }
  _tagging = false;
  _tagAt = 0;
  _repaint(api);
}

/**
 * ONE LINE MARKED UP - the `mood` of an open fragment: a line put in between two, or
 * one whose words were changed (a change drops its tags). The tagger marks it by the mood of the video and keeps the arc
 * of the lines around it (routes/scen3.js, /scen3/voice/tag with `only`).
 */
export async function tagLine(api, i) {
  if (_tagging || _reading.length || _batch) return;
  _tagging = true;
  _tagAt = Date.now();
  _rsaid = ''; _rbad = false;
  _repaint(api);
  try {
    await _tag(api, [i]);
  } catch (e) {
    _rsaid = T.t('The tagging failed: {why}', { why: e.message });
    _rbad = true;
  }
  _tagging = false;
  _tagAt = 0;
  _repaint(api);
}

async function _tag(api, only) {
  const body = { projectId: api.projectId(), mood: api.mood() };
  if (only && only.length) body.only = only;
  const d = await (await fetch('/api/scen3/voice/tag', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  if (!d || !d.success) throw new Error((d && d.error) || T.t('the tagging failed'));
  api.setProject(d.project);
  return d.report || {};
}

/**
 * Stage 2, the read: every line that needs reading. It does not tag on the
 * way - that is stage 1, and this refuses to start until it is done.
 */
export async function generate(api) {
  if (_tagging || _reading.length || _batch) return;
  if (!canSpeak(api.project() || {})) {
    _rsaid = T.t('The script is not marked up yet - field 1, mood & voice, does that.');
    _rbad = true;
    return _repaint(api);
  }
  // ...and the lines read with other settings: read again for another stability, retimed
  // for another speed. Only here - the chain reads only what is not read.
  await readAll(api, { settle: true });
}

/**
 * THE ONE `generate` of the field "mood & voice": the script marked up by
 * the mood when any line of the video has no [tags], then every line that needs it read - the two stages, one after the
 * other. A mark-up that fails stops here, said in words, and nothing is read.
 */
export async function markAndRead(api) {
  if (_tagging || _reading.length || _batch) return;
  if (untagged(api.project() || {}).length) {
    await tagAll(api);
    if (_rbad || untagged(api.project() || {}).length) return;
  }
  await generate(api);
}

// A chunk of lines, spoken now in one call - tagged first where they have no tags yet, because
// every read is v3 with tags. The server speaks them together, writes their takes into the
// project itself and answers with the project as it now stands - which is what the panel paints
// from. `inBatch` is how "generate" gets past the guard that stops a second read starting on top
// of one already running: the batch IS that runner, and without it its first chunk refuses
// itself. A stray click cannot get in this way - the buttons are disabled while a batch runs.
async function _speak(api, lines, inBatch) {
  if (_reading.length || (_batch && !inBatch)) return false;
  // Tagging is stage 1 and nothing else does it: a line read without its tags would not match
  // the lines around it.
  const some = Array.isArray(api.project() && api.project().lines) ? api.project().lines : [];
  if (lines.some(i => some[i] && !_tagged(some[i]))) {
    _rsaid = T.t('This line has no tags yet - mark the script up first, in field 1, mood & voice.');
    _rbad = true;
    _repaint(api);
    return false;
  }
  _reading = lines.slice();
  if (!_readAt) _readAt = Date.now();
  _rsaid = ''; _rbad = false;
  _repaint(api);
  let ok = false;
  try {
    const d = await (await fetch('/api/scen3/voice/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: api.projectId(), only: lines }),
    })).json();
    if (!d || !d.success) throw new Error((d && d.error) || T.t('refused'));
    api.setProject(d.project);
    const bad = ((d.report || {}).failed || []);
    if (bad.length) {
      const why = bad[0].error || T.t('not read');
      throw new Error(bad.length === 1 ? T.t('line {n} - {why}', { n: bad[0].line, why })
        : T.t('lines {list} - {why}', { list: bad.map(b => b.line).join(', '), why }));
    }
    ok = true;
  } catch (e) {
    _rsaid = lines.length === 1 ? T.t('Line {n} was not read: {why}', { n: lines[0] + 1, why: e.message })
      : T.t('Not read: {why}', { why: e.message });
    _rbad = true;
  }
  _reading = [];
  if (!_batch) _readAt = 0;
  _repaint(api);
  return ok;
}

/** One line, spoken now - from the open fragment's own button. */
export const readLine = (api, i) => _speak(api, [i], false);

// EVERY LINE THAT NEEDS IT, READ BY THE SERVER, so the run does not belong to the page: walking
// away from it leaves nothing unread. One call hands the whole list
// over (routes/scen3.js, /scen3/voice/speak-all), the server starts a line a second without waiting
// for the ones already going, and this only WATCHES - bringing the takes in as they land, so the
// script fills in under the pointer. Closing the app still stops it; what was already spoken stays.
const _wait = (ms) => new Promise(r => setTimeout(r, ms));
const WATCH_MS = 1500;

export async function readAll(api, opts) {
  const p = api.project() || {};
  const settle = !!(opts && opts.settle);
  const want = (Array.isArray(p.lines) ? p.lines : [])
    .map((l, i) => (_needs(l) || (settle && unsettledBy(p, l)) ? i : -1)).filter(i => i >= 0);
  if (!want.length) return;
  _batch = { done: 0, total: want.length };
  _readAt = Date.now();
  _rsaid = ''; _rbad = false;
  _repaint(api);
  try {
    const d = await (await fetch('/api/scen3/voice/speak-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: api.projectId(), ...(settle ? { settle: true } : {}) }),
    })).json();
    if (!d || !d.success) throw new Error((d && d.error) || T.t('refused'));
    if (d.queued) _batch = { done: 0, total: d.queued };
    _repaint(api);
    await _watchRead(api);
  } catch (e) {
    _rsaid = T.t('Not read: {why}', { why: e.message });
    _rbad = true;
  }
  _batch = null;
  _readAt = 0;
  _repaint(api);
}

// A read already going when the panel opened - started before a reload, or from another tab. The
// server owns it, so there is always something to come back to.
let _lookedRead = '';
export async function pickUpRead(api) {
  const id = api.projectId();
  if (!id || _lookedRead === id) return;
  _lookedRead = id;
  try {
    const d = await (await fetch('/api/scen3/voice/state?projectId=' + encodeURIComponent(api.projectId()))).json();
    const st = d && d.state;
    if (!st || !st.running || _batch) return;
    _batch = { done: st.done + st.skipped.length, total: st.total };
    _repaint(api);
    await _watchRead(api);
    _batch = null;
    _repaint(api);
  } catch (e) { /* without the state, nothing shows as running */ }
}

// Watch the server read, until it says it has stopped. A reading that fails is not the read failing
// - the next one asks again - so it is skipped rather than thrown.
async function _watchRead(api) {
  for (let k = 0; k < 1200; k++) {
    await _wait(WATCH_MS);
    let st = null;
    try {
      const d = await (await fetch('/api/scen3/voice/state?projectId=' + encodeURIComponent(api.projectId()))).json();
      st = d && d.state;
    } catch (e) { continue; }
    if (!st) return;
    _batch = { done: st.done + st.skipped.length, total: st.total };
    if (api.reload) { try { await api.reload(); } catch (e) { /* the next tick tries again */ } }
    _repaint(api);
    if (st.running) continue;
    const bad = st.failed || [];
    if (bad.length) {
      const why = bad[0].error || T.t('refused');
      _rsaid = bad.length === 1 ? T.t('Line {n} not read: {why}', { n: bad[0].line, why })
        : T.tn(bad.length, '{n} line not read: {why}', '{n} lines not read: {why}', { why });
      _rbad = true;
    }
    return;
  }
}

/** Coming back to the hub leaves the search behind, but not what was said about the last take. */
export function leave() {
  if (_audio) { _audio.pause(); _playing = ''; }
}

// ── THE VOICES, A WINDOW ──
// The saved voices and the ElevenLabs library with its filters and its search (paintPicker) in a window of js/gen-window.js -
// field 1's menu opens it ("ElevenLabs library…"); it stays open after a voice is taken and is painted again when its host
// repaints, where it was scrolled to. ONE window for the setup (js/merge-v3/wk-setup.js) and Home's voiceover
// quick start (js/home/start.js). `o.key` - whose window it is (the project, the popup), `o.lang`
// - the library's language for it (languageFor).
let _vwin = null;                        // { win, api }
export const voicesOpen = () => !!(_vwin && _vwin.win.alive());
export function openVoices(api, o = {}) {
  if (voicesOpen()) { paintVoices(api); return _vwin.win; }
  if (!allow('voices')) return null;
  languageFor(String(o.key || ''), o.lang);
  // Moved and stretched; its size kept.
  const win = GW.openFrame({
    name: 'voices', size: { w: 900, h: 660 }, geom: { key: 'voices', resize: true, move: true, keepSize: true },
    onClose: () => { if (_vwin && _vwin.win === win) _vwin = null; leave(); },
  });
  win.setCrumbs([{ label: T.t('Voices') }]);
  _vwin = { win, api };
  paintVoices();
  return win;
}
/** Painted again - with the host's api now (`api`, when given). What scrolls is the list above the foot; the foot - the
 *  library's pages - stays at the window's bottom. */
export function paintVoices(api) {
  if (!voicesOpen()) return;
  if (api) _vwin.api = api;
  const body = _vwin.win.body;
  const was = body.querySelector('.mv3-wk-vwin');
  const at = was ? was.scrollTop : 0;
  body.textContent = '';
  const box = el('div', 'mv3-wk-vwin');
  const foot = el('div', 'mv3-wk-vwinfoot');
  body.append(box, foot);
  paintPicker(box, { ..._vwin.api, pagerHost: foot });
  if (at) box.scrollTop = at;
}
export function closeVoices() {
  if (voicesOpen()) _vwin.win.close();
  _vwin = null;
}
