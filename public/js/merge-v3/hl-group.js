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
     pattern      (phase V74, the owner's (пт7)) main video's patterns - the set with ticks and the layers with their settings, as the
                  one lane's strip has them (patterns-ui.js): each change puts the WHOLE list on all of them; each fragment its own
                  list, a press opens it with its main video picked.
     music        the volume for all - the lane's, in dB, so each keeps its own balance ~10 dB under its speech ((хо4)); "deal
                  again" from moods, or no music; each fragment its track and a choice of another one of its mood, one of a
                  mood, or none ((хо9)) - the server measures and lays it (routes/highlights.js), only the app's clips replaced
                  ((хо11)). No music lane on the open fragment: "+ music" makes its "audio 2" (the owner: "если нет, то можно
                  добавить").
   The OPEN fragment among the ticked is the page's - its own undo step; the others are the server's. No undo for several ((хо5)):
   a slider brought back gives back the same pages and place. Nothing ticked open and a lane's name pressed on the project's own
   timeline: the first ticked opens ((хо1)).

   CHANGED (phase V66.1, the owner 2026-11-03, (хо24)-(хо28)): while a group is ticked the TIMELINE'S PANEL IS COVERED BY THREE
   BUTTONS - Subtitles, main audio, music - for all N (no lanes, no transport; the bubbles and gold names went); a fragment's row in
   the strip shows its own timeline until "‹ all N". (Phase V74: a fourth, "pattern".)

   THE SAMPLE ((хо7)): while the Subtitles block is in the strip, the preview draws a whole page of «example» - as many words in a
   line as the lanes have, in as many lines - in the open fragment's look, instead of its subtitles (captions/layer.js setLive),
   and it is dragged up and down there (cap-place.js setSample); let go, the place is written for all.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Views from './lib-views.js';
import * as C from './controls.js';
import * as CapPlace from './cap-place.js';
import { fitTimeline } from './layout.js';
import { setSubsStyle, selectTrackById, onSelChange, newBedLane, mainVideo, patternsOf, setPatterns } from './timeline-b.js';
// (phase V74) Main video's patterns, picked by ticks - the one lane's block, for all of them.
import { renderPatterns, nameOf as patternName } from './patterns-ui.js';
import { normalizeStyle, autoWordsPerLine, autoSize, POSITIONS, rowsOn } from '../captions/style.js';
import { paginate } from '../captions/pages.js';
import { putTitle, dropTitle, titleLaneOf, topTitleOf } from '../captions/title.js';

let _A = null;              // what highlights.js lends: { pid, rec, ticked, openN, load, say, whole, tiles(host) }
let _own = '';              // a fragment opened from its row with its OWN Subtitles picked ((хо15)) - its key
let _busy = '';             // 'subs' | 'speech' | 'music' | 'pattern' while a write for all is under way
let _patWant = null;        // (V74) the patterns waiting to go to the rest while a write of them is under way: { list, ns }
let _moods = null;          // Music -> highlights: [{ id, label, n }] (the root as 'yours' when it has tracks)
let _dealMoods = [];        // the moods "deal again" takes
let _sample = false;        // the «example» is on the preview

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const _enc = encodeURIComponent;
async function _post(url, body) {
  let r = null, d = null;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); d = await r.json(); } catch (e) { d = null; }
  if (!r || !d || !d.success) throw new Error((d && d.error) || 'The app did not answer - try again in a moment.');
  return d;
}

// ── Who is in the group ─────────────────────────────────────────────────────
/** Two fragments or more ticked (made) - the buttons over the timeline lead to the common settings ((хо1), V66.1 (хо24)). */
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
    return { pos: st.pos, ty: st.ty, size: st.size, sizeAuto: st.sizeAuto !== false, wordsPerLine: st.wordsPerLine, lines: st.lines, hold: !!st.hold, own,
      rows: rowsOn(st) ? 2 : 1 };
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
    // (phase V71) Two rows, or one - no field.
    if (patch.rows != null) p.rows = +patch.rows === 2 ? 2 : undefined;
    setSubsStyle(lane.id, p, patch.size != null || patch.wordsPerLine != null || patch.lines != null);
  }, (ns) => _post('/api/highlights/' + _enc(_A.pid()) + '/style', { ns, ...patch }), said);
}

/**
 * (phase V74, (пт7)) Main video's patterns - the whole list - for all the ticked: the open one by the page (its own undo step), the
 * rest by the server, the latest list only while one is on its way (a tick after a tick sends both).
 */
