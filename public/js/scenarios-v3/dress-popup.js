// Scenarios v3 — "Dress the character" popup, opened by CLICKING the character
// card in Casting. Rebuilds v2's popup with one addition: a narrow leftmost
// column listing characters, so switching character re-fills the obraz gallery
// without leaving the popup.
//
// Columns:  characters | lookbooks | preview + gallery | create a lookbook
//
// Commit rule (differs from v2 on purpose): the casting changes ONLY when an
// item in the centre gallery is clicked. Closing the popup — ×, click-outside,
// Esc — commits nothing, and merely browsing characters commits nothing either.
//
// This phase is the shell: dressing (Apply / Mix / Re-dress) and creating a
// lookbook are laid out but disabled; they get wired in the next phase.

import { loadCharacters, loadLookbooks, filterByGender, thumbImg, thumb } from './chars.js';
import { preview1k, genLookbook, genDress, genMix, finalize, awaitTask, lookbookMeta, obrazSave, obrazDelete } from './api.js';
import { startProgress, lockControls, freeze } from '../progress.js';

// Two independent engine settings, both mirrored server-side by storage-sync.js:
// the header gear governs dressing, the generator's own gear governs lookbooks.
const ENGINE_KEY    = 'sv3_engine_v1';
const LB_ENGINE_KEY = 'sv3_lb_engine_v1';
const _pref = (k, dflt) => { try { return localStorage.getItem(k) || dflt; } catch (e) { return dflt; } };
const _engine   = () => _pref(ENGINE_KEY, 'nano-banana-2');
const _lbEngine = () => _pref(LB_ENGINE_KEY, 'nano-banana-2');

const MAX_MIX = 5;

// Placeholder for the generator's prompt box: five concrete outfit descriptions,
// one per line, so it is obvious what level of detail works.
const CLOTHING_EXAMPLES = [
  'oversized beige linen blazer, white ribbed tank, wide-leg cream trousers, tan leather loafers',
  'black cropped moto jacket, grey graphic tee, ripped skinny jeans, chunky boots, silver chain',
  'olive utility jumpsuit, white crew socks, brown suede sneakers, canvas tote bag',
  'navy pinstripe suit, light blue oxford shirt, burgundy silk tie, brown brogues, leather belt',
  'pastel pink hoodie, high-waist mom jeans, white low-top sneakers, mini crossbody bag',
].join('\n');

let _ov       = null;
let _chars    = [];
let _lbs      = [];
let _sel      = null;    // selected character
let _active   = null;    // { src, obrazId, kind:'base'|'obraz' }
let _selectedLbs = [];
let _onCommit = null;
let _genFile  = null;    // { name, dataUrl } of the uploaded outfit reference
let _fresh    = [];      // lookbooks generated in this session, newest first
let _busy     = false;   // a generation is in flight
let _lbGender = {};      // public path -> { gender } for lookbooks that have one
let _projGender = '';    // the open project's narrator gender

// ── hover preview: enlarged tile, always to the right, never off-interface ───
const _hoverMemo = new Map();   // full path -> 1K path, so repeat hovers are instant
let _hoverEl = null;

function _hideHover() {
  if (_hoverEl) { _hoverEl.remove(); _hoverEl = null; }
}

async function _showHover(anchor, fullPath) {
  _hideHover();
  if (!_ov) return;
  const box = _ov.querySelector('.sv3-pop');
  if (!box) return;

  const el = document.createElement('div');
  el.className = 'sv3-lbhover';
  const img = document.createElement('img');
  img.alt = '';
  img.src = _hoverMemo.get(fullPath) || thumb(fullPath);
  el.appendChild(img);
  _ov.appendChild(el);
  _hoverEl = el;

  // Sit to the RIGHT of the tile, vertically centred on it, then clamp inside the
  // popup box so the panel can never spill past the interface edge.
  const place = () => {
    if (_hoverEl !== el) return;
    const a = anchor.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = a.right + 10;
    if (left + w > b.right - 8) left = Math.max(b.left + 8, a.left - w - 10);   // no room right -> flip
    let top = a.top + a.height / 2 - h / 2;
    top = Math.min(Math.max(top, b.top + 8), b.bottom - h - 8);
    el.style.left = Math.round(left) + 'px';
    el.style.top  = Math.round(top) + 'px';
  };
  place();
  img.addEventListener('load', place, { once: true });

  if (!_hoverMemo.get(fullPath)) {
    const p = await preview1k(fullPath);
    _hoverMemo.set(fullPath, p);
    if (_hoverEl === el) { img.src = p; }
  }
}

