/* ═══════════════════════════════════════════════════════════════════════════
   THE SOUND WINDOW - ONE window for music and sounds, the same on both pages: the Library's AUDIO -> "generate"
   (and Music's "Generate music") and Merge's AUDIO -> "generate", the lane's "Video to Music…", ?open=audio. Merge's
   adapter is js/merge-v3/sound-host.js. A generation's window (js/gen-window.js, GEN_SIZE 1280×800):

     head     the engine and the MODE - "Suno · Simple · background, no vocals" - and a "?" right of it: how the mode works
     left     MUSIC | SOUNDS - the switch on top; under it the mode of that group (Music: Simple, Custom, Lyrics, From a
              description - ElevenLabs, Video to Music - ElevenLabs; Sounds: Sounds - Suno, Sound effects - ElevenLabs), the
              model, "Length [46] s" in one line (Merge: "· by the video"), the folded chips; every row's name has its "?".
              Its width is the person's - the sash right of it, remembered (`lib_music_sash_v1`)
     right    the gold card - the mode's fields (Simple, Custom, Lyrics - js/sound/suno-form.js; the other four here) -, and
              under it: in Merge the OPEN PROJECT's presses ("this project · N", a card each - its tracks played, ★, "show",
              dragged onto a lane); in the Library in Lyrics the texts, a row each. Video to Music has the VIDEO tree beside
              it (a press puts a video into "The video"; in Merge a clip of the timeline comes by its right button)
     foot     ALMANAC, the line of the last press ("in Alerts · …"), where it goes ("into Music → Pop"), the price, "generate"

   It opens on Music → Simple - unless it is opened for something: a clip for Video to Music, a text for Custom. The
   window stays open after "generate"; the press is the server's at once (routes/audio-gen.js, lib/audio-gens.js - its record
   and its Alerts row), and the page follows it. WHERE IT GOES: sounds - SFX → My sounds → Generated; music in Merge - Music's
   root (a clip's track also under its clip); music in the Library - the folder under Music open there (`into`), a mood
   folder of highlights - Simple makes that mood's preset, Custom goes into highlights' root, and there only
   Simple and Custom of Music are offered.

   The page says how it works through a HOST (configure(h)) - Merge's (js/merge-v3/sound-host.js) and the Library's
   (js/library/main.js):
     page, view       where the Alerts row says it was started ('merge', 'audio' | 'library', 'musicmake')
     store            the browser's key of the form's state
     key()            the open project's key ('' - none: the Library); a press is the project's
     title()          its name, for the card's head ('' - none yet)
     writerKind()     Simple's writer told the project's kind ('blank' when none)
     videoSecs()      the video's length for "by the video" (0 - none)
     clipNow(clip)    a timeline's clip in "The video" as it is now { live, gone, name, start, dur, thumb, lane } (Merge)
     flush(clip)      -> Promise<boolean>: the timeline saved before the server reads the clip from it (Merge)
     where(dest, label) -> the Alerts row's place { page, href, label, spot }
     laneName(name)   a lane's stored name in the interface's language (Merge) - the lane a track was laid on
     made             true - the project's presses as cards under the card (Merge)
     showFile(path)   "show" on a result - where it lies
     drag             { type, media, refuse(el, ev) } - a result dragged onto a lane (Merge)
     onLanded(gen, dest)   a press of this page landed (open or closed)
     onSaved()        a text saved into Music → Lyrics
     soundsNode()     the Library: the tree's key of SFX → My sounds → Generated (where the Alerts row of a sound leads)

     configure(host)   the page's host - once, as it starts
     open(o)           o: { mode, clip, lyric { title, text }, place() -> the Library's folder open { key, cat, folder, label,
                       trail }, anchor } - the window, or the one open already (fitted to `o`)
     follow()          the presses of this page still being made (a reload, the window closed) followed to their end
     shown()           the window open now, or null
     projectChanged()  Merge: another project opened - its presses read again
   ═══════════════════════════════════════════════════════════════════════════ */

import { openFrame, GEN_SIZE, GEOM_CHAT } from '../gen-window.js';
import { createTree, setMediaDrag } from '../media-tree.js';
import { waveEl, secs } from './wave.js';
import { createSunoForm, el, api, post, ls, lsSet, copyText, titleOf, qmark, withQ, closeQ, modeRowHelp, MODEL_ROW_HELP } from './suno-form.js';
import { ask } from '../ask.js';
import { showError } from '../notice.js';
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';
import { allow } from '../key-gate.js';
import * as T from '../i18n/t.js';

// ── the modes, in two groups ──────────────────────────────────────────────────
const GROUPS = { music: ['simple', 'custom', 'lyrics', 'compose', 'video'], sounds: ['sounds', 'sfx'] };
const GROUP_WORD = { music: T.t('Music'), sounds: T.t('Sounds') };
const groupOf = (mode) => (GROUPS.sounds.includes(mode) ? 'sounds' : 'music');
// Simple, Custom and Lyrics say what they are in js/sound/suno-form.js (modeHelp); these are the other four's.
const MODE_HELP = {
  sounds: T.t('A sound or a loop by Suno, from a description. It goes to SFX → My sounds → Generated.'),
  compose: T.t('Music by ElevenLabs from a description - instrumental unless you untick it. The chips add their words. It goes to AUDIO → Music.'),
  video: T.t('Music made FOR a video: ElevenLabs watches it (cuts, pace, mood) and scores it. Press a video in the VIDEO folders on the right - in Merge also a clip of the timeline by its right button, and the track is laid under that clip too. Say what you want if you like. It goes to AUDIO → Music.'),
  sfx: T.t('A sound effect by ElevenLabs, from a description - up to 30 s, or the length it picks. It goes to SFX → My sounds → Generated.'),
};
const GROUP_HELP = T.t('Music - Simple, Custom and Lyrics by Suno; music from a description and Video to Music by ElevenLabs.\nSounds - a sound or a loop by Suno; sound effects by ElevenLabs.');
const LOOP = T.t('The end joins the start, so it can be laid again and again with no seam.');
const KEY_SASH = 'lib_music_sash_v1';
const SET_W = 260, SET_MIN = 200, SET_MAX = 460, RIGHT_MIN = 480;
const LYR_MAX = 12;
const V2M_MAX = 600;
const SOUNDS_HOME = T.t('SFX → My sounds → Generated');

let H = null;              // the page's host
let F = null;              // the form - made at the first open, kept for the page
let _win = null;           // the window, while it is open
let _ui = null;            // its parts
let _o = {};               // this opening's: place, anchor
let _going = false;
const _runs = new Map();   // id -> { gen, dest } - this page's presses being followed
let _last = null;          // { gen, dest } - the last press: its line in the foot
let _err = '';             // the last press refused before it started - said in the foot until the next one
let _lyricGens = [];       // the Library's Lyrics records that wrote texts, newest first
const _rowOpen = new Map(); // a text's row the person opened or folded: `<gen>:<i>` -> true / false
let _looked = false;
let _timer = 0;
let _rest = '';            // the Library: the music mode remembered for the folders that are not a mood's
let _groupShown = '';      // the group the switch last showed - its thumb slides from there
let _placeKey = null;      // the Library: the folder the window was last fitted to
// Merge: the open project's presses (`made`)
let GENS = [];
let LIBIDX = new Map();    // path -> the shelf's item (its wave, star, id, name)
let _pTimer = 0;
let _pKey = null;

const S = () => F.S;
const _cat = () => (F ? F.cat() : null);
const _mode = () => (_cat() ? _cat().modes.find(x => x.id === S().mode) : null);
const _engineOf = (id) => ((_cat() && _cat().modes.find(x => x.id === id)) || {}).engine || 'suno';
// A mode's name as it is shown: the catalog's English label (lib/audio-engines.js MODES) in the interface's language.
const _modeName = (id) => { const m = _cat() && _cat().modes.find(x => x.id === id); return m ? T.t(m.label) : id; };
const _hook = (name, ...a) => (H && typeof H[name] === 'function' ? H[name](...a) : undefined);
// A lane's stored name as it is shown - the host's word for it when it has one.
const _lane = (name) => String(_hook('laneName', name) || name || '');
const _place = () => (typeof _o.place === 'function' ? _o.place() : null) || null;
const _key = () => String(_hook('key') || '');

