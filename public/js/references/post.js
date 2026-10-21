/* ═══════════════════════════════════════════════════════════════════════════
   REFERENCES - A POST (phase TG, block 5; the owner 2026-10-21). ONE module for both places the media tree shows posts:
   the Library's Media shelf (js/library/main.js) and Merge's Library panel (js/merge-v3/library.js).

     decorate(tile, it)     a post's tile: how many files it holds (or ▶ and its length), and on hover (the owner: "при
                            наведении на плитку поста показывать во всплывашке все миниатюры поста") every miniature of a
                            post of several - a press on one opens the post on it
     openPost(list, at, o)  the post viewer: the file being looked at large, the post's facts on the right, and UNDER the
                            stage the strip of the post's miniatures, scrolled sideways, with "N selected" (the owner: "клик
                            по миниатюре - просмотр, галочка в правом верхнем углу - выделение. и добавь кнопку select
                            all"); the arrows step through the posts; Delete asks "really?" on the button itself.
                            o.onChanged() - a post deleted: the page reads its gallery again
   A shelf item of kind 'references' (routes/library.js) carries the post's files in meta.items.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { askName } from '../name-box.js';

const SRC_LABEL = { files: 'Files', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok', other: 'Other' };
const FOLDER_LABEL = { posts: 'Posts', reels: 'Reels', shorts: 'Shorts', videos: 'Videos' };

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
  return isNaN(d) ? String(s) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// ── deleting (block 5d) ──────────────────────────────────────────────────────
/** The question before a post is deleted - with the projects whose timelines hold its files (POST /api/library/usage), as
 *  every other tile of the Library asks: there its clips turn red, to be replaced or removed. */
export async function deleteQuestion(it) {
  const files = filesOf(it).map(f => f.path).filter(Boolean);
  let q = `Delete the post "${it.name}"` + (files.length ? ` and its ${files.length} file${files.length === 1 ? '' : 's'}?` : '?');
  if (!files.length) return q;
  try {
    const d = await fetch('/api/library/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media: files }) }).then(r => r.json());
    const projects = (d && d.projects) || [];
    if (projects.length) {
      q += '\n\nIt is used in ' + projects.length + (projects.length === 1 ? ' project' : ' projects') + ':\n'
        + projects.slice(0, 10).map(p => '  «' + p.title + '» - ' + p.clips + (p.clips === 1 ? ' clip' : ' clips')).join('\n')
        + '\n\nThere its clips turn red - to be replaced or removed.';
    }
  } catch (e) { /* the plain question */ }
  return q;
}

// ── the tile ─────────────────────────────────────────────────────────────────
let _hover = null;          // { box, tile, timer, hideTimer }

// `opts.dragFile(dataTransfer, it, file)` (block 5d, Merge): a miniature of the hover is dragged onto a lane.
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
    c.title = (f.type === 'video' ? 'video ' + mmss(f.dur) : 'photo') + ' - open the post on it';
    if (f.thumb) { const im = el('img'); im.src = f.thumb; im.alt = ''; im.loading = 'lazy'; c.appendChild(im); }
    if (f.type === 'video') c.appendChild(el('span', 'ref-hover-v', '▶'));
    c.addEventListener('click', (e) => { e.stopPropagation(); _hoverOut(true); if (open) open(it, i); });
    if (opts && typeof opts.dragFile === 'function') {
      c.draggable = true;
      c.title += ' - or drag it onto a lane';
      c.addEventListener('dragstart', (e) => { e.stopPropagation(); opts.dragFile(e.dataTransfer, it, f); });
      c.addEventListener('dragend', () => _hoverOut(true));
    }
    grid.appendChild(c);
  });
  box.appendChild(grid);
  box.appendChild(el('div', 'ref-hover-cap', files.length + ' files · ' + (it.name || '')));
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
let _v = null;      // { ov, layer, list, at, file, sel: Set, o, armed }

