// CUTTING A PIECE OUT OF ANY VIDEO (phase TG, block 7; the owner 2026-10-21: "в просмотре медиа и в uploads и в birols,
// где угодно в видео можно обрезать"; "когда пользователь выбрал фрагмент обрезки, нужно предложить в попапе куда
// сохранить обрезок"; "вариант Б, но в обрезке можно галочкой отобразить оригинал, где бы этот кусок не находился и
// обрезать еще раз и создастся новый файл").
//
// ONE module for every viewer of a video: the Library's and Merge's (js/library/viewer.js - `underStage`, `videoSrc`,
// a row of `extraRows`) and the post viewer of REFERENCES (js/references/post.js, `cutBox` per file of a post).
//
//   under the video   the trimmer (js/merge-v3/trim.js) and "Cut…": the window "save the piece to" - the places of the
//                     media tree as a folded tree (js/place-tree.js, phase V39), the clip's own place on top - and the
//                     piece becomes a NEW clip there (POST /api/library/cut). The video itself stays as it is.
//   right column      a piece has "original": ticked, the stage shows the WHOLE video it was cut from, the handles where
//                     the piece was - and a cut from there is another new piece.
//
// Not cut here: talking heads (their project's) and renders.

import { trimmer } from './merge-v3/trim.js';
import { whereText } from './media-targets.js';
import { openPlaces, closePlaces } from './place-tree.js';

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

// Which pieces show their whole video now - by viewer item. Forgotten when a viewer opens (`reset`).
const _whole = new Set();
const _key = (it) => (it ? it.kind + ':' + it.id : '');

export function reset() { _whole.clear(); }

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
  txt.appendChild(el('small', null, 'this piece is ' + mmss(o.in) + '–' + mmss(o.out) + (o.dur ? ' of ' + mmss(o.dur) : '')
    + (nm ? ' · ' + (nm.length > 48 ? nm.slice(0, 46) + '…' : nm) : '')));
  if (nm) lab.title += ' - of: ' + nm;
  lab.append(box, txt);
  return lab;
}

/** What hangs under a viewer's video: the trimmer and "Cut…" - null for what is not cut here. */
export function underStage(it, video, o) {
  if (!cuttable(it)) return null;
  const m = it.meta || {};
  const whole = !!(m.original && _whole.has(_key(it)));
  const here = ['birols', 'uploads', 'hooks'].includes(it.kind)
    ? { kind: it.kind, cat: m.categoryId || '' } : null;
  return cutBox(video, { src: whole ? m.original.path : it.media, start: whole ? m.original : null, here, whole }, o);
}

/**
 * The trimmer under `video` and its "Cut…" button.
 *   piece { src, start?: {in,out}, here?: {kind,cat}, whole? }   the file shown (whose seconds the handles are in)
 *   o { say(text, isError), onSaved({ kind, id, to, where }) }
 */
export function cutBox(video, piece, o) {
  const opt = o || {};
  const say = (t, err) => { if (typeof opt.say === 'function') opt.say(t, err); };
  const wrap = el('div', 'mv3-trimbox cut-box');
  const t = trimmer(video, { start: piece.start || null, onChange: () => paint() });
  wrap.appendChild(t.el);
  const btn = el('button', 'mv3-trimbox-save u-btn is-s is-main', 'Cut…');
  btn.type = 'button';
  wrap.appendChild(btn);
  const paint = () => {
    const g = t.get();
    btn.title = 'Save ' + mmss(g.in) + '–' + mmss(g.out) + ' as a NEW clip - you choose where. '
      + (piece.whole ? 'The whole video and this piece stay as they are.' : 'This video stays as it is.');
  };
  paint();
  btn.addEventListener('click', () => {
    const g = t.get();
    if (!(g.dur > 0)) return;
    if (!piece.start && g.in <= 0.05 && g.out >= g.dur - 0.05) { say('Move a handle first - that is the whole video.', true); return; }
    _menu(btn, piece, g, async (to) => {
      btn.disabled = true;
      btn.textContent = 'Cutting…';
      say('Cutting ' + mmss(g.in) + '–' + mmss(g.out) + '…');
      try {
        const r = await fetch('/api/library/cut', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ src: piece.src, in: g.in, out: g.out, to: { kind: to.kind, cat: to.cat || '', label: to.label || '' } }),
        }).then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || 'not cut');
        say('Saved as a new clip in ' + whereText(to) + '.');
        if (typeof opt.onSaved === 'function') { try { opt.onSaved({ kind: r.kind, id: r.id, to, where: whereText(to) }); } catch (e) { /* the page's */ } }
      } catch (e) {
        say('Not cut: ' + e.message, true);
      }
      if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Cut…'; }
    });
  });
  return wrap;
}

// ── the window "save the piece to" ───────────────────────────────────────────
// (phase V39) A tree of the places (js/place-tree.js): REFERENCES and VIDEO folded, the clip's own place on top as
// "BESIDE IT"; "+ new category…" in REFERENCES, Uploads and B-rolls.
export function closeMenu() { closePlaces(); }

async function _menu(anchor, piece, g, go) {
  closePlaces();
  let tree = [];
  try { const d = await fetch('/api/library/tree').then(r => r.json()); tree = (d && d.nodes) || []; } catch (e) { tree = []; }
  if (!anchor.isConnected) return;
  openPlaces(anchor, {
    title: 'Save the piece ' + mmss(g.in) + '–' + mmss(g.out) + ' (' + (g.out - g.in).toFixed(1) + ' s) as a new clip in',
    tree, here: piece.here || null, above: true, alignRight: true, cls: 'cut-menu', name: 'cut-menu',
    places: { images: false, refHome: 'its site\'s folder (no folder of yours)', newCats: ['references', 'uploads', 'birols'] },
    onPick: go,
  });
}
