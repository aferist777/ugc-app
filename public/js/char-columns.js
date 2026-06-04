/* ════════════════════════════════════════════════════════════════════════
   CHARACTER COLUMNS — drag-to-reorder (by column header) + resizable sashes.
   Layout (order + per-column flex-grow) persists to localStorage 2s after the
   last change and is restored on reload.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const LS_KEY   = 'char_cols_layout_v1';
  const DEBOUNCE = 2000;
  const MIN_GROW = 0.3;
  let _saveTimer = null;
  let _dragKey   = null;

  const rowEl = () => document.querySelector('#l1-character .char-cols-row');
  const cols  = (row) => Array.from(row.querySelectorAll(':scope > .col-9-16'));

  // Stable key from the header text (help "?" / punctuation stripped).
  function colKey(col) {
    const h = col.querySelector(':scope > .col-header');
    const t = (h ? h.textContent : '').replace(/[^a-zA-Zа-яА-ЯёЁ ]/g, '').trim().toLowerCase().replace(/\s+/g, '_');
    return t || 'col';
  }

  function _load() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } }
  function _persist(row) {
    const list = cols(row);
    const order = list.map(colKey);
    const grows = {};
    list.forEach(c => { grows[colKey(c)] = parseFloat(c.style.flexGrow) || 1; });
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ order, grows })); } catch {}
    }, DEBOUNCE);
  }

  function _applySaved(row) {
    const saved = _load();
    const list = cols(row);
    // widths (flex-grow)
    list.forEach(c => {
      const gr = (saved.grows && saved.grows[colKey(c)]) || 1;
      c.style.flex = gr + ' 1 0';
      c.style.flexGrow = String(gr);
    });
    // order
    if (Array.isArray(saved.order) && saved.order.length) {
      const byKey = {}; list.forEach(c => { byKey[colKey(c)] = c; });
      saved.order.forEach(k => { if (byKey[k]) row.appendChild(byKey[k]); }); // appendChild moves in order
    }
  }

  // ── Resize sashes ───────────────────────────────────────────────────────
  function _rebuildSashes(row) {
    row.querySelectorAll(':scope > .char-col-sash').forEach(s => s.remove());
    const list = cols(row);
    for (let i = 0; i < list.length - 1; i++) {
      const sash = document.createElement('div');
      sash.className = 'char-col-sash';
      sash.title = 'Drag to resize';
      list[i].after(sash);
      _wireSash(sash, row);
    }
  }
  function _wireSash(sash, row) {
    sash.addEventListener('mousedown', e => {
      e.preventDefault();
      const left = sash.previousElementSibling;
      const right = sash.nextElementSibling;
      if (!left || !right) return;
      const rowW = row.getBoundingClientRect().width || 1;
      const total = cols(row).reduce((a, c) => a + (parseFloat(c.style.flexGrow) || 1), 0);
      const startX = e.clientX;
      const lg = parseFloat(left.style.flexGrow) || 1;
      const rg = parseFloat(right.style.flexGrow) || 1;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      sash.classList.add('dragging');
      function mm(ev) {
        const d = ((ev.clientX - startX) / rowW) * total;
        const nl = Math.max(MIN_GROW, lg + d);
        const nr = Math.max(MIN_GROW, rg - d);
        left.style.flex = nl + ' 1 0';  left.style.flexGrow = String(nl);
        right.style.flex = nr + ' 1 0'; right.style.flexGrow = String(nr);
      }
      function mu() {
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        sash.classList.remove('dragging');
        _persist(row);
      }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
    // double-click a sash → reset all columns to equal width
    sash.addEventListener('dblclick', () => {
      cols(row).forEach(c => { c.style.flex = '1 1 0'; c.style.flexGrow = '1'; });
      _persist(row);
    });
  }

  // ── Reorder by dragging the column header ─────────────────────────────────
  function _wireReorder(row) {
    cols(row).forEach(col => {
      const h = col.querySelector(':scope > .col-header');
      if (h && !h._dndWired) {
        h._dndWired = true;
        h.setAttribute('draggable', 'true');
        h.style.cursor = 'grab';
        h.addEventListener('dragstart', e => {
          _dragKey = colKey(col);
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', _dragKey); } catch {}
        });
        h.addEventListener('dragend', () => { _dragKey = null; });
      }
      if (col._dndWired) return;
      col._dndWired = true;
      col.addEventListener('dragover', e => { if (_dragKey) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
      col.addEventListener('drop', e => {
        if (!_dragKey) return;
        e.preventDefault();
        const dragged = cols(row).find(c => colKey(c) === _dragKey);
        _dragKey = null;
        if (!dragged || dragged === col) return;
        const rect = col.getBoundingClientRect();
        if (e.clientX > rect.left + rect.width / 2) col.after(dragged);
        else col.before(dragged);
        _rebuildSashes(row);
        _persist(row);
      });
    });
  }

  function init() {
    const row = rowEl();
    if (!row || row._colsInit) return;
    row._colsInit = true;
    _applySaved(row);
    _rebuildSashes(row);
    _wireReorder(row);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