async function _patternsAll(next) {
  if (_busy && _busy !== 'pattern') { _A.say('A moment - the last change is still being put on them.', true); return; }
  const { open, rest } = _split();
  if (open) setPatterns(next);
  if (!rest.length) { Views.altChanged(); return; }
  _patWant = { list: next, ns: rest.map((f) => f.n) };
  if (_busy === 'pattern') return;
  _busy = 'pattern';
  Views.altChanged();
  while (_patWant) {
    const w = _patWant;
    _patWant = null;
    try { await _post('/api/highlights/' + _enc(_A.pid()) + '/patterns', { ns: w.ns, patterns: w.list }); } catch (e) { _A.say(e.message, true); }
  }
  _busy = '';
  await _A.load();
  Views.altChanged();
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
  // (phase V71, the owner's (хо34)) Two rows for all of them - each page whole while it is spoken, every other one in a second row.
  const rows = C.select([['1', 'one'], ['2', 'two']], String(ref.rows === 2 ? 2 : 1), (v) => _subsPatch({ rows: +v }));
  if (mixed('rows')) rows.title = 'Not the same on all of them now - a choice gives them one';
  box.appendChild(C.row('Rows', rows));
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

// (phase V74, (пт7)) Main video's patterns for all the ticked - the open one's list shown, a change puts the whole list on all.
function renderPattern(host) {
  const list = _A.ticked();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.dataset.hlGroup = 'pattern';
  host.appendChild(box);
  _head(box, 'Patterns', list.length);
  renderPatterns(box, {
    list: () => patternsOf(), write: (next) => { _patternsAll(next); }, repaint: () => Views.altChanged(),
    note: _busy === 'pattern' ? 'Putting them on them…' : 'Over the whole of main video, under the words. A change puts this list - every pattern and its settings - on every ticked fragment.',
  });
  _each(box);
  const ul = _el('ul', 'mv3-hlg-list');
  for (const f of list) {
    const mine = f.n === _A.openN() ? patternsOf() : ((f.lanes && f.lanes.patterns) || []);
    const li = _el('li', 'mv3-hlg-item');
    li.appendChild(_el('span', 'mv3-hlg-name', f.title));
    li.appendChild(_el('span', 'mv3-hlg-what', mine.length ? mine.map((p) => patternName(p.src)).join(', ') : 'no pattern'));
    li.title = 'Open «' + f.title + '» with its own main video - its patterns';
    li.addEventListener('click', () => _openOwn(f, 'main'));
    ul.appendChild(li);
  }
  box.appendChild(ul);
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
    box.appendChild(_el('div', 'mv3-hlg-sub', 'Moods'));
    box.appendChild(chips);
    const deal = C.button(_busy === 'music' ? 'dealing…' : 'deal again', () => _musicAll(false),
      { title: 'Each ticked fragment a new track of these moods - none twice while there are tracks' });
    deal.disabled = !!_busy || !_dealMoods.length;
    const none = C.button('no music', () => _musicAll(true), { title: 'The music taken off every ticked fragment - what you put there yourself stays' });
    none.disabled = !!_busy;
    box.appendChild(C.row('', C.pair(deal, none)));
  }
  _each(box);
  for (const f of list) box.appendChild(C.row(f.title, _trackChoice(f)));
}

// (phase V66.1) ONE fragment's music, on top of its music lane's strip or of the app's clip on it: its track, and the choice of
// another of the standard ones - of its mood, of a mood, or none (the same as its row among the ticked).
const _openFrag = () => {
  const rec = _A && _A.rec();
  const n = _A ? _A.openN() : 0;
  return n > 0 ? ((rec && rec.fragments) || []).find((x) => x.n === n && x.state === 'ready' && !x.deletedAt && x.key) || null : null;
};
function _trackChoice(f) {
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
  return sel;
}
function renderOneMusic(host) {
  const f = _openFrag();
  if (!f) return;
  if (!_moods) _readMoods();
  const box = _el('div', 'mv3-hlg' + (_busy ? ' is-busy' : ''));
  box.appendChild(_el('div', 'mv3-ins-title', 'Music of this fragment'));
  box.appendChild(C.row('Track', _trackChoice(f)));
  box.appendChild(_el('p', 'mv3-ins-note', _busy === 'music' ? 'Laying the track…'
    : 'Another of the standard tracks of Music → highlights - it goes in place of this one, ~10 dB under the speech. What you put on this lane yourself stays.'));
  box.appendChild(_el('div', 'mv3-c-sep'));
  host.appendChild(box);
}

// A volume control for several: "mixed" until moved.
function _mixedVolume(vols, onChange) {
  const db = (v) => (v > 0 ? Math.max(C.DB_MIN, 20 * Math.log10(v)) : C.DB_MIN);
  return C.slider({ min: C.DB_MIN, max: C.DB_MAX, step: 0.5, value: Math.round(db(vols[0] == null ? 1 : vols[0]) * 2) / 2,
    mixed: !_same(vols.map((v) => Math.round(db(v) * 2) / 2)), fmt: C.dbLabel, onChange: (d) => onChange(C.fromDb(d)) });
}

