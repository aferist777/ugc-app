/* ═══════════════════════════════════════════════════════════════════════════
   REFERENCES - A POST. ONE module for both places the media tree shows posts:
   the Library's Media shelf (js/library/main.js) and Merge's Library panel (js/merge-v3/library.js).

     decorate(tile, it)     a post's tile: how many files it holds (or ▶ and its length), and on hover every miniature of a
                            post of several - a press on one opens the post on it
     openPost(list, at, o)  the post viewer: the file being looked at large, the post's facts on the right, and UNDER the
                            stage the strip of the post's miniatures, scrolled sideways, with "N selected" (a press on a
                            miniature shows it, the tick in its top right corner picks it; "select all"); the arrows step through the posts; Delete asks "really?" on the button itself.
                            o.onChanged() - a post deleted: the page reads its gallery again
   A shelf item of kind 'references' (routes/library.js) carries the post's files in meta.items.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
// "Move to…" is the place picker - the media tree's places, folded.
import { openPlaces, closePlaces } from '../place-tree.js';
// A video of a post is cut into new pieces under the stage; a piece shows its whole video on a tick.
import * as Cut from '../cut.js';
// The sash before the right column - one helper and one remembered width with the media viewer.
// and the head's actions as the viewer draws them: an icon and its word (fillAct)
import { wireInfoSash, fillAct } from '../library/viewer.js';
// A failure is a popup in the corner (js/notice.js), not the browser's alert().
import { showError } from '../notice.js';
import { twoPress } from '../really.js';
// a new post's gold dot until it is opened - one module with the YouTube sources' tiles
import * as News from './news.js';
import * as T from '../i18n/t.js';

const SRC_LABEL = { files: T.t('Files'), instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', other: T.t('Other') };
const FOLDER_LABEL = { posts: T.t('Posts'), reels: 'Reels', shorts: 'Shorts', videos: T.t('Videos') };
// Text that lands in an attribute of the viewer's markup.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const mmss = (s) => {
  s = Math.round(Number(s) || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};
const filesOf = (it) => ((it && it.meta && it.meta.items) || []);
const whereOf = (it) => {
  const m = (it && it.meta) || {};
  return (SRC_LABEL[m.source] || m.source || '') + (m.folder ? ' · ' + (FOLDER_LABEL[m.folder] || m.folder) : '');
};
const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? String(s) : d.toLocaleDateString(T.lang() === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ── deleting ─────────────────────────────────────────────────────────────────
const _paths = (it) => filesOf(it).map(f => f.path).filter(Boolean);

/** The projects whose timelines hold these files (POST /api/library/usage) - none when the read fails. */
async function _projectsOf(files) {
  try {
    const d = await fetch('/api/library/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media: files }) }).then(r => r.json());
    return (d && d.projects) || [];
  } catch (e) { return []; }
}

/** The question before a post is deleted - with the projects whose timelines hold its files, as every other tile of the
 *  Library asks: there its clips turn red, to be replaced or removed. */
export async function deleteQuestion(it) {
  const files = _paths(it);
  if (!files.length) return T.t('Delete the post "{name}"?', { name: it.name });
  let q = T.tn(files.length, 'Delete the post "{name}" and its {n} file?', 'Delete the post "{name}" and its {n} files?', { name: it.name });
  const projects = await _projectsOf(files);
  if (projects.length) {
    q += '\n\n' + T.tn(projects.length, 'It is used in {n} project:', 'It is used in {n} projects:') + '\n'
      + projects.slice(0, 10).map(p => '  ' + T.t('«{title}» - {clips}', { title: p.title, clips: T.tn(p.clips, '{n} clip', '{n} clips') })).join('\n')
      + '\n\n' + T.t('There its clips turn red - to be replaced or removed.');
  }
  return q;
}

// ── the tile ─────────────────────────────────────────────────────────────────
let _hover = null;          // { box, tile, timer, hideTimer }

// `opts.dragFile(dataTransfer, it, file)` (Merge): a miniature of the hover is dragged onto a lane.
export function decorate(tile, it, open, opts) {
  const files = filesOf(it);
  const m = it.meta || {};
  const badge = el('span', 'ref-badge');
  if (m.remote) badge.textContent = '▷ ' + mmss(m.remote.dur || it.dur);
  else if (files.length > 1) {
    const v = files.filter(f => f.type === 'video').length;
    badge.textContent = '⧉ ' + files.length + (v ? ' · ' + v + ' ▶' : '');
  } else if (files[0] && files[0].type === 'video') badge.textContent = '▶ ' + mmss(files[0].dur || it.dur);
  else badge.textContent = '';
  if (badge.textContent) tile.appendChild(badge);
  tile.title = [it.name, m.author, whereOf(it)].filter(Boolean).join('\n');
  News.mark(tile, it);
  if (files.length > 1) {
    tile.addEventListener('mouseenter', () => _hoverIn(tile, it, open, opts));
    tile.addEventListener('mouseleave', () => _hoverOut());
  }
}

function _hoverIn(tile, it, open, opts) {
  _hoverOut(true);
  const timer = setTimeout(() => _hoverShow(tile, it, open, opts), 260);
  _hover = { tile, timer, box: null, hideTimer: null };
}

function _hoverOut(now) {
  if (!_hover) return;
  clearTimeout(_hover.timer);
  const h = _hover;
  const drop = () => { if (h.box) h.box.remove(); if (_hover === h) _hover = null; };
  if (now) { clearTimeout(h.hideTimer); drop(); return; }
  clearTimeout(h.hideTimer);
  h.hideTimer = setTimeout(drop, 180);         // time to move the pointer into the popup
}

function _hoverShow(tile, it, open, opts) {
  if (!_hover || _hover.tile !== tile || !tile.isConnected) return;
  const files = filesOf(it);
  const box = el('div', 'ref-hover');
  const grid = el('div', 'ref-hover-grid');
  files.forEach((f, i) => {
    const c = el('button', 'ref-hover-cell');
    c.type = 'button';
    const what = f.type === 'video' ? T.t('video {len}', { len: mmss(f.dur) }) : T.t('photo');
    c.title = T.t('{what} - open the post on it', { what });
    if (f.thumb) { const im = el('img'); im.src = f.thumb; im.alt = ''; im.loading = 'lazy'; c.appendChild(im); }
    if (f.type === 'video') c.appendChild(el('span', 'ref-hover-v', '▶'));
    c.addEventListener('click', (e) => { e.stopPropagation(); _hoverOut(true); if (open) open(it, i); });
    if (opts && typeof opts.dragFile === 'function') {
      c.draggable = true;
      c.title = T.t('{what} - open the post on it - or drag it onto a lane', { what });
      c.addEventListener('dragstart', (e) => { e.stopPropagation(); opts.dragFile(e.dataTransfer, it, f); });
      c.addEventListener('dragend', () => _hoverOut(true));
    }
    grid.appendChild(c);
  });
  box.appendChild(grid);
  box.appendChild(el('div', 'ref-hover-cap', T.tn(files.length, '{n} file · {name}', '{n} files · {name}', { name: it.name || '' })));
  box.addEventListener('mouseenter', () => { if (_hover) clearTimeout(_hover.hideTimer); });
  box.addEventListener('mouseleave', () => _hoverOut());
  document.body.appendChild(box);
  // Beside the tile - to its right, or to its left when the window ends there.
  const r = tile.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  let x = r.right + 8;
  if (x + bw > window.innerWidth - 8) x = Math.max(8, r.left - bw - 8);
  let y = Math.min(Math.max(8, r.top), window.innerHeight - bh - 8);
  box.style.left = x + 'px';
  box.style.top = y + 'px';
  _hover.box = box;
}

// ── the viewer ───────────────────────────────────────────────────────────────
let _v = null;      // { ov, layer, list, at, file, sel: Set, o }

export function openPost(list, at, o) {
  closePost();
  _hoverOut(true);
  // The fragments drawn over a video live while its viewer is open.
  Cut.reset();
  const posts = (list || []).filter(x => x && x.kind === 'references');
  if (!posts.length) return;
  const ov = el('div', 'lib-view-ov ref-view-ov');
  // The one frame: a head of 40 px - the post's name, its place and the
  // count at the left, the actions (an icon and its word) at the right, the ✕ of 28 px last; the window's status line
  // (`.ref-said`) is the first line of the right column, not in the head.
  ov.innerHTML = `
    <div class="lib-view ref-view u-win is-float">
      <div class="lib-view-head u-win-head">
        <span class="lib-view-title u-win-title"></span>
        <span class="ref-view-where u-win-sub"></span>
        <span class="lib-view-count u-win-sub"></span>
        <span class="sp"></span>
        <span class="lib-view-acts"></span>
        <button class="u-btn is-icon is-quiet u-x" data-x="close" type="button" title="${esc(T.t('Close (Esc)'))}"></button>
      </div>
      <div class="lib-view-body">
        <button class="lib-view-arrow u-btn is-icon is-quiet" data-x="prev" type="button" title="${esc(T.t('The previous post (left arrow)'))}">&#8249;</button>
        <div class="ref-view-mid">
          <div class="lib-view-stage"></div>
          <div class="ref-strip-bar">
            <span class="ref-strip-n"></span>
            <button class="u-btn is-s" data-x="all" type="button"></button>
            <span class="sp"></span>
            <button class="u-btn is-s" data-x="move" type="button" title="${esc(T.t('Move the selected files - into a folder of REFERENCES (as a post of their own), into VIDEO or into IMAGES'))}"></button>
          </div>
          <div class="ref-strip"></div>
        </div>
        <button class="lib-view-arrow u-btn is-icon is-quiet" data-x="next" type="button" title="${esc(T.t('The next post (right arrow)'))}">&#8250;</button>
        <aside class="lib-view-info"><div class="ref-said u-status" aria-live="polite"></div></aside>
      </div>
    </div>`;
  document.body.appendChild(ov);
  wireInfoSash(ov);
  const layer = Layers.open(ov, { name: 'post-view', onEsc: closePost });
  _v = { ov, layer, list: posts, at: Math.max(0, posts.findIndex(p => p === list[at] || String(p.id) === String((list[at] || {}).id))), file: 0, sel: new Set(), o: o || {}, whole: false };
  ov.querySelector('[data-x="close"]').addEventListener('click', closePost);
  ov.querySelector('[data-x="prev"]').addEventListener('click', () => _step(-1));
  ov.querySelector('[data-x="next"]').addEventListener('click', () => _step(1));
  ov.querySelector('[data-x="all"]').addEventListener('click', _selectAll);
  ov.querySelector('[data-x="move"]').addEventListener('click', (e) => {
    const files = filesOf(_cur()).filter(f => _v.sel.has(f.id));
    if (files.length) _moveMenu(e.currentTarget, files.map(f => f.id), files);
  });
  // closed by the press beside it (`mousedown`), as every window - a drag let go over the dark
  // does not close it
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closePost(); });
  document.addEventListener('keydown', _onKey);
  if (o && Number.isInteger(o.file)) _v.file = o.file;
  _paint();
}

