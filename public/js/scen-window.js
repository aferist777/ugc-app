// THE SCENARIO WINDOW - one scenario read, or a new one written by hand (phase V28.2, the owner 2026-10-12:
// "blank будет открывать попап, как при создании сценария в merge"). ONE window for two pages: Merge's
// talking-head picker opens it on a row or on "+ scenario" (js/merge-v3/scen-pick.js), the Library's
// "New scenario -> blank" on a new one (js/library/main.js). Its frame and its buttons are css/dialog.css.
//
// Reading an existing scenario and writing a new one differ by what is in the fields, not by what the
// fields are. `save` keeps it in the library; `use` makes a project from it - saving first, because a
// project is made from what is STORED (routes/scen3.js takes a snapshot of the lines).
//
//   openScenario(summary, { saved, use, closeOnSave })
//     summary      a row of a list ({ id, archived }), or null for a new scenario
//     saved(rec)   after every save and restore - the list behind the window reads itself again
//     use(rec)     makes the project and opens it; a throw is said in the window, which stays
//     closeOnSave  the window goes after a save (the Library: the shelf shows it, selected)

import * as API from './merge-v3/scen-api.js';
import * as Layers from './layers.js';

const MIN_LINES = 3;          // routes/scen3.js refuses a NEW scenario below this

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export async function openScenario(summary, hooks = {}) {
  const isNew = !summary;
  const saved = hooks.saved || (() => {});
  let rec = { id: null, title: '', lines: [], vertical: '', product: '', roles: [] };
  const ov = _el('div', 'mv3-x-ov');
  const box = _el('div', 'mv3-x is-scen');
  ov.appendChild(box);

  const head = _el('div', 'mv3-x-head');
  const h3 = document.createElement('h3');
  h3.textContent = isNew ? 'New scenario' : 'Scenario';
  head.appendChild(h3);
  const close = _el('button', 'mv3-x-close', '✕');
  close.type = 'button';
  head.appendChild(close);
  box.appendChild(head);

  const body = _el('div', 'mv3-x-body');
  box.appendChild(body);

  const field = (label, node) => {
    const row = _el('div', 'mv3-x-row');
    const l = document.createElement('label');
    l.textContent = label;
    row.append(l, node);
    body.appendChild(row);
    return node;
  };
  const input = (placeholder, listId) => {
    const i = _el('input', 'mv3-sc-inp');
    i.type = 'text';
    if (placeholder) i.placeholder = placeholder;
    if (listId) i.setAttribute('list', listId);
    return i;
  };

  const title = field('Title', input('what this ad is called'));
  const vertical = field('Vertical', input('optional', 'mv3-sc-verticals'));
  const product = field('Product', input('optional', 'mv3-sc-products'));
  const role = field('Role', input('optional', 'mv3-sc-roles'));
  // The presenter's gender (phase V28.2: "Gender", no longer "Narrator" - in the Library a narrator is the
  // voice a script is WRITTEN in, a field of its own).
  const gender = field('Gender', (() => {
    const s = document.createElement('select');
    for (const [v, t] of [['', 'any - every character is offered'], ['female', 'female'], ['male', 'male']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      s.appendChild(o);
    }
    return s;
  })());
  // The suggestions are values used before, collected from saved scenarios - a hint, never
  // a list of allowed answers, which is why these are datalists and not selects.
  for (const id of ['mv3-sc-verticals', 'mv3-sc-products', 'mv3-sc-roles']) {
    if (!document.getElementById(id)) {
      const dl = document.createElement('datalist');
      dl.id = id;
      document.body.appendChild(dl);
    }
  }

  body.appendChild(_el('div', 'mv3-x-hdr', 'The lines'));
  const lines = _el('textarea', 'mv3-sc-lines');
  lines.spellcheck = false;
  lines.placeholder = 'One line per row. Each line becomes one fragment: it is spoken in one take and animated as one clip.';
  body.appendChild(lines);
  const count = _el('p', 'mv3-x-note');
  body.appendChild(count);
  body.appendChild(_el('p', 'mv3-x-note',
    'This is the scenario in the library. A project made from it keeps its own copy of the text, '
    + 'so editing here never changes a project that already exists.'));

  const foot = _el('div', 'mv3-x-foot');
  const note = _el('span', 'mv3-x-note');
  const save = _el('button', 'mv3-c-btn', 'save');
  save.type = 'button';
  save.title = 'Keep it in the library';
  // `use` worn like `save` and standing at the far right, away from it (phase I2, the owner
  // 2026-10-01). For a scenario in the archive the same place says `restore`: the row and its menu
  // offer nothing to build with until it is back, and neither does this window.
  let archived = !!(summary && summary.archived);
  const use = _el('button', 'mv3-c-btn mv3-x-use');
  use.type = 'button';
  const dressUse = () => {
    use.textContent = archived ? 'restore' : 'use';
    use.title = archived ? 'Put it back in the library' : 'Save it and make a talking-head project from it';
  };
  dressUse();
  foot.append(save, note, use);
  box.appendChild(foot);

  const linesOf = () => lines.value.split('\n').map(s => s.trim()).filter(Boolean);
  const gate = () => {
    const n = linesOf().length;
    const why = !title.value.trim() ? 'A title is needed.'
      : n < MIN_LINES ? `At least ${MIN_LINES} lines are needed - there ${n === 1 ? 'is' : 'are'} ${n}.`
        : '';
    count.textContent = why || `${n} lines - ${n} fragments.`;
    // An EDIT is never refused by the server, only a new scenario is: a half-typed title
    // must not be able to fail a save of something that already exists.
    save.disabled = !!why && isNew;
    use.disabled = !!why && !archived;           // a restore needs no valid text
    return why;
  };
  title.addEventListener('input', gate);
  lines.addEventListener('input', gate);

  const layer = Layers.open(ov, { name: 'scenario', onEsc: () => _close(ov, layer) });
  close.addEventListener('click', () => _close(ov, layer));
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _close(ov, layer); });
  document.body.appendChild(ov);

  // The suggestions and, for an existing scenario, its text: both are a request away, and
  // the window is already on screen while they arrive.
  API.options().then((o) => {
    const fill = (id, values) => {
      const dl = document.getElementById(id);
      if (!dl) return;
      dl.textContent = '';
      for (const v of (values || [])) {
        const opt = document.createElement('option');
        opt.value = v;
        dl.appendChild(opt);
      }
    };
    fill('mv3-sc-verticals', o.verticals);
    fill('mv3-sc-products', o.products);
    fill('mv3-sc-roles', o.roles);
  }).catch(() => { /* suggestions are a convenience */ });

  if (!isNew) {
    note.textContent = 'reading…';
    try {
      rec = await API.get(summary.id);
      title.value = rec.title || '';
      vertical.value = rec.vertical || '';
      product.value = rec.product || '';
      const r0 = (rec.roles || [])[0] || {};
      role.value = r0.name || '';
      gender.value = ['male', 'female'].includes(String(r0.gender || '')) ? r0.gender : '';
      lines.value = (rec.lines || []).map(l => l.text || '').join('\n');
      archived = !!rec.archived;
      dressUse();
      note.textContent = '';
    } catch (e) {
      note.textContent = 'Could not read it: ' + e.message;
    }
  }
  gate();
  title.focus();

  const collect = () => ({
    id: rec.id || undefined,
    title: title.value.trim(),
    // The scenario's own type, not a fixed one: it is a field now (phase F7), set in the Library.
    type: (rec && rec.type) || 'talking_head',
    vertical: vertical.value.trim(),
    product: product.value.trim(),
    // One role, the presenter: the store keeps a list, and nothing offers a second one.
    roles: (role.value.trim() || gender.value) ? [{ id: 'r0', name: role.value.trim(), gender: gender.value }] : [],
    lines: linesOf().map(text => ({ text })),
  });

  const store = async () => {
    note.textContent = 'saving…';
    rec = await API.save(collect());
    note.textContent = 'saved';
    saved(rec);                    // the list behind the window shows the new title
    return rec;
  };

  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await store();
      if (hooks.closeOnSave) { _close(ov, layer); return; }
    } catch (e) { note.textContent = e.message; }
    save.disabled = false;
  });
  use.addEventListener('click', async () => {
    if (archived) {
      use.disabled = true;
      note.textContent = 'restoring…';
      try {
        // By the list's id when the record could not be read (review I): rec.id is null then.
        await API.archive(rec.id || summary.id, false);
        archived = false;
        dressUse();
        note.textContent = 'back in the library';
        saved(rec);
      } catch (e) {
        note.textContent = e.message;
      }
      gate();
      return;
    }
    if (gate() || !hooks.use) return;
    use.disabled = true;
    try {
      await hooks.use(await store());
      // THE WINDOW GOES (phase Y1, the owner 2026-09-22): the project is open on its step, and this
      // modal must not stay on top of it - with the page's shortcuts switched off underneath, because
      // a modal layer holds them.
      _close(ov, layer);
    } catch (e) {
      note.textContent = e.message;
      use.disabled = false;
    }
  });
}

function _close(ov, layer) {
  Layers.close(layer);
  try { ov.remove(); } catch (e) { /* already gone */ }
}
