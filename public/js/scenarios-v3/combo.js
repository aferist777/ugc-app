// Scenarios v3 — combo field with remembered options (vertical / product / role).
//
// Type a free value into the input; on scenario save the backend harvests it
// into that field's shared list, so next time it shows up as a suggestion. The
// panel is full width and exactly 5.5 rows tall, so a sixth row is cut in half
// and the list visibly continues — that IS the scroll affordance.
//
// Each suggestion carries an ✕ that deletes it from the shared list only; a
// scenario already using the value keeps it, because the record stores a string.

import { deleteOption } from './api.js';

const ROW = 28;          // px per option row — keep in sync with .sv3-combo-opt in the CSS
const VISIBLE = 5.5;     // rows shown before scrolling

export function createCombo({ kind, placeholder, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'sv3-combo';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sv3-combo-input';
  input.placeholder = placeholder || '';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'sv3-combo-caret';
  caret.tabIndex = -1;
  caret.textContent = '▾';
  caret.title = 'Show saved options';

  const panel = document.createElement('div');
  panel.className = 'sv3-combo-panel';
  panel.style.maxHeight = (ROW * VISIBLE) + 'px';

  wrap.append(input, caret, panel);

  let _options = [];
  let _open = false;

  const value = () => input.value.trim();
  const setValue = (v) => { input.value = v == null ? '' : String(v); };

  function close() { _open = false; panel.classList.remove('open'); }

  function open() {
    _open = true;
    panel.classList.add('open');
    render();
  }

  // Typing narrows the suggestions; a value that matches nothing is simply new.
  function render() {
    const q = input.value.trim().toLowerCase();
    const shown = q ? _options.filter(o => o.toLowerCase().includes(q)) : _options;
    panel.textContent = '';

    if (!shown.length) {
      const e = document.createElement('div');
      e.className = 'sv3-combo-empty';
      e.textContent = _options.length ? 'No match — it will be saved as new' : 'No saved options yet';
      panel.appendChild(e);
      return;
    }

    shown.forEach(opt => {
      const row = document.createElement('div');
      row.className = 'sv3-combo-opt';

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'sv3-combo-pick';
      pick.textContent = opt;
      pick.addEventListener('click', () => {
        setValue(opt);
        close();
        if (onChange) onChange(value());
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'sv3-combo-del';
      del.textContent = '✕';
      del.title = 'Remove this saved option';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        del.disabled = true;
        try {
          const next = await deleteOption(kind, opt);
          _options = next[kind] || [];
          render();
        } catch (err) {
          del.disabled = false;
          console.error('[sv3] option delete failed', err);
        }
      });

      row.append(pick, del);
      panel.appendChild(row);
    });
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', () => { if (!_open) open(); else render(); if (onChange) onChange(value()); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && _open) { e.stopPropagation(); close(); } });
  caret.addEventListener('click', () => { _open ? close() : (input.focus(), open()); });

  // Any click outside the widget dismisses the panel.
  document.addEventListener('click', (e) => { if (_open && !wrap.contains(e.target)) close(); });

  return {
    el: wrap,
    value,
    setValue,
    setOptions(list) { _options = Array.isArray(list) ? list.slice() : []; if (_open) render(); },
    focus() { input.focus(); },
  };
}