// The Library's window on a mood folder (Music → highlights → <mood>) - its id, '' for any other folder.
function _moodOpen() {
  const p = _place();
  const m = /^music:highlights:(.+)$/.exec(String((p && p.key) || ''));
  return m && F && F.moods().some(x => x.id === m[1]) ? m[1] : '';
}
// The modes offered: a group's - on a mood folder Music is Simple and Custom only.
function _modes(group) {
  const g = group || groupOf(S().mode);
  return g === 'music' && _moodOpen() ? ['simple', 'custom'] : GROUPS[g];
}

/** The page's host - once, as it starts. */
export function configure(host) { H = host || null; }

function _form() {
  if (F) return F;
  F = createSunoForm({
    store: (H && H.store) || 'sound_window_v1', title: T.t('Generate audio'),
    base: { mode: 'simple', model: 'V6', lastMode: { music: 'simple', sounds: 'sounds' } },
    fields: {
      sounds: { prompt: '', loop: false, tempo: 0, key: 'Any' },
      compose: { prompt: '', seconds: 30, instrumental: true },
      // `clip` - a clip of a timeline { key, trackId, clipId, name, start, dur, thumb } in place of a file; `dur` - the
      // file's length when it is known (the price).
      video: { video: '', name: '', thumb: '', dur: 0, clip: null, description: '', tags: '', sfx: false, useAudio: false },
      sfx: { prompt: '', seconds: 0, loop: false, influence: 0.3 },
    },
    mood: () => _moodOpen(),
    lyricsOff: () => !!_moodOpen(),
    persist: (st) => ({ mode: _moodOpen() ? (_rest || 'simple') : st.mode, model: st.model, lastMode: st.lastMode, f: st.f }),
    say: (t, bad) => _say(t, bad),
    paintCol: () => paintCol(),
    paintMake: () => paintMake(),
    paintMakePrice: () => paintFoot(),
    setMode: (id, how) => setMode(id, how),
    videoSecs: () => +_hook('videoSecs') || 0,
    onSaved: () => { _hook('onSaved'); if (_ui && S().mode === 'lyrics') paintMake(); },
    // Without a video the length is said in seconds.
    lengthNote: (mode) => (+_hook('videoSecs') > 0 ? '' : mode === 'simple' ? T.t('up to 360 s - the bed comes out a little longer') : mode === 'custom' ? T.t('10–360 s') : ''),
    priceOf: (mode, p) => {
      if (mode !== 'video' || !p.usdPerMin) return null;
      const sec = _v2m().dur;
      return sec ? { big: '≈ $' + (p.usdPerMin * sec / 60).toFixed(3), small: T.t('{length} of music, as long as the video · ElevenLabs', { length: secs(sec) }) }
        : { big: T.t('≈ ${n}/min', { n: p.usdPerMin }), small: T.t('of music, as long as the video') };
    },
  });
  const st = F.S;
  if (!st.lastMode || typeof st.lastMode !== 'object') st.lastMode = { music: 'simple', sounds: 'sounds' };
  if (![...GROUPS.music, ...GROUPS.sounds].includes(st.mode)) st.mode = 'simple';
  _rest = st.mode;
  return F;
}

// ── the mode ──────────────────────────────────────────────────────────────────
function setMode(id, how) {
  if (!_modes(groupOf(id)).includes(id)) return;
  // Custom picked while the mood's card is in "edit": its Style and Exclude go with it.
  const carried = id === 'custom' && how === 'pick' && F.carryEdit();
  S().mode = id;
  S().lastMode[groupOf(id)] = id;
  if (!_moodOpen()) _rest = id;
  F.save();
  _err = '';
  paint();
  if (carried) _say(T.t('The mood\'s Style and Exclude are in Custom - its tracks go into Music → highlights.'));
}
function setGroup(g) {
  if (groupOf(S().mode) === g) return;
  const was = S().lastMode[g];
  setMode(_modes(g).includes(was) ? was : _modes(g)[0]);
}
// The Library: the mode fitted to the folder it opens on - a mood's: Simple; another: the one remembered for them.
function _fitMode() {
  const p = _place();
  const key = String((p && p.key) || '');
  if (key === _placeKey) return;
  _placeKey = key;
  if (_moodOpen() && groupOf(S().mode) === 'music' && !_modes('music').includes(S().mode)) S().mode = 'simple';
}

function paint() {
  if (!_ui) return;
  paintHead();
  paintCol();
  paintMake();
  paintFoot();
  _side();
}

// The line over the card says how the work goes and goes quiet after 9 s. An error (`bad`) - a refusal of
// the tree, a file that will not play, a press that failed, the form's "Not saved" - is a popup in the corner instead
// (js/notice.js), and the line goes quiet.
let _sayT = 0;
function _say(text, bad) {
  if (bad) { showError(text); text = ''; }
  if (!_ui) return;
  const s = _ui.status;
  s.textContent = text || '';
  s.hidden = !text;
  clearTimeout(_sayT);
  if (text) _sayT = setTimeout(() => { if (s.textContent === text) { s.textContent = ''; s.hidden = true; } }, 9000);
}

// ── where it goes ─────────────────────────────────────────────────────────────
// { node: the Library tree's key of the folder it lies in, into: the folder's id for the server ('' - Music's root),
//   label: its path in words, note: why it is not the folder open, sound: SFX, clip: Music's root and under its clip }
function _dest() {
  const mode = S().mode;
  const p = _place();
  if (mode === 'lyrics') return { node: p && p.key ? p.key : 'music', into: '', label: '' };
  // The Library's tree key of SFX → My sounds → Generated (the host's `soundsNode`), where the server files every sound made.
  if (groupOf(mode) === 'sounds') return { node: String(_hook('soundsNode') || 'sounds'), into: '', label: SOUNDS_HOME, sound: true };
  if (!p) {
    const clip = mode === 'video' && S().f.video.clip;
    return { node: 'music', into: '', label: T.t('Music'), clip: !!clip };
  }
  const key = String(p.key || '');
  const hl = /^music:highlights(:|$)/.test(key) || p.folder === 'highlights';
  const lyr = key === 'music:lyrics';
  if (p.cat && !hl && !lyr) return { node: key, into: p.cat, label: T.t('Music → {place}', { place: p.trail || p.label }) };
  // A mood folder open: Simple makes its mood, and the server files the tracks there.
  const mood = F.preset();
  if (mood) return { node: key, into: '', label: T.t('Music → highlights → {mood}', { mood: T.tc('mood', mood.label) }) };
  // Custom on a mood folder: into highlights itself - the mood folder keeps only what its preset made.
  if (_moodOpen()) return { node: 'music:highlights', into: 'highlights', label: T.t('Music → highlights') };
  return { node: 'music', into: '', label: T.t('Music'),
    note: hl ? T.t('highlights takes only a mood\'s preset - open a mood\'s folder') : lyr ? T.t('Lyrics holds texts only') : '' };
}

// ── the head: the engine, the mode, its "?" ───────────────────────────────────
const _engineWord = (mode) => (_engineOf(mode) === 'eleven' ? 'ElevenLabs' : 'Suno');
function _helpText() {
  const d = _dest();
  return F.helpText(T.t('AUDIO → {place}', { place: d.label || T.t('Music') })) || MODE_HELP[S().mode] || '';
}
function paintHead() {
  if (!_win || !_win.alive()) return;
  closeQ();
  const m = _mode();
  const name = _engineWord(S().mode) + ' · ' + (m ? T.t(m.label) : T.t('music'));
  _win.setCrumbs([{ label: name }]);
  _win.crumbs.appendChild(qmark(() => _helpText(), { title: name }));
}