// Which lookbooks the grid should show. Unknown gender stays visible on purpose:
// everything that predates the gender pass must not disappear.
function _lbVisible() {
  const sel = _q('#sv3-pop-lbfilter');
  const mode = (sel && sel.value) || 'char';
  if (mode === 'all') return _lbs;
  const want = mode === 'char' ? String(_projGender || '').toLowerCase() : mode;
  if (!want) return _lbs;
  return _lbs.filter(lb => {
    const g = ((_lbGender[lb.path] || {}).gender || '').toLowerCase();
    return !g || g === 'unisex' || g === want;
  });
}

function _close() {
  document.removeEventListener('keydown', _onKey);
  _hideHover();
  if (_ov) _ov.remove();
  _ov = null; _sel = null; _active = null; _selectedLbs = []; _genFile = null;
}
function _onKey(e) { if (e.key === 'Escape') _close(); }

const _q = sel => (_ov ? _ov.querySelector(sel) : null);

function _status(text) {
  const n = _q('#sv3-pop-st');
  if (n) n.textContent = text || '';
}

// ── left column: one row per character ──────────────────────────────────────
function _renderChars() {
  const box = _q('#sv3-pop-chars');
  if (!box) return;
  box.textContent = '';

  if (!_chars.length) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'No characters match — create one on the Character tab.';
    box.appendChild(e);
    return;
  }

  _chars.forEach(c => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sv3-pop-ch' + (_sel && _sel.id === c.id ? ' on' : '');
    row.title = `${c.name}${c.gender ? ' · ' + c.gender : ''} — ${c.obrazy.length} look(s)`;

    // Square tile cropped to the LEFT of the sheet — that is where the portrait
    // close-up sits, so the row shows the character's face and nothing else.
    //
    // /api/thumb, NOT chars.js thumbImg: that one rewrites the path into a neighbouring
    // thumbs/ folder and, when nothing is there, falls back to the full 4K sheet. Two
    // characters missing their thumbs were pulling 1.96 MB into a column of small tiles.
    // This derivative is capped at 30 KB and cached on its source's mtime.
    const im = document.createElement('div');
    im.className = 'sv3-pop-ch-im';
    if (c.sheet) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = '/api/thumb?src=' + encodeURIComponent(c.sheet) + '&v=face';
      im.appendChild(img);
    }

    const nm = document.createElement('div');
    nm.className = 'sv3-pop-ch-nm';
    nm.textContent = c.name;

    row.append(im, nm);
    row.addEventListener('click', () => _pickChar(c));   // browsing only — never commits
    box.appendChild(row);
  });
}

function _pickChar(c) {
  _sel = c;
  _active = c.sheet ? { src: c.sheet, obrazId: '', kind: 'base' } : null;
  _renderChars(); _renderPreview(); _renderGallery(); _syncSave(); _syncApply();
  _status('');
}

// ── centre: the active image at ~1K ─────────────────────────────────────────
// The thumb goes up instantly so the pane is never blank, then the 1K derivative
// replaces it. The full 4K file is never pulled here.
let _prevToken = 0;

async function _renderPreview() {
  const box = _q('#sv3-pop-prev');
  if (!box) return;
  box.textContent = '';
  if (!_active || !_active.src) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = _sel ? 'This character has no reference sheet yet.' : 'Pick a character on the left.';
    box.appendChild(e);
    return;
  }

  const token = ++_prevToken;
  const img = document.createElement('img');
  img.alt = '';
  img.className = 'sv3-pop-previmg warming';
  img.src = thumb(_active.src);
  box.appendChild(img);

  const p = await preview1k(_active.src);
  if (token !== _prevToken || !_ov || !img.isConnected) return;   // a newer pick won
  img.src = p;
  img.classList.remove('warming');
}

