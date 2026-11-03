/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — HIGHLIGHTS: THE COMMON SETTINGS OF THE TICKED FRAGMENTS (phase V66, the owner 2026-10-31 and 2026-11-03, answers
   (хо1)-(хо17)): "чтобы сразу у всех хайлайтов можно было поменять положение субтитров двигать верх-вниз по превью (на превью
   слово example), размер субтитров, количество слов в строке, количество строк ... музыку наложеную можно менять у каждого хайлайта
   по отдельности при выделенных всех".

   While two fragments or more are ticked (highlights.js), the NAME of a lane on the timeline - Subtitles, main audio, the lane of the
   music - opens its common settings in the strip on the right instead of the one lane's (lib-views.js laneAlt): at the top "for all
   N", under it each fragment. The captions crumb with fragments ticked leads to the same place as Subtitles ((хо16)).
     Subtitles    where (up / down, and «example» dragged on the preview), size (one number for all, (хо17)), words in a line,
                  lines, the title on top on / off ((хо12)); under them the tiles' tabs as before (highlights.js); each fragment its
                  preset and how many of its pages stand in a place of their own - never moved by the common place ((хо6)); a press on
                  one opens it with its own Subtitles picked, all of its settings ((хо15)). A place set for all is HELD over presets
                  ((хо13), captions/style.js `hold`).
     main audio   the volume for all; each fragment its own ((хо3)).
     music        the volume for all - the lane's, in dB, so each keeps its own balance ~10 dB under its speech ((хо4)); "deal
                  again" from moods, or no music; each fragment its track and a choice of another one of its mood, one of a
                  mood, or none ((хо9)) - the server measures and lays it (routes/highlights.js), only the app's clips replaced
                  ((хо11)). No music lane on the open fragment: "+ music" makes its "audio 2" (the owner: "если нет, то можно
                  добавить").
   The OPEN fragment among the ticked is the page's - its own undo step; the others are the server's. No undo for several ((хо5)):
   a slider brought back gives back the same pages and place. Nothing ticked open and a lane's name pressed on the project's own
   timeline: the first ticked opens ((хо1)).

   THE SAMPLE ((хо7)): while the Subtitles block is in the strip, the preview draws a whole page of «example» - as many words in a
   line as the lanes have, in as many lines - in the open fragment's look, instead of its subtitles (captions/layer.js setLive),
   and it is dragged up and down there (cap-place.js setSample); let go, the place is written for all.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Views from './lib-views.js';
import * as C from './controls.js';
import * as Layers from '../layers.js';
import * as CapPlace from './cap-place.js';
import { setSubsStyle, selectTrackById, onSelChange, selectedTrack, newBedLane } from './timeline-b.js';
import { normalizeStyle, autoWordsPerLine, autoSize, POSITIONS } from '../captions/style.js';
import { paginate } from '../captions/pages.js';
import { putTitle, dropTitle, titleLaneOf, topTitleOf } from '../captions/title.js';

let _A = null;              // what highlights.js lends: { pid, rec, ticked, openN, load, say, whole, tiles(host) }
let _own = '';              // a fragment opened from its row with its OWN Subtitles picked ((хо15)) - its key
let _busy = '';             // 'subs' | 'speech' | 'music' while a write for all is under way
let _moods = null;          // Music -> highlights: [{ id, label, n }] (the root as 'yours' when it has tracks)
let _dealMoods = [];        // the moods "deal again" takes
let _sample = false;        // the «example» is on the preview
let _sampleRaf = 0;

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const _enc = encodeURIComponent;
async function _post(url, body) {
  let r = null, d = null;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); d = await r.json(); } catch (e) { d = null; }
  if (!r || !d || !d.success) throw new Error((d && d.error) || 'The app did not answer - try again in a moment.');
  return d;
}

