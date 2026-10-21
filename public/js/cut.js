// CUTTING A PIECE OUT OF ANY VIDEO (phase TG, block 7; the owner 2026-10-21: "в просмотре медиа и в uploads и в birols,
// где угодно в видео можно обрезать"; "когда пользователь выбрал фрагмент обрезки, нужно предложить в попапе куда
// сохранить обрезок"; "вариант Б, но в обрезке можно галочкой отобразить оригинал, где бы этот кусок не находился и
// обрезать еще раз и создастся новый файл").
//
// ONE module for every viewer of a video: the Library's and Merge's (js/library/viewer.js - `underStage`, `videoSrc`,
// a row of `extraRows`) and the post viewer of REFERENCES (js/references/post.js, `cutBox` per file of a post).
//
//   under the video   the trimmer (js/merge-v3/trim.js) and "Cut…": the window "save the piece to" - the places of the
//                     media tree (js/media-targets.js), the clip's own place first - and the piece becomes a NEW clip
//                     there (POST /api/library/cut). The video itself stays as it is.
//   right column      a piece has "original": ticked, the stage shows the WHOLE video it was cut from, the handles where
//                     the piece was - and a cut from there is another new piece.
//
// Not cut here: talking heads (their project's) and renders.

import * as Layers from './layers.js';
import { trimmer } from './merge-v3/trim.js';
import { targetsOf, whereText } from './media-targets.js';
import { askName } from './name-box.js';

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
  box.type = 'checkbox';
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
  const btn = el('button', 'mv3-trimbox-save', 'Cut…');
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
      btn.textContent = 'cutting…';
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
let _open = null;      // { box, layer, away }

export function closeMenu() {
  if (!_open) return;
  _open.box.remove();
  Layers.close(_open.layer);
  document.removeEventListener('mousedown', _open.away, true);
  _open = null;
}

async function _menu(anchor, piece, g, go) {
  closeMenu();
  let tree = [];
  try { const d = await fetch('/api/library/tree').then(r => r.json()); tree = (d && d.nodes) || []; } catch (e) { tree = []; }
  if (!anchor.isConnected) return;
  const all = targetsOf(tree, { images: false, refHome: 'its site\'s folder (no category)' });
  // "+ new category" for the two kinds of VIDEO that have them, after their places.
  const at = all.findIndex(x => x.head === 'VIDEO');
  if (at >= 0) all.push({ newCat: 'uploads', text: '+ new Uploads category…' }, { newCat: 'birols', text: '+ new B-rolls category…' });
  const isHere = (x) => piece.here && x.kind === piece.here.kind && (x.cat || '') === (piece.here.cat || '');
  const here = all.find(x => !x.head && !x.newCat && isHere(x));

  const box = el('div', 'ref-move cut-menu');
  box.appendChild(el('div', 'ref-move-title', 'Save the piece ' + mmss(g.in) + '–' + mmss(g.out) + ' (' + (g.out - g.in).toFixed(1) + ' s) as a new clip in'));
  const list = el('div', 'ref-move-list');
  const item = (x, text) => {
    const b = el('button', 'ref-move-it' + (isHere(x) ? ' is-here' : ''), text || x.text);
    b.type = 'button';
    b.addEventListener('click', async () => {
      let to = x;
      if (x.newCat) {
        const kind = x.newCat;
        const cat = await askName({
          anchor: b, title: 'New ' + ({ references: 'REFERENCES', uploads: 'Uploads', birols: 'B-rolls' }[kind] || kind) + ' category',
          okLabel: 'Create', maxLength: 60,
          submit: async (name) => {
            const r = await fetch('/api/library/cats', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind, label: name }) }).then(z => z.json());
            if (!r || !r.success) throw new Error((r && r.error) || 'not made');
            return r.cat;
          },
        });
        if (!cat) return;
        to = { kind, cat: cat.id, label: cat.label, text: cat.label };
      }
      closeMenu();
      go(to);
    });
    list.appendChild(b);
  };
  if (here) { list.appendChild(el('div', 'ref-move-head', 'BESIDE IT')); item(here); }
  for (const x of all) {
    if (x.head) { list.appendChild(el('div', 'ref-move-head', x.head)); continue; }
    item(x);
  }
  box.appendChild(list);
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(r.right - bw, window.innerWidth - bw - 8)) + 'px';
  box.style.top = (r.top - bh - 6 >= 8 ? r.top - bh - 6 : Math.min(window.innerHeight - bh - 8, r.bottom + 6)) + 'px';
  const away = (e) => { if (!box.contains(e.target) && e.target !== anchor && !(e.target.closest && e.target.closest('.nm-box'))) closeMenu(); };
  document.addEventListener('mousedown', away, true);
  _open = { box, away, layer: Layers.open(box, { name: 'cut-menu', onEsc: closeMenu }) };
}