function _syncSave() {
  const b = _q('#sv3-pop-save');
  if (b) b.disabled = !(_sel && _active && _active.src);
}

// ── centre: gallery = base 4K sheet + this character's obrazy ───────────────
// Clicking an item only PREVIEWS it. Nothing reaches the project until Save.
function _renderGallery() {
  const box = _q('#sv3-pop-gal');
  if (!box) return;
  box.textContent = '';
  if (!_sel) return;

  // base on the far left, then the looks newest-first, so a freshly dressed one
  // always lands immediately next to base. Sorted here rather than relying on the
  // loader's order, so it cannot drift.
  const items = [];
  if (_sel.sheet) items.push({ src: _sel.sheet, obrazId: '', kind: 'base', label: 'base 4K reference' });
  _sel.obrazy.slice()
    .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))
    .forEach(o => items.push({ src: o.image, obrazId: o.id, kind: 'obraz', label: o.name || 'look' }));

  if (!items.length) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'No looks for this character yet.';
    box.appendChild(e);
    return;
  }

  items.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-pop-git' + (it.kind === 'base' ? ' base' : '')
      + (_active && _active.kind === it.kind && String(_active.obrazId) === String(it.obrazId) ? ' on' : '');
    b.appendChild(thumbImg(it.src));
    b.title = `${it.label} — click to preview`;
    b.addEventListener('click', () => {
      _active = { src: it.src, obrazId: it.obrazId, kind: it.kind };
      _renderPreview(); _renderGallery(); _syncSave(); _syncApply();
    });

    // A look can be thrown away straight from the strip. The base sheet has no
    // ✕ — it belongs to the character, not to this library.
    if (it.kind === 'obraz' && it.obrazId) {
      const x = document.createElement('span');
      x.className = 'sv3-pop-gitx';
      x.textContent = '×';
      x.title = 'Delete this look';
      x.addEventListener('click', async (e) => {
        e.stopPropagation();                 // never let it double as "preview"
        if (_busy) return;
        try {
          await obrazDelete(it.obrazId);
          const all = await loadCharacters(true);
          _chars = filterByGender(all, _projGender);
          const again = _chars.find(c => c.id === _sel.id);
          if (again) _sel = again;
          // if the deleted look was on screen, fall back to the base sheet
          if (_active && String(_active.obrazId) === String(it.obrazId)) {
            _active = _sel && _sel.sheet ? { src: _sel.sheet, obrazId: '', kind: 'base' } : null;
            _renderPreview();
          }
          _renderChars(); _renderGallery(); _syncSave(); _syncApply();
          _status('Look deleted.');
        } catch (err) {
          _status('Delete failed: ' + err.message);
        }
      });
      b.appendChild(x);
    }
    box.appendChild(b);
  });
}

// Save is the only thing that touches the project.
function _commit() {
  if (!_sel || !_active || !_active.src) return;
  const payload = {
    characterId:   _sel.id,
    characterName: _sel.name,
    obrazId:       _active.obrazId || '',
    obrazImage:    _active.src,
  };
  _close();
  if (_onCommit) _onCommit(payload);
}