// ── the settings column ───────────────────────────────────────────────────────
function paintCol() {
  if (!_ui || !_cat()) return;
  const CAT = _cat();
  const col = _ui.col;
  col.textContent = '';
  const row = (label, body, help, warn) => {
    const r = el('div', 'mv3-ig-row');
    if (label) r.appendChild(withQ(el('label', null, label), help));
    r.appendChild(body);
    if (warn) r.appendChild(el('div', 'au-note', warn));
    col.appendChild(r);
    return r;
  };
  // MUSIC | SOUNDS: over the mode. A pill with a thumb that slides under the group chosen (css/sound-window.css .au-switch) - drawn
  // where it was, then moved, so the column painted again still shows the slide.
  const g = groupOf(S().mode);
  // the shared segment (css/app-shell.css .u-seg): the group lit is the selected look
  const seg = el('div', 'au-switch u-seg');
  seg.dataset.on = _groupShown || g;
  for (const k of ['music', 'sounds']) {
    const b = el('button', 'au-switch-b' + (g === k ? ' on is-on' : ''), GROUP_WORD[k]);
    b.type = 'button';
    b.setAttribute('aria-pressed', g === k ? 'true' : 'false');
    b.addEventListener('click', () => setGroup(k));
    seg.appendChild(b);
  }
  if (seg.dataset.on !== g) requestAnimationFrame(() => { seg.dataset.on = g; });
  _groupShown = g;
  const swRow = el('div', 'au-switch-row');
  swRow.appendChild(seg);
  row('', withQ(swRow, GROUP_HELP));
  const modes = CAT.modes.filter(m => _modes(g).includes(m.id)).sort((a, b) => _modes(g).indexOf(a.id) - _modes(g).indexOf(b.id));
  const eng = _engineOf(S().mode);
  // A missing key stays in words: it is why nothing would come.
  const noKey = !CAT.fake && CAT.keys && !CAT.keys[eng === 'eleven' ? 'eleven' : 'kie'];
  row(T.t('Mode'), F.modeSelect(modes.map(m => Object.assign({}, m, { label: (m.engine === 'eleven' ? 'ElevenLabs · ' : '') + T.t(m.label) }))),
    modeRowHelp(modes), noKey ? T.t('No {name} key - add it on Admin → API keys.', { name: eng === 'eleven' ? 'ElevenLabs' : 'kie.ai' }) : '');
  if (eng === 'suno' && S().mode !== 'lyrics') row(T.t('Model'), F.modelSelect(), MODEL_ROW_HELP);
  else if (eng === 'eleven') {
    row(T.t('Model'), el('div', 'au-val', S().mode === 'sfx' ? 'eleven_text_to_sound_v2' : S().mode === 'compose' ? 'music_v2_5 (Eleven Music)' : 'Eleven Music'),
      T.t('ElevenLabs has one model for each mode - nothing to choose.'));
  }
  F.lengthRows(row);
  F.chipRows(col);
}

// ── the right column: the gold card, and what is under it ─────────────────────
const _field = (label, input, opts) => F.field(label, input, opts);
const _text = (obj, key, opts) => F.text(obj, key, opts);
const _check = (obj, key, label, after, help) => F.check(obj, key, label, after, help);
const _knob = (obj, key, label, min, max, step, hint) => F.knob(obj, key, label, min, max, step, hint);

function paintMake() {
  if (!_ui || !_cat()) return;
  const host = _ui.make;
  host.textContent = '';
  const m = _mode();
  if (!m) return;
  // the gold card is a panel: its head the mode's name in gold (the generator's place), whom it is for after it
  const card = el('div', 'au-card');
  const title = H && H.made ? String(_hook('title') || '') : '';
  const h = el('div', 'au-card-h');
  h.appendChild(el('span', 'au-card-n', _engineWord(S().mode) + ' · ' + T.t(m.label)));
  // Merge: the project it is for - by its name, or "this project" while it has none.
  if (H && H.made) h.appendChild(el('span', 'au-muted', title ? T.t('for {name}', { name: title }) : T.t('for this project')));
  card.appendChild(h);
  const f = S().f[S().mode];
  // The examples in the fields an engine reads as they are stay in English - the engines are best spoken to in English.
  if (F.paintFields(card)) { /* Simple, Custom, Lyrics - the shared form's */ } else if (S().mode === 'sounds') {
    card.appendChild(_field(T.t('The sound'), _text(f, 'prompt', { area: true, rows: 3, placeholder: T.t('e.g. {example}', { example: 'a soft camera shutter click with a short mechanical whir' }) }),
      { max: 500, help: T.t('What the sound is, as a sound designer says it - the source, the action, the material; a loop with its tempo and key. Up to 500 characters.') }));
    const r2 = el('div', 'au-row2');
    const tempo = el('input', 'au-in u-in');
    tempo.type = 'number'; tempo.min = '0'; tempo.max = '300'; tempo.placeholder = T.t('auto');
    tempo.value = f.tempo ? String(f.tempo) : '';
    tempo.addEventListener('change', () => { f.tempo = Math.max(0, Math.min(300, Math.round(+tempo.value || 0))); F.save(); });
    r2.appendChild(_field(T.t('Tempo'), tempo, { help: T.t('Beats per minute, for a loop. Empty - Suno\'s own.') }));
    const key = el('select', 'au-sel u-in');
    // 'Any' is said in the interface's language; the keys themselves are music's own names.
    for (const k of (_cat().soundKeys || ['Any'])) { const op = el('option', null, k === 'Any' ? T.t('Any') : k); op.value = k; key.appendChild(op); }
    key.value = f.key || 'Any';
    key.addEventListener('change', () => { f.key = key.value; F.save(); });
    r2.appendChild(_field(T.t('Key'), key, { help: T.t('The key of a musical loop. Any - Suno\'s own.') }));
    card.appendChild(r2);
    card.appendChild(_check(f, 'loop', T.t('a seamless loop'), null, LOOP));
  } else if (S().mode === 'compose') {
    card.appendChild(_field(T.t('The music'), _text(f, 'prompt', { area: true, rows: 4, placeholder: T.t('e.g. {example}', { example: 'calm lo-fi with soft piano and vinyl crackle, steady, nothing that jumps out - under a voiceover' }) }),
      { max: 4100, help: T.t('In sentences: what it is for first, then the genre, the instruments, the tempo, the key and its shape. "no …" is honoured here. A chip on the left adds its words. Up to 4100 characters.') }));
    card.appendChild(_check(f, 'instrumental', T.t('instrumental'), null, T.t('No voice. Off - ElevenLabs may sing.')));
  } else if (S().mode === 'video') {
    card.appendChild(_field(T.t('The video'), _attachment(f), { help: H && H.clipNow
      ? T.t('The video ElevenLabs scores: a press on a video in the VIDEO folders on the right, a clip of the timeline by its right button (its track is then laid under it), "from this computer…" or a file let go here. Up to 10 minutes and 200 MB.')
      : T.t('The video ElevenLabs scores: a press on a video in the VIDEO folders on the right, "from this computer…" or a file let go here. Up to 10 minutes and 200 MB.') }));
    card.appendChild(_field(T.t('What you want'), _text(f, 'description', { area: true, rows: 3, placeholder: T.t('optional - e.g. {example}', { example: 'upbeat and modern, builds to the reveal at the end' }) }),
      { max: 4100, help: T.t('Optional - the feel, where it builds, what to keep out. Up to 4100 characters.') }));
    card.appendChild(_field(T.t('Tags'), _text(f, 'tags', { placeholder: 'upbeat, cinematic' }), { help: T.t('Up to 10 words, by commas - upbeat, cinematic…') }));
    card.appendChild(_check(f, 'sfx', T.t('add sound effects'), null, T.t('ElevenLabs adds sound effects from what happens in the video.')));
    card.appendChild(_check(f, 'useAudio', T.t('use the video\'s own sound'), null, T.t('The video\'s own sound is taken as a reference - its genre, tempo and mood.')));
  } else if (S().mode === 'sfx') {
    card.appendChild(_field(T.t('The sound'), _text(f, 'prompt', { area: true, rows: 3, placeholder: T.t('e.g. {example}', { example: 'a quick airy whoosh, left to right' }) }),
      { max: 1000, help: T.t('The source, the action, the material, the space, the distance, how it starts and ends. Up to 1000 characters; the length on the left (0.5–30 s) or its own.') }));
    const inf = el('div');
    inf.appendChild(_knob(f, 'influence', T.t('follow the words'), 0, 1, 0.05, T.t('Higher - closer to the description, less varied.')));
    card.appendChild(_field('', inf));
    card.appendChild(_check(f, 'loop', T.t('a seamless loop'), null, LOOP));
  }
  host.appendChild(card);
  // Merge: the open project's presses; the Library: in Lyrics, the texts.
  if (H && H.made) host.appendChild(_madeBox());
  else if (S().mode === 'lyrics') host.appendChild(_lyricsList());
}

