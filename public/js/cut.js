// CUTTING PIECES OUT OF ANY VIDEO (phase TG, block 7; the owner 2026-10-21: "в просмотре медиа и в uploads и в birols,
// где угодно в видео можно обрезать"; "когда пользователь выбрал фрагмент обрезки, нужно предложить в попапе куда
// сохранить обрезок"; "вариант Б, но в обрезке можно галочкой отобразить оригинал, где бы этот кусок не находился и
// обрезать еще раз и создастся новый файл").
//
// SEVERAL FRAGMENTS, A JOIN, THE SCENES, ITS SOUND (phase V81, the owner 2026-11-09: "надо пользователю дать возможность на одном
// видео сделать сразу несколько выделений ... две опции при сохранении - сохранить и сразу склеить выделеное, либо сохранить каждый
// фрагмент отдельно ... видео проанализировалось и сразу же нарезалось на сцены ... правой кнопкой мыши пользователь может нажать на
// фрагмент и сохранить фрагмент отдельно"; "в меню правой кнопки будет save audio"; "после нарезки на сцены, с зажатым ctrl можно
// выделять нужные сцены и правой кнопкой добавить на таймлайн ... добавить раздельно или добавить сразу одним файлом").
//
// ONE module for every viewer of a video: the Library's and Merge's (js/library/viewer.js - `underStage`, `videoSrc`, a row of
// `extraRows`) and the post viewer of REFERENCES (js/references/post.js, `cutBox` per file of a post).
//
//   under the video   the bar of fragments (js/ranges.js; the rule js/cuts/parts.js) and a row: ▶ (only the fragments, one
//                     after another), "Scenes" (lib/scenes.js lays a video's scenes edge to edge - one step back), how many
//                     and how long, "Save…" - "Join into one" / "Each separately", then ONE window "save the pieces to" (the
//                     place picker js/place-tree.js over js/media-targets.js, the clip's own place on top) and the work
//                     (POST /api/library/cuts) with its count and "stop". The video itself stays as it is.
//   right button      on the video: "Save audio" (a row per sound track - into the root of AUDIO since 2026-11-09, the
//                     owner's (в19)-(в21); POST /api/audio/from-video)
//                     and "Save video as…" (what the shell's own menu had); on a fragment: "Save this fragment…" / "Save N
//                     fragments…", "Save its audio", "Delete" - and in Merge (`o.lay`) "Add to timeline · separately" (each a
//                     clip of this file, no new file) and "· as one file" (the join made first, beside the video).
//   right column      a piece has "original": ticked, the stage shows the WHOLE video it was cut from with the piece's
//                     fragment - or a join's fragments - on the bar; a save from there is another new piece.
//   keys              while the viewer is on top: Delete, Escape (the pick first, (в16)), Ctrl+Z / Ctrl+Y - the bar's.
//
// Not cut here: talking heads (their project's) and renders - they have the right button's Save audio only.

import { rangesBar } from './ranges.js';
import { joinedLen } from './cuts/parts.js';
import { whereText } from './media-targets.js';
import { openPlaces, closePlaces } from './place-tree.js';
import { menuAt } from './tile-select.js';
import { showError, showToast } from './notice.js';
import * as Layers from './layers.js';

const CUTTABLE = new Set(['birols', 'uploads', 'hooks', 'youtube']);
const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
export const mmss = (s) => {
  const t = Math.max(0, Math.round(+s || 0));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
};
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const clean = (p) => String(p || '').split('?')[0];

// Which pieces show their whole video now - by viewer item. Forgotten when a viewer opens (`reset`).
const _whole = new Set();
const _key = (it) => (it ? it.kind + ':' + it.id : '');
// (phase V81, (в18)) The fragments drawn over each video while its viewer is open - and their steps back.
const _states = new Map();

export function reset() { _whole.clear(); _states.clear(); }

/** A video of the Media shelf that may be cut. */
export function cuttable(it) {
  return !!(it && CUTTABLE.has(it.kind) && VIDEO_RE.test(String(it.media || '')));
}

/** What the viewer's stage plays: the whole video while "original" is ticked, else the clip's own file. */
export function videoSrc(it) {
  const o = it && it.meta && it.meta.original;
  return (o && _whole.has(_key(it))) ? o.path : null;
}