// ── lookbook grid (selection works; dressing lands next phase) ──────────────
function _renderLbs() {
  const box = _q('#sv3-pop-lbgrid');
  if (!box) return;
  box.textContent = '';
  if (!_lbs.length) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'No lookbooks yet.';
    box.appendChild(e);
    return;
  }
  // Anything generated in this session goes first, so a fresh lookbook lands in
  // the top-left corner no matter how the library lists its files.
  const shown = _lbVisible();
  if (!shown.length) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'No lookbooks for this gender — switch the filter above.';
    box.appendChild(e);
    return;
  }
  // Selected tiles jump to the top-left in the order they were picked, so the
  // selection is always in sight; freshly generated ones follow.
  const BIG = Number.MAX_SAFE_INTEGER;
  const selRank   = p => { const i = _selectedLbs.indexOf(p); return i < 0 ? BIG : i; };
  const freshRank = p => { const i = _fresh.indexOf(p); return i < 0 ? BIG : i; };
  const ordered = shown.slice().sort((a, b) => {
    const s = selRank(a.path) - selRank(b.path);
    if (s !== 0) return s;
    return freshRank(a.path) - freshRank(b.path);
  });

  ordered.forEach(lb => {
    const picked = _selectedLbs.indexOf(lb.path);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-pop-lb' + (picked >= 0 ? ' on' : '');
    b.style.backgroundImage = `url('${lb.thumbPath || lb.path}')`;
    const g = ((_lbGender[lb.path] || {}).gender || '');
    b.title = (lb.name || lb.path) + (g ? ' · ' + g : '');
    if (picked >= 0) {
      // the number also shows the mix order when several are selected
      const n = document.createElement('span');
      n.className = 'sv3-pop-lbnum';
      n.textContent = String(picked + 1);
      b.appendChild(n);
    }
    b.addEventListener('mouseenter', () => _showHover(b, lb.path));
    b.addEventListener('mouseleave', _hideHover);
    b.addEventListener('click', () => {
      const i = _selectedLbs.indexOf(lb.path);
      if (i >= 0) _selectedLbs.splice(i, 1);
      else if (_selectedLbs.length < MAX_MIX) _selectedLbs.push(lb.path);
      _renderLbs(); _syncApply();
    });
    box.appendChild(b);
  });
}

// One button, three jobs — exactly as v2 read the selection:
//   1 lookbook   -> Apply    (dress the base 4K sheet)
//   2-5          -> Mix      (blend them into a new lookbook)
//   none + note  -> Re-dress (change the clothes on the shown image)
function _applyMode() {
  const n = _selectedLbs.length;
  const note = ((_q('#sv3-pop-refine') || {}).value || '').trim();
  if (n >= 2) return 'mix';
  if (n === 1) return 'apply';
  if (note && _active && _active.src) return 'redress';
  return '';
}

function _syncApply() {
  const btn = _q('#sv3-pop-apply');
  if (!btn) return;
  const n = _selectedLbs.length;
  const mode = _applyMode();
  btn.textContent = mode === 'mix' ? `Mix ${n} looks` : (mode === 'redress' ? 'Re-dress' : 'Apply');
  btn.disabled = !mode || _busy;
  const wrap = _q('#sv3-pop-apply-wrap');
  if (wrap) {
    wrap.title = mode === 'mix'   ? `Blend ${n} lookbooks into a new one — spends credits`
      : mode === 'apply'   ? 'Dress the base 4K sheet in the selected lookbook — spends credits'
      : mode === 'redress' ? 'Change the clothes on the shown image from your note — spends credits'
      : 'Select a lookbook, 2-5 to mix, or type a note to re-dress the shown image';
  }
}

const _APPLY_LABEL = {
  apply:   'Dressing the reference sheet…',
  mix:     'Blending the lookbooks…',
  redress: 'Re-dressing the shown image…',
};