// ── Video to Music's video ────────────────────────────────────────────────────
// ONE CLIP of a timeline (Merge, its right button) or a FILE (a press in the VIDEO tree on the right, "from this computer…", a
// file let go on the field). A clip is shown as it is NOW on the open timeline (the host's clipNow).
function _v2m() {
  const f = S().f.video;
  const c = f.clip;
  if (c) {
    const n = _hook('clipNow', c);
    if (!n) return { clip: c, gone: false, name: c.name || 'clip', start: +c.start || 0, dur: Math.round((+c.dur || 0) * 10) / 10, thumb: c.thumb || '', lane: '' };
    return Object.assign({ clip: c }, n);
  }
  return { name: f.name || '', dur: +f.dur || 0, thumb: f.thumb || '', gone: false };
}
const _clock = (t) => { const s = Math.max(0, +t || 0); return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
const _usd = (s) => '≈ $' + (0.15 * (+s || 0) / 60).toFixed(3);
let _attPaint = null;      // the field of the video, painted again when the timeline changes under its clip
function _attachment(f) {
  const att = el('div', 'au-att');
  const paint = () => {
    att.textContent = '';
    const v = _v2m();
    if (f.clip || f.video) {
      if (v.thumb) { const im = el('img'); im.src = v.thumb; att.appendChild(im); } else att.appendChild(el('div', 'au-att-ph'));
      const tx = el('div', 'au-att-tx');
      // a clip with no name of its own is sent as 'clip' and shown in the interface's words
      tx.appendChild(el('b', null, f.clip ? (v.name === 'clip' ? T.t('clip') : v.name) : (f.name || f.video.split('/').pop())));
      if (f.clip) {
        const at = { from: _clock(v.start), to: _clock(v.start + v.dur), length: secs(v.dur) };
        tx.appendChild(el('span', 'au-muted', v.lane ? T.t('a clip of {lane} · {from} – {to} · {length}', Object.assign({ lane: v.lane }, at))
          : T.t('a clip · {from} – {to} · {length}', at)));
        if (v.gone) tx.appendChild(el('span', 'au-err', T.t('Not on the timeline any more - press a clip with the right button again.')));
        else if (v.dur > V2M_MAX) tx.appendChild(el('span', 'au-err', T.t('Longer than 10 minutes - Video to Music takes up to 10.')));
        else tx.appendChild(el('span', 'au-muted', T.t('{price} for its {length} · the track is laid under it', { price: _usd(v.dur), length: secs(v.dur) })));
      } else {
        tx.appendChild(el('span', 'au-muted', v.dur ? T.t('{length} · {price} · into Music only - not onto the timeline', { length: secs(v.dur), price: _usd(v.dur) })
          : T.t('into Music only - not onto the timeline')));
      }
      att.appendChild(tx);
    } else {
      att.appendChild(el('div', 'au-att-ph'));
      att.appendChild(el('div', 'au-att-tx', H && H.clipNow
        ? T.t('Press a video in the VIDEO folders on the right, or a clip on the timeline with the right button - or drop a file here. Up to 10 minutes and 200 MB.')
        : T.t('Press a video in the VIDEO folders on the right - or drop a file here. Up to 10 minutes and 200 MB.')));
    }
    const up = el('button', 'au-btn u-btn is-s', T.t('From this computer…'));
    up.type = 'button';
    up.title = T.t('A video from this computer - it is copied into VIDEO → Uploads first');
    up.addEventListener('click', () => {
      const inp = el('input');
      inp.type = 'file'; inp.accept = 'video/*';
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const v2 = await _uploadVideo(file);
        if (v2) { Object.assign(f, v2, { clip: null }); F.save(); paintMake(); paintFoot(); }
      });
      inp.click();
    });
    att.appendChild(up);
    if (f.video || f.clip) {
      const x = el('button', 'au-x u-btn is-s is-icon is-quiet is-del u-x', '');
      x.type = 'button';
      x.title = T.t('no video');
      x.addEventListener('click', () => { Object.assign(f, { video: '', name: '', thumb: '', dur: 0, clip: null }); F.save(); paintMake(); paintFoot(); });
      att.appendChild(x);
    }
  };
  _attPaint = paint;
  att.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); e.stopPropagation(); att.classList.add('is-drop'); } });
  att.addEventListener('dragleave', () => att.classList.remove('is-drop'));
  att.addEventListener('drop', async (e) => {
    att.classList.remove('is-drop');
    const file = Array.from(e.dataTransfer.files || [])[0];
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    const v = await _uploadVideo(file);
    if (v) { Object.assign(f, v, { clip: null }); F.save(); paintMake(); paintFoot(); }
  });
  paint();
  return att;
}
async function _uploadVideo(file) {
  _say(T.t('Bringing the video in (VIDEO → Uploads)…'));
  const fd = new FormData();
  fd.append('video', file);
  fd.append('name', file.name);
  try {
    const d = await api('/api/mv3/video/upload', { method: 'POST', body: fd });
    _say(T.t('"{name}" is in VIDEO → Uploads.', { name: file.name }));
    const it = d.item || {};
    return { video: it.videoPath, name: it.name || file.name, thumb: it.thumbPath || '', dur: +it.duration || 0 };
  } catch (e) { _say(e.message, true); return null; }
}