export function closePost() {
  _closeMenu();
  Cut.closeMenu();
  if (!_v) return;
  _v.ov.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) { /* gone */ } v.removeAttribute('src'); v.load(); });
  _v.ov.remove();
  Layers.close(_v.layer);
  document.removeEventListener('keydown', _onKey);
  _v = null;
}

function _onKey(e) {
  if (!_v || !Layers.topIs(_v.layer)) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); _step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); _step(-1); }
}

function _step(d) {
  if (!_v || !_v.list.length) return;
  _v.at = (_v.at + d + _v.list.length) % _v.list.length;
  _v.file = 0;
  _v.sel = new Set();
  _v.whole = false;
  _said('');
  _paint();
}

const _cur = () => (_v ? _v.list[_v.at] : null);

// The window's ONE status line (`u-status`, the first line of the right column): quiet; red only when
// it says something did not happen ("not moved: …", "not added: …", a cut that failed).
function _setSaid(node, text, bad) {
  if (!node) return;
  node.textContent = text || '';
  node.classList.toggle('is-bad', !!(bad || /^not /i.test(String(text || ''))));
}
function _said(text, bad) { if (_v) _setSaid(_v.ov.querySelector('.ref-said'), text, bad); }

function _paint() {
  const it = _cur();
  if (!it) return closePost();
  _v.whole = false;
  const ov = _v.ov;
  ov.querySelector('.lib-view-title').textContent = it.name || '';
  ov.querySelector('.ref-view-where').textContent = whereOf(it);
  ov.querySelector('.lib-view-count').textContent = T.t('post {k} / {n}', { k: _v.at + 1, n: _v.list.length });
  News.opened(it);                                  // looked at - no longer new
  _paintStage();
  _paintStrip();
  _paintInfo(it);
  _paintActs(it);
}

