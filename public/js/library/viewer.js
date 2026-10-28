// LIBRARY — the viewer.
//
// Opens the item itself, not its thumbnail: an <img> for stills, a <video> with controls
// for clips. Arrows step through the same list the grid is showing, so paging never
// wanders off the current filter.
//
// The element is REPLACED between items rather than reused: swapping a src on a live
// <video> keeps the old frame on screen until the new one decodes, and a video element
// left with a src goes on buffering after it is hidden.

import * as Layers from '../layers.js';
// (phase V49.1) A failure is a popup in the corner (js/notice.js), not the browser's alert().
import { showError } from '../notice.js';

const $ = (sel, root) => (root || document).querySelector(sel);

let _ov = null;
let _layer = null;
let _list = [];
let _at = 0;
let _onIndex = null;
let _onAction = null;
let _actionsFor = () => [];
let _extraRows = null;
// Something a caller hangs UNDER the media on the stage - the cut of a video (js/cut.js) is the one there is.
// Opt-in: a page that passes nothing gets exactly the viewer it had.
let _underStage = null;
// What a PICTURE is drawn from on the stage, when not its own file - Merge shows the 2048px preview
// tier rather than a 4K original (phase J4). Opt-in, like the rest.
let _showSrc = null;
// What a VIDEO plays on the stage, when not its own file - a piece showing its whole video (js/cut.js, phase TG block 7).
let _videoSrc = null;

const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i;
// A track has nothing to look at, so it gets a player on the stage instead of a broken picture.
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)(\?|$)/i;

function _fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function _meta(it) {
  const rows = [];
  rows.push(['kind', it.kind || '']);
  const m = it.meta || {};
  if (m.character) rows.push(['character', m.character]);
  if (m.gender) rows.push(['gender', m.gender]);
  if (m.looks != null) rows.push(['looks', String(m.looks)]);
  if (m.voices) rows.push(['voices', String(m.voices)]);
  if (m.variations) rows.push(['variations', String(m.variations)]);
  if (m.categoryId) rows.push(['category', m.categoryId]);
  if (m.favorite) rows.push(['favourite', 'yes']);
  if (m.date) rows.push(['date', _fmtDate(m.date)]);
  // (phase V27) A clip that came by a link: where from, opened in the browser.
  if (m.link) {
    const a = document.createElement('a');
    a.href = m.link; a.target = '_blank'; a.rel = 'noreferrer';
    a.title = m.link;
    a.textContent = String(m.link).replace(/^https?:\/\/(www\.)?/i, '').slice(0, 60) + (String(m.link).length > 70 ? '…' : '');
    rows.push(['link', a]);
  }
  rows.push(['file', String(it.media || '').split('/').pop()]);
  return rows;
}

