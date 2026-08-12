// CHARACTER v2 — editing the portrait the parameters just made.
//
// The create column turns into this the moment a portrait exists: chips for the traits worth
// changing, a field for anything else, and Cancel / Edit on the floor.
//
// The FIELD is the single source of truth for what will be asked. Chips do not keep a parallel
// selection - their lit state is read back out of the text - so the two can never disagree, and
// typing over what a chip wrote is allowed rather than fought. One chip per group, because
// "age: 30; age: 40" is not a request.
//
// Free text survives chips: a segment without a colon is the user's own and is kept as it is,
// appended after the pairs. So "age: 40; longer nose" is a perfectly good instruction.
//
// The values are the schema's, not a list written out here. They are the same words the create
// column offers, which is what makes the result predictable.

import { PARAM_SCHEMA } from './schema.js';

// The eight the user asked for, in that order.
const GROUP_KEYS = ['age', 'skin', 'hairColor', 'hairLength', 'eyeColor', 'facialHair', 'scars', 'freckles'];

function groups() {
  const byKey = {};
  PARAM_SCHEMA.forEach(g => g.params.forEach(p => { byKey[p.k] = p; }));
  return GROUP_KEYS.map(k => byKey[k]).filter(Boolean)
    .map(p => ({ k: p.k, key: String(p.label || p.k).toLowerCase(), label: p.label,
                 opts: (p.opts || []).filter(o => o !== '') }));
}

// A field is a list of `; `-separated segments. One with a colon is a pair a chip owns; one
// without is the user's own words.
function parse(text) {
  const pairs = new Map(), free = [];
  for (const part of String(text || '').split(';')) {
    const s = part.trim();
    if (!s) continue;
    const m = s.match(/^([^:]+):\s*(.*)$/);
    if (m && m[2].trim()) pairs.set(m[1].trim().toLowerCase(), m[2].trim());
    else free.push(s);
  }
  return { pairs, free };
}

function compose(pairs, free) {
  const bits = [...pairs.entries()].map(([k, v]) => k + ': ' + v).concat(free);
  return bits.join('; ');
}

export function build(host, hooks) {
  const onCancel = (hooks || {}).onCancel || null;
  const onEdit = (hooks || {}).onEdit || null;
  host.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'cv2-edit';

  const note = document.createElement('div');
  note.className = 'cv2-edit-note';
  note.textContent = 'Change what the portrait looks like: tap a trait, or describe it yourself.';
  wrap.appendChild(note);

  const chipBox = document.createElement('div');
  chipBox.className = 'cv2-chips';
  wrap.appendChild(chipBox);

  const ta = document.createElement('textarea');
  ta.className = 'cv2-edit-txt';
  ta.id = 'cv2-edit-txt';
  ta.rows = 3;
  ta.placeholder = 'e.g. age: 40; hair color: red; longer nose, a scar across the brow';

  const foot = document.createElement('div');
  foot.className = 'cv2-edit-foot';
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.id = 'cv2-edit-cancel'; cancel.className = 'cv2-edit-btn';
  cancel.textContent = 'Cancel';
  cancel.title = 'Leave the portrait as it is and go back to the parameters';
  cancel.addEventListener('click', () => { if (onCancel) onCancel(); });
  const go = document.createElement('button');
  go.type = 'button'; go.id = 'cv2-edit-go'; go.className = 'cv2-edit-btn is-go';
  go.textContent = 'Edit';
  go.title = 'Apply these changes to the portrait';
  go.addEventListener('click', () => {
    const t = ta.value.trim();
    if (t && onEdit) onEdit(t);
  });

  const G = groups();

  const paint = () => {
    const { pairs } = parse(ta.value);
    chipBox.textContent = '';
    for (const g of G) {
      const row = document.createElement('div');
      row.className = 'cv2-chip-row';
      const lab = document.createElement('span');
      lab.className = 'cv2-chip-lab';
      lab.textContent = g.label;
      row.appendChild(lab);
      for (const o of g.opts) {
        const b = document.createElement('button');
        b.type = 'button';
        const on = pairs.get(g.key) === o;
        b.className = 'cv2-chip' + (on ? ' is-on' : '');
        b.textContent = o;
        b.addEventListener('click', () => {
          const cur = parse(ta.value);
          // Tapping the lit one clears it; tapping another replaces it. One per group.
          if (cur.pairs.get(g.key) === o) cur.pairs.delete(g.key);
          else cur.pairs.set(g.key, o);
          ta.value = compose(cur.pairs, cur.free);
          paint();
          sync();
        });
        row.appendChild(b);
      }
      chipBox.appendChild(row);
    }
  };

  const sync = () => { go.disabled = !ta.value.trim(); };
  // Typing is allowed to disagree with a chip: the field wins, and the chips re-read themselves.
  ta.addEventListener('input', () => { paint(); sync(); });

  wrap.appendChild(ta);
  foot.appendChild(cancel); foot.appendChild(go);
  wrap.appendChild(foot);
  host.appendChild(wrap);
  paint();
  sync();

  return {
    clear: () => { ta.value = ''; paint(); sync(); },
    value: () => ta.value.trim(),
    // Re-assert the button from the field, after a job's control lock has restored what it
    // disabled and would otherwise hand Edit back over an empty field.
    sync,
  };
}