function _paintStage() {
  const it = _cur();
  const stage = _v.ov.querySelector('.lib-view-stage');
  stage.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) { /* gone */ } v.removeAttribute('src'); v.load(); });
  stage.textContent = '';
  const m = it.meta || {};
  if (m.remote) {
    // A long video kept as a tile, WATCHED without
    // downloading: YouTube in its own player, any other site from the stream yt-dlp names (GET .../watch) - and where a
    // site gives none, its poster and the way to it in the browser.
    const w = el('div', 'ref-remote');
    const cap = el('div', 'ref-remote-cap');
    cap.appendChild(el('span', null, '▷ ' + mmss(m.remote.dur) + ' · ' + T.t('watched from the site, not downloaded') + ' · '));
    if (m.link) { const a = el('a', null, T.t('open it in the browser')); a.href = m.link; a.target = '_blank'; a.rel = 'noreferrer'; cap.appendChild(a); }
    const yt = /youtube/i.test(String(m.remote.site || '')) && m.remote.id;
    if (yt) {
      const f = el('iframe', 'ref-player');
      f.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(m.remote.id) + '?autoplay=1&rel=0&modestbranding=1';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.allowFullscreen = true;
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      w.appendChild(f);
    } else {
      const im = el('img', 'lib-view-media');
      if (m.poster) { im.src = m.poster; im.alt = ''; w.appendChild(im); }
      const it0 = it;
      fetch('/api/references/' + encodeURIComponent(it.id) + '/watch').then(r => r.json()).then((d) => {
        if (!_v || _cur() !== it0 || !d || !d.success) { if (d && !d.success) cap.firstChild.textContent = '▷ ' + mmss(m.remote.dur) + ' · ' + d.error + ' · '; return; }
        const v = el('video', 'lib-view-media');
        v.src = d.url; v.controls = true; v.autoplay = true; v.playsInline = true;
        v.addEventListener('error', () => { cap.firstChild.textContent = '▷ ' + T.t('the site would not play it here') + ' · '; v.replaceWith(im); }, { once: true });
        if (im.isConnected) im.replaceWith(v); else w.insertBefore(v, cap);
      }).catch(() => { /* the poster stays */ });
    }
    w.appendChild(cap);
    stage.appendChild(w);
    return;
  }
  const f = filesOf(it)[_v.file];
  if (!f) { stage.appendChild(el('div', 'ref-none', T.t('No file in this post.'))); return; }
  stage.classList.remove('has-under');
  if (f.type === 'video') {
    const v = el('video', 'lib-view-media');
    const whole = !!(_v.whole && f.original);
    v.src = whole ? f.original.path : f.path; v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true;
    stage.appendChild(v);
    // The stretch and "Cut…": a NEW clip wherever it is put; the post keeps this file.
    const said = _v.ov.querySelector('.ref-said');
    // The fragments start where the piece was in its whole video (a join - each of its pieces).
    const start = whole ? (Array.isArray(f.original.parts) && f.original.parts.length ? f.original.parts : [f.original]) : null;
    const box = Cut.cutBox(v, {
      src: whole ? f.original.path : f.path, start, whole, name: whole ? (f.original.name || it.name || '') : (it.name || ''),
      key: 'post:' + it.id + ':' + (f.id || _v.file) + (whole ? ':whole' : ''),
      here: { kind: 'references', cat: (it.meta && it.meta.categoryId) || '' },
    }, {
      say: (text, err) => { if (_v && said.isConnected) _setSaid(said, text, err); },
      onSaved: (r) => {
        if (_v && said.isConnected) _setSaid(said, T.t('saved as a new clip in {place}', { place: r.where }));
        if (typeof _v.o.onChanged === 'function') { try { _v.o.onChanged({ cut: it }); } catch (e) { /* the page's */ } }
      },
    });
    stage.classList.add('has-under');
    stage.appendChild(box);
  } else {
    const im = el('img', 'lib-view-media');
    im.src = f.path; im.alt = it.name || '';
    stage.appendChild(im);
  }
}