// ── The VIDEO tree of Video to Music - beside the middle, in that mode only ──
// Only VIDEO's FOLDERS are seen - the path over them, the folder tiles, the videos; the tree that walks
// them is built in a column that is never shown (css/sound-window.css).
let _vtree = null;
let _vseq = 0;
let _vRead = 0;
function _side() {
  if (!_ui) return;
  const on = S().mode === 'video';
  _ui.v2m.hidden = !on;
  if (on) _v2mOpen();
}
function _v2mOpen() {
  if (!_ui) return;
  if (!_vtree || !_ui.v2mTree.contains(_vtree.el)) {
    _ui.v2mTree.textContent = '';
    _vtree = createTree(_ui.v2mTree, { page: 'v2m', roots: ['video'], fallback: 'uploads',
      status: (t, bad) => { if (t) _say(t, bad); },
      onSelect: (n) => _v2mLoad(n),
      onChanged: () => _v2mLoad(_vtree.selected()) });
    _vRead = 0;
  }
  if (Date.now() - _vRead < 2000) return;
  _vRead = Date.now();
  _vtree.load().then(() => {
    const n = _vtree.selected();
    if (n) { _v2mLoad(n); return; }
    // The tree not read (its reason said in the corner by `status`): the gallery says so - not empty.
    if (_ui) _ui.v2mGal.replaceChildren(failedEl(T.t('the videos'), () => { _vRead = 0; _v2mOpen(); }));
  });
}
async function _v2mLoad(n) {
  if (!_ui || !_vtree || !n) return;
  const mine = ++_vseq;
  const gal = _ui.v2mGal;
  gal.textContent = '';
  gal.appendChild(_vtree.crumbsEl(n));
  const fold = _vtree.foldersEl(n);
  if (fold) gal.appendChild(fold);
  const grid = el('div', 'au-v2m-grid');
  gal.appendChild(grid);
  // empty, reading and did not load are the shared parts (js/ui-state.js); a folder not read says so with
  // Try again, the reason in the corner - never "No videos here."
  if (!n.q) { if (!fold) grid.appendChild(emptyEl(T.t('Nothing here.'), { icon: 'folder' })); return; }
  grid.appendChild(loadingEl(T.t('reading…')));
  let items = [];
  try {
    const d = await api('/api/library/shelf/media?' + new URLSearchParams(n.q));
    items = (d.items || []).filter(i => i && i.media && /\.(mp4|mov|webm|m4v|mkv)$/i.test(String(i.media).split('?')[0]));
  } catch (e) {
    if (mine === _vseq) { grid.textContent = ''; grid.appendChild(failedEl(T.t('the videos'), () => _v2mLoad(n))); showError(e.message); }
    return;
  }
  if (mine !== _vseq || !_ui) return;
  grid.textContent = '';
  if (!items.length && !fold) grid.appendChild(emptyEl(T.t('No videos here.'), { icon: 'film' }));
  for (const it of items) grid.appendChild(_v2mTile(it));
}
function _v2mTile(it) {
  const f = S().f.video;
  const dur = +it.dur || +((it.meta || {}).dur) || 0;
  const long = dur > V2M_MAX;
  const b = el('button', 'au-v2m-it' + (!f.clip && f.video === it.media ? ' is-on' : '') + (long ? ' is-long' : ''));
  b.type = 'button';
  b.dataset.media = it.media;
  if (it.thumb) { const im = el('img'); im.src = it.thumb; im.loading = 'lazy'; im.alt = ''; b.appendChild(im); } else b.appendChild(el('div', 'au-att-ph'));
  b.appendChild(el('span', 'nm', it.name || String(it.media).split('/').pop()));
  if (dur) b.appendChild(el('span', 'd', secs(dur)));
  const named = (it.name || '') + (dur ? ' · ' + secs(dur) : '');
  b.title = long ? T.t('{name} - longer than 10 minutes: Video to Music takes up to 10', { name: named })
    : T.t('{name} - a press puts it into "The video"; its music goes to Music only', { name: named });
  b.addEventListener('click', () => {
    if (long) { _say(T.t('"{name}" is {length} - Video to Music takes up to 10 minutes.', { name: it.name || T.t('that video'), length: secs(dur) }), true); return; }
    Object.assign(f, { clip: null, video: it.media, name: it.name || '', thumb: it.thumb || '', dur });
    F.save();
    paintMake();
    paintFoot();
    for (const x of _ui.v2mGal.querySelectorAll('.au-v2m-it')) x.classList.toggle('is-on', x.dataset.media === it.media);
  });
  return b;
}

// ── the foot: ALMANAC, the line of the last press, where it goes, the price, "generate" ──
function paintFoot() {
  if (!_ui) return;
  const lyr = S().mode === 'lyrics';
  const d = _dest();
  const into = lyr ? T.t('texts only · save → Music → Lyrics')
    : d.clip ? T.t('into Music, and under its clip')
      : d.note ? T.t('into {place} - {note}', { place: d.label, note: d.note }) : T.t('into {place}', { place: d.label });
  _ui.into.textContent = into;
  _ui.into.title = lyr ? T.t('Texts only - nothing is filed by itself; "save" keeps a text in Music → Lyrics') : into;
  const p = F.price();
  _ui.price.textContent = '';
  if (p.big) {
    _ui.price.appendChild(el('b', 'u-price', p.big));
    _ui.price.appendChild(el('span', null, p.small + (_cat() && _cat().fake ? ' · FAKE' : '')));
  }
  _ui.price.title = p.big ? T.t('per press · {price} · {what}', { price: p.big, what: p.small }) : '';
  _ui.go.textContent = lyr ? T.t('Write the lyrics') : T.t('Generate');
  _paintLine();
}
// Where a press being made is: the server's stage, else who is making it, else starting.
const _stageOf = (g) => g.stage || (g.taskId ? T.t('{name} is making it', { name: g.engine === 'eleven' ? 'ElevenLabs' : 'Suno' }) : T.t('starting'));
// The line of the last press: where it is in Alerts, what came of it - or why it did not start.
function _paintLine() {
  const line = _ui && _ui.line;
  if (!line) return;
  line.className = 'au-line u-status is-line';
  if (_err) { line.textContent = _err; line.title = _err; line.classList.add('is-bad'); return; }
  const r = _last;
  const g = r && r.gen;
  line.textContent = '';
  line.title = '';
  if (!g) return;
  const lyr = g.kind === 'lyrics';
  let t;
  if (g.state === 'pending') {
    t = lyr ? T.t('writing the lyrics…') : T.t('in Alerts · {stage}…', { stage: _stageOf(g) });
  } else if (g.state === 'done') {
    const n = (g.results || []).length;
    const place = (r.dest && r.dest.label) || T.t('Music');
    if (lyr) t = S().mode === 'lyrics' && !(H && H.made) ? T.t('the lyrics are written - above') : T.t('the lyrics are written - in Lyrics');
    else if (g.kind === 'sound') t = T.tn(n, 'in Alerts · done - {n} sound in {place}', 'in Alerts · done - {n} sounds in {place}', { place });
    else if (g.laid) t = T.tn(n, 'in Alerts · done - {n} track in {place}, and laid under its clip on {lane}', 'in Alerts · done - {n} tracks in {place}, and laid under its clip on {lane}', { place, lane: _lane(g.laid.lane) });
    else if (g.notLaid) t = T.tn(n, 'in Alerts · done - {n} track in {place}; not laid on the timeline - {why}', 'in Alerts · done - {n} tracks in {place}; not laid on the timeline - {why}', { place, why: g.notLaid });
    else t = T.tn(n, 'in Alerts · done - {n} track in {place}', 'in Alerts · done - {n} tracks in {place}', { place });
  } else {
    const why = g.error || T.t('it did not come');
    t = lyr ? (g.refused ? T.t('refused - {why}', { why }) : T.t('failed - {why}', { why }))
      : (g.refused ? T.t('in Alerts · refused - {why}', { why }) : T.t('in Alerts · failed - {why}', { why }));
    line.classList.add('is-bad');
  }
  line.textContent = t;
  line.title = t;
}

// The request of the open mode.
function _body() {
  const mode = S().mode;
  const f = S().f[mode];
  // Simple, Custom, Lyrics - the shared form's request (Simple's writer told the project's kind); the rest here.
  const b = F.body(String(_hook('writerKind') || 'blank')) || { mode, model: S().model };
  if (mode === 'sounds') Object.assign(b, { prompt: f.prompt, loop: !!f.loop, tempo: f.tempo || 0, key: f.key || 'Any' });
  else if (mode === 'compose') Object.assign(b, { prompt: f.prompt, seconds: f.seconds || 0, instrumental: f.instrumental !== false });
  else if (mode === 'video') {
    // A clip - the server makes it into a file and lays the track under it - or a file of the library.
    const v = _v2m();
    if (f.clip) b.clip = { key: f.clip.key, clipId: f.clip.clipId, name: v.name, start: v.start, dur: v.dur };
    else Object.assign(b, { video: f.video, name: f.name || '' });
    Object.assign(b, { seconds: v.dur || 0, description: f.description, tags: f.tags, sfx: !!f.sfx, useAudio: !!f.useAudio });
  } else if (mode === 'sfx') Object.assign(b, { prompt: f.prompt, seconds: f.seconds || 0, loop: !!f.loop, influence: f.influence });
  return b;
}