// ── A lane's name pressed ───────────────────────────────────────────────────
// (хо15), (хо26) A fragment opened from its row with its own lane picked - its timeline shown, lanes and all, the one lane's
// strip - until "‹ all N" in the timeline's head (or another fragment opened, or the group gone).
async function _openOwn(f, lane) {
  if (!f.key) return;
  if (Store.key() !== f.key) { try { await Store.open(f.key); } catch (e) { _A.say(e.message, true); return; } }
  _own = f.key;
  // (V74) 'main' - its main video lane, whatever its id.
  selectTrackById(lane === 'main' ? ((mainVideo() || {}).id || 'v1') : lane);
  _sync();
}

// (хо1) Nothing ticked is open: the first ticked opens, and the same lane is picked there (the music's - its lane, made when missing).
async function _openFirst(laneKind) {
  const f = _A.ticked()[0];
  if (!f || !f.key) return;
  try { await Store.open(f.key); } catch (e) { _A.say(e.message, true); return; }
  if (laneKind === 'music') { pickMusic(); return; }
  if (laneKind === 'pattern') { selectTrackById((mainVideo() || {}).id || 'v1'); return; }
  selectTrackById(laneKind === 'subs' ? 'subs' : 'a1');
}

/** "+ music": the open fragment's music lane picked - "audio 2" made when it has none. */
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
/** A button over the timeline: that lane's common settings (the first ticked opened when none is). */
export function pickLane(kind) {
  if (!isGroup()) return;
  if (kind === 'music') { pickMusic(); return; }
  if (_A.openN() <= 0) { _openFirst(kind); return; }
  if (kind === 'pattern') { selectTrackById((mainVideo() || {}).id || 'v1'); return; }
  selectTrackById(kind === 'subs' ? 'subs' : 'a1');
}

const _kindOf = (track) => {
  if (!track) return '';
  if (track.kind === 'subs') return 'subs';
  if (track.id === 'a1') return 'speech';
  // (phase V74) The main video lane - its patterns.
  if (track.kind === 'video') { const m = mainVideo(); return m && m.id === track.id ? 'pattern' : ''; }
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
  const clips = [{ id: 'hlg-sample', start: 0, dur: 36000, name: words.map((w) => w.w).join(' '), words, src: null }];
  // (phase V71, the owner's (хо32)) In two rows: a second page of the sample, where the second row stands - the two move together.
  if (rowsOn(style)) clips.push({ ...clips[0], id: 'hlg-sample2' });
  return { format: fmt, tracks: [{ id: 'subs', kind: 'subs', name: 'Subtitles', style, clips }] };
}
function _checkSampleNow() {
  const want = _shownBlock() === 'subs' && !!_openSubs();
  if (want) {
    _sample = true;
    CapPlace.setSample({ tl: _sampleTl(), onDrop: (place) => _subsPatch({ place }) });
  } else if (_sample) {
    _sample = false;
    CapPlace.setSample(null);
  }
}
const _checkSample = () => _sync();

// ── The buttons in place of the timeline (phase V66.1, the owner 2026-11-03, (хо24)-(хо28)) ───────────────────────────────
// "когда выбрано несколько фрагментов нарезки, то на таймлайне просто отображать эти кнопки для массового редактирования. без элементов
// таймлайна". While a group is ticked the timeline's panel - its head with the transport and its lanes - is covered by the buttons
// of the common settings: compact buttons at its left edge, Subtitles, main audio, music ("+ music" while the open
// fragment has none) and (phase V74) pattern; the one whose block is in the strip is lit. Under them the open fragment stays open - the preview shows its
// frame and «example» (a group with none open opens the first ticked, quietly - (хо24)). A fragment's row in the strip shows ITS
// timeline, lanes and all, with "‹ all N" in the timeline's head back to the buttons ((хо26)); fewer than two ticked - the timeline as
// it was ((хо28)). No bubbles, no gold names ((хо27)).
let _panel = null;             // the buttons over the timeline
let _back = null;              // "‹ all N" in the timeline's head while a fragment is shown on its own
let _opening = false;          // the first ticked being opened under the buttons
const _ownNow = () => !!(_own && _own === Store.key());