function _paintStrip() {
  const it = _cur();
  const files = filesOf(it);
  const strip = _v.ov.querySelector('.ref-strip');
  const bar = _v.ov.querySelector('.ref-strip-bar');
  strip.textContent = '';
  // One file, or a tile kept from a long video: nothing to choose between.
  const show = files.length > 1;
  strip.hidden = !show;
  bar.hidden = !show;
  if (!show) return;
  files.forEach((f, i) => {
    const c = el('div', 'ref-cell' + (i === _v.file ? ' is-cur' : '') + (_v.sel.has(f.id) ? ' is-sel' : ''));
    const what = (f.type === 'video' ? T.t('video {len}', { len: mmss(f.dur) }) : T.t('photo')) + (f.w ? ' · ' + f.w + '×' + f.h : '');
    c.title = T.t('{what} - a press shows it', { what });
    if (f.thumb) { const im = el('img'); im.src = f.thumb; im.alt = ''; im.loading = 'lazy'; c.appendChild(im); }
    else c.appendChild(el('span', 'ref-cell-none', f.type === 'video' ? T.t('video') : f.type === 'photo' ? T.t('photo') : f.type));
    if (f.type === 'video') c.appendChild(el('span', 'ref-cell-dur', '▶ ' + mmss(f.dur)));
    const tick = el('button', 'ref-tick', '✓');
    tick.type = 'button';
    tick.title = _v.sel.has(f.id) ? T.t('Selected - press to let go') : T.t('Select');
    tick.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_v.sel.has(f.id)) _v.sel.delete(f.id); else _v.sel.add(f.id);
      _paintStrip();
    });
    c.appendChild(tick);
    c.addEventListener('click', () => { _v.file = i; _v.whole = false; _paintStage(); _paintStrip(); _paintInfo(_cur()); });
    strip.appendChild(c);
  });
  const n = _v.sel.size;
  bar.querySelector('.ref-strip-n').textContent = n ? T.t('{k} of {n} selected', { k: n, n: files.length })
    : T.tn(files.length, '{n} file · none selected', '{n} files · none selected');
  bar.querySelector('[data-x="all"]').textContent = n === files.length ? T.t('Select none') : T.t('Select all');
  const mv = bar.querySelector('[data-x="move"]');
  mv.textContent = n ? T.t('move {n} to…', { n }) : T.t('move to…');
  mv.disabled = !n;
  const cur = strip.children[_v.file];
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function _selectAll() {
  const files = filesOf(_cur());
  if (_v.sel.size === files.length) _v.sel = new Set();
  else _v.sel = new Set(files.map(f => f.id));
  _paintStrip();
}