/** The right column's "original" for a piece, or null. `repaint` draws the viewer again. */
export function originalRow(it, repaint) {
  const o = it && it.meta && it.meta.original;
  if (!o || !o.path) return null;
  return ['original', originalTick(o, _whole.has(_key(it)), (on) => {
    if (on) _whole.add(_key(it)); else _whole.delete(_key(it));
    repaint();
  })];
}

/** The tick itself: "whole video" and what the piece is of it. */
export function originalTick(o, on, onToggle) {
  const lab = el('label', 'cut-orig');
  lab.title = 'Show the whole video this piece was cut from - and cut another piece from it (a new clip again)';
  const box = el('input');
  box.type = 'checkbox'; box.classList.add('u-check');
  box.checked = !!on;
  box.addEventListener('change', () => onToggle(box.checked));
  const txt = el('span', 'cut-orig-txt');
  txt.appendChild(el('b', null, 'show the whole video'));
  const nm = String(o.name || '');
  const parts = Array.isArray(o.parts) && o.parts.length ? o.parts : null;
  txt.appendChild(el('small', null, (parts
    ? 'this clip is ' + plural(parts.length, 'piece') + (o.dur ? ' of ' + mmss(o.dur) : '') + ', joined'
    : 'this piece is ' + mmss(o.in) + '–' + mmss(o.out) + (o.dur ? ' of ' + mmss(o.dur) : ''))
    + (nm ? ' · ' + (nm.length > 48 ? nm.slice(0, 46) + '…' : nm) : '')));
  if (nm) lab.title += ' - of: ' + nm;
  lab.append(box, txt);
  return lab;
}

/**
 * What hangs under a viewer's video: the bar and its row - null for what is not cut here. Every video gets its right button
 * (Save audio, Save video as…) here, cut or not. `o`: { say, onSaved, lay } - see cutBox.
 */
export function underStage(it, video, o) {
  const m = (it && it.meta) || {};
  const whole = !!(m.original && _whole.has(_key(it)));
  const src = whole ? m.original.path : it.media;
  const name = whole ? (m.original.name || it.name || '') : (it.name || '');
  if (!cuttable(it)) {
    if (video && VIDEO_RE.test(String(it && it.media || ''))) wireVideoMenu(video, { src, name, say: o && o.say });
    return null;
  }
  const here = ['birols', 'uploads', 'hooks'].includes(it.kind) ? { kind: it.kind, cat: m.categoryId || '' } : null;
  const start = whole ? (Array.isArray(m.original.parts) && m.original.parts.length ? m.original.parts : [m.original]) : null;
  return cutBox(video, { src, start, here, whole, name, key: _key(it) + (whole ? ':whole' : ''), kind: it.kind,
    libId: it.libId || it.id || '' }, o);
}

// ── the keyboard: the bar of the viewer on top ───────────────────────────────
const _bars = new Set();
let _keysWired = false;
function _wireKeys() {
  if (_keysWired) return;
  _keysWired = true;
  // Ahead of js/layers.js (which hears the document, capturing): Escape lets a fragment go before it closes the viewer.
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    const top = Layers.top();
    for (const b of [..._bars]) {
      if (!b.el.isConnected) { _bars.delete(b); continue; }
      if (!top || !top.el || !top.el.contains(b.el)) continue;
      if (b.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    }
  }, true);
}

/**
 * The bar of fragments under `video` and its row.
 *   piece { src, start?: [{ in, out }], here?: { kind, cat }, whole?, name?, key?, kind?, libId? }
 *         src - the file shown (whose seconds the fragments are in); start - fragments to begin with (a piece's place in its
 *         whole video)
 *   o { say(text, isError), onSaved({ where, pieces }), lay?: { pieces(list, file) } }
 *         lay - Merge only: "Add to timeline"; `file` { src, name, thumb, dur, kind, libId }, list [{ in, out }] of it
 */