export function openPost(list, at, o) {
  closePost();
  _hoverOut(true);
  const posts = (list || []).filter(x => x && x.kind === 'references');
  if (!posts.length) return;
  const ov = el('div', 'lib-view-ov ref-view-ov');
  ov.innerHTML = `
    <div class="lib-view ref-view">
      <div class="lib-view-head">
        <span class="lib-view-title"></span>
        <span class="ref-view-where"></span>
        <span class="lib-view-count"></span>
        <span class="sp"></span>
        <span class="ref-said"></span>
        <span class="lib-view-acts"></span>
        <button class="lib-btn" data-x="close" type="button" title="Close (Esc)">&#10005;</button>
      </div>
      <div class="lib-view-body">
        <button class="lib-view-arrow" data-x="prev" type="button" title="The previous post (left arrow)">&#8249;</button>
        <div class="ref-view-mid">
          <div class="lib-view-stage"></div>
          <div class="ref-strip-bar">
            <span class="ref-strip-n"></span>
            <button class="lib-btn" data-x="all" type="button"></button>
            <span class="sp"></span>
            <button class="lib-btn" data-x="move" type="button" title="Move the selected files - into a category of REFERENCES (as a post of their own), into VIDEO or into IMAGES"></button>
          </div>
          <div class="ref-strip"></div>
        </div>
        <button class="lib-view-arrow" data-x="next" type="button" title="The next post (right arrow)">&#8250;</button>
        <aside class="lib-view-info"></aside>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const layer = Layers.open(ov, { name: 'post-view', onEsc: closePost });
  _v = { ov, layer, list: posts, at: Math.max(0, posts.findIndex(p => p === list[at] || String(p.id) === String((list[at] || {}).id))), file: 0, sel: new Set(), o: o || {}, armed: null };
  ov.querySelector('[data-x="close"]').addEventListener('click', closePost);
  ov.querySelector('[data-x="prev"]').addEventListener('click', () => _step(-1));
  ov.querySelector('[data-x="next"]').addEventListener('click', () => _step(1));
  ov.querySelector('[data-x="all"]').addEventListener('click', _selectAll);
  ov.querySelector('[data-x="move"]').addEventListener('click', (e) => {
    const files = filesOf(_cur()).filter(f => _v.sel.has(f.id));
    if (files.length) _moveMenu(e.currentTarget, files.map(f => f.id), files);
  });
  ov.addEventListener('click', (e) => { if (e.target === ov) closePost(); });
  document.addEventListener('keydown', _onKey);
  if (o && Number.isInteger(o.file)) _v.file = o.file;
  _paint();
}

export function closePost() {
  _closeMenu();
  if (!_v) return;
  _v.ov.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) { /* gone */ } v.removeAttribute('src'); v.load(); });
  _v.ov.remove();
  Layers.close(_v.layer);
  document.removeEventListener('keydown', _onKey);
  clearTimeout(_v.armed);
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
  _v.ov.querySelector('.ref-said').textContent = '';
  _paint();
}

const _cur = () => (_v ? _v.list[_v.at] : null);

function _paint() {
  const it = _cur();
  if (!it) return closePost();
  const ov = _v.ov;
  ov.querySelector('.lib-view-title').textContent = it.name || '';
  ov.querySelector('.ref-view-where').textContent = whereOf(it);
  ov.querySelector('.lib-view-count').textContent = 'post ' + (_v.at + 1) + ' / ' + _v.list.length;
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
    // (block 5c; the owner: "при клике на плитку пользователь видит видео") A long video kept as a tile, WATCHED without
    // downloading: YouTube in its own player, any other site from the stream yt-dlp names (GET .../watch) - and where a
    // site gives none, its poster and the way to it in the browser.
    const w = el('div', 'ref-remote');
    const cap = el('div', 'ref-remote-cap');
    cap.appendChild(el('span', null, '▷ ' + mmss(m.remote.dur) + ' · watched from the site, not downloaded · '));
    if (m.link) { const a = el('a', null, 'open it in the browser'); a.href = m.link; a.target = '_blank'; a.rel = 'noreferrer'; cap.appendChild(a); }
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
        v.addEventListener('error', () => { cap.firstChild.textContent = '▷ the site would not play it here · '; v.replaceWith(im); }, { once: true });
        if (im.isConnected) im.replaceWith(v); else w.insertBefore(v, cap);
      }).catch(() => { /* the poster stays */ });
    }
    w.appendChild(cap);
    stage.appendChild(w);
    return;
  }
  const f = filesOf(it)[_v.file];
  if (!f) { stage.appendChild(el('div', 'ref-none', 'No file in this post.')); return; }
  if (f.type === 'video') {
    const v = el('video', 'lib-view-media');
    v.src = f.path; v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true;
    stage.appendChild(v);
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
    c.title = (f.type === 'video' ? 'video ' + mmss(f.dur) : 'photo') + (f.w ? ' · ' + f.w + '×' + f.h : '') + ' - a press shows it';
    if (f.thumb) { const im = el('img'); im.src = f.thumb; im.alt = ''; im.loading = 'lazy'; c.appendChild(im); }
    else c.appendChild(el('span', 'ref-cell-none', f.type));
    if (f.type === 'video') c.appendChild(el('span', 'ref-cell-dur', '▶ ' + mmss(f.dur)));
    const tick = el('button', 'ref-tick', '✓');
    tick.type = 'button';
    tick.title = _v.sel.has(f.id) ? 'Selected - press to let go' : 'Select';
    tick.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_v.sel.has(f.id)) _v.sel.delete(f.id); else _v.sel.add(f.id);
      _paintStrip();
    });
    c.appendChild(tick);
    c.addEventListener('click', () => { _v.file = i; _paintStage(); _paintStrip(); });
    strip.appendChild(c);
  });
  const n = _v.sel.size;
  bar.querySelector('.ref-strip-n').textContent = n ? n + ' of ' + files.length + ' selected' : files.length + ' files · none selected';
  bar.querySelector('[data-x="all"]').textContent = n === files.length ? 'select none' : 'select all';
  const mv = bar.querySelector('[data-x="move"]');
  mv.textContent = n ? `move ${n} to…` : 'move to…';
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
  box.textContent = '';
  const m = it.meta || {};
  const files = filesOf(it);
  _row(box, 'where', whereOf(it));
  _row(box, 'author', m.author || m.origin);
  _row(box, 'posted', fmtDate(m.postedAt));
  _row(box, 'received', fmtDate(m.date));
  if (m.link) {
    const a = el('a', null, String(m.link).replace(/^https?:\/\/(www\.)?/i, '').slice(0, 60));
    a.href = m.link; a.target = '_blank'; a.rel = 'noreferrer'; a.title = m.link;
    _row(box, 'link', a);
  }
  if (files.length) {
    const p = files.filter(f => f.type === 'photo').length, v = files.length - p;
    _row(box, 'files', [p ? p + ' photo' + (p === 1 ? '' : 's') : '', v ? v + ' video' + (v === 1 ? '' : 's') : ''].filter(Boolean).join(', '));
    const f = files[_v.file];
    if (f && f.w) _row(box, 'this one', f.w + '×' + f.h + (f.dur ? ' · ' + mmss(f.dur) : ''));
  }
  _row(box, 'note', m.note);
  if (m.caption) {
    const c = el('div', 'ref-caption', m.caption);
    _row(box, 'caption', c);
  }
}

function _paintActs(it) {
  const box = _v.ov.querySelector('.lib-view-acts');
  box.textContent = '';
  // The whole post: into a category of REFERENCES (or back to its source's folder) - and, a post of one video or one
  // picture, into VIDEO or IMAGES (the owner: one of several goes by its files, from the strip).
  const mv = el('button', 'lib-btn', 'Move to…');
  mv.type = 'button';
  mv.title = 'Move the whole post';
  mv.addEventListener('click', () => _moveMenu(mv, 'all', filesOf(it), true));
  box.appendChild(mv);
  // (block 5c) A long video kept as a tile goes on from here - and leaves REFERENCES (the owner's answer (о)).
  if (it.meta && it.meta.remote && it.meta.link) {
    const src = el('button', 'lib-btn', 'To scenario sources');
    src.type = 'button';
    src.title = 'Add it to the scenario generator\'s sources: downloaded, its words heard and its topics found - the hearing and the topics are paid. It leaves REFERENCES.';
    src.addEventListener('click', () => _toSources(it, src));
    box.appendChild(src);
    const hl = el('button', 'lib-btn', 'To highlights');
    hl.type = 'button';
    hl.title = 'A new highlights project in Merge with this video - its length, count and caption style chosen there. It leaves REFERENCES once the project starts.';
    hl.addEventListener('click', () => {
      const u = '/merge?highlights=' + encodeURIComponent(it.meta.link) + '&ref=' + encodeURIComponent(it.id);
      closePost();
      if (location.pathname === '/merge' && window.__ugcHighlightsFrom) window.__ugcHighlightsFrom(it.meta.link, it.id);
      else location.href = u;
    });
    box.appendChild(hl);
  }
  const del = el('button', 'lib-btn danger', 'Delete');
  del.type = 'button';
  del.title = 'Delete this post and its files';
  del.addEventListener('click', async () => {
    // "really?" on the button itself (the owner's way): a second press within a few seconds deletes.
    if (!_v.armed) {
      del.textContent = 'really? delete the post';
      _v.armed = setTimeout(() => { if (_v) { _v.armed = null; del.textContent = 'Delete'; } }, 6000);
      // (block 5d) Its files on a timeline: said before the second press - there its clips turn red.
      deleteQuestion(it).then((q) => {
        const m = /It is used in (d+ projects?)/.exec(q);
        if (m && _v && _cur() === it) _v.ov.querySelector('.ref-said').textContent = 'on the timelines of ' + m[1] + ' - its clips there turn red';
      });
      return;
    }
    clearTimeout(_v.armed);
    _v.armed = null;
    del.disabled = true;
    try {
      const r = await fetch('/api/references/' + encodeURIComponent(it.id), { method: 'DELETE' }).then(x => x.json());
      if (!r || !r.success) throw new Error((r && r.error) || 'not deleted');
    } catch (e) { del.disabled = false; del.textContent = 'Delete'; alert('Not deleted: ' + e.message); return; }
    if (typeof _v.o.onChanged === 'function') { try { _v.o.onChanged({ deleted: it }); } catch (e) { /* the page's */ } }
    _v.list = _v.list.filter(x => x !== it);
    if (!_v.list.length) return closePost();
    if (_v.at >= _v.list.length) _v.at = _v.list.length - 1;
    _v.file = 0;
    _v.sel = new Set();
    _paint();
  });
  box.appendChild(del);
}

// ── to the scenario sources (block 5c) ───────────────────────────────────────
// The same way in as the Sources' "From a link" (POST /api/sources/add/link; lib/source-intake.js): read, then a source -
// downloaded, heard and its topics found, one row in Alerts. Paid: asked on the button itself, a second press goes. A
// vertical or square video is asked about there - from here it was chosen as a source. Once it is a source (or was one
// already) the post leaves REFERENCES.
async function _toSources(it, btn) {
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = 'paid: hearing + topics - press again';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'To scenario sources'; } }, 5000);
    return;
  }
  delete btn.dataset.armed;
  btn.disabled = true;
  const said = _v.ov.querySelector('.ref-said');
  const say = (t) => { if (_v && said.isConnected) said.textContent = t; btn.textContent = t.length < 40 ? t : 'To scenario sources'; };
  say('reading the link…');
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const d = await r.json().catch(() => null);
    if (!d || !d.success) throw new Error((d && d.error) || 'no answer');
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
  } catch (e) { say('not added: ' + e.message); btn.disabled = false; return; }
  const already = read && read.state === 'error' && /source already/i.test(String(read.error || ''));
  if (!read || (read.state !== 'source' && !already)) {
    say('not added: ' + ((read && (read.error || read.step)) || 'the link was not read'));
    btn.disabled = false;
    btn.textContent = 'To scenario sources';
    return;
  }
  try { await fetch('/api/references/' + encodeURIComponent(it.id), { method: 'DELETE' }); } catch (e) { /* it stays - the source is made */ }
  if (typeof _v.o.onChanged === 'function') { try { _v.o.onChanged({ deleted: it }); } catch (e) { /* the page's */ } }
  const words = already ? 'it was a source already - it left REFERENCES' : 'added to the scenario sources - its row is in Alerts';
  _v.list = _v.list.filter(x => x !== it);
  if (!_v.list.length) { closePost(); return; }
  if (_v.at >= _v.list.length) _v.at = _v.list.length - 1;
  _v.file = 0;
  _v.sel = new Set();
  _paint();
  _v.ov.querySelector('.ref-said').textContent = words;
}

// ── moving (block 5b) ────────────────────────────────────────────────────────
// A menu of where the files can go, read from the media tree: REFERENCES' own categories (or back to the post's source
// folder) and "+ new category", VIDEO's Uploads, B-rolls' categories, Generated · Uncategorized and Hooks, IMAGES and its
// categories. What cannot take every file chosen is pale with the reason (the owner's answer (ч)): a picture never goes
// into VIDEO, a video never into IMAGES, a post of several goes out by its files, a tile-only video stays in REFERENCES.
let _menu = null;
const VIDEO_KINDS = new Set(['birols', 'uploads', 'hooks']);

function _closeMenu() {
  if (!_menu) return;
  _menu.box.remove();
  Layers.close(_menu.layer);
  document.removeEventListener('mousedown', _menu.away, true);
  _menu = null;
}

function _targets(tree) {
  const out = [];
  const ref = tree.find(n => n.key === 'references');
  out.push({ head: 'REFERENCES' });
  out.push({ kind: 'references', cat: '', label: '', text: 'the source\'s folder (no category)' });
  for (const c of ((ref && ref.children) || []).filter(c => c.cat)) out.push({ kind: 'references', cat: c.cat, label: c.name || c.label, text: c.label });
  out.push({ newCat: true, text: '+ new category…' });
  const walk = (n, trail, add) => {
    for (const c of n.children || []) {
      const p = trail ? trail + ' · ' + c.label : c.label;
      if (c.kind && (VIDEO_KINDS.has(c.kind) || c.kind === 'images')) {
        if (c.uncat) add({ kind: c.kind, cat: '', label: '', text: p });
        else if (c.cat && c.cat !== '__cat__') add({ kind: c.kind, cat: c.cat, label: c.name || c.label, text: p });
        else if (!c.cat && (c.key === 'uploads' || c.key === 'hooks') && !(c.children || []).some(x => x.uncat)) add({ kind: c.kind, cat: '', label: '', text: p });
      }
      walk(c, p, add);
    }
  };
  const video = tree.find(n => n.key === 'video');
  out.push({ head: 'VIDEO' });
  if (video) walk(video, '', (t) => out.push(t));
  const images = tree.find(n => n.key === 'images');
  out.push({ head: 'IMAGES' });
  if (images) {
    const before = out.length;
    walk(images, 'IMAGES', (t) => out.push(t));
    if (!out.slice(before).some(t => !t.cat)) out.splice(before, 0, { kind: 'images', cat: '', label: '', text: 'IMAGES · Uncategorized' });
  }
  return out;
}

async function _moveMenu(anchor, ids, files, whole) {
  _closeMenu();
  const it = _cur();
  let tree = [];
  try { const d = await fetch('/api/library/tree').then(r => r.json()); tree = (d && d.nodes) || []; } catch (e) { tree = []; }
  if (!_v || _cur() !== it) return;
  const photos = files.filter(f => f.type === 'photo').length;
  const videos = files.length - photos;
  const remote = !!(it.meta && it.meta.remote);
  const why = (t) => {
    if (t.kind === 'references') return (whole && (it.meta.categoryId || '') === t.cat) ? 'it is there now' : '';
    if (remote) return 'a video kept as a tile stays in REFERENCES';
    if (whole && filesOf(it).length > 1) return 'a post of several goes out by its files - select them below';
    if (VIDEO_KINDS.has(t.kind)) return photos ? 'pictures do not go into VIDEO' : '';
    if (t.kind === 'images') return videos ? 'videos do not go into IMAGES' : '';
    return '';
  };
  const box = el('div', 'ref-move');
  box.appendChild(el('div', 'ref-move-title', whole ? 'Move the post to' : `Move ${files.length} file${files.length === 1 ? '' : 's'} to`));
  const list = el('div', 'ref-move-list');
  for (const t of _targets(tree)) {
    if (t.head) { list.appendChild(el('div', 'ref-move-head', t.head)); continue; }
    const b = el('button', 'ref-move-it', t.text);
    b.type = 'button';
    const no = t.newCat ? '' : why(t);
    if (no) { b.disabled = true; b.title = no; }
    b.addEventListener('click', async () => {
      let to = t;
      if (t.newCat) {
        const cat = await askName({
          anchor: b, title: 'New REFERENCES category', okLabel: 'Create', maxLength: 60,
          submit: async (name) => {
            const r = await fetch('/api/library/cats', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind: 'references', label: name }) }).then(x => x.json());
            if (!r || !r.success) throw new Error((r && r.error) || 'not made');
            return r.cat;
          },
        });
        if (!cat) return;
        to = { kind: 'references', cat: cat.id, label: cat.label, text: cat.label };
      }
      _closeMenu();
      await _doMove(it, ids, to);
    });
    list.appendChild(b);
  }
  box.appendChild(list);
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - bw - 8)) + 'px';
  box.style.top = (r.bottom + 4 + bh > window.innerHeight - 8 ? Math.max(8, r.top - bh - 4) : r.bottom + 4) + 'px';
  const away = (e) => { if (!box.contains(e.target) && e.target !== anchor && !(e.target.closest && e.target.closest('.nm-box'))) _closeMenu(); };
  document.addEventListener('mousedown', away, true);
  _menu = { box, away, layer: Layers.open(box, { name: 'ref-move', onEsc: _closeMenu }) };
}

async function _doMove(it, ids, to) {
  const said = _v.ov.querySelector('.ref-said');
  said.textContent = 'moving…';
  let r = null;
  try {
    r = await fetch('/api/references/' + encodeURIComponent(it.id) + '/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: ids, to }),
    }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || 'not moved');
  } catch (e) { if (_v) said.textContent = 'not moved: ' + e.message; return; }
  if (!_v) return;
  const where = (to.kind === 'references' ? 'REFERENCES · ' + (to.cat ? to.label : 'its source folder')
    : to.kind === 'images' ? 'IMAGES' + (to.cat ? ' · ' + to.label : '')
    : ({ uploads: 'Uploads', birols: 'B-rolls', hooks: 'Hooks' }[to.kind] || to.kind) + (to.cat ? ' · ' + to.label : ''));
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
  _v.ov.querySelector('.ref-said').textContent = (r.moved ? r.moved + ' moved to ' + where : 'nothing moved')
    + (skipped ? ' · ' + skipped + ' stayed: ' + r.skipped[0].why : '');
}