// ── Who is in the group ─────────────────────────────────────────────────────
/** Two fragments or more ticked (made) - the lanes' names lead to the common settings, and the bubbles show ((хо1)). */
export const isGroup = () => !!(_A && _A.pid() && _A.ticked().length >= 2);
const _tl = () => Store.timeline() || {};
const _openSubs = () => ((_tl().tracks) || []).find((t) => t && t.kind === 'subs') || null;
const _openA1 = () => ((_tl().tracks) || []).find((t) => t && t.id === 'a1') || null;
/** The lane a fragment's music lies on (the one with the app's bed `hm…`, else "audio 2") - highlights-cut.js musicLaneOf. */
const _isBed = (c) => !!(c && /^hm/.test(String(c.id || '')));
function musicLaneOf(tl) {
  const auds = (((tl || {}).tracks) || []).filter((t) => t && t.kind === 'audio' && t.id !== 'a1');
  return auds.find((t) => (t.clips || []).some(_isBed)) || auds.find((t) => t.id === 'a2') || null;
}
export const openMusicLane = () => musicLaneOf(_tl());
const _split = () => {
  const list = _A.ticked();
  const n = _A.openN();
  const open = list.find((f) => f.n === n) || null;
  return { list, open, rest: list.filter((f) => f !== open) };
};

// What a ticked fragment's subtitles are now: the open one's from its timeline, the others' as the server read them (`lanes`).
function _subsOf(f) {
  if (f.n === _A.openN()) {
    const lane = _openSubs();
    const st = normalizeStyle((lane && lane.style) || {});
    const own = ((lane && lane.clips) || []).filter((c) => c && c.style && ['pos', 'tx', 'ty'].some((k) => c.style[k] != null)).length;
    return { pos: st.pos, ty: st.ty, size: st.size, sizeAuto: st.sizeAuto !== false, wordsPerLine: st.wordsPerLine, lines: st.lines, hold: !!st.hold, own };
  }
  return (f.lanes && f.lanes.subs) || null;
}
const _same = (vals) => vals.length > 0 && vals.every((v) => JSON.stringify(v) === JSON.stringify(vals[0]));
const _titled = (f) => (f.n === _A.openN() ? !!titleLaneOf(_tl()) : !!(f.cap && f.cap.titled));

// ── Writes: the open one by the page, the rest by the server ────────────────
async function _forAll(kind, page, server, said) {
  if (_busy) return;
  const { open, rest } = _split();
  if (open) page();
  if (!rest.length) { Views.altChanged(); return; }
  _busy = kind;
  Views.altChanged();
  try { await server(rest.map((f) => f.n)); if (said) _A.say(said); } catch (e) { _A.say(e.message, true); }
  _busy = '';
  await _A.load();
  Views.altChanged();
}