function _row(box, k, v) {
  if (!v) return;
  const r = el('div', 'lib-view-row');
  r.appendChild(el('span', 'lib-view-k', k));
  const val = el('span', 'lib-view-v');
  if (v instanceof Node) val.appendChild(v); else val.textContent = v;
  r.appendChild(val);
  box.appendChild(r);
}

function _paintInfo(it) {
  const box = _v.ov.querySelector('.lib-view-info');
  const said = box.querySelector('.ref-said');      // the status line stays the column's first line
  box.textContent = '';
  if (said) box.appendChild(said);
  const m = it.meta || {};
  const files = filesOf(it);
  _row(box, T.t('where'), whereOf(it));
  // Filed under an own category of REFERENCES: said beside the site it came from.
  _row(box, T.t('category'), m.categoryId ? (m.categoryLabel || '') : '');
  _row(box, T.t('author'), m.author || m.origin);
  _row(box, T.t('posted'), fmtDate(m.postedAt));
  _row(box, T.t('received'), fmtDate(m.date));
  if (m.link) {
    const a = el('a', null, String(m.link).replace(/^https?:\/\/(www\.)?/i, '').slice(0, 60));
    a.href = m.link; a.target = '_blank'; a.rel = 'noreferrer'; a.title = m.link;
    _row(box, T.t('link'), a);
  }
  if (files.length) {
    const p = files.filter(f => f.type === 'photo').length, v = files.length - p;
    _row(box, T.t('files'), [p ? T.tn(p, '{n} photo', '{n} photos') : '', v ? T.tn(v, '{n} video', '{n} videos') : ''].filter(Boolean).join(', '));
    const f = files[_v.file];
    if (f && f.w) _row(box, T.t('this one'), f.w + '×' + f.h + (f.dur ? ' · ' + mmss(f.dur) : ''));
    // A piece cut out of a video: its whole video, on a tick.
    if (f && f.original) _row(box, T.t('original'), Cut.originalTick(f.original, _v.whole, (on) => { _v.whole = on; _paintStage(); }));
  }
  _row(box, T.t('note'), m.note);
  if (m.caption) {
    const c = el('div', 'ref-caption', m.caption);
    _row(box, T.t('caption'), c);
  }
}