// The paid paths in the centre/left columns.
async function _onApply() {
  const mode = _applyMode();
  if (!mode || _busy || !_sel) return;
  const note = ((_q('#sv3-pop-refine') || {}).value || '').trim();

  _busy = true; _syncApply(); _syncGen();
  const unlock = lockControls([
    _q('#sv3-pop-apply'), _q('#sv3-pop-refine'), _q('#sv3-pop-save'),
    _q('#sv3-pop-gen'), _q('#sv3-pop-count'),
  ]);
  // mixing produces a lookbook, so its progress belongs over the grid; dressing
  // produces a character image, so it belongs over the centre preview
  const host = mode === 'mix' ? _q('#sv3-pop-lbgrid') : _q('#sv3-pop-prev');
  const pr = startProgress(host, { label: _APPLY_LABEL[mode], total: 1 });
  const thaw = freeze(_q('.sv3-pop'));   // nothing in the popup is clickable meanwhile

  try {
    if (mode === 'mix') {
      const r = await genMix({ paths: _selectedLbs.slice(), note, engine: _lbEngine() });
      const s = await awaitTask(r.taskId);
      const f = await finalize(s.imagePath, 'lookbook', '');
      pr.step(); pr.finish();
      _fresh = [f.path].concat(_fresh.filter(p => p !== f.path));
      _lbs = await loadLookbooks(true);
      try { _lbGender = await lookbookMeta(); } catch (e) {}
      _selectedLbs = [];
      _renderLbs();
      _status('Mixed into a new lookbook.');
    } else {
      const basePath = mode === 'apply' ? (_sel.sheet || '') : _active.src;
      if (!basePath) throw new Error('this character has no reference sheet to dress');
      const r = await genDress({
        basePath,
        lookbookPath: mode === 'apply' ? _selectedLbs[0] : '',
        note, engine: _engine(),
      });
      const s = await awaitTask(r.taskId);
      // dressed looks join the character's own library
      const saved = await obrazSave({
        charId: _sel.id, charName: _sel.name, imagePath: s.imagePath,
        gender: _sel.gender || '', lookbookPath: mode === 'apply' ? _selectedLbs[0] : '', engine: _engine(),
      });
      pr.step(); pr.finish();

      // reload the character so the new obraz appears in the gallery, then show it
      const all = await loadCharacters(true);
      _chars = filterByGender(all, _projGender);
      const again = _chars.find(c => c.id === _sel.id);
      if (again) _sel = again;
      _active = { src: saved.path, obrazId: saved.obrazId, kind: 'obraz' };
      _renderChars(); _renderPreview(); _renderGallery();
      _status(mode === 'apply' ? 'Dressed and saved as a look.' : 'Re-dressed and saved as a look.');
    }
    // The note has been consumed. Leaving it would silently fold into the next
    // Apply, or turn a forgotten note into an accidental Re-dress.
    const rf = _q('#sv3-pop-refine');
    if (rf) rf.value = '';
  } catch (e) {
    pr.fail(e.message || 'generation failed');
  } finally {
    _busy = false;
    thaw();
    unlock();
    _syncApply(); _syncGen(); _syncSave();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CREATE-A-LOOKBOOK column — collapsed to a spine, opens to double width.
//
// Three modes, decided by what the user supplied:
//   text only        -> draw a brand-new lookbook from the description
//   photo only       -> extract the outfit from the photo as it is
//   photo + text     -> analyse the notes against the photo first, then extract
//                       with those edits applied
// The generation itself is wired in the next phase; the mode detection, the
// upload and the collapse behaviour are live now.
// ════════════════════════════════════════════════════════════════════════════

function _setCreateOpen(open) {
  const col = _q('#sv3-pop-create');
  if (col) col.classList.toggle('is-collapsed', !open);
}

function _genMode() {
  const txt = ((_q('#sv3-pop-genprompt') || {}).value || '').trim();
  if (_genFile && txt) return 'edit';
  if (_genFile)        return 'extract';
  if (txt)             return 'scratch';
  return '';
}

const _MODE_TEXT = {
  scratch: 'Draws a new lookbook from your description.',
  extract: 'Extracts the outfit from the photo as it is.',
  edit:    'Analyses your notes against the photo, then extracts the outfit with those edits.',
};

function _syncGen() {
  const mode = _genMode();
  const hint = _q('#sv3-pop-genmode');
  const btn  = _q('#sv3-pop-gen');
  const wrap = _q('#sv3-pop-gen-wrap');
  if (hint) hint.textContent = mode ? _MODE_TEXT[mode] : 'Add a photo or describe an outfit.';
  if (btn)  btn.disabled = !mode || _busy;
  if (wrap) wrap.title = mode ? 'Generate — this spends credits' : 'Add a photo or describe an outfit';
  const cnt = _q('#sv3-pop-count');
  if (cnt) cnt.disabled = mode !== 'scratch' || _busy;   // count only applies from scratch
}

const _GEN_LABEL = {
  scratch: 'Drawing the lookbook…',
  extract: 'Extracting the outfit…',
  edit:    'Reading the photo and your notes…',
};

// The one paid path in this column. Submits, polls every task, files each result
// into the lookbook base, puts them top-left, then collapses the column.
async function _onGenerate() {
  const mode = _genMode();
  if (!mode || _busy) return;
  const promptTxt = ((_q('#sv3-pop-genprompt') || {}).value || '').trim();
  const count = mode === 'scratch' ? Math.max(1, Math.min(5, +((_q('#sv3-pop-count') || {}).value || 1))) : 1;

  _busy = true;
  const unlock = lockControls([
    _q('#sv3-pop-gen'), _q('#sv3-pop-count'), _q('#sv3-pop-genprompt'),
    _q('#sv3-pop-save'), _q('#sv3-pop-apply'), _q('#sv3-pop-create-x'),
  ]);
  const pr = startProgress(_q('#sv3-pop-drop'), { label: _GEN_LABEL[mode], total: count });
  const thaw = freeze(_q('.sv3-pop'));

  try {
    const r = await genLookbook({
      prompt: promptTxt,
      imageBase64: _genFile ? _genFile.dataUrl : '',
      count, engine: _lbEngine(),
    });
    const ids = r.taskIds || [];
    if (!ids.length) throw new Error('the engine returned no tasks');
    pr.tick(count > 1 ? `Generating ${count} options…` : 'Generating…');

    // poll in parallel; a single failure must not throw away the others
    // the gender came back with the task ids, so it is filed together with the image
    const settled = await Promise.allSettled(ids.map(async (tid) => {
      const s = await awaitTask(tid);
      const f = await finalize(s.imagePath, 'lookbook', r.gender || '');
      pr.step();
      return f.path;
    }));
    const paths = settled.filter(x => x.status === 'fulfilled' && x.value).map(x => x.value);
    const lost  = settled.length - paths.length;
    if (!paths.length) {
      throw new Error((settled[0] && settled[0].reason && settled[0].reason.message) || 'generation failed');
    }
    pr.finish();

    _fresh = paths.concat(_fresh.filter(p => !paths.includes(p)));
    _lbs = await loadLookbooks(true);
    try { _lbGender = await lookbookMeta(); } catch (e) {}
    _renderLbs();

    // clear the form and fold the column away
    _genFile = null;
    _showDropped(null);
    const ta = _q('#sv3-pop-genprompt'); if (ta) ta.value = '';
    _setCreateOpen(false);
    _status(lost ? `${paths.length} lookbook(s) added, ${lost} failed.` : `${paths.length} lookbook(s) added.`);
  } catch (e) {
    pr.fail(e.message || 'generation failed');
    _status('');
  } finally {
    _busy = false;
    thaw();
    unlock();
    _syncGen(); _syncSave();
  }
}

// One wiring routine for both gears: a toggle, an outside-click close, and a
// select that persists to its own key.
function _wireOneGear(gearId, popId, selId, key, dflt) {
  const gear = _q('#' + gearId);
  const pop  = _q('#' + popId);
  const sel  = _q('#' + selId);
  if (sel) {
    const want = _pref(key, dflt);
    sel.value = Array.prototype.some.call(sel.options, o => o.value === want) ? want : dflt;
    sel.addEventListener('change', () => { try { localStorage.setItem(key, sel.value); } catch (e) {} });
  }
  if (gear && pop) {
    gear.addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('open'); });
    document.addEventListener('click', (e) => {
      if (pop.classList.contains('open') && !pop.contains(e.target) && e.target !== gear) pop.classList.remove('open');
    });
  }
}

