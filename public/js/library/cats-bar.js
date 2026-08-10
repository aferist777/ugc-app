// LIBRARY — the category row.
//
// Four gestures live on one pill, which is a lot, so they are separated deliberately:
//   click            filter by this category
//   double click     rename it
//   press and drag   reorder
//   hover, then x    delete it
//
// The click is what makes this fiddly: it has to wait ~200ms to find out whether a second
// click is coming, and it has to be cancelled outright once a drag starts. Everything below
// funnels through _armClick / _cancelClick so those two rules hold in one place.
//
// Every chip can be renamed and deleted except All and Uncategorized, which are the absence
// of something rather than categories. What those actions MEAN depends on who owns it. The
// Birols generator's own list is never written: its entries carry the generator's system
// prompt and their order is read by the Scenarios birols column. So for one of those,
// renaming forks (a Library category takes the new name and the clips move into it) and
// deleting resolves its clips and drops the chip out of sight. Either way the generator keeps
// its category, and generating into it again brings it straight back here.

import * as A from './actions.js';

const CLICK_DELAY = 200;      // long enough to catch a double click, short enough to not lag
const DRAG_SLOP = 4;          // px before a press becomes a drag rather than a click
const CONFIRM_MS = 4000;      // the delete confirmation's own patience

let _clickT = null;
function _cancelClick() { if (_clickT) { clearTimeout(_clickT); _clickT = null; } }
function _armClick(fn) { _cancelClick(); _clickT = setTimeout(() => { _clickT = null; fn(); }, CLICK_DELAY); }

// ── Delete confirmation ─────────────────────────────────────────────────────
// Holds for 4 seconds, but only while the pointer is away: on the panel means it is being
// read, so the countdown stops and restarts when the pointer leaves. Running out is a
// CANCEL — a timer must never be the thing that deletes files.
let _pop = null;
export function closeConfirm() {
  if (!_pop) return;
  clearTimeout(_pop.timer);
  _pop.el.remove();
  _pop = null;
}

function _confirmDelete(chip, cat, onDone) {
  closeConfirm();
  const el = document.createElement('div');
  el.className = 'lib-cat-pop';
  const n = cat.count || 0;
  const clips = n + (n === 1 ? ' clip' : ' clips');

  const head = document.createElement('div');
  head.className = 'lib-cat-pop-head';
  head.textContent = 'Delete "' + cat.name + '"?';
  el.appendChild(head);

  const label = document.createElement('label');
  label.className = 'lib-cat-pop-row';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = true;                       // the safe branch is the default
  const boxText = document.createElement('span');
  label.appendChild(box);
  label.appendChild(boxText);
  el.appendChild(label);

  const note = document.createElement('div');
  note.className = 'lib-cat-pop-note';
  el.appendChild(note);

  const row = document.createElement('div');
  row.className = 'lib-cat-pop-btns';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.className = 'lib-btn'; cancel.textContent = 'Cancel';
  const go = document.createElement('button');
  go.type = 'button'; go.className = 'lib-btn';
  row.appendChild(cancel); row.appendChild(go);
  el.appendChild(row);

  // The button says what it will do, in the words of the branch that is selected. An
  // unchecked box removes files from disk, so it must never read as a bland "OK".
  // A generator category is not removed, only dropped from this row — so say so, or deleting
  // one looks like it failed when it turns up again after the next generation.
  const comesBack = !cat.own && !cat.orphan
    ? ' The Birols generator keeps it; it returns here when you generate into it again.' : '';
  const paint = () => {
    boxText.textContent = n ? ('Move its ' + clips + ' to Uncategorized') : 'No clips to move';
    if (box.checked) {
      note.textContent = 'The clips stay on disk.' + comesBack;
      go.textContent = 'Delete category';
      go.classList.remove('danger');
    } else {
      note.textContent = (n ? ('Its ' + clips + ' will be deleted from disk. This cannot be undone.')
                            : 'The category is empty.') + comesBack;
      go.textContent = n ? ('Delete category and ' + clips) : 'Delete category';
      go.classList.add('danger');
    }
  };
  box.addEventListener('change', paint);
  paint();

  document.body.appendChild(el);
  const r = chip.getBoundingClientRect();
  const w = el.getBoundingClientRect();
  el.style.left = Math.max(6, Math.min(r.left, window.innerWidth - w.width - 6)) + 'px';
  el.style.top = Math.min(r.bottom + 4, window.innerHeight - w.height - 6) + 'px';

  const start = () => { clearTimeout(_pop.timer); _pop.timer = setTimeout(closeConfirm, CONFIRM_MS); };
  _pop = { el, timer: null };
  start();
  el.addEventListener('mouseenter', () => clearTimeout(_pop.timer));   // being read: wait
  el.addEventListener('mouseleave', start);
  el.addEventListener('click', (e) => e.stopPropagation());
  cancel.addEventListener('click', closeConfirm);
  go.addEventListener('click', async () => {
    const mode = box.checked ? 'move' : 'delete';
    go.disabled = true; cancel.disabled = true;
    clearTimeout(_pop.timer);
    try {
      const d = await A.deleteCat(cat.catKind, cat.id, mode);
      closeConfirm();
      onDone(null, d);
    } catch (err) {
      closeConfirm();
      onDone(err);
    }
  });
}