function _paintActs(it) {
  const box = _v.ov.querySelector('.lib-view-acts');
  box.textContent = '';
  // The whole post: into a category of REFERENCES (or back to its source's folder) - and, a post of one video or one
  // picture, into VIDEO or IMAGES (one of several goes by its files, from the strip).
  const mv = fillAct(el('button', 'u-btn is-s'), T.t('Move to…'));
  mv.type = 'button';
  mv.title = T.t('Move the whole post');
  mv.addEventListener('click', () => _moveMenu(mv, 'all', filesOf(it), true));
  box.appendChild(mv);
  // A long video kept as a tile goes on from here - once downloaded, its tile is the source's.
  if (it.meta && it.meta.remote && it.meta.link) {
    const src = el('button', 'u-btn is-s', T.t('To scenario sources'));
    src.type = 'button';
    src.title = T.t('Add it to the scenario generator\'s sources: downloaded, its words heard and its topics found - the hearing and the topics are paid. Downloaded, this tile is the source.');
    // paid: asked on the button itself by js/really.js - a light step, not a red fill
    twoPress(src, { paid: true, text: T.t('paid: hearing + topics - press again'), go: () => _toSources(it, src) });
    box.appendChild(src);
    const hl = el('button', 'u-btn is-s', T.t('To highlights'));
    hl.type = 'button';
    hl.title = T.t('A new highlights project in Merge with this video - its length, count and caption style chosen there. The project downloads it first; then this tile is the downloaded video.');
    hl.addEventListener('click', () => {
      // The tile stays until its video is downloaded for the project.
      const u = '/merge?highlights=' + encodeURIComponent(it.meta.link);
      closePost();
      if (location.pathname === '/merge' && window.__ugcHighlightsFrom) window.__ugcHighlightsFrom(it.meta.link);
      else location.href = u;
    });
    box.appendChild(hl);
  }
  const del = fillAct(el('button', 'u-btn is-s is-danger'), T.t('Delete'));
  del.type = 'button';
  del.title = T.t('Delete this post and its files');
  // "Really?" on the button itself, by js/really.js: a second press within 3 s deletes.
  twoPress(del, {
    // Its files on a timeline: said before the second press - there its clips turn red.
    armed: () => {
      const files = _paths(it);
      if (!files.length) return Promise.resolve();
      return _projectsOf(files).then((projects) => {
        if (projects.length && _v && _cur() === it) {
          _said(T.tn(projects.length, 'on the timelines of {n} project - its clips there turn red', 'on the timelines of {n} projects - its clips there turn red'));
        }
      });
    },
    go: async () => {
    del.disabled = true;
    try {
      const r = await fetch('/api/references/' + encodeURIComponent(it.id), { method: 'DELETE' }).then(x => x.json());
      if (!r || !r.success) throw new Error((r && r.error) || T.t('not deleted'));
    } catch (e) { del.disabled = false; fillAct(del, T.t('Delete')); showError(T.t('Not deleted: {why}', { why: e.message })); return; }
    if (typeof _v.o.onChanged === 'function') { try { _v.o.onChanged({ deleted: it }); } catch (e) { /* the page's */ } }
    _v.list = _v.list.filter(x => x !== it);
    if (!_v.list.length) return closePost();
    if (_v.at >= _v.list.length) _v.at = _v.list.length - 1;
    _v.file = 0;
    _v.sel = new Set();
    _paint();
  } });
  box.appendChild(del);
}

