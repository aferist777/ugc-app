// CHARACTER v2 — the Create column's `main` panel.
//
// A sticky action row (name, rnd, Create), then the parameter rows, then TPDNE. The options
// and every dependency rule come from ./schema.js, lifted verbatim out of the old creator, so
// what a user picks here is what they picked there.
//
// Two things are deliberately different from the old panel:
//
//   • rows are built once and shown or hidden by a class, not rebuilt per mode. The old
//     creator marked advanced-only rows with data-adv and let CSS hide them; the same idea,
//     minus the !important cascade it needed to override the legacy stylesheet.
//   • a value is only ever offered if allowedOpts permits it given the current picks, and a
//     pick that a later change invalidates is cleared rather than left showing something
//     impossible. The old panel applied those rules to the randomiser only, so choosing
//     "female" by hand still left "full beard" selectable underneath.

import { PARAM_SCHEMA, BASIC, MARKS_KEYS, NONE_DEFAULT, RND_ORDER, allowedOpts, paramByKey, allParamKeys, genName } from './schema.js';

const SEL_ID = (k) => 'cv2-p-' + k;

let _onGenerate = null;
let _onTpdne = null;

export function currentValues() {
  const v = {};
  for (const k of allParamKeys()) {
    const el = document.getElementById(SEL_ID(k));
    v[k] = el ? el.value : '';
  }
  return v;
}

// Re-offer every dropdown's values against the current picks. A parameter whose selected
// value is no longer allowed is reset to blank: showing "full beard" under "female" would be
// a promise the generator cannot keep.
function refreshOptions() {
  const picked = currentValues();
  for (const k of allParamKeys()) {
    const el = document.getElementById(SEL_ID(k));
    const p = paramByKey(k);
    if (!el || !p) continue;
    const allowed = allowedOpts(p, picked);
    const keep = allowed.includes(el.value) ? el.value : '';
    el.textContent = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '—';
    el.appendChild(blank);
    for (const o of allowed) {
      if (!o) continue;
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      el.appendChild(opt);
    }
    el.value = keep;
    // A parameter with nothing to offer (hair colour on a bald head) is not a choice.
    const empty = allowed.filter(Boolean).length === 0;
    el.disabled = empty;
    el.closest('.cv2-row')?.classList.toggle('is-na', empty);
  }
}

function row(p) {
  const r = document.createElement('div');
  r.className = 'cv2-row';
  if (!BASIC.includes(p.k)) r.dataset.adv = '1';      // hidden in simple mode
  const lab = document.createElement('label');
  lab.className = 'cv2-row-lab';
  lab.textContent = p.label;
  lab.htmlFor = SEL_ID(p.k);
  const sel = document.createElement('select');
  sel.className = 'cv2-row-sel';
  sel.id = SEL_ID(p.k);
  sel.addEventListener('change', () => { refreshOptions(); });
  r.appendChild(lab); r.appendChild(sel);
  return r;
}

// simple randomises the four basics; advanced randomises everything except the marks.
// Values are picked in RND_ORDER and each pick feeds the next, so the result is coherent.
function randomize(advanced) {
  const keys = advanced ? allParamKeys().filter(k => !MARKS_KEYS.includes(k)) : BASIC.slice();
  const picked = currentValues();
  for (const k of RND_ORDER) {
    if (!keys.includes(k)) continue;
    const p = paramByKey(k);
    const el = document.getElementById(SEL_ID(k));
    if (!p || !el) continue;
    const opts = allowedOpts(p, picked).filter(Boolean);
    if (!opts.length) continue;
    const val = opts[Math.floor(Math.random() * opts.length)];
    picked[k] = val;
  }
  for (const [k, v] of Object.entries(picked)) {
    const el = document.getElementById(SEL_ID(k));
    if (el && keys.includes(k)) el.value = v;
  }
  refreshOptions();
  const nm = document.getElementById('cv2-name');
  if (nm) nm.value = genName();
}