async function _generate(btn) {
  if (_going || !_cat()) return;
  // A mode whose engine has no key is not pressed: the popup says which (Suno - kie.ai, the rest - ElevenLabs).
  if (!allow(_engineOf(S().mode) === 'eleven' ? 'eleven' : 'suno', btn, { open: 'audio' })) return;
  _going = true;
  btn.disabled = true;
  _err = '';
  _paintLine();
  try {
    // A clip of the open timeline: the server reads it from the SAVED timeline - what is not saved yet goes first.
    const vc = S().mode === 'video' ? S().f.video.clip : null;
    if (vc && H && typeof H.flush === 'function' && !(await H.flush(vc))) throw new Error(T.t('The timeline could not be saved - the clip is read from the saved one. Try again in a moment.'));
    const b = _body();
    const d = _dest();
    const m = _mode();
    // The Alerts row keeps `spot`'s key, view and label (lib/alerts.js) - the page's own place (the host's `where`).
    b.where = _hook('where', d, (m ? m.label : S().mode)) || null;
    if (d.into) b.into = d.into;
    const key = _key();
    if (key) b.project = key;
    const r = await F.press(b);
    _track(r.gen, d);
    if (H && H.made) { GENS = [r.gen].concat(GENS.filter(g => g.id !== r.gen.id)); _paintMade(); _followProject(); }
    _say(r.gen.kind === 'lyrics' ? T.t('Writing the lyrics…') : T.t('Asked - it is in Alerts too; you can close this window, the app files it when it comes.'));
  } catch (e) {
    // A press refused or failed before it started is an error - in the corner (js/notice.js); a field left
    // empty at the press ("The mood's style is empty…", js/sound/suno-form.js - `hint`) is said on the foot's line, as a hint.
    if (e && e.hint) { _err = e.message; _paintLine(); } else showError(e.message);
  } finally {
    _going = false;
    btn.disabled = false;
  }
}

// ── following what this page pressed ─────────────────────────────────────────
function _track(gen, dest) {
  if (!gen || !gen.id) return;
  _last = { gen, dest };
  if (gen.state === 'pending') _runs.set(gen.id, { gen, dest });
  _paintLine();
  _tick();
}
function _tick() { if (!_timer && _runs.size) _timer = setTimeout(_poll, 3000); }
function _addLyrics(g) {
  if (!g || g.kind !== 'lyrics' || g.state !== 'done' || !(g.lyrics || []).length) return false;
  _lyricGens = [g, ..._lyricGens.filter(x => x.id !== g.id)]
    .sort((a, b) => String(b.doneAt || b.at || '').localeCompare(String(a.doneAt || a.at || '')));
  return true;
}
async function _poll() {
  _timer = 0;
  let lyricsCame = false;
  for (const [id, r] of [..._runs]) {
    let g;
    try { g = (await api('/api/audio/gens/' + encodeURIComponent(id))).gen; }
    catch (e) { if (/not found/i.test(e.message)) _runs.delete(id); continue; }
    r.gen = g;
    if (_last && _last.gen.id === id) _last.gen = g;
    if (g.state === 'pending') continue;
    _runs.delete(id);
    if (g.kind === 'lyrics') { if (_addLyrics(g)) lyricsCame = true; }
    else if (g.state === 'done') { try { await _hook('onLanded', g, r.dest); } catch (e) { /* the page's */ } }
  }
  if (lyricsCame && _ui && S().mode === 'lyrics' && !(H && H.made)) paintMake();
  _paintLine();
  _tick();
}
// The presses of this page the server is still making - after a reload, or with the window closed and opened again - are
// followed to their end; and the texts Lyrics wrote here are shown again. Asked once per page.
async function _pickUp() {
  if (_looked || !H) return;
  _looked = true;
  let items = [];
  try { items = (await api('/api/audio/gens?limit=60')).items || []; } catch (e) { return; }
  const mine = items.filter(g => g && g.where && g.where.page === H.page && g.where.spot && g.where.spot.view === H.view);
  const destOf = (g) => ({ node: g.where.spot.key || 'music', into: g.into || '', label: g.where.spot.label || '' });
  for (const g of mine.slice().reverse()) {
    if (g.state === 'pending' && !_runs.has(g.id)) _track(g, destOf(g));
    _addLyrics(g);
  }
  if (!_last && mine[0]) _last = { gen: mine[0], dest: destOf(mine[0]) };
  if (_ui) { paintMake(); _paintLine(); }
}

// ── the Library: Lyrics' texts under the card, a row each ────────────────────
function _lyricsList() {
  const box = el('div', 'au-lyrs');
  const gens = _lyricGens.slice(0, LYR_MAX);
  if (!gens.length) {
    box.appendChild(emptyEl(T.t('The texts come here - a row each, to save into Music → Lyrics or to use in Custom.'), { line: true }));
    return box;
  }
  gens.forEach((g, gi) => {
    const grp = el('div', 'au-lyr-g');
    const when = _when(g.doneAt || g.at);
    // what the press asked for (the server's words) after it
    grp.appendChild(el('div', 'au-made-h', (gi ? T.t('written {when}', { when }) : T.t('written last · {when}', { when })) + (g.said ? ' · ' + g.said : '')));
    (g.lyrics || []).forEach((l, i) => grp.appendChild(_lyricRow(l, g, gi === 0, g.id + ':' + i)));
    box.appendChild(grp);
  });
  return box;
}
function _lyricRow(l, g, latest, key) {
  const open = _rowOpen.has(key) ? _rowOpen.get(key) : latest;
  const row = el('div', 'au-lr' + (open ? ' is-open' : ''));
  const h = el('div', 'au-lr-h');
  const t = el('button', 'au-lr-t');
  t.type = 'button';
  t.title = T.t('Open or fold the text');
  const peek = String(l.text || '').split('\n').map(s => s.trim()).filter(s => s && !/^\[[^\]]*\]$/.test(s)).slice(0, 2).join(' / ');
  t.append(el('span', 'au-chips-tw', '▸'), el('b', null, l.title || titleOf(l.text)), el('span', 'au-lr-peek', peek ? '- ' + peek : ''));
  t.addEventListener('click', () => {
    const now = !row.classList.contains('is-open');
    _rowOpen.set(key, now);
    row.classList.toggle('is-open', now);
  });
  const use = el('button', 'au-link', T.t('Use in custom'));
  use.type = 'button';
  use.addEventListener('click', () => F.useLyric(l));
  const copy = el('button', 'au-link', T.t('Copy'));
  copy.type = 'button';
  copy.addEventListener('click', async () => { const ok = await copyText(l.text); _say(ok ? T.t('Copied.') : T.t('Not copied - the clipboard refused it.'), !ok); });
  h.append(t, F.saveButton(l, g), use, copy);
  row.append(h, el('pre', 'au-lr-text', l.text || ''));
  return row;
}
function _when(iso) {
  const d = new Date(iso || Date.now());
  if (isNaN(d)) return '';
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  return d.toDateString() === now.toDateString() ? hm : String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + hm;
}