export function cutBox(video, piece, o) {
  const opt = o || {};
  const say = (t, err) => { if (typeof opt.say === 'function') opt.say(t, err); };
  const key = piece.key || clean(piece.src);
  let state = _states.get(key);
  if (!state) {
    state = { parts: (piece.start || []).map((p) => ({ in: +p.in, out: +p.out })), undo: [], redo: [] };
    _states.set(key, state);
  }
  const wrap = el('div', 'cut-box');
  let _busy = null;                  // the work going: { kind: 'save' | 'scenes', stop() }
  const bar = rangesBar(video, {
    src: piece.src, state,
    onChange: () => paint(),
    onMenu: (e, hit) => {
      if (!hit.part) { videoMenu(e, { src: piece.src, name: piece.name, say }); return; }
      _partMenu(e, hit);
    },
  });
  _bars.add(bar);
  _wireKeys();
  wrap.appendChild(bar.el);

  const row = el('div', 'cut-row');
  const play = el('button', 'cut-play u-btn is-s', '▶');
  play.type = 'button';
  play.title = 'Play - only the fragments, one after another (as the join will be); with none, the whole video';
  const scenes = el('button', 'cut-scenes u-btn is-s', 'Scenes');
  scenes.type = 'button';
  scenes.title = 'Find where the shots change and lay every scene as a fragment - what is drawn goes (Ctrl+Z brings it back)';
  const info = el('span', 'cut-info');
  const save = el('button', 'cut-save u-btn is-s is-main', 'Save…');
  save.type = 'button';
  row.append(play, scenes, info, save);
  wrap.appendChild(row);

  function paint() {
    const parts = bar.parts();
    const n = parts.length;
    if (!_busy) {
      info.textContent = n ? plural(n, 'fragment') + ' · ' + mmss(joinedLen(parts)) : 'Sweep over the bar to mark a fragment';
      info.classList.toggle('is-hint', !n);
    }
    save.disabled = !n || !!_busy;
    save.title = n ? 'Save the fragments as new clips - joined into one, or each of its own; this video stays as it is'
      : 'Draw a fragment over the bar first';
  }
  const playPaint = () => { play.textContent = video.paused ? '▶' : '❚❚'; };
  play.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  video.addEventListener('play', playPaint);
  video.addEventListener('pause', playPaint);

  // ── the work: saving, finding the scenes ──
  const busyRow = (text, stop) => {
    info.replaceChildren(el('span', null, text));
    info.classList.remove('is-hint');
    if (stop) {
      const x = el('button', 'cut-stop u-btn is-s is-quiet', 'stop');
      x.type = 'button';
      x.addEventListener('click', stop);
      info.appendChild(x);
    }
  };

  async function run(parts, join, to) {
    if (_busy) return null;
    const res = await fetch('/api/library/cuts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src: piece.src, parts, join, to: { kind: to.kind, cat: to.cat || '', label: to.label || '' } }),
    }).then((x) => x.json()).catch((e) => ({ success: false, error: e.message }));
    if (!res || !res.success) { say('Not saved: ' + ((res && res.error) || 'no answer'), true); return null; }
    const job = res.job;
    const stop = () => fetch('/api/library/cuts/' + job, { method: 'DELETE' }).catch(() => {});
    _busy = { kind: 'save', stop };
    paint();
    let st = null;
    for (;;) {
      st = await fetch('/api/library/cuts/' + job).then((x) => x.json()).catch(() => null);
      if (!st || !st.success) break;
      if (wrap.isConnected) busyRow((join ? 'Joining ' + plural(parts.length, 'fragment') + '…' : 'Saving ' + Math.min(st.done + 1, st.total || parts.length) + ' / ' + (st.total || parts.length) + '…'), stop);
      if (st.state !== 'working') break;
      await new Promise((r) => setTimeout(r, 700));
    }
    _busy = null;
    if (wrap.isConnected) paint();
    if (!st || !st.success) { say('Not saved: the work was lost', true); return null; }
    const pieces = st.pieces || [];
    const where = whereText(to);
    if (st.state === 'failed') say('Not saved: ' + (st.error || 'the cut failed') + (pieces.length ? ' (' + plural(pieces.length, 'clip') + ' saved first)' : ''), true);
    else if (st.state === 'stopped') say('Stopped - ' + plural(pieces.length, 'clip') + ' saved in ' + where + '.');
    else say('Saved ' + (join ? 'as one clip' : plural(pieces.length, 'clip')) + ' in ' + where + '.');
    if (pieces.length && typeof opt.onSaved === 'function') { try { opt.onSaved({ where, pieces, to }); } catch (e) { /* the page's */ } }
    return { state: st.state, pieces };
  }

  // "Join into one" / "Each separately" - then one window of places for all of them.
  function saveMenu(anchor, parts, x, y) {
    if (!parts.length || _busy) return;
    const many = parts.length > 1;
    const ask = (join) => _places(anchor, piece, parts, join, (to) => run(parts, join, to));
    if (!many) { ask(false); return; }
    const r = anchor.getBoundingClientRect();
    menuAt(x != null ? x : r.left, y != null ? y : r.bottom + 4, [
      ['Join into one', 'one new clip of the ' + parts.length + ' fragments, in the order of time', () => ask(true)],
      ['Each separately', parts.length + ' new clips, each its own', () => ask(false)],
    ]);
  }
  save.addEventListener('click', () => saveMenu(save, bar.parts()));

  scenes.addEventListener('click', async () => {
    if (_busy) return;
    const src = clean(piece.src);
    let cancelled = false;
    const stop = () => { cancelled = true; fetch('/api/library/scenes?src=' + encodeURIComponent(src), { method: 'DELETE' }).catch(() => {}); };
    _busy = { kind: 'scenes', stop };
    scenes.disabled = true;
    paint();
    let d = null;
    for (;;) {
      d = await fetch('/api/library/scenes?src=' + encodeURIComponent(src)).then((x) => x.json()).catch(() => null);
      if (cancelled || !d || !d.success || d.state !== 'working' || !wrap.isConnected) break;
      busyRow('Finding the scenes… ' + (d.pct || 0) + ' %', stop);
      await new Promise((r) => setTimeout(r, 700));
    }
    _busy = null;
    scenes.disabled = false;
    if (!wrap.isConnected) return;
    if (cancelled) { paint(); say('The scenes were not looked for.'); return; }
    if (!d || !d.success || d.state !== 'done') { paint(); say('The scenes were not found: ' + ((d && d.error) || 'no answer'), true); return; }
    const list = (d.scenes || []).map((s, i) => ({ in: s.in, out: s.out, label: 'scene ' + (i + 1) }));
    bar.setParts(list);
    bar.setMarks(list.slice(1).map((s) => s.in));
    paint();
    say(plural(list.length, 'scene') + ' - each is a fragment now. Ctrl + a press picks several; Ctrl+Z brings back what was drawn.');
  });

  // ── the right button on a fragment ──
  function _partMenu(e, hit) {
    const picked = bar.picked();
    const list = picked.length ? picked : [hit.part];
    const n = list.length;
    const rows = [];
    if (n === 1) {
      rows.push(['Save this fragment…', mmss(list[0].in) + '–' + mmss(list[0].out) + ' as a new clip', () => saveMenu(save, list, e.clientX, e.clientY)]);
      rows.push(['Save its audio', 'its sound · into AUDIO', () => saveAudio({ src: piece.src, name: piece.name, in: list[0].in, out: list[0].out, say })]);
    } else {
      rows.push(['Save ' + n + ' fragments · joined…', 'one new clip of them, in the order of time', () => _places(save, piece, list, true, (to) => run(list, true, to))]);
      rows.push(['Save ' + n + ' fragments · each…', n + ' new clips, each its own', () => _places(save, piece, list, false, (to) => run(list, false, to))]);
    }
    if (opt.lay && typeof opt.lay.pieces === 'function') {
      rows.push(['Add to timeline · separately', (n === 1 ? 'a clip' : n + ' clips') + ' of this video from the playhead - no new file', () => _laySeparately(list)]);
      rows.push(['Add to timeline · as one file', 'joined into one clip beside this video, then laid', () => _layJoined(list)]);
    }
    rows.push([n === 1 ? 'Delete' : 'Delete ' + n, 'take ' + (n === 1 ? 'it' : 'them') + ' off the bar (Ctrl+Z brings back)', () => bar.del(), true]);
    menuAt(e.clientX, e.clientY, rows);
  }

  async function _laySeparately(list) {
    const tr = await tracksOf(piece.src);
    const file = { src: clean(piece.src), name: piece.name || '', thumb: '', dur: bar.dur(), kind: piece.kind || '', libId: piece.libId || '', sound: tr.length > 0 };
    try { opt.lay.pieces(list, file); } catch (e) { showError('Not laid', { detail: e.message }); }
  }
  async function _layJoined(list) {
    const to = piece.here && ['birols', 'uploads', 'hooks'].includes(piece.here.kind) ? piece.here : { kind: 'uploads', cat: '', label: '' };
    const r = await run(list, true, to);
    const p = r && r.pieces && r.pieces[0];
    if (!p || r.state !== 'done') return;
    const tr = await tracksOf(p.src);
    try {
      opt.lay.pieces([{ in: 0, out: +p.dur || joinedLen(list) }],
        { src: p.src, name: p.name, thumb: p.thumb || '', dur: +p.dur || 0, kind: to.kind, libId: '', sound: tr.length > 0 });
    } catch (e) { showError('Not laid', { detail: e.message }); }
  }

  // The video's own right button: Save audio, Save video as…
  wireVideoMenu(video, { src: piece.src, name: piece.name, say });
  paint();
  playPaint();
  return wrap;
}