function _wireGear() {
  _wireOneGear('sv3-pop-gear',   'sv3-pop-gearpop',   'sv3-pop-engine',   ENGINE_KEY,    'nano-banana-2');
  _wireOneGear('sv3-pop-lbgear', 'sv3-pop-lbgearpop', 'sv3-pop-lbengine', LB_ENGINE_KEY, 'nano-banana-2');
}

function _showDropped(dataUrl) {
  const drop = _q('#sv3-pop-drop');
  if (!drop) return;
  drop.textContent = '';
  if (dataUrl) {
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '';
    drop.appendChild(img);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'sv3-pop-dropx';
    x.textContent = '×';
    x.title = 'Remove the photo';
    x.addEventListener('click', e => { e.stopPropagation(); _genFile = null; _showDropped(null); _syncGen(); });
    drop.appendChild(x);
  } else {
    const s = document.createElement('span');
    s.innerHTML = 'Drop a photo of a person<br>in an interesting outfit<br>(or click to upload)';
    drop.appendChild(s);
  }
}

function _readFile(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const fr = new FileReader();
  fr.onload = () => {
    _genFile = { name: file.name, dataUrl: String(fr.result || '') };
    _showDropped(_genFile.dataUrl);
    _syncGen();
  };
  fr.readAsDataURL(file);
}