function _shownBlock() {
  const over = document.getElementById('mv3-over');
  const b = over && over.classList.contains('is-open') && over.querySelector('[data-hl-group]');
  return b ? b.dataset.hlGroup : '';
}
function _panelPaint(tl) {
  if (!_panel || !tl.contains(_panel)) {
    _panel = _el('div', 'mv3-hlg-panel');
    tl.appendChild(_panel);
  }
  const n = _A.ticked().length;
  const on = _shownBlock();
  const music = openMusicLane();
  const sig = [n, on, !!music, _busy].join('|');
  if (_panel.dataset.sig === sig) return;
  _panel.dataset.sig = sig;
  _panel.textContent = '';
  for (const [k, label] of [['subs', 'Subtitles'], ['speech', 'main audio'], ['music', music ? 'music' : '+ music'], ['pattern', 'pattern']]) {
    const b = _el('button', 'mv3-hlg-pbtn' + (on === k ? ' is-on' : ''), label + ' · for all ' + n);
    b.type = 'button';
    b.disabled = !!_busy;
    b.addEventListener('click', () => pickLane(k));
    _panel.appendChild(b);
  }
}
function _backPaint() {
  const head = document.querySelector('#mv3-timeline > .mv3-panel-head');
  const want = isGroup() && _ownNow() && !!head;
  if (!want) { if (_back) { _back.remove(); _back = null; } return; }
  if (!_back || !head.contains(_back)) {
    _back = _el('button', 'mv3-iconbtn is-text mv3-hlg-back');
    _back.type = 'button';
    _back.title = 'Back to the buttons of the ticked fragments';
    _back.addEventListener('click', () => { _own = ''; pickLane('subs'); _sync(); });
    const title = head.querySelector('.mv3-panel-title');
    if (title && title.nextSibling) head.insertBefore(_back, title.nextSibling); else head.appendChild(_back);
  }
  _back.textContent = '‹ all ' + _A.ticked().length;
}
let _panelWas = false;
function _panelSync() {
  const tl = document.getElementById('mv3-timeline');
  const want = !!tl && isGroup() && !_ownNow();
  if (tl) tl.classList.toggle('is-hlg', want);
  if (!want) { if (_panel) { _panel.remove(); _panel = null; } }
  else _panelPaint(tl);
  // (V66.1, the owner: "чтобы просто все кнопки вместились") The buttons come: the panel as tall as they are; they go: as its lanes.
  if (want !== _panelWas) { _panelWas = want; fitTimeline(); }
  if (want) {
    // (хо24) A group with no fragment open: the first ticked opens under the buttons - its frame on the preview.
    if (_A.openN() <= 0 && !_opening) {
      const f = _A.ticked()[0];
      if (f && f.key) { _opening = true; Store.open(f.key).catch((e) => _A.say(e.message, true)).finally(() => { _opening = false; }); }
    }
  }
  _backPaint();
}

// What shows follows the ticks, the pick, the store and the strip - once the strip has been drawn (a timer, not a frame: a
// window that paints nothing still follows).
let _syncT = 0;
function _sync() {
  if (_syncT) clearTimeout(_syncT);
  _syncT = setTimeout(() => { _syncT = 0; _panelSync(); _checkSampleNow(); }, 0);
}

// ── Wiring ──────────────────────────────────────────────────────────────────
/** highlights.js lends what it knows of the project; the lanes' names are taken over while a group is ticked. */
export function initGroup(api) {
  _A = api;
  // The bubbles of V66 are gone (V66.1, (хо27)): what they remembered goes too.
  try { localStorage.removeItem('mv3_hlg_tips_v1'); } catch (e) { /* nothing kept */ }
  Views.laneAlt({
    // A lane's name - a button of the panel - while a group is ticked; not on a fragment shown on its own from its row ((хо26)).
    wants: (track) => {
      if (!isGroup() || _ownNow()) return false;
      return !!_kindOf(track);
    },
    render: (host, track) => {
      const k = _kindOf(track);
      // (хо24) The project's own timeline: the first ticked opens, the lane picked there.
      if (_A.openN() <= 0) { host.appendChild(_el('p', 'mv3-ins-note', 'Opening the first ticked fragment…')); _openFirst(k); return null; }
      let out = null;
      if (k === 'subs') out = renderSubs(host, (box) => _A.tiles(box));
      else if (k === 'speech') renderSpeech(host);
      else if (k === 'pattern') renderPattern(host);
      else renderMusic(host);
      _sync();
      return out;
    },
  });
  // (V66.1) One fragment's music lane - not while the group's buttons stand for the lanes.
  Views.laneExtra({
    wants: (track, clip) => {
      if (!_A.pid() || (isGroup() && !_ownNow()) || !_openFrag()) return false;
      const m = openMusicLane();
      return !!(m && track && track.id === m.id && (!clip || _isBed(clip)));
    },
    render: (host) => renderOneMusic(host),
  });
  onSelChange(() => _sync());
  Store.onChange(() => { if (_own && Store.key() !== _own) _own = ''; _sync(); });
  Views.onAltShown(() => _sync());
}

/** The group's state changed (ticks, a read of the record): what shows follows. */
export function changed() {
  if (_own && !isGroup()) _own = '';
  _sync();
}