function _paint() {
  if (!_ov) return;
  const it = _list[_at];
  if (!it) return closeViewer();

  const stage = $('.lib-view-stage', _ov);
  stage.textContent = '';                     // replace, never reuse (see the note above)
  // A sound of the Sounds shelf is heard whatever its extension says - a .webm there has no picture (phase V7).
  const isSound = it.kind === 'sounds';
  const isVideo = !isSound && VIDEO_RE.test(String(it.media || ''));
  if (isVideo) {
    const v = document.createElement('video');
    v.className = 'lib-view-media';
    v.src = (_videoSrc && _videoSrc(it)) || it.media;
    v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true;
    stage.appendChild(v);
    if (_underStage) {
      const extra = _underStage(it, v);
      if (extra) { stage.classList.add('has-under'); stage.appendChild(extra); }
      else stage.classList.remove('has-under');
    }
  } else if (isSound || AUDIO_RE.test(String(it.media || ''))) {
    const a = document.createElement('audio');
    a.className = 'lib-view-audio';
    a.src = it.media;
    a.controls = true;
    a.autoplay = true;
    stage.appendChild(a);
    stage.classList.remove('has-under');
  } else {
    const img = document.createElement('img');
    img.className = 'lib-view-media';
    img.src = (_showSrc && _showSrc(it)) || it.media;
    img.alt = it.name || '';
    stage.appendChild(img);
    stage.classList.remove('has-under');
  }

  $('.lib-view-title', _ov).textContent = it.name || '';
  $('.lib-view-count', _ov).textContent = (_at + 1) + ' / ' + _list.length;

  const info = $('.lib-view-info', _ov);
  info.textContent = '';
  // Rows the caller supplies come first and hold real controls (the kind and category
  // dropdowns), so they are elements rather than text; the read-only facts follow. A fact
  // the caller made editable is dropped from the read-only set — otherwise the panel
  // shows "kind" twice, once as a dropdown and once as text that cannot be changed.
  const extra = (typeof _extraRows === 'function' ? (_extraRows(it) || []) : []);
  const owned = new Set(extra.map(([k]) => k));
  const rows = extra.concat(_meta(it).filter(([k]) => !owned.has(k)));
  for (const [k, v] of rows) {
    if (!v) continue;
    const row = document.createElement('div');
    row.className = 'lib-view-row';
    const key = document.createElement('span'); key.className = 'lib-view-k'; key.textContent = k;
    const val = document.createElement('span'); val.className = 'lib-view-v';
    if (v instanceof Node) val.appendChild(v); else val.textContent = v;
    row.appendChild(key); row.appendChild(val);
    info.appendChild(row);
  }

  // WHAT IT WAS MADE FROM. A clip animated out of a still carries the path back to that
  // picture, and six generated seconds are very hard to place months later - the reference
  // frame is often the only thing that identifies one. Shown as a picture rather than a
  // path, above the facts, because that is the form in which it is recognisable.
  const ref = (it.meta || {}).refImage;
  if (ref) {
    const row = document.createElement('div');
    row.className = 'lib-view-row lib-view-ref';
    const key = document.createElement('span'); key.className = 'lib-view-k'; key.textContent = 'from';
    const val = document.createElement('span'); val.className = 'lib-view-v';
    const a = document.createElement('a');
    a.href = ref; a.target = '_blank'; a.rel = 'noreferrer';
    a.title = 'Open the picture this was animated from';
    const im = document.createElement('img');
    im.src = '/api/thumb?src=' + encodeURIComponent(ref) + '&v=card';
    im.alt = 'reference';
    a.appendChild(im);
    val.appendChild(a);
    row.appendChild(key); row.appendChild(val);
    info.insertBefore(row, info.firstChild);
  }

  _paintActions(it);
  if (typeof _onIndex === 'function') _onIndex(_at, it);
}

// The action row is rebuilt per item: what you may do depends on the shelf the item
// came from (a lookbook file has no favourite flag, a character has no category), and
// the labels are stateful — "Favourite" flips to "Unfavourite".
function _paintActions(it) {
  const box = $('.lib-view-acts', _ov);
  if (!box) return;
  box.textContent = '';
  if (typeof _onAction !== 'function') return;
  for (const a of (_actionsFor(it) || [])) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-btn' + (a.danger ? ' danger' : '');
    b.textContent = a.label;
    if (a.title) b.title = a.title;
    b.addEventListener('click', async () => {
      box.querySelectorAll('button').forEach(x => { x.disabled = true; });
      let r = null;
      try { r = await _onAction(a.id, it); } catch (e) { showError(e.message); }
      if (!_ov) return;                                  // the handler closed us
      if (r && r.removed) return dropCurrent();
      // Only the buttons changed (a "Delete" waiting for its second press) - the video plays on.
      if (r && r.actionsOnly) { _paintActions(it); return; }
      _paint();
    });
    box.appendChild(b);
  }
}

// THE RIGHT COLUMN'S WIDTH (phase V35, the owner 2026-10-23, (т5): "в просмотре медиа в попапе ... sash добавим там, чтобы
// пользователь мог менять размеры для удобства"). A sash between the stage and the column: dragged LEFT, the column widens;
// the stage keeps room for a picture. The width is remembered - one for every viewer: this one (the Library's and Merge's)
// and a post's (js/references/post.js) - and a double press gives the page's own width back (css: 220px, Merge 260px).
const LS_INFO_W = 'ugc_view_info_w_v1';
const INFO_MIN = 180, STAGE_MIN = 260;