// ── the window "save the pieces to" ──────────────────────────────────────────
// (phase V39) A tree of the places (js/place-tree.js): REFERENCES and VIDEO folded, the clip's own place on top as
// "BESIDE IT"; "+ new category…" in REFERENCES, Uploads and B-rolls. One window for every piece of a press (phase V81).
export function closeMenu() { closePlaces(); }

async function _places(anchor, piece, parts, join, go) {
  closePlaces();
  let tree = [];
  try { const d = await fetch('/api/library/tree').then(r => r.json()); tree = (d && d.nodes) || []; } catch (e) { tree = []; }
  if (!anchor.isConnected) return;
  const n = parts.length;
  const title = n === 1
    ? 'Save the piece ' + mmss(parts[0].in) + '–' + mmss(parts[0].out) + ' (' + (parts[0].out - parts[0].in).toFixed(1) + ' s) as a new clip in'
    : join ? 'Save the ' + n + ' fragments joined (' + mmss(joinedLen(parts)) + ') as a new clip in'
      : 'Save the ' + n + ' fragments as ' + n + ' new clips in';
  openPlaces(anchor, {
    title, tree, here: piece.here || null, above: true, alignRight: true, cls: 'cut-menu', name: 'cut-menu',
    places: { images: false, refHome: 'its site\'s folder (no folder of yours)', newCats: ['references', 'uploads', 'birols'] },
    onPick: go,
  });
}