// ── The row ─────────────────────────────────────────────────────────────────
// ctx = { kind, cur, status(msg, kind), reload(), refreshCats() }
//   kind  the open kind filter, '' on All
//   cur   the selected category id
export function renderCatBar(box, cats, ctx) {
  box.textContent = '';
  closeConfirm();

  // A new category has to join ONE kind's list, and on the All filter the row is a union of
  // all three — so there is no answer to "which list". Disabled rather than guessing.
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'lib-cat-add';
  add.textContent = '+';
  add.disabled = !ctx.kind;
  add.title = ctx.kind ? 'New category' : 'Pick Birols, Uploads or Hooks first — a category belongs to one of them';
  add.addEventListener('click', async () => {
    const name = prompt('New category');
    if (name == null || !String(name).trim()) return;
    try {
      const d = await A.addCat(ctx.kind, String(name).trim());
      await ctx.refreshCats();
      await ctx.reload();
      ctx.status(d.created ? ('Added "' + d.cat.label + '"') : ('"' + d.cat.label + '" already exists'));
    } catch (e) { ctx.status(e.message, 'err'); }
  });
  box.appendChild(add);

  const chip = (id, text, cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-filter' + (cls ? ' ' + cls : '') + (id === ctx.cur ? ' cur' : '');
    b.textContent = text;
    return b;
  };

  // All, then Uncategorized. Both are the absence of something rather than a category, so
  // neither drags, renames nor deletes.
  const all = chip('', 'All');
  all.addEventListener('click', () => { if (ctx.cur !== '') ctx.onFilter(''); });
  box.appendChild(all);

  for (const cat of cats) {
    const b = chip(cat.id, cat.label, cat.pinned ? 'pinned' : '');
    b.dataset.id = cat.id;
    if (cat.pinned) {
      b.title = 'Clips with no category';
      b.addEventListener('click', () => { if (ctx.cur !== cat.id) ctx.onFilter(cat.id); });
      box.appendChild(b);
      continue;
    }

    b.dataset.kind = cat.catKind || '';
    b.classList.add('drag');
    b.title = cat.own ? 'Double click to rename, drag to reorder'
      : (cat.orphan ? 'A category only its clips remember. Double click to make it a library category'
                    : 'From the Birols generator. Renaming or deleting it here changes only the library');
    if (!cat.own) b.classList.add('foreign');

    // Every chip but the synthetic ones. For a generator category this hides rather than
    // removes — the confirmation says which.
    {
      const x = document.createElement('span');
      x.className = 'lib-cat-x';
      x.textContent = '✕';
      x.title = 'Delete this category';
      // mousedown too, or the press would start a drag before the click ever lands
      x.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        _cancelClick();
        _confirmDelete(b, cat, (err, d) => {
          if (err) return ctx.status(err.message, 'err');
          const msg = d.mode === 'delete'
            ? ('Deleted the category and ' + d.affected + (d.affected === 1 ? ' clip' : ' clips'))
            : ('Deleted the category' + (d.affected ? ('; ' + d.affected + ' moved to Uncategorized') : ''));
          const tail = d.disposition === 'hidden' ? ' It returns when you generate into it again.' : '';
          ctx.refreshCats().then(() => ctx.reload()).then(() => ctx.status(msg + tail));
        });
      });
      b.appendChild(x);
    }

    b.addEventListener('click', () => {
      if (b.dataset.dragged === '1') { b.dataset.dragged = ''; return; }   // that was a drag
      _armClick(() => { if (ctx.cur !== cat.id) ctx.onFilter(cat.id); });
    });

    b.addEventListener('dblclick', async () => {
      _cancelClick();                       // the single click must not also fire
      const next = prompt(cat.own ? 'Rename category' : 'Name for a library copy of this category', cat.name);
      if (next == null) return;
      const name = String(next).trim();
      if (!name || name === cat.name) return;
      try {
        const d = await A.renameCat(cat.catKind, cat.id, name);
        await ctx.refreshCats();
        await ctx.reload();
        ctx.status(d.forked
          ? ('Renamed into the library as "' + d.cat.label + '"'
             + (d.moved ? ('; ' + d.moved + (d.moved === 1 ? ' clip' : ' clips') + ' moved') : '')
             + '. The generator keeps its own, and it returns here when you generate into it.')
          : ('Renamed to "' + d.cat.label + '"'));
      } catch (e) { ctx.status(e.message, 'err'); }
    });

    _wireDrag(b, box, ctx);
    box.appendChild(b);
  }
}

// ── Reorder by dragging ─────────────────────────────────────────────────────
// Plain mouse events over the row: past the slop the chip is picked up, and passing over
// another chip swaps them in the DOM. On release the DOM order IS the new order.
//
// On the All filter the row mixes all three lists, so the order is saved per kind, keeping
// each kind's relative sequence. Nothing here writes the Birols tab's own list.
function _wireDrag(b, box, ctx) {
  b.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;

    const move = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - x0) < DRAG_SLOP && Math.abs(ev.clientY - y0) < DRAG_SLOP) return;
        dragging = true;
        _cancelClick();
        closeConfirm();
        b.classList.add('dragging');
        box.classList.add('reordering');
      }
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = over && over.closest ? over.closest('.lib-filter.drag') : null;
      if (!target || target === b || target.parentElement !== box) return;
      const r = target.getBoundingClientRect();
      const after = ev.clientX > r.left + r.width / 2;
      box.insertBefore(b, after ? target.nextSibling : target);
    };

    const up = async () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (!dragging) return;
      b.classList.remove('dragging');
      box.classList.remove('reordering');
      b.dataset.dragged = '1';              // swallow the click this release produces

      const byKind = {};
      for (const el of box.querySelectorAll('.lib-filter.drag')) {
        const k = el.dataset.kind;
        if (!k) continue;
        (byKind[k] = byKind[k] || []).push(el.dataset.id);
      }
      try {
        await Promise.all(Object.entries(byKind).map(([k, ids]) => A.setCatOrder(k, ids)));
        ctx.status('Order saved');
      } catch (e) { ctx.status(e.message, 'err'); }
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}