// ── Merge: the open project's presses under the card ─────────────────────────
// How long ago - "12 s ago", "3 min ago", an older one its day and time; `bare` - without "ago" (a press still being made).
const _ago = (iso, bare) => {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  const span = s < 60 ? T.t('{s} s', { s }) : s < 3600 ? T.t('{n} min', { n: Math.round(s / 60) }) : '';
  if (span) return bare ? span : T.t('{time} ago', { time: span });
  const d = new Date(t);
  const loc = T.lang() === 'ru' ? 'ru-RU' : 'en-GB';
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
};
function _madeBox() {
  const box = el('div', 'au-made-box');
  const head = el('div', 'au-proj');
  const list = el('div', 'au-made');
  box.append(head, list);
  _ui.madeH = head;
  _ui.made = list;
  _paintMade();
  return box;
}
function _paintMade() {
  if (!_ui || !_ui.made || !_ui.made.isConnected) return;
  _ui.madeH.textContent = GENS.length ? T.t('this project · {n}', { n: GENS.length }) : T.t('this project · nothing made here yet');
  _ui.made.textContent = '';
  for (const g of GENS) _ui.made.appendChild(_genCard(g));
}
function _genCard(g) {
  const card = el('div', 'au-gen' + (g.state === 'failed' ? ' is-failed' : ''));
  const h = el('div', 'au-gen-h');
  h.appendChild(el('span', 'au-state ' + (g.state === 'pending' ? 'run' : g.state === 'done' ? 'ok' : 'bad'),
    g.state === 'pending' ? T.t('making') : g.state === 'done' ? T.t('done') : (g.refused ? T.t('refused') : T.t('failed'))));
  h.appendChild(el('b', null, g.said || _modeName(g.mode)));
  h.appendChild(el('span', 'sp'));
  h.appendChild(el('span', null, (g.engine === 'eleven' ? 'ElevenLabs' : 'Suno') + ' · ' + _modeName(g.mode) + (g.fake ? ' · FAKE' : '') + ' · ' + _ago(g.at)));
  if (g.state !== 'pending') {
    const x = el('button', 'au-x u-btn is-s is-icon is-quiet is-del u-x', '');
    x.type = 'button';
    x.title = T.t('Off this list - the files stay where they are');
    x.addEventListener('click', async () => {
      try { await api('/api/audio/gens/' + encodeURIComponent(g.id), { method: 'DELETE' }); GENS = GENS.filter(y => y.id !== g.id); _paintMade(); }
      catch (e) { _say(e.message, true); }
    });
    h.appendChild(x);
  }
  card.appendChild(h);
  if (g.mode === 'simple' && g.written && g.written.style) {
    const w = el('div', 'au-said');
    w.appendChild(el('b', null, (g.written.by === 'as picked' ? T.t('Sent as picked') : g.written.by === 'preset' ? T.t('The mood\'s preset') : T.t('The writer wrote')) + ': '));
    w.appendChild(document.createTextNode(g.written.title + ' - ' + g.written.style));
    if (g.fell) w.appendChild(el('div', 'au-muted', g.fell));
    card.appendChild(w);
  }
  if (g.state === 'pending') {
    const bar = el('div', 'au-bar');
    bar.appendChild(el('i'));
    card.appendChild(bar);
    const row = el('div', 'au-gen-h');
    row.appendChild(el('span', null, _stageOf(g) + ' · ' + _ago(g.at, true)));
    row.appendChild(el('span', 'sp'));
    if (g.alertId) {
      const st = el('button', 'au-link', T.t('Stop waiting'));
      st.type = 'button';
      st.title = T.t('It stops being waited for and is not filed - the money is not given back');
      st.addEventListener('click', async () => {
        try { await post('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', {}); _pollProject(); } catch (e) { _say(e.message, true); }
      });
      row.appendChild(st);
    }
    card.appendChild(row);
  } else if (g.state === 'failed') {
    card.appendChild(el('div', 'au-err', g.error || T.t('it did not come')));
    if (g.alertId && !g.refused) {
      const again = el('button', 'au-link', T.t('Try again (pays again)'));
      again.type = 'button';
      again.addEventListener('click', async () => {
        // the question at the button, a plain answer - it is paid
        const q = g.engine === 'eleven' ? T.t('Ask for it again? It costs ElevenLabs credits again.') : T.t('Ask for it again? It costs kie credits again.');
        if (!await ask(again, q, { yes: T.t('Ask again') })) return;
        try { await post('/api/alerts/' + encodeURIComponent(g.alertId) + '/retry', {}); _say(T.t('Asked again.')); _followProject(); _pollProject(); } catch (e) { _say(e.message, true); }
      });
      card.appendChild(again);
    }
  } else if (g.kind === 'lyrics') {
    for (const l of (g.lyrics || [])) card.appendChild(F.lyricCard(l, g));
  } else {
    for (const r of (g.results || [])) card.appendChild(_result(r));
    // Made from a clip: where its track was laid, or why not.
    if (g.laid) card.appendChild(el('div', 'au-said', T.t('Laid under its clip on {lane} at {time}.', { lane: _lane(g.laid.lane), time: _clock(g.laid.at) })));
    else if (g.notLaid) card.appendChild(el('div', 'au-said', T.t('Not laid on the timeline: {why}.', { why: g.notLaid })));
  }
  return card;
}
// One sound heard at a time: a press on a row plays it, a press again stops it; the row shows how far it is.
let _hear = null;
function _stopHearing() {
  if (!_hear) return;
  try { _hear.audio.pause(); } catch (e) { /* gone */ }
  _hear.row.classList.remove('is-playing');
  _hear.row.style.removeProperty('--p');
  _hear = null;
}
function _hearToggle(path, row) {
  if (_hear && _hear.path === path) { _stopHearing(); return; }
  _stopHearing();
  const audio = new Audio(path);
  _hear = { path, row, audio };
  row.classList.add('is-playing');
  audio.addEventListener('timeupdate', () => { if (_hear && _hear.audio === audio && audio.duration) row.style.setProperty('--p', (audio.currentTime / audio.duration * 100).toFixed(1) + '%'); });
  audio.addEventListener('ended', () => { if (_hear && _hear.audio === audio) _stopHearing(); });
  audio.play().catch(() => { _stopHearing(); _say(T.t('That file will not play'), true); });
}
function _result(r) {
  const it = LIBIDX.get(r.path);
  const row = el('div', 'au-res' + (_hear && _hear.path === r.path ? ' is-playing' : ''));
  row.dataset.path = r.path;
  const pb = el('button', 'au-play u-btn is-s is-icon', '▶');
  pb.type = 'button';
  row.appendChild(pb);
  row.appendChild(el('span', 'au-res-n', (it && it.name) || r.title));
  row.appendChild(waveEl(it ? (it.meta || {}).wave : [], 'au-wave'));
  row.appendChild(el('span', 'au-muted', secs(r.dur)));
  if (it) {
    const fav = !!(it.meta && it.meta.favorite);
    const star = el('button', 'au-star u-btn is-s is-icon is-quiet' + (fav ? ' on' : ''), fav ? '★' : '☆');
    star.type = 'button';
    star.title = fav ? T.t('Take it out of Favorites') : T.t('Into Favorites');
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api('/api/library/item/' + encodeURIComponent(it.kind) + '/' + encodeURIComponent(it.id),
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: !fav }) });
        await _index();
        _paintMade();
        window.dispatchEvent(new Event('mv3:lib-reload'));
      } catch (er) { _say(er.message, true); }
    });
    row.appendChild(star);
    if (H && typeof H.showFile === 'function') {
      const show = el('button', 'au-link', T.t('Show'));
      show.type = 'button';
      show.title = T.t('Where it lies - on the shelf, in its place in the tree');
      show.addEventListener('click', (e) => { e.stopPropagation(); _stopHearing(); H.showFile(r.path); });
      row.appendChild(show);
    }
  } else {
    row.appendChild(el('span', 'au-muted', T.t('deleted')));
  }
  row.addEventListener('click', () => _hearToggle(r.path, row));
  // Onto an audio lane, as a tile of the shelf is: a track of music lies as a bed, a sound as a sound effect. The window lays
  // itself aside while it is dragged (gen-window.js passDrags).
  const drag = H && H.drag;
  if (it && drag) {
    row.draggable = true;
    row.title = T.t('A press plays it · drag it onto an audio lane');
    row.addEventListener('dragstart', (e) => {
      // Not onto a highlights project's own timeline - a fragment is opened first.
      if (typeof drag.refuse === 'function' && drag.refuse(row, e)) return;
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData(drag.type, JSON.stringify({
        libId: it.id, src: it.media, thumb: null, name: it.name || r.title || '', group: it.kind,
        dur: +it.dur || +r.dur || 0, media: 'audio', bed: it.kind === 'music',
      }));
      e.dataTransfer.setData(drag.media + 'audio', '1');
      setMediaDrag(e.dataTransfer, it);
    });
  }
  return row;
}
// The shelf's items by path: a result row's name, waveform and star - and what a lane is given when it is dragged.
async function _index() {
  const map = new Map();
  for (const f of ['music', 'sounds']) {
    try { for (const it of (await api('/api/library/shelf/media?filter=' + f)).items || []) map.set(String(it.media || '').split('?')[0], it); } catch (e) { /* none */ }
  }
  LIBIDX = map;
}
// Followed while anything is being made and the window is open: every 3 s, the project's list again.
async function _pollProject() {
  const key = _key();
  if (!key || !(H && H.made)) return;
  let d;
  try { d = await api('/api/audio/gens?limit=40&project=' + encodeURIComponent(key)); } catch (e) { return; }
  if (key !== _key()) return;
  const before = new Map(GENS.map(g => [g.id, g.state]));
  GENS = d.items || [];
  if (GENS.some(g => before.get(g.id) === 'pending' && g.state !== 'pending')) await _index();
  _paintMade();
  if (!GENS.some(g => g.state === 'pending')) _unfollowProject();
}
function _followProject() { if (!_pTimer && _win) _pTimer = setInterval(_pollProject, 3000); }
function _unfollowProject() { clearInterval(_pTimer); _pTimer = 0; }
async function _readProject() {
  if (!(H && H.made)) return;
  _pKey = _key();
  GENS = [];
  _paintMade();
  await _index();
  await _pollProject();
  if (GENS.some(g => g.state === 'pending')) _followProject();
}
/** Merge: another project opened - its presses read again (a clip of the one left is no video of this one). */
export function projectChanged() {
  if (!_win || !(H && H.made) || _key() === _pKey) return;
  _unfollowProject();
  _readProject();
  paintMake();
}