// ── a video's sound (phase V81) ──────────────────────────────────────────────
const _tracks = new Map();
/** The video's sound tracks [{ k, label, def }] - [] for a video with none. */
export async function tracksOf(src) {
  const s = clean(src);
  if (_tracks.has(s)) return _tracks.get(s);
  const d = await fetch('/api/audio/tracks?src=' + encodeURIComponent(s)).then((r) => r.json()).catch(() => null);
  const list = (d && d.success && Array.isArray(d.tracks)) ? d.tracks : [];
  if (d && d.success) _tracks.set(s, list);
  return list;
}

/** One sound track of a video (whole, or [in, out)) into the root of AUDIO - a popup says where. */
export async function saveAudio(o) {
  const say = typeof o.say === 'function' ? o.say : () => {};
  const body = { src: clean(o.src), name: o.name || '' };
  if (o.track != null) body.track = o.track;
  if (o.in != null && o.out != null) { body.in = o.in; body.out = o.out; }
  say('Taking the sound…');
  const d = await fetch('/api/audio/from-video', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch((e) => ({ success: false, error: e.message }));
  if (!d || !d.success) {
    say('');
    showError('The sound was not saved', { detail: (d && d.error) || 'no answer' });
    return null;
  }
  say('Saved the sound in AUDIO.');
  showToast({ mark: '♪', title: 'Saved · ' + ((d.item && d.item.name) || 'the sound'), where: 'AUDIO' });
  return d.item;
}

// "Save video as…" - the shell's Save dialog, as its own menu offered before the page had one.
function _download(src, name) {
  const a = document.createElement('a');
  a.href = clean(src);
  const ext = (/\.([a-z0-9]{2,4})$/i.exec(clean(src)) || [, 'mp4'])[1];
  a.download = (String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'video') + '.' + ext;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The right button's menu for a video: Save audio (a row per sound track), Save video as… */
export async function videoMenu(e, o) {
  const x = e.clientX, y = e.clientY;
  const tr = await tracksOf(o.src);
  const rows = [];
  if (!tr.length) rows.push(['Save audio', 'this video has no sound', null]);
  else tr.forEach((t) => rows.push(['Save audio' + (tr.length > 1 ? ' · ' + t.label : ''), 'its sound · into AUDIO',
    () => saveAudio({ src: o.src, name: o.name, track: t.k, say: o.say })]));
  rows.push(['Save video as…', 'a copy of the file wherever you choose', () => _download(o.src, o.name)]);
  menuAt(x, y, rows);
}

/** The video element's own right button (once per element). */
export function wireVideoMenu(video, o) {
  if (!video || video.__cutMenu) return;
  video.__cutMenu = true;
  video.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); videoMenu(e, o); });
}