function _wireCreate() {
  const spine = _q('#sv3-pop-create-spine');
  if (spine) spine.addEventListener('click', () => _setCreateOpen(true));
  const x = _q('#sv3-pop-create-x');
  if (x) x.addEventListener('click', () => _setCreateOpen(false));

  const drop = _q('#sv3-pop-drop');
  const file = _q('#sv3-pop-file');
  if (drop && file) {
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('over');
      _readFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    file.addEventListener('change', () => _readFile(file.files && file.files[0]));
  }

  const pr = _q('#sv3-pop-genprompt');
  if (pr) pr.addEventListener('input', _syncGen);

  const gen = _q('#sv3-pop-gen');
  if (gen) gen.addEventListener('click', _onGenerate);

  _syncGen();
}

// ── open ────────────────────────────────────────────────────────────────────
// backTo names whatever is still open underneath, when something is. Opened from the page
// this closes onto the page and Save is just Save; opened from Build mix it closes onto the
// mix, and the button says so - a returning Save and a final one should not look alike.
// characterId overrides who the popup opens on. Without it the popup falls back to whoever
// the project has cast, which is right when it is opened cold and wrong when it was opened
// by pressing the + inside one particular character's looks.
export async function openDressPopup({ project, onCommit, backTo, characterId }) {
  _close();
  _onCommit = onCommit;

  _ov = document.createElement('div');
  _ov.className = 'sv3-pop-ov';
  _ov.innerHTML = `
    <div class="sv3-pop">
      <div class="sv3-pop-head">
        <span class="sv3-pop-title">Dress the character</span>
        <span class="sv3-pop-sub" id="sv3-pop-lock"></span>
        <span class="sp"></span>
        <span class="sv3-gearwrap">
          <button class="sv3-btn sm" id="sv3-pop-gear" type="button" title="Generation settings">&#9881;</button>
          <div class="sv3-gearpop" id="sv3-pop-gearpop">
            <label>Engine for all generations in this popup
              <select id="sv3-pop-engine">
                <option value="nano-banana-2">nano-banana-2</option>
              </select>
            </label>
          </div>
        </span>
        <button class="sv3-btn sm" id="sv3-pop-x" type="button" title="Close without changing the casting">&times;</button>
      </div>
      <div class="sv3-pop-cols">
        <div class="sv3-pop-col sv3-pop-colchars">
          <div class="sv3-pop-sub2">Characters</div>
          <div class="sv3-pop-scroll" id="sv3-pop-chars"></div>
        </div>
        <div class="sv3-pop-col sv3-pop-collbs">
          <div class="sv3-pop-sub2">
            Lookbooks
            <span class="sp"></span>
            <select id="sv3-pop-lbfilter" class="sv3-minisel" title="Filter lookbooks by the gender they suit">
              <option value="char">character</option>
              <option value="male">male</option>
              <option value="female">female</option>
              <option value="all">all</option>
            </select>
          </div>
          <div class="sv3-pop-scroll" id="sv3-pop-lbgrid"></div>
          <textarea class="sv3-pop-refine" id="sv3-pop-refine" rows="2"
            placeholder="Clothing-only tweaks: add jeans, change the colours… With nothing selected this re-dresses the shown image."></textarea>
          <span id="sv3-pop-apply-wrap"><button class="sv3-btn primary" id="sv3-pop-apply" type="button" disabled>Apply</button></span>
        </div>
        <div class="sv3-pop-col sv3-pop-colmid">
          <div class="sv3-pop-prev" id="sv3-pop-prev"></div>
          <div class="sv3-pop-gal" id="sv3-pop-gal"></div>
          <div class="sv3-pop-savebar">
            <span class="sv3-pop-st" id="sv3-pop-st"></span>
            <span class="sp"></span>
            <button class="sv3-btn primary" id="sv3-pop-save" type="button" disabled
              title="Apply the previewed look to this project">Save</button>
          </div>
          <div class="sv3-pop-hint">Click a look to preview it. Only Save applies it to the project.</div>
        </div>
        <div class="sv3-pop-col sv3-pop-colcreate is-collapsed" id="sv3-pop-create">
          <div class="sv3-pop-spine" id="sv3-pop-create-spine" title="Open the lookbook generator">Create a lookbook</div>
          <div class="sv3-pop-createbody">
            <div class="sv3-pop-sub2">
              Create a lookbook
              <span class="sp"></span>
              <span class="sv3-gearwrap">
                <button class="sv3-btn sm" id="sv3-pop-lbgear" type="button" title="Lookbook generation settings">&#9881;</button>
                <div class="sv3-gearpop" id="sv3-pop-lbgearpop">
                  <label>Engine for lookbook generation
                    <select id="sv3-pop-lbengine">
                      <option value="nano-banana-2">nano-banana-2 &mdash; 2K</option>
                      <option value="nano-banana-2-lite">nano-banana-2-lite &mdash; 1K</option>
                    </select>
                  </label>
                </div>
              </span>
              <button class="sv3-btn sm" id="sv3-pop-create-x" type="button" title="Collapse">&times;</button>
            </div>
            <!-- the photo field takes whatever height is left; the prompt and the
                 button stay pinned to the bottom edge of the column -->
            <div class="sv3-pop-drop" id="sv3-pop-drop">
              <span id="sv3-pop-drophint">Drop a photo of a person<br>in an interesting outfit<br>(or click to upload)</span>
            </div>
            <input type="file" id="sv3-pop-file" accept="image/*" style="display:none">
            <div class="sv3-pop-createfoot">
              <textarea class="sv3-pop-refine" id="sv3-pop-genprompt" rows="6"
                placeholder="${CLOTHING_EXAMPLES}"></textarea>
              <div class="sv3-pop-mode" id="sv3-pop-genmode"></div>
              <div class="sv3-pop-genrow">
                <label>Images
                  <select id="sv3-pop-count"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
                </label>
                <span class="sp"></span>
                <span id="sv3-pop-gen-wrap"><button class="sv3-btn primary" id="sv3-pop-gen" type="button" disabled>Generate</button></span>
              </div>
              <div class="sv3-pop-st" id="sv3-pop-genst"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(_ov);

  _q('#sv3-pop-x').addEventListener('click', _close);
  _q('#sv3-pop-save').addEventListener('click', _commit);
  if (backTo) {
    const sv = _q('#sv3-pop-save');
    sv.textContent = 'Save and back to ' + backTo;
    sv.title = 'Apply the previewed look and return to ' + backTo;
  }
  _q('#sv3-pop-apply').addEventListener('click', _onApply);
  _q('#sv3-pop-refine').addEventListener('input', _syncApply);
  _ov.addEventListener('mousedown', e => { if (e.target === _ov) _close(); });
  document.addEventListener('keydown', _onKey);

  const gender = (project && project.gender) || '';
  const lock = _q('#sv3-pop-lock');
  if (lock) lock.textContent = gender ? `${gender} only` : 'all genders (scenario has none)';

  _projGender = gender;
  _status('loading…');
  const [all, lbs, meta] = await Promise.all([loadCharacters(true), loadLookbooks(true), lookbookMeta().catch(() => ({}))]);
  if (!_ov) return;                       // closed while loading
  _lbs = lbs;
  _lbGender = meta || {};
  _chars = filterByGender(all, gender);

  const filt = _q('#sv3-pop-lbfilter');
  if (filt) filt.addEventListener('change', _renderLbs);

  const wantId = String(characterId || ((project && project.casting) || {}).characterId || '');
  const pre = _chars.find(c => c.id === wantId) || _chars[0] || null;
  _status('');
  _renderLbs(); _syncApply(); _wireCreate(); _wireGear();
  if (pre) {
    _pickChar(pre);
    // if the project already has a look for this character, show it as active
    const oid = String(((project && project.casting) || {}).obrazId || '');
    const img = String(((project && project.casting) || {}).obrazImage || '');
    if (img && (!oid || pre.obrazy.some(o => o.id === oid))) {
      _active = { src: img, obrazId: oid, kind: oid ? 'obraz' : 'base' };
      _renderPreview(); _renderGallery();
    }
    _syncSave();
  } else {
    _renderChars(); _renderPreview(); _renderGallery(); _syncSave();
  }
}