/** (хо2), (хо7), (хо13), (хо17) Place, size, words, lines for all the ticked. */
function _subsPatch(patch, said) {
  const fmt = _tl().format || '9:16';
  _forAll('subs', () => {
    const lane = _openSubs();
    if (!lane) return;
    const p = {};
    if (patch.place) Object.assign(p, { pos: patch.place.pos, ty: patch.place.ty, hold: true });
    if (patch.size === 'auto') Object.assign(p, { sizeAuto: true, size: autoSize(fmt) });
    else if (patch.size != null) Object.assign(p, { size: patch.size, sizeAuto: false });
    if (patch.wordsPerLine != null) p.wordsPerLine = patch.wordsPerLine;
    if (patch.lines != null) p.lines = patch.lines;
    setSubsStyle(lane.id, p, patch.size != null || patch.wordsPerLine != null || patch.lines != null);
  }, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/style', { ns, ...patch }), said);
}

/** (хо12) The title on top on / off for all the ticked. */
function _titleAll(on) {
  const rec = _A.rec();
  _forAll('subs', () => {
    const { open } = _split();
    if (!open) return;
    if (on) {
      const text = topTitleOf(open, { whole: _A.whole(), language: (rec && rec.agent && rec.agent.language) || '' });
      Store.mutate((tl) => { putTitle(tl, text, open.length || open.seconds, () => 'ht' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)); });
    } else Store.mutate((tl) => { dropTitle(tl); });
  }, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/title-on-top', { ns, on: !!on }), on ? 'the title is on top of them' : 'the title is off them');
}

/** (хо3), (хо4) A lane's volume - 'speech' (main audio) or 'music' - for all the ticked, or for one (`only`). */
function _volume(lane, volume, only) {
  const v = Math.round(volume * 10000) / 10000;
  const pageSide = () => Store.mutate((tl) => {
    const t = lane === 'music' ? musicLaneOf(tl) : (tl.tracks || []).find((x) => x && x.id === 'a1');
    if (t) t.volume = v;
  });
  if (only) {
    if (only.n === _A.openN()) { pageSide(); return; }
    _busy = lane;
    _post('/api/highlights/' + _enc(_A.pid()) + '/volume', { ns: [only.n], lane, volume: v })
      .catch((e) => _A.say(e.message, true)).then(async () => { _busy = ''; await _A.load(); Views.altChanged(); });
    return;
  }
  _forAll(lane, pageSide, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/volume', { ns, lane, volume: v }));
}

// The music the server handed back for the open fragment, laid by the page: the app's clips replaced on its music lane - "audio 2"
// made when it has none - one undo step ((хо11)).
function _layOpenMusic(clips) {
  Store.mutate((tl) => {
    for (const t of (tl.tracks || [])) if (t && t.kind === 'audio') t.clips = (t.clips || []).filter((c) => !_isBed(c));
    if (!clips || !clips.length) return;
    const lane = musicLaneOf(tl) || newBedLane(tl.tracks);
    if (lane) for (const c of clips) lane.clips.push(c);
  });
}

/** (хо9) One fragment's music: 'another', a mood id, or 'none'. */
async function _musicOne(f, how) {
  if (_busy) return;
  const taken = _A.ticked().filter((x) => x !== f && x.music).map((x) => x.music.id);
  const open = f.n === _A.openN();
  _busy = 'music';
  Views.altChanged();
  try {
    const d = await _post('/api/highlights/' + _enc(_A.pid()) + '/fragments/' + f.n + '/music', { how, taken, open });
    if (open) _layOpenMusic(d.clips || []);
    _A.say(d.music ? '«' + f.title + '»: ' + d.music.title : '«' + f.title + '»: no music');
  } catch (e) { _A.say(e.message, true); }
  _busy = '';
  await _A.load();
  Views.altChanged();
}

/** (хо4) The music of all the ticked dealt again from `_dealMoods`, or taken off (`none`). */
async function _musicAll(none) {
  if (_busy) return;
  const { list, open } = _split();
  if (!none && !_dealMoods.length) { _A.say('choose a mood or more first', true); return; }
  _busy = 'music';
  Views.altChanged();
  try {
    const d = await _post('/api/highlights/' + _enc(_A.pid()) + '/music', { ns: list.map((f) => f.n), ...(none ? { none: true } : { moods: _dealMoods.slice() }), open: open ? open.n : 0 });
    if (d.open) _layOpenMusic(d.open.clips || []);
    _A.say((none ? 'no music on ' : 'music dealt again to ') + d.n + ' fragments' + (d.missed ? ' - ' + d.missed + ' could not be laid' : ''), !!d.missed);
  } catch (e) { _A.say(e.message, true); }
  _busy = '';
  await _A.load();
  Views.altChanged();
}

async function _readMoods() {
  try {
    const r = await fetch('/api/audio/music/highlights');
    const d = await r.json();
    if (!d || !d.success) throw new Error();
    _moods = (d.moods || []).map((m) => ({ id: m.id, label: m.label, n: (m.tracks || []).length }));
    if ((d.root || []).length) _moods.push({ id: 'yours', label: 'yours', n: d.root.length });
  } catch (e) { _moods = []; }
  Views.altChanged();
}

// ── Painting ────────────────────────────────────────────────────────────────
function _head(host, what, n) {
  host.appendChild(_el('div', 'mv3-ins-title', what + ' · for all ' + n));
  // The three lanes' common settings one press apart - also once the bubbles are closed.
  const row = _el('div', 'mv3-hlg-lanes');
  for (const [k, label] of [['subs', 'Subtitles'], ['speech', 'main audio'], ['music', openMusicLane() ? 'music' : '+ music']]) {
    const b = _el('button', 'mv3-hlg-lane' + (label === what || (k === 'speech' && what === 'Main audio') || (k === 'music' && what === 'Music') ? ' is-on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => pickLane(k));
    row.appendChild(b);
  }
  host.appendChild(row);
}
function _each(host) { host.appendChild(_el('div', 'mv3-c-sep')); host.appendChild(_el('div', 'mv3-hlg-each', 'each fragment')); }
const _wordsSaid = (v) => (v > 0 ? 'up to ' + v : 'auto (up to ' + autoWordsPerLine('9:16') + ')');

/**
 * The Subtitles block - the top of the captions of several (highlights.js captionsAlt) and of the Subtitles lane's name pressed.
 * `target(host)` paints the tiles' part and returns their target.
 */
export function renderSubs(host, target) {
  const list = _A.ticked();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.dataset.hlGroup = 'subs';
  host.appendChild(box);
  _head(box, 'Subtitles', list.length);
  const subs = list.map(_subsOf).filter(Boolean);
  const ref = (list.find((f) => f.n === _A.openN()) && _subsOf(list.find((f) => f.n === _A.openN()))) || subs[0] || {};
  const mixed = (k) => !_same(subs.map((s) => s[k]));
  // Where: up and down from its anchor ((хо7)), as the one lane's Nudge - and «example» dragged on the preview.
  const pos = POSITIONS.includes(ref.pos) ? ref.pos : 'bottom';
  box.appendChild(C.row('Where', C.slider({
    min: -0.80, max: 0.80, step: 0.01, value: +ref.ty || 0, mixed: mixed('ty') || mixed('pos'),
    fmt: (v) => (Math.abs(v) < 0.005 ? pos : (v > 0 ? 'down ' : 'up ') + Math.abs(Math.round(v * 100)) + '% from ' + pos),
    onChange: (v) => _subsPatch({ place: { pos, ty: v } }),
  })));
  // Size: one number for all ((хо17)), or the format's.
  const autoS = subs.length > 0 && subs.every((s) => s.sizeAuto);
  const size = C.slider({ min: 20, max: 200, step: 1, value: +ref.size || 60, mixed: mixed('size') || mixed('sizeAuto'),
    fmt: (v) => v + (autoS ? ' (auto)' : ''), onChange: (v) => _subsPatch({ size: v }) });
  box.appendChild(C.row('Size', C.pair(size, C.toggleNamed('auto', autoS, (on) => _subsPatch({ size: on ? 'auto' : (+ref.size || 60) }),
    'Let the format choose the size'))));
  box.appendChild(C.row('Words', C.slider({ min: 0, max: 12, step: 1, value: +ref.wordsPerLine || 0, mixed: mixed('wordsPerLine'),
    fmt: _wordsSaid, onChange: (v) => _subsPatch({ wordsPerLine: v }) })));
  const lines = Math.max(1, Math.min(3, Math.round(+ref.lines || 2)));
  const LINES = [['1', 'one'], ['2', 'two']].concat(subs.some((s) => +s.lines === 3) ? [['3', 'three']] : []);
  const ls = C.select(LINES, String(lines), (v) => _subsPatch({ lines: +v }));
  if (mixed('lines')) ls.title = 'Not the same on all of them now - a choice gives them one';
  box.appendChild(C.row('Lines', ls));
  // (хо12) The title on top.
  const titled = list.filter(_titled).length;
  const tOn = C.button('on', () => _titleAll(true), { title: 'Its headline at the top for the first three seconds - on every ticked fragment' });
  const tOff = C.button('off', () => _titleAll(false), { title: 'The title on top taken off every ticked fragment' });
  tOn.classList.toggle('is-on', titled === list.length);
  tOff.classList.toggle('is-on', titled === 0);
  box.appendChild(C.row('Title on top', C.pair(tOn, C.pair(tOff, titled && titled < list.length ? _el('span', 'mv3-c-num', titled + ' of ' + list.length) : null))));
  box.appendChild(_el('p', 'mv3-ins-note', _busy === 'subs' ? 'Putting it on them…'
    : 'Drag «example» on the preview up or down - let go, and all of them are there. A place set here stays when a preset is pressed; '
      + 'the size, the words and the lines are the preset\'s. Lines with a place of their own stay where they are.'));
  // The tiles' tabs, as the captions of several always had them (highlights.js).
  const out = target(box);
  // Each fragment ((хо6), (хо15)).
  _each(box);
  const ul = _el('ul', 'mv3-hlg-list');
  for (const f of list) {
    const s = _subsOf(f) || {};
    const c = f.n === _A.openN() ? _A.capOpen() : f.cap;
    const li = _el('li', 'mv3-hlg-item');
    li.appendChild(_el('span', 'mv3-hlg-name', f.title));
    li.appendChild(_el('span', 'mv3-hlg-what', (c && c.name ? c.name + (c.edited ? ' (edited)' : '') : 'a style of its own')
      + (s.own ? ' · ' + s.own + (s.own === 1 ? ' line in its own place' : ' lines in their own place') : '')));
    li.title = 'Open «' + f.title + '» with its own Subtitles - all of its settings';
    li.addEventListener('click', () => _openOwn(f, 'subs'));
    ul.appendChild(li);
  }
  box.appendChild(ul);
  _checkSample();
  return out;
}

function renderSpeech(host) {
  const list = _A.ticked();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.dataset.hlGroup = 'speech';
  host.appendChild(box);
  _head(box, 'Main audio', list.length);
  const vol = (f) => (f.n === _A.openN() ? ((_openA1() || {}).volume != null ? +_openA1().volume : 1) : ((f.lanes && f.lanes.speech && f.lanes.speech.volume) != null ? +f.lanes.speech.volume : 1));
  const vols = list.map(vol);
  box.appendChild(C.row('Volume', _mixedVolume(vols, (v) => _volume('speech', v))));
  box.appendChild(_el('p', 'mv3-ins-note', _busy === 'speech' ? 'Putting it on them…' : 'The speech of every ticked fragment - its music stays as it is.'));
  _each(box);
  for (const f of list) box.appendChild(C.row(f.title, C.volume(vol(f), (v) => _volume('speech', v, f))));
}

function renderMusic(host) {
  const list = _A.ticked();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.dataset.hlGroup = 'music';
  host.appendChild(box);
  _head(box, 'Music', list.length);
  const lane = (f) => (f.n === _A.openN() ? openMusicLane() : null);
  const vol = (f) => {
    if (f.n === _A.openN()) { const l = lane(f); return l && l.volume != null ? +l.volume : 1; }
    return f.lanes && f.lanes.music && f.lanes.music.volume != null ? +f.lanes.music.volume : 1;
  };
  box.appendChild(C.row('Volume', _mixedVolume(list.map(vol), (v) => _volume('music', v))));
  box.appendChild(_el('p', 'mv3-ins-note', 'Louder or quieter by the same for all - each stays ~10 dB under its own speech before that.'));
  // Deal again ((хо4)): the moods as chips, then the press.
  if (!_moods) { _readMoods(); box.appendChild(_el('p', 'mv3-ins-note', 'reading Music → highlights…')); }
  else {
    const chips = _el('div', 'mv3-hlp-chips mv3-hlg-moods');
    for (const m of _moods) {
      const b = _el('button', 'mv3-hlp-chip' + (_dealMoods.includes(m.id) ? ' is-on' : ''), m.label);
      b.type = 'button';
      b.appendChild(_el('span', 'mv3-cap-n', ' ' + m.n));
      b.disabled = !m.n;
      b.addEventListener('click', () => {
        _dealMoods = _dealMoods.includes(m.id) ? _dealMoods.filter((x) => x !== m.id) : _dealMoods.concat([m.id]);
        Views.altChanged();
      });
      chips.appendChild(b);
    }
    box.appendChild(C.row('Moods', chips));
    const deal = C.button(_busy === 'music' ? 'dealing…' : 'deal again', () => _musicAll(false),
      { title: 'Each ticked fragment a new track of these moods - none twice while there are tracks' });
    deal.disabled = !!_busy || !_dealMoods.length;
    const none = C.button('no music', () => _musicAll(true), { title: 'The music taken off every ticked fragment - what you put there yourself stays' });
    none.disabled = !!_busy;
    box.appendChild(C.row('', C.pair(deal, none)));
  }
  _each(box);
  for (const f of list) {
    const m = f.music;
    const opts = [['', m ? m.title + (m.mood ? ' · ' + m.mood : '') : 'no music']];
    if (m) opts.push(['another', 'another track of ' + (m.mood || 'its tracks')]);
    for (const x of (_moods || [])) if (x.n) opts.push(['mood:' + x.id, 'a track of ' + x.label]);
    if (m) opts.push(['none', 'no music']);
    const sel = C.select(opts, '', (v) => {
      sel.value = '';
      if (!v) return;
      _musicOne(f, v === 'another' ? 'another' : v === 'none' ? 'none' : v.slice(5));
    });
    sel.disabled = !!_busy;
    sel.classList.add('mv3-hlg-track');
    box.appendChild(C.row(f.title, sel));
  }
}

// A volume control for several: "mixed" until moved.
function _mixedVolume(vols, onChange) {
  const db = (v) => (v > 0 ? Math.max(C.DB_MIN, 20 * Math.log10(v)) : C.DB_MIN);
  return C.slider({ min: C.DB_MIN, max: C.DB_MAX, step: 0.5, value: Math.round(db(vols[0] == null ? 1 : vols[0]) * 2) / 2,
    mixed: !_same(vols.map((v) => Math.round(db(v) * 2) / 2)), fmt: C.dbLabel, onChange: (d) => onChange(C.fromDb(d)) });
}

// ── A lane's name pressed ───────────────────────────────────────────────────
// (хо15) A fragment opened from its row with its own lane picked - the one lane's strip, as with one fragment.
async function _openOwn(f, lane) {
  if (!f.key) return;
  if (Store.key() !== f.key) { try { await Store.open(f.key); } catch (e) { _A.say(e.message, true); return; } }
  _own = f.key;
  selectTrackById(lane);
}

// (хо1) Nothing ticked is open: the first ticked opens, and the same lane is picked there (the music's - its lane, made when missing).
async function _openFirst(laneKind) {
  const f = _A.ticked()[0];
  if (!f || !f.key) return;
  try { await Store.open(f.key); } catch (e) { _A.say(e.message, true); return; }
  if (laneKind === 'music') { pickMusic(); return; }
  selectTrackById(laneKind === 'subs' ? 'subs' : 'a1');
}

/** "+ music" and the music bubble: the open fragment's music lane picked - "audio 2" made when it has none. */
export function pickMusic() {
  if (!isGroup()) return;
  const openIn = _A.ticked().some((f) => f.n === _A.openN()) || _A.openN() > 0;
  if (!openIn) { _openFirst('music'); return; }
  let lane = openMusicLane();
  if (!lane) {
    let id = '';
    Store.mutate((tl) => { const l = newBedLane(tl.tracks); id = l ? l.id : ''; });
    if (!id) { _A.say('four audio lanes is the limit', true); return; }
    lane = { id };
  }
  selectTrackById(lane.id);
}
/** A bubble's press: that lane's common settings (the first ticked opened when none is). */
export function pickLane(kind) {
  if (!isGroup()) return;
  if (kind === 'music') { pickMusic(); return; }
  if (_A.openN() <= 0) { _openFirst(kind); return; }
  selectTrackById(kind === 'subs' ? 'subs' : 'a1');
}

const _kindOf = (track) => {
  if (!track) return '';
  if (track.kind === 'subs') return 'subs';
  if (track.id === 'a1') return 'speech';
  if (track.kind === 'audio') { const m = openMusicLane(); return m && m.id === track.id ? 'music' : ''; }
  return '';
};

// ── «example» on the preview ((хо7)) ────────────────────────────────────────
// A whole page: as many «example» in a line as the lane's words, in as many lines - the open fragment's look, standing still.
function _sampleTl(over) {
  const tl = _tl();
  const lane = _openSubs();
  if (!tl || !lane) return null;
  const st = Object.assign({}, lane.style || {}, over || {});
  for (const k of ['mix', 'anims', 'mixSeed', 'fonts']) delete st[k];
  Object.assign(st, { enter: 'none', leave: 'none', appear: 'none' });
  const fmt = tl.format || '9:16';
  const style = normalizeStyle(st);
  const per = +style.wordsPerLine > 0 ? +style.wordsPerLine : autoWordsPerLine(fmt);
  const n = per * Math.max(1, Math.min(3, Math.round(+style.lines || 2)));
  // Cut by the very rule a page is cut by (pages.js): as many as fit in its lines at its size - the page a real one can be.
  const said = Array.from({ length: n }, (_, i) => ({ text: 'example', start: i * 0.3, end: i * 0.3 + 0.25 }));
  const first = (paginate(said, { lane: style, format: fmt })[0] || {}).words || [];
  const words = (first.length ? first : said.slice(0, 1).map(() => ({ w: 'example' }))).map((w) => ({ w: w.w || 'example', s: 0, e: 0 }));
  return { format: fmt, tracks: [{ id: 'subs', kind: 'subs', name: 'Subtitles', style,
    clips: [{ id: 'hlg-sample', start: 0, dur: 36000, name: words.map((w) => w.w).join(' '), words, src: null }] }] };
}
function _checkSample() {
  if (_sampleRaf) cancelAnimationFrame(_sampleRaf);
  _sampleRaf = requestAnimationFrame(() => {
    _sampleRaf = 0;
    const over = document.getElementById('mv3-over');
    const want = isGroup() && !!(over && over.classList.contains('is-open') && over.querySelector('[data-hl-group="subs"]')) && !!_openSubs();
    if (want) {
      const tl = _sampleTl();
      _sample = true;
      CapPlace.setSample({ tl, onDrop: (place) => _subsPatch({ place }) });
    } else if (_sample) {
      _sample = false;
      CapPlace.setSample(null);
    }
  });
}

// ── The bubbles over the timeline ((хо1), (хо14)) ───────────────────────────
// While a group is ticked, a bubble on each of the three lanes, right of its name, its tail pointing at it: a press on it gives
// that lane's common settings. The music's - "+ music" where its lane will stand - when the open fragment has none. ✕ closes
// them for this group of ticks; "don't show again" for good. The names stay gold while a group is ticked.
const LS_TIPS = 'mv3_hlg_tips_v1';
let _tips = null;               // { subs, speech, music } - the bubbles on the screen
let _tipsClosed = '';           // the group (its project and ticks) whose bubbles were closed
const _tipsOff = () => { try { return !!(JSON.parse(localStorage.getItem(LS_TIPS) || '{}') || {}).off; } catch (e) { return false; } };
function _tipsNever(on) { try { localStorage.setItem(LS_TIPS, JSON.stringify(on ? { off: true } : {})); } catch (e) { /* shown again next time */ } }
const _groupSig = () => (_A ? _A.pid() + ':' + _A.ticked().map((f) => f.n).join(',') : '');

function _tipsHide() {
  if (!_tips) return;
  for (const b of Object.values(_tips)) b.remove();
  _tips = null;
}
function _tipBox(kind, text) {
  const box = _el('div', 'bub is-tip is-lane');
  box.setAttribute('role', 'note');
  const t = _el('span', 'bub-go', text);
  t.title = 'Press: the common settings of the ticked fragments';
  t.addEventListener('click', () => pickLane(kind));
  box.appendChild(t);
  if (kind === 'subs') {
    const never = _el('label', 'bub-never');
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = _tipsOff();
    tick.addEventListener('change', () => { _tipsNever(tick.checked); if (tick.checked) _tipsHide(); });
    never.append(tick, document.createTextNode(' don\'t show again'));
    box.appendChild(never);
  }
  const x = _el('button', 'bub-x', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  x.addEventListener('click', () => { _tipsClosed = _groupSig(); _tipsHide(); });
  box.appendChild(x);
  document.body.appendChild(box);
  return box;
}
// A lane's name on the screen, inside the timeline's view - else null.
function _label(id) {
  const tl = document.getElementById('mv3-timeline');
  const e = id && document.querySelector('#mv3-timeline .mv3b-row[data-track="' + id + '"] .mv3b-lbl');
  if (!tl || !e) return null;
  const r = e.getBoundingClientRect(), v = tl.getBoundingClientRect();
  const mid = r.top + r.height / 2;
  return r.width > 0 && r.height > 0 && mid > v.top && mid < v.bottom ? r : null;
}
function _place(box, r, dy) {
  const H = window.innerHeight;
  const bh = box.offsetHeight;
  box.style.left = Math.round(r.right + 10) + 'px';
  box.style.top = Math.round(Math.max(6, Math.min(H - bh - 6, r.top + r.height / 2 + (dy || 0) - bh / 2))) + 'px';
  box.style.visibility = '';
}
function _gold(on, musicId) {
  let st = document.getElementById('mv3-hlg-gold');
  if (!st) { st = document.createElement('style'); st.id = 'mv3-hlg-gold'; document.head.appendChild(st); }
  const ids = on ? ['subs', 'a1'].concat(musicId ? [musicId] : []) : [];
  const css = ids.length ? ids.map((id) => '#mv3-timeline .mv3b-row[data-track="' + id + '"] .mv3b-lbl').join(',') + '{color:var(--gold)}' : '';
  if (st.textContent !== css) st.textContent = css;
}
function _tipsTick() {
  const group = isGroup() && _A.openN() >= 0 && !!document.getElementById('mv3-timeline');
  const music = group ? openMusicLane() : null;
  _gold(group, music && music.id);
  if (_tipsClosed && _tipsClosed !== _groupSig()) _tipsClosed = '';
  const show = group && !_tipsOff() && !_tipsClosed && !Layers.blocked() && document.visibilityState !== 'hidden';
  if (!show) { _tipsHide(); return; }
  const n = _A.ticked().length;
  const rs = _label('subs'), ra = _label('a1'), rm = music ? _label(music.id) : null;
  const want = { subs: rs && 'Subtitles of all ' + n, speech: ra && 'Main audio of all ' + n, music: (rm || ra) && (rm ? 'Music of all ' + n : '+ music for all ' + n) };
  if (_tips && _tips.music && !!_tips.music.dataset.add !== !rm) _tipsHide();
  if (!_tips) _tips = {};
  for (const k of ['subs', 'speech', 'music']) {
    if (!want[k]) { if (_tips[k]) { _tips[k].remove(); delete _tips[k]; } continue; }
    if (!_tips[k]) { _tips[k] = _tipBox(k, want[k]); if (k === 'music' && !rm) _tips[k].dataset.add = '1'; }
    else if (_tips[k].firstChild.textContent !== want[k]) _tips[k].firstChild.textContent = want[k];
  }
  if (_tips.subs) _place(_tips.subs, rs);
  if (_tips.speech) _place(_tips.speech, ra, rm ? 0 : -6);
  // No music lane yet: where it will stand - under main audio.
  if (_tips.music) _place(_tips.music, rm || ra, rm ? 0 : ra.height / 2 + 8);
}

// ── Wiring ──────────────────────────────────────────────────────────────────
/** highlights.js lends what it knows of the project; the lanes' names are taken over while a group is ticked. */
export function initGroup(api) {
  _A = api;
  Views.laneAlt({
    // A lane's name while a group is ticked - unless it is the open fragment's own Subtitles opened from its row ((хо15)).
    wants: (track) => {
      if (!isGroup()) return false;
      const k = _kindOf(track);
      if (!k) return false;
      if (k === 'subs' && _own && _own === Store.key()) return false;
      return true;
    },
    render: (host, track) => {
      const k = _kindOf(track);
      // (хо1) The project's own timeline: the first ticked opens, the lane picked there.
      if (_A.openN() <= 0) { host.appendChild(_el('p', 'mv3-ins-note', 'Opening the first ticked fragment…')); _openFirst(k); return null; }
      if (k === 'subs') return renderSubs(host, (box) => _A.tiles(box));
      if (k === 'speech') renderSpeech(host);
      else renderMusic(host);
      _checkSample();
      return null;
    },
  });
  // The pick moved off the open fragment's own Subtitles: the group's again at the next press of a name.
  onSelChange(() => {
    const t = selectedTrack();
    if (_own && !(t && t.kind === 'subs' && Store.key() === _own)) _own = '';
    _checkSample();
  });
  Store.onChange(() => { if (_own && Store.key() !== _own) _own = ''; _checkSample(); });
  Views.onAltShown(() => _checkSample());
  // The bubbles follow the lanes as they scroll, grow and are drawn again.
  setInterval(_tipsTick, 250);
  window.addEventListener('resize', _tipsTick);
}

/** The group's state changed (ticks, a read of the record): what shows follows. */
export function changed() { _checkSample(); }
