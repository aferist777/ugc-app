// LIBRARY — the viewer.
//
// Opens the item itself, not its thumbnail: an <img> for stills, a <video> with controls
// for clips. Arrows step through the same list the grid is showing, so paging never
// wanders off the current filter.
//
// The element is REPLACED between items rather than reused: swapping a src on a live
// <video> keeps the old frame on screen until the new one decodes, and a video element
// left with a src goes on buffering after it is hidden.

const $ = (sel, root) => (root || document).querySelector(sel);

let _ov = null;
let _list = [];
let _at = 0;
let _onIndex = null;
let _onAction = null;
let _actionsFor = () => [];

const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/i;

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
  rows.push(['file', String(it.media || '').split('/').pop()]);
  return rows;
}

function _paint() {
  if (!_ov) return;
  const it = _list[_at];
  if (!it) return closeViewer();

  const stage = $('.lib-view-stage', _ov);
  stage.textContent = '';                     // replace, never reuse (see the note above)
  const isVideo = VIDEO_RE.test(String(it.media || ''));
  if (isVideo) {
    const v = document.createElement('video');
    v.className = 'lib-view-media';
    v.src = it.media;
    v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true;
    stage.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.className = 'lib-view-media';
    img.src = it.media;
    img.alt = it.name || '';
    stage.appendChild(img);
  }

  $('.lib-view-title', _ov).textContent = it.name || '';
  $('.lib-view-count', _ov).textContent = (_at + 1) + ' / ' + _list.length;

  const info = $('.lib-view-info', _ov);
  info.textContent = '';
  for (const [k, v] of _meta(it)) {
    if (!v) continue;
    const row = document.createElement('div');
    row.className = 'lib-view-row';
    const key = document.createElement('span'); key.className = 'lib-view-k'; key.textContent = k;
    const val = document.createElement('span'); val.className = 'lib-view-v'; val.textContent = v;
    row.appendChild(key); row.appendChild(val);
    info.appendChild(row);
  }

  const open = $('[data-x="open"]', _ov);
  open.href = it.media || '#';
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
      try { r = await _onAction(a.id, it); } catch (e) { alert(e.message); }
      if (!_ov) return;                                  // the handler closed us
      if (r && r.removed) return dropCurrent();
      _paint();
    });
    box.appendChild(b);
  }
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

export function step(d) {
  if (!_ov || !_list.length) return;
  _at = (_at + d + _list.length) % _list.length;
  _paint();
}

function _onKey(e) {
  if (!_ov) return;
  if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
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

  const ov = document.createElement('div');
  ov.className = 'lib-view-ov';
  ov.innerHTML = `
    <div class="lib-view">
      <div class="lib-view-head">
        <span class="lib-view-title"></span>
        <span class="lib-view-count"></span>
        <span class="sp"></span>
        <span class="lib-view-acts"></span>
        <a class="lib-btn" data-x="open" target="_blank" rel="noopener" title="Open the file in a new tab">Open</a>
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

  $('[data-x="close"]', ov).addEventListener('click', closeViewer);
  $('[data-x="prev"]', ov).addEventListener('click', () => step(-1));
  $('[data-x="next"]', ov).addEventListener('click', () => step(1));
  ov.addEventListener('click', (e) => { if (e.target === ov) closeViewer(); });
  document.addEventListener('keydown', _onKey);

  _paint();
}

export function closeViewer() {
  if (!_ov) return;
  // stop any playback before the node goes, or Chrome keeps buffering a detached video
  _ov.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} v.removeAttribute('src'); v.load(); });
  _ov.remove();
  _ov = null;
  _list = [];
  _onIndex = null;
  _onAction = null;
  _actionsFor = () => [];
  document.removeEventListener('keydown', _onKey);
}