/** A sash before `.lib-view-info` in a viewer's overlay `ov`. */
export function wireInfoSash(ov) {
  const info = ov && ov.querySelector('.lib-view-info');
  const body = info && info.parentElement;
  if (!info || !body) return;
  const sash = document.createElement('div');
  sash.className = 'lib-view-sash';
  sash.title = 'Drag to resize the column - a double press gives its usual width back';
  body.insertBefore(sash, info);
  // The two arrows (40px each) and the stage stay; the column takes the rest at most.
  const max = () => Math.max(INFO_MIN, body.getBoundingClientRect().width - STAGE_MIN - 80);
  const apply = (w) => {
    const v = Math.round(Math.max(INFO_MIN, Math.min(max(), w)));
    info.style.flexBasis = v + 'px';
    return v;
  };
  let saved = 0;
  try { saved = parseInt(localStorage.getItem(LS_INFO_W) || '', 10) || 0; } catch (e) { saved = 0; }
  if (saved) apply(saved);
  sash.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = e.clientX;
    const base = info.getBoundingClientRect().width;
    document.body.classList.add('lib-view-resizing');
    const move = (ev) => apply(base - (ev.clientX - from));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('lib-view-resizing');
      try { localStorage.setItem(LS_INFO_W, String(Math.round(info.getBoundingClientRect().width))); } catch (err) { /* a private window */ }
      // The press may end over the dark around the window: that click must not close the viewer.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  sash.addEventListener('dblclick', () => {
    info.style.flexBasis = '';
    try { localStorage.removeItem(LS_INFO_W); } catch (e) { /* a private window */ }
  });
}

// Drop the item being shown and move to the next one — what a delete leaves behind.
// The list is the page's array, so it is filtered rather than spliced in place.
export function dropCurrent() {
  if (!_ov) return;
  _list = _list.filter((_, i) => i !== _at);
  if (!_list.length) return closeViewer();
  if (_at >= _list.length) _at = _list.length - 1;
  _paint();
}

/** Draw the current item again - after a caller has changed it in place (a clip trimmed to a
 *  new file has a new `media`, and the stage has to play that one, not the one it opened on). */
export function repaint() { _paint(); }

export function step(d) {
  if (!_ov || !_list.length) return;
  _at = (_at + d + _list.length) % _list.length;
  _paint();
}

// Escape is the stack's (js/layers.js) - it belongs to whatever is on top, which may be a
// box opened over this viewer. The arrows are this viewer's own, and only while it is the
// top layer - and never in a field (phase V56: a description is written in the right column).
function _onKey(e) {
  if (!_ov || !Layers.topIs(_layer)) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
}

export function openViewer(items, index, opts) {
  closeViewer();
  _list = (items || []).filter(i => i && i.media);
  if (!_list.length) return;
  _at = Math.max(0, Math.min(_list.length - 1, index || 0));
  const o = opts || {};
  _onIndex = o.onIndex || null;
  _onAction = o.onAction || null;
  _actionsFor = typeof o.actionsFor === 'function' ? o.actionsFor : () => [];
  _extraRows = typeof o.extraRows === 'function' ? o.extraRows : null;
  _underStage = typeof o.underStage === 'function' ? o.underStage : null;
  _showSrc = typeof o.showSrc === 'function' ? o.showSrc : null;
  _videoSrc = typeof o.videoSrc === 'function' ? o.videoSrc : null;

  const ov = document.createElement('div');
  ov.className = 'lib-view-ov';
  ov.innerHTML = `
    <div class="lib-view">
      <div class="lib-view-head">
        <span class="lib-view-title"></span>
        <span class="lib-view-count"></span>
        <span class="sp"></span>
        <span class="lib-view-acts"></span>
        <button class="lib-btn" data-x="close" type="button" title="Close (Esc)">&#10005;</button>
      </div>
      <div class="lib-view-body">
        <button class="lib-view-arrow" data-x="prev" type="button" title="Previous (left arrow)">&#8249;</button>
        <div class="lib-view-stage"></div>
        <button class="lib-view-arrow" data-x="next" type="button" title="Next (right arrow)">&#8250;</button>
        <aside class="lib-view-info"></aside>
      </div>
    </div>`;
  document.body.appendChild(ov);
  _ov = ov;
  wireInfoSash(ov);

  $('[data-x="close"]', ov).addEventListener('click', closeViewer);
  $('[data-x="prev"]', ov).addEventListener('click', () => step(-1));
  $('[data-x="next"]', ov).addEventListener('click', () => step(1));
  ov.addEventListener('click', (e) => { if (e.target === ov) closeViewer(); });
  document.addEventListener('keydown', _onKey);
  _layer = Layers.open(ov, { name: 'viewer', onEsc: closeViewer });

  _paint();
}

export function closeViewer() {
  if (!_ov) return;
  // stop any playback before the node goes, or Chrome keeps buffering a detached video
  _ov.querySelectorAll('video, audio').forEach(v => { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load(); });
  _ov.remove();
  _ov = null;
  _list = [];
  _onIndex = null;
  _onAction = null;
  _actionsFor = () => [];
  _extraRows = null;
  _showSrc = null;
  _videoSrc = null;
  _underStage = null;
  document.removeEventListener('keydown', _onKey);
  if (_layer) { Layers.close(_layer); _layer = null; }
}