// ── to the scenario sources ──────────────────────────────────────────────────
// The same way in as the Sources' "From a link" (POST /api/sources/add/link; lib/source-intake.js): read, then a source -
// downloaded, heard and its topics found, one row in Alerts. Paid: asked on the button itself, a second press goes. A
// vertical or square video is asked about there - from here it was chosen as a source. Once it is a source (or was one
// already) the post leaves REFERENCES.
async function _toSources(it, btn) {
  btn.disabled = true;
  const said = _v.ov.querySelector('.ref-said');
  const say = (text, bad) => { if (_v && said.isConnected) _setSaid(said, text, bad); btn.textContent = text.length < 40 ? text : T.t('To scenario sources'); };
  say(T.t('reading the link…'));
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => null);
    if (!d || !d.success) throw new Error((d && d.error) || T.t('no answer'));
    return d;
  };
  let read = null;
  try {
    read = (await api('/api/sources/add/link', { url: it.meta.link })).read;
    for (let i = 0; i < 90 && read && read.state === 'reading'; i++) {
      await new Promise(r => setTimeout(r, 1000));
      read = (await api('/api/sources/add/' + encodeURIComponent(read.id))).read;
    }
    if (read && read.state === 'ask') read = (await api('/api/sources/add/' + encodeURIComponent(read.id) + '/answer', { as: 'source' })).read;
  } catch (e) { say(T.t('not added: {why}', { why: e.message }), true); btn.disabled = false; return; }
  const already = read && read.state === 'error' && /source already/i.test(String(read.error || ''));
  if (!read || (read.state !== 'source' && !already)) {
    say(T.t('not added: {why}', { why: (read && (read.error || read.step)) || T.t('the link was not read') }), true);
    btn.disabled = false;
    btn.textContent = T.t('To scenario sources');
    return;
  }
  // The tile STAYS: the server takes it away
  // only once its video is a downloaded source, whose tile is then in its place (lib/sources-store.js update). A video that
  // was a source already is that source's tile - this one is a second of it and goes now.
  if (already) {
    try { await fetch('/api/references/' + encodeURIComponent(it.id), { method: 'DELETE' }); } catch (e) { /* hidden behind the source anyway */ }
    if (typeof _v.o.onChanged === 'function') { try { _v.o.onChanged({ deleted: it }); } catch (e) { /* the page's */ } }
    _v.list = _v.list.filter(x => x !== it);
    if (!_v.list.length) { closePost(); return; }
    if (_v.at >= _v.list.length) _v.at = _v.list.length - 1;
    _v.file = 0;
    _v.sel = new Set();
    _paint();
    _said(T.t('it is a source already - its downloaded video is in YouTube · Videos'));
    return;
  }
  btn.textContent = T.t('To scenario sources');
  _said(T.t('added to the scenario sources - it is downloaded now (its row is in Alerts); this tile turns into the downloaded video when it is in'));
}