function setAdvanced(on) {
  const panel = document.getElementById('cv2-create-main');
  if (panel) panel.classList.toggle('is-adv', on);
  const sw = document.getElementById('cv2-adv');
  if (sw) sw.checked = on;
  const rnd = document.getElementById('cv2-rnd');
  if (rnd) rnd.title = on ? 'Randomise every parameter except marks, and the name' : 'Randomise the basics and the name';
  try { localStorage.setItem('cv2_advanced_v1', on ? '1' : '0'); } catch (e) {}
}

export function build(host, hooks) {
  _onGenerate = (hooks || {}).onGenerate || null;
  _onTpdne = (hooks || {}).onTpdne || null;

  host.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'cv2-create-main';
  panel.id = 'cv2-create-main';

  // Sticky row: the three things you reach for regardless of how far down the list you are.
  const head = document.createElement('div');
  head.className = 'cv2-crhead';
  const name = document.createElement('input');
  name.type = 'text'; name.id = 'cv2-name'; name.className = 'cv2-name';
  name.placeholder = 'Name (auto)';
  const rnd = document.createElement('button');
  rnd.type = 'button'; rnd.id = 'cv2-rnd'; rnd.className = 'cv2-rnd'; rnd.textContent = 'rnd';
  rnd.addEventListener('click', () => randomize(panel.classList.contains('is-adv')));
  const gen = document.createElement('button');
  gen.type = 'button'; gen.className = 'cv2-gen'; gen.textContent = '▶ Create';
  gen.title = 'Generate the character from the parameters below';
  gen.addEventListener('click', () => { if (_onGenerate) _onGenerate(currentValues(), name.value.trim()); });
  head.appendChild(name); head.appendChild(rnd); head.appendChild(gen);
  panel.appendChild(head);

  // The simple / advanced switch, on its own row so the sticky one stays three items wide.
  const modeRow = document.createElement('label');
  modeRow.className = 'cv2-advrow';
  const sw = document.createElement('input');
  sw.type = 'checkbox'; sw.id = 'cv2-adv';
  sw.addEventListener('change', () => setAdvanced(sw.checked));
  const swTxt = document.createElement('span');
  swTxt.textContent = 'Advanced';
  modeRow.appendChild(sw); modeRow.appendChild(swTxt);
  panel.appendChild(modeRow);

  // Every row in one scroller: group titles are advanced-only, exactly as before.
  const rows = document.createElement('div');
  rows.className = 'cv2-rows';
  for (const g of PARAM_SCHEMA) {
    const t = document.createElement('div');
    t.className = 'cv2-grp';
    t.dataset.adv = '1';
    t.textContent = g.group;
    rows.appendChild(t);
    for (const p of g.params) rows.appendChild(row(p));
  }
  panel.appendChild(rows);

  // TPDNE last: it is the other way IN, not a variation on the parameters above, and picking
  // it takes the column somewhere else entirely.
  const foot = document.createElement('div');
  foot.className = 'cv2-crfoot';
  const tp = document.createElement('button');
  tp.type = 'button'; tp.className = 'cv2-tpdne'; tp.textContent = 'TPDNE';
  tp.title = 'Take a random synthetic face from thispersondoesnotexist.com and refine it by text';
  tp.addEventListener('click', () => { if (_onTpdne) _onTpdne(); });
  const note = document.createElement('div');
  note.className = 'cv2-crfoot-note';
  note.textContent = 'A face that belongs to no one. Refined by text rather than parameters.';
  foot.appendChild(tp); foot.appendChild(note);
  panel.appendChild(foot);

  host.appendChild(panel);

  // Options first: the selects are created empty, so a value assigned before they are
  // populated has nothing to stick to and is dropped by the next repopulate.
  refreshOptions();
  // Marks start at none, so a character is not born scarred.
  for (const k of NONE_DEFAULT) {
    const el = document.getElementById(SEL_ID(k));
    if (el && [...el.options].some(o => o.value === 'none')) el.value = 'none';
  }
  refreshOptions();          // settle the dependencies those defaults imply
  let adv = false;
  try { adv = localStorage.getItem('cv2_advanced_v1') === '1'; } catch (e) {}
  setAdvanced(adv);
  return { currentValues, randomize, refreshOptions };
}
