// LIBRARY — the scenarios shelf.
//
// The second shelf that is not pictures, and it draws rows for the same reason the voices shelf
// does: a scenario is a title, a few fields and a line count. A card here would be a grey tile
// with a name under it, which is a thumbnail that admits it has no thumbnail.
//
// A row OPENS IN PLACE. Clicking it drops a panel underneath holding every line of the scenario
// in one textarea, one line per line, with Save under it. Editing a script is reading it top to
// bottom and fixing what reads wrong, and one field you can select across does that; the
// Scenarios page's row-per-line editor is for working line by line, which is a different job.
//
// Lines are `{text}` records - the roles live on the scenario, not on its lines - so splitting a
// textarea on newlines maps onto the store exactly, with nothing to preserve per line. That is
// what makes this safe to offer here at all.
//
// One panel open at a time: two open textareas of a ten-line script is more scrolling than the
// whole shelf is worth.

const _fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// The tail under a title: what tells two scenarios for the same product apart, in the order you
// would say it. Empty fields are dropped rather than shown as blanks.
function _tail(m) {
  const n = m.lines || 0;
  return [
    n + (n === 1 ? ' line' : ' lines'),
    m.type,
    m.vertical,
    m.product,
    m.roles,
  ].filter(Boolean).join(' · ');
}

let _open = '';          // the id whose panel is showing
let _hooks = {};

function _status(panel, text, kind) {
  const el = panel.querySelector('.lib-sedit-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'lib-sedit-status' + (kind ? ' ' + kind : '');
}

async function _fill(panel, it) {
  const ta = panel.querySelector('.lib-sedit-ta');
  _status(panel, 'loading…');
  try {
    const d = await fetch('/api/scen3/scenarios/' + encodeURIComponent(it.id)).then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'could not read it');
    const lines = (d.scenario && d.scenario.lines) || [];
    ta.value = lines.map(l => (l && l.text) || '').join('\n');
    ta.dataset.was = ta.value;          // what was loaded, to tell an edit from a no-op
    panel.dataset.title = (d.scenario && d.scenario.title) || it.name;
    _status(panel, '');
    // Grow to the content so a ten-line script needs no inner scrolling, up to a ceiling.
    ta.style.height = Math.min(460, Math.max(120, ta.scrollHeight + 4)) + 'px';
  } catch (e) {
    ta.value = '';
    _status(panel, e.message, 'err');
  }
}

async function _save(panel, it, btn) {
  const ta = panel.querySelector('.lib-sedit-ta');
  // Blank lines are separators people leave while editing, not lines of script: they are dropped
  // rather than saved as empty ones, which is also what stops a stray trailing newline from
  // adding a line every time you press Save.
  const lines = ta.value.split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text }));
  if (!lines.length) { _status(panel, 'nothing to save - every line is empty', 'err'); return; }

  btn.disabled = true;
  _status(panel, 'saving…');
  try {
    const d = await fetch('/api/scen3/scenarios', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: it.id, title: panel.dataset.title || it.name, lines }),
    }).then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    ta.dataset.was = ta.value;
    _status(panel, 'Saved · ' + lines.length + (lines.length === 1 ? ' line' : ' lines'), 'ok');
    // The row's tail carries the line count, so it is now out of date. Reloading the shelf is the
    // honest fix: the count comes from the store, not from what was just typed.
    if (_hooks.reload) _hooks.reload();
  } catch (e) {
    _status(panel, 'Not saved: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

function _panel(it) {
  const panel = document.createElement('div');
  panel.className = 'lib-sedit';

  const ta = document.createElement('textarea');
  ta.className = 'lib-sedit-ta';
  ta.spellcheck = false;
  ta.placeholder = 'One line of the script per line.';
  panel.appendChild(ta);

  const foot = document.createElement('div');
  foot.className = 'lib-sedit-foot';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'lib-btn';
  save.textContent = 'Save';
  save.addEventListener('click', () => _save(panel, it, save));

  const st = document.createElement('span');
  st.className = 'lib-sedit-status';

  foot.append(save, st);
  panel.appendChild(foot);

  // Ctrl/Cmd+Enter saves. A ten-line script is a lot of typing to then go hunting for a button.
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save.click(); }
  });
  return panel;
}

export function render(items, hooks = {}) {
  _hooks = hooks || {};
  const grid = document.getElementById('lib-grid');
  if (!grid) return;
  grid.textContent = '';
  grid.className = 'lib-rows is-scenarios';

  if (!items.length) {
    const e = document.createElement('div');
    e.className = 'lib-empty';
    e.textContent = 'No scenarios yet.';
    grid.appendChild(e);
    return;
  }

  for (const it of items) {
    const wrap = document.createElement('div');
    wrap.className = 'lib-swrap';

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'lib-srow';
    row.setAttribute('aria-expanded', 'false');

    const main = document.createElement('div');
    main.className = 'lib-srow-main';

    const t = document.createElement('div');
    t.className = 'lib-srow-t';
    t.textContent = it.name;

    const s = document.createElement('div');
    s.className = 'lib-srow-s';
    s.textContent = _tail(it.meta || {});

    main.append(t, s);

    const d = document.createElement('div');
    d.className = 'lib-srow-d';
    d.textContent = _fmtDate((it.meta || {}).date);

    const arrow = document.createElement('span');
    arrow.className = 'lib-srow-arrow';
    arrow.textContent = '▾';

    row.append(main, d, arrow);
    wrap.appendChild(row);

    row.addEventListener('click', () => {
      const already = wrap.querySelector('.lib-sedit');
      if (already) {                       // second click closes
        already.remove();
        row.setAttribute('aria-expanded', 'false');
        _open = '';
        return;
      }
      // Close whichever other one is open first.
      grid.querySelectorAll('.lib-sedit').forEach(p => p.remove());
      grid.querySelectorAll('.lib-srow').forEach(r => r.setAttribute('aria-expanded', 'false'));
      const panel = _panel(it);
      wrap.appendChild(panel);
      row.setAttribute('aria-expanded', 'true');
      _open = String(it.id);
      _fill(panel, it);
    });

    grid.appendChild(wrap);
    // Survive a reload of the shelf: the panel that was open reopens, because Save reloads and
    // a Save that closed the thing you were editing would be its own kind of rude.
    if (_open && String(it.id) === _open) {
      const panel = _panel(it);
      wrap.appendChild(panel);
      row.setAttribute('aria-expanded', 'true');
      _fill(panel, it);
    }
  }
}

// Leaving the shelf forgets which panel was open: coming back to a shelf with an editor already
// hanging open is a surprise, and there is nothing unsaved to protect - Save is explicit.
export function leave() { _open = ''; }