// ── the sash between the columns (remembered, `lib_music_sash_v1`) ───────────
function _setW(w) {
  if (!_ui || !_win) return SET_W;
  const room = _win.box.clientWidth - RIGHT_MIN;
  const v = Math.round(Math.max(SET_MIN, Math.min(Math.max(SET_MIN, Math.min(SET_MAX, room)), +w || SET_W)));
  _ui.set.style.flexBasis = v + 'px';
  return v;
}
function _wireSash() {
  const { sash, set } = _ui;
  sash.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    sash.setPointerCapture(e.pointerId);
    sash.classList.add('is-on');
    const x0 = e.clientX, w0 = set.getBoundingClientRect().width;
    let w = w0;
    const move = (ev) => { w = _setW(w0 + ev.clientX - x0); };
    const up = () => {
      sash.removeEventListener('pointermove', move);
      sash.removeEventListener('pointerup', up);
      sash.removeEventListener('pointercancel', up);
      sash.classList.remove('is-on');
      lsSet(KEY_SASH, w);
    };
    sash.addEventListener('pointermove', move);
    sash.addEventListener('pointerup', up);
    sash.addEventListener('pointercancel', up);
  });
  sash.addEventListener('dblclick', () => lsSet(KEY_SASH, _setW(SET_W)));
}
const _onResize = () => { if (_ui) _setW(ls(KEY_SASH, SET_W)); };

/** The presses of this page still being made are followed (the Library calls it as it starts). */
export function follow() {
  _form();
  _pickUp();
}

// What an opening asks for: a mode, a clip for Video to Music, a text for Custom.
function _apply(o) {
  if (!_cat()) return;
  if (o.clip) {
    Object.assign(S().f.video, { video: '', name: '', thumb: '', dur: 0, clip: o.clip });
    S().mode = 'video';
    S().lastMode.music = 'video';
    F.save();
  } else if (o.mode && _modes(groupOf(o.mode)).includes(o.mode)) S().mode = o.mode;
  if (o.lyric) { F.useLyric(o.lyric); return; }
  paint();
  if (o.clip) _say(T.t('The clip is in "The video" - say what you want if you like, then generate. Its track is laid under it when it comes.'));
}

/**
 * The window - one per page: opened again while it is open, the same one stays, fitted to `o`. It opens on Music → Simple
 * unless `o` asks for another mode, a clip or a text.
 */
export async function open(o) {
  const opt = Object.assign({ mode: 'simple' }, o || {});
  // Neither Suno's key (kie.ai) nor ElevenLabs': the window does not open - the popup says so (js/key-gate.js).
  if (!(_win && _win.alive()) && !allow('sound', opt.anchor, { open: 'audio' })) return null;
  if (typeof opt.place === 'function') _o.place = opt.place; else if (!_win) _o.place = null;
  if (opt.anchor) _o.anchor = opt.anchor;
  _form();
  if (_win && _win.alive()) {
    _fitMode();
    _apply(opt);
    return _win;
  }
  // A mood's preset edited in an earlier opening is not carried into this one.
  F.resetEdit();
  _placeKey = null;
  _err = '';
  _win = openFrame({
    // The chats' one size and place, the person's (gen-window.js GEOM_CHAT).
    name: 'generate audio', anchor: _o.anchor, cls: 'is-music is-sound', size: GEN_SIZE, geom: GEOM_CHAT,  passDrags: true, foot: true,
    onClose: () => {
      F.closeAlmanac();
      closeQ();
      _stopHearing();
      _unfollowProject();
      window.removeEventListener('resize', _onResize);
      _win = null;
      _ui = null;
      _attPaint = null;
    },
  });
  _win.setCrumbs([{ label: T.t('Generate audio') }]);
  const body = _win.body;
  body.classList.add('au-win');
  const set = el('div', 'mv3-ig-set au-set');
  const col = el('div', 'mv3-ig-scroll');
  // The almanac at the foot of the settings column, where the chats have theirs.
  const alm = el('div', 'au-alm');
  set.append(col, alm);
  const sash = el('div', 'au-msash');
  sash.title = T.t('Drag to widen the settings - a double press puts it back');
  const right = el('div', 'au-right');
  const pair = el('div', 'au-pair');
  const mid = el('div', 'au-mid');
  const status = el('div', 'au-status u-status');
  status.hidden = true;
  const make = el('div', 'au-make');
  mid.append(status, make);
  const v2m = el('div', 'au-v2m');
  const v2mGal = el('div', 'au-v2m-gal');
  const v2mTree = el('div', 'au-v2m-tree');
  v2m.append(v2mGal, v2mTree);
  v2m.hidden = true;
  pair.append(mid, v2m);
  // the foot is the frame's, across the whole window: the last press at the left; where it goes, the price and
  // "generate" at the right
  const foot = _win.foot;
  foot.classList.add('au-foot');
  const line = el('div', 'au-line');
  const into = el('div', 'au-into');
  const price = el('div', 'au-price');
  const go = el('button', 'au-go u-btn is-main', T.t('Generate'));
  go.type = 'button';
  go.addEventListener('click', () => _generate(go));
  foot.append(line, el('span', 'sp'), into, price, go);
  right.append(pair);
  body.append(set, sash, right);
  _ui = { set, col, sash, mid, status, make, v2m, v2mGal, v2mTree, alm, line, into, price, go, madeH: null, made: null };
  _vtree = null;
  _setW(ls(KEY_SASH, SET_W));
  _wireSash();
  window.addEventListener('resize', _onResize);
  const win = _win;
  await _start(win, opt);
  return win;
}

// The settings column while the catalog is read ("Reading…"); not read - "The settings did not
// load" and Try again there, the reason in the corner (the form says it, js/sound/suno-form.js ready).
async function _start(win, opt) {
  if (!_ui || win !== _win) return;
  _ui.col.replaceChildren(loadingEl(T.t('reading…'), { line: true }));
  const ok = await F.ready();
  if (!_ui || win !== _win) return;
  if (!ok) { _ui.col.replaceChildren(failedEl(T.t('the settings'), () => _start(win, opt), { line: true })); return; }
  _ui.alm.replaceChildren();
  F.almanacButton(_ui.alm);
  _fitMode();
  _apply(opt);
  _pickUp();
  _readProject();
}

/** The window open now, or null. */
export const shown = () => (_win && _win.alive() ? _win : null);

/** Merge: the clip in "The video" may have moved on the timeline - its field painted again. */
export function clipChanged() {
  if (_win && _ui && S().mode === 'video' && S().f.video.clip && _attPaint) { _attPaint(); paintFoot(); }
}