// ── moving ───────────────────────────────────────────────────────────────────
// Where the files can go, read from the media tree as a tree of its places, folded each time
// (js/place-tree.js): REFERENCES' own categories (or back to the post's source folder) and a "+" for a new one, VIDEO's
// Generated (a B-roll with no category), B-rolls' categories, Hooks and Uploads, IMAGES and its categories. What cannot
// take every file chosen is grey with the reason: a picture never goes into VIDEO, a video never
// into IMAGES, a post of several goes out by its files, a tile-only video stays in REFERENCES.
const VIDEO_KINDS = new Set(['birols', 'uploads', 'hooks']);

function _closeMenu() { closePlaces(); }

async function _moveMenu(anchor, ids, files, whole) {
  _closeMenu();
  const it = _cur();
  let tree = [];
  try { const d = await fetch('/api/library/tree').then(r => r.json()); tree = (d && d.nodes) || []; } catch (e) { tree = []; }
  if (!_v || _cur() !== it) return;
  const photos = files.filter(f => f.type === 'photo').length;
  const videos = files.length - photos;
  const remote = !!(it.meta && it.meta.remote);
  const why = (to) => {
    if (to.kind === 'references') return (whole && (it.meta.categoryId || '') === to.cat) ? T.t('it is there now') : '';
    if (remote) return T.t('a video kept as a tile stays in REFERENCES');
    if (whole && filesOf(it).length > 1) return T.t('a post of several goes out by its files - select them below');
    if (VIDEO_KINDS.has(to.kind)) return photos ? T.t('pictures do not go into VIDEO') : '';
    if (to.kind === 'images') return videos ? T.t('videos do not go into IMAGES') : '';
    return '';
  };
  openPlaces(anchor, {
    title: whole ? T.t('Move the post to') : T.tn(files.length, 'Move {n} file to', 'Move {n} files to'),
    tree, why, name: 'ref-move', places: { newCats: ['references'] },
    onPick: (to) => { if (_v && _cur() === it) _doMove(it, ids, to); },
  });
}

async function _doMove(it, ids, to) {
  const said = _v.ov.querySelector('.ref-said');
  _setSaid(said, T.t('moving…'));
  let r = null;
  try {
    r = await fetch('/api/references/' + encodeURIComponent(it.id) + '/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: ids, to }),
    }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || T.t('not moved'));
  } catch (e) { if (_v) _setSaid(said, T.t('not moved: {why}', { why: e.message }), true); return; }
  if (!_v) return;
  const where = (to.kind === 'references' ? T.t('REFERENCES') + ' · ' + (to.cat ? to.label : T.t('its source folder'))
    : to.kind === 'images' ? T.t('IMAGES') + (to.cat ? ' · ' + to.label : '')
    : ({ uploads: T.t('Uploads'), birols: T.t('B-rolls'), hooks: T.t('Hooks') }[to.kind] || to.kind) + (to.cat ? ' · ' + to.label : ''));
  const skipped = (r.skipped || []).length;
  if (typeof _v.o.onChanged === 'function') { try { _v.o.onChanged({ moved: it }); } catch (e) { /* the page's */ } }
  // The post as it is now: gone, filed elsewhere whole, or smaller.
  const left = r.post;
  if (left && ids === 'all' && to.kind === 'references') {
    it.meta = Object.assign({}, it.meta, { categoryId: left.categoryId || '', categoryLabel: left.categoryLabel || '' });
  } else if (!left) {
    _v.list = _v.list.filter(x => x !== it);
    if (!_v.list.length) return closePost();
    if (_v.at >= _v.list.length) _v.at = _v.list.length - 1;
  } else {
    it.meta = Object.assign({}, it.meta, {
      items: (left.media || []).map(m => ({ id: m.id, type: m.type, path: m.path, thumb: m.thumb || null, w: m.w || 0, h: m.h || 0, dur: m.dur || 0 })),
      poster: left.poster || null,
    });
  }
  _v.file = 0;
  _v.sel = new Set();
  _paint();
  _said((r.moved ? T.t('{n} moved to {place}', { n: r.moved, place: where }) : T.t('nothing moved'))
    + (skipped ? ' · ' + T.t('{n} stayed: {why}', { n: skipped, why: r.skipped[0].why }) : ''));
}
