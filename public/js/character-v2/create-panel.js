// CHARACTER v2 — the Create column's `main` panel.
//
// Top to bottom: a sticky action row (name, rnd, Create), a body that shows EITHER the
// eighteen parameter dropdowns or a chosen preset, and a sticky foot holding TPDNE and the
// preset dropdown, which sits on the column's bottom edge.
//
// There is no simple/advanced switch. What used to be "advanced" — every group, two columns —
// is now simply how the parameters look; the old simple mode showed four of eighteen and hid
// the rest behind a toggle nobody needed once presets existed.
//
// One state, two views. The dropdowns and the prompt's clickable tokens read and write the
// same values object, so changing either moves the other. A second source of truth here would
// have drifted within a day.
//
// Choosing a preset fills those values, names the character, and swaps the body for the
// preset's example image above its prompt. The parameters stay collapsed and cannot be opened
// while a preset is active — clearing the preset is the way back to building by hand.

import { PARAM_SCHEMA, MARKS_KEYS, NONE_DEFAULT, RND_ORDER, allowedOpts, paramByKey, allParamKeys, genName } from './schema.js';
import { PRESETS, presetById, exampleUrl, promptSegments, presetLabel } from './presets.js';

const SEL_ID = (k) => 'cv2-p-' + k;
const LS_PRESET = 'cv2_preset_v1';

let _onGenerate = null;
let _onTpdne = null;
let _preset = '';        // the chosen preset's id, or ''
let _edited = false;     // a token was changed, so the values no longer match the preset

export function currentValues() {
  const v = {};
  for (const k of allParamKeys()) {
    const el = document.getElementById(SEL_ID(k));
    v[k] = el ? el.value : '';
  }
  return v;
}

// ── The dropdowns ───────────────────────────────────────────────────────────
// Re-offer every value against the current picks. A selection a later change invalidates is
// cleared rather than left showing something impossible, and a parameter with nothing left to
// say (hair colour on a bald head) is disabled instead of silently blank.
function refreshOptions() {
  const picked = currentValues();
  for (const k of allParamKeys()) {
    const el = document.getElementById(SEL_ID(k));
    const p = paramByKey(k);
    if (!el || !p) continue;
    const allowed = allowedOpts(p, picked);
    // When the current pick is no longer allowed, take the only remaining value rather than
    // blanking the slot: switching to female leaves exactly "none" for facial hair, and an
    // empty slot there says less than the answer does.
    const real = allowed.filter(Boolean);
    const keep = allowed.includes(el.value) ? el.value : (real.length === 1 ? real[0] : '');
    el.textContent = '';
    const blank = document.createElement('option');
    blank.value = ''; blank.textContent = '—';
    el.appendChild(blank);
    for (const o of allowed) {
      if (!o) continue;
      const opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      el.appendChild(opt);
    }
    el.value = keep;
    const empty = allowed.filter(Boolean).length === 0;
    el.disabled = empty;
    const row = el.closest('.cv2-row');
    if (row) row.classList.toggle('is-na', empty);
  }
  renderPrompt();
}

function row(p) {
  const r = document.createElement('div');
  r.className = 'cv2-row';
  const lab = document.createElement('label');
  lab.className = 'cv2-row-lab';
  lab.textContent = p.label;
  lab.htmlFor = SEL_ID(p.k);
  const sel = document.createElement('select');
  sel.className = 'cv2-row-sel';
  sel.id = SEL_ID(p.k);
  sel.addEventListener('change', () => { _markEdited(); refreshOptions(); });
  r.appendChild(lab); r.appendChild(sel);
  return r;
}

function setValues(values) {
  for (const k of allParamKeys()) {
    const el = document.getElementById(SEL_ID(k));
    if (!el) continue;
    const want = values[k] || '';
    // The option may not exist yet on this pass; refreshOptions rebuilds and re-applies.
    if (![...el.options].some(o => o.value === want)) {
      const opt = document.createElement('option');
      opt.value = want; opt.textContent = want || '—';
      el.appendChild(opt);
    }
    el.value = want;
  }
  refreshOptions();
}

// ── The randomiser ──────────────────────────────────────────────────────────
// Picks in RND_ORDER so each choice can react to the ones before it. Marks are left alone: a
// scar or a tattoo is a decision, not something to hand out at random.
function randomize() {
  const keys = allParamKeys().filter(k => !MARKS_KEYS.includes(k));
  const picked = currentValues();
  for (const k of RND_ORDER) {
    if (!keys.includes(k)) continue;
    const p = paramByKey(k);
    if (!p) continue;
    const opts = allowedOpts(p, picked).filter(Boolean);
    if (!opts.length) continue;
    picked[k] = opts[Math.floor(Math.random() * opts.length)];
  }
  clearPreset();          // rolling dice is building by hand, so it leaves the preset behind
  setValues(picked);
  const nm = document.getElementById('cv2-name');
  if (nm) nm.value = genName();
}

// ── Presets ─────────────────────────────────────────────────────────────────
function applyPreset(id) {
  const p = presetById(id);
  if (!p) return clearPreset();
  _preset = p.id;
  _edited = false;
  try { localStorage.setItem(LS_PRESET, _preset); } catch (e) {}
  setValues(p.v);
  const nm = document.getElementById('cv2-name');
  if (nm) nm.value = genName();          // a preset is a look, not a person: it gets a new name
  paintPresetState();
}

function clearPreset() {
  _preset = '';
  _edited = false;
  try { localStorage.setItem(LS_PRESET, ''); } catch (e) {}
  const sel = document.getElementById('cv2-preset');
  if (sel) sel.value = '';
  paintPresetState();
}

// Which of the two bodies shows, and what the preset row says about it.
function paintPresetState() {
  const panel = document.getElementById('cv2-create-main');
  if (panel) panel.classList.toggle('has-preset', !!_preset);
  const img = document.getElementById('cv2-preset-img');
  const p = presetById(_preset);
  if (img) {
    if (p) { img.src = exampleUrl(p.id); img.alt = p.name + ' example'; }
    else { img.removeAttribute('src'); img.alt = ''; }
  }
  const ed = document.getElementById('cv2-edited');
  if (ed) ed.hidden = !(p && _edited);
  const sel = document.getElementById('cv2-preset');
  if (sel && sel.value !== _preset) sel.value = _preset;
}

// A token changed, so the values have left the preset behind. The example still shows - it is
// what the preset looks like - but a marker beside the prompt label says it no longer matches.
function _markEdited() {
  if (_preset && !_edited) { _edited = true; paintPresetState(); }
}

// ── The prompt, with every value clickable ──────────────────────────────────
function renderPrompt() {
  const box = document.getElementById('cv2-prompt');
  if (!box) return;
  const values = currentValues();
  box.textContent = '';
  for (const seg of promptSegments(values)) {
    if (!seg.k) {
      box.appendChild(document.createTextNode(seg.text));
      continue;
    }
    const p = paramByKey(seg.k);
    const tok = document.createElement('button');
    tok.type = 'button';
    tok.className = 'cv2-tok' + (!seg.value || seg.value === 'none' ? ' is-off' : '');
    tok.dataset.k = seg.k;
    tok.title = (p ? p.label : seg.k) + ' — click to change';
    tok.textContent = '[' + (seg.value || '—') + ']';
    tok.addEventListener('click', (e) => { e.stopPropagation(); openTokenPicker(tok, seg.k); });
    box.appendChild(tok);
  }
}

let _pop = null;
function closeTokenPicker() { if (_pop) { _pop.remove(); _pop = null; } }
document.addEventListener('click', closeTokenPicker);

// Two rows, as asked: what the dependencies allow, then everything else. The split is the
// point — the second row is reachable, but you can see you are stepping outside what the
// other choices imply, which is exactly the information a flat list hides.
function openTokenPicker(anchor, k) {
  closeTokenPicker();
  const p = paramByKey(k);
  if (!p) return;
  const values = currentValues();
  const allowed = allowedOpts(p, values).filter(Boolean);
  const rest = p.opts.filter(o => !allowed.includes(o));

  const pop = document.createElement('div');
  pop.className = 'cv2-pop';
  pop.addEventListener('click', (e) => e.stopPropagation());

  const title = document.createElement('div');
  title.className = 'cv2-pop-t';
  title.textContent = p.label;
  pop.appendChild(title);

  const addRow = (label, list, cls) => {
    if (!list.length) return;
    const r = document.createElement('div');
    r.className = 'cv2-pop-row ' + cls;
    if (label) { const l = document.createElement('span'); l.className = 'cv2-pop-lbl'; l.textContent = label; r.appendChild(l); }
    for (const o of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cv2-pop-opt' + (values[k] === o ? ' cur' : '');
      b.textContent = o;
      b.addEventListener('click', () => {
        const el = document.getElementById(SEL_ID(k));
        if (el) {
          if (![...el.options].some(x => x.value === o)) {
            const opt = document.createElement('option'); opt.value = o; opt.textContent = o; el.appendChild(opt);
          }
          el.value = o;
        }
        _markEdited();
        refreshOptions();
        closeTokenPicker();
      });
      r.appendChild(b);
    }
    pop.appendChild(r);
  };
  addRow('fits', allowed, 'is-fits');
  addRow('other', rest, 'is-other');

  document.body.appendChild(pop);
  // Above the token, and nudged back on screen rather than hanging off an edge.
  const a = anchor.getBoundingClientRect();
  const r = pop.getBoundingClientRect();
  let top = a.top - r.height - 6;
  if (top < 6) top = a.bottom + 6;                       // no room above, so below
  let left = a.left + a.width / 2 - r.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - r.width - 6));
  pop.style.top = Math.round(top) + 'px';
  pop.style.left = Math.round(left) + 'px';
  _pop = pop;
}

// ── Build ───────────────────────────────────────────────────────────────────
export function build(host, hooks) {
  _onGenerate = (hooks || {}).onGenerate || null;
  _onTpdne = (hooks || {}).onTpdne || null;

  host.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'cv2-create-main';
  panel.id = 'cv2-create-main';

  // Sticky action row.
  const head = document.createElement('div');
  head.className = 'cv2-crhead';
  const name = document.createElement('input');
  name.type = 'text'; name.id = 'cv2-name'; name.className = 'cv2-name'; name.placeholder = 'Name (auto)';
  const rnd = document.createElement('button');
  rnd.type = 'button'; rnd.id = 'cv2-rnd'; rnd.className = 'cv2-rnd'; rnd.textContent = 'rnd';
  rnd.title = 'Randomise every parameter except marks, and the name';
  rnd.addEventListener('click', randomize);
  const gen = document.createElement('button');
  gen.type = 'button'; gen.id = 'cv2-gen'; gen.className = 'cv2-gen'; gen.textContent = '▶ Create';
  gen.title = 'Generate the character from the values below';
  gen.addEventListener('click', () => { if (_onGenerate) _onGenerate(currentValues(), name.value.trim(), _preset); });
  head.appendChild(name); head.appendChild(rnd); head.appendChild(gen);
  panel.appendChild(head);

  // The preset row sits directly under the action row, ABOVE the example it selects, and is
  // visible in both states - it is how you enter preset mode and how you leave it.
  const prow = document.createElement('div');
  prow.className = 'cv2-presetrow';
  const psel = document.createElement('select');
  psel.className = 'cv2-preset'; psel.id = 'cv2-preset';
  psel.title = 'A preset fills every parameter and names the character';
  const none = document.createElement('option');
  none.value = ''; none.textContent = '— no preset: build by hand —';
  psel.appendChild(none);
  for (const p of PRESETS) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = presetLabel(p);
    psel.appendChild(o);
  }
  psel.addEventListener('change', () => { psel.value ? applyPreset(psel.value) : clearPreset(); });
  prow.appendChild(psel);
  panel.appendChild(prow);

  // Body A: the parameters. Every group, two columns. Hidden while a preset is active.
  const rows = document.createElement('div');
  rows.className = 'cv2-rows';
  rows.id = 'cv2-rows';
  for (const g of PARAM_SCHEMA) {
    const t = document.createElement('div');
    t.className = 'cv2-grp';
    t.textContent = g.group;
    rows.appendChild(t);
    for (const p of g.params) rows.appendChild(row(p));
  }
  panel.appendChild(rows);

  // Body B: the preset — its example above the prompt it stands for.
  const pv = document.createElement('div');
  pv.className = 'cv2-presetview';
  const fig = document.createElement('div');
  fig.className = 'cv2-preset-fig';
  const img = document.createElement('img');
  img.id = 'cv2-preset-img'; img.className = 'cv2-preset-img'; img.alt = '';
  // NOT lazy: this is the one image the panel exists to show, visible the moment a preset is
  // chosen. Lazy would also never fire in the automated browser pane, which does not
  // composite, so it would look broken in every check.
  img.decoding = 'async';
  fig.appendChild(img);
  pv.appendChild(fig);

  // The prompt is a field, not loose text: a label above it on the left, the how-to behind a
  // question mark rather than as a paragraph competing with the thing it describes, and a
  // marker for when the values have left the preset behind.
  const head2 = document.createElement('div');
  head2.className = 'cv2-fld-head';
  const lbl = document.createElement('span');
  lbl.className = 'cv2-fld-lbl';
  lbl.textContent = 'Prompt';
  const help = document.createElement('span');
  help.className = 'cv2-help';
  help.tabIndex = 0;
  help.textContent = '?';
  const tip = document.createElement('span');
  tip.className = 'cv2-tip';
  tip.textContent = 'Click any bracketed value to change it. Realism markers are added at generation and are not part of this text.';
  help.appendChild(tip);
  const edited = document.createElement('span');
  edited.className = 'cv2-edited'; edited.id = 'cv2-edited'; edited.hidden = true;
  edited.textContent = 'edited';
  head2.appendChild(lbl); head2.appendChild(help); head2.appendChild(edited);
  pv.appendChild(head2);

  const pr = document.createElement('div');
  pr.className = 'cv2-prompt'; pr.id = 'cv2-prompt';
  pv.appendChild(pr);
  panel.appendChild(pv);

  // Sticky foot: TPDNE alone now that the preset row lives above the example.
  const foot = document.createElement('div');
  foot.className = 'cv2-crfoot';
  const tprow = document.createElement('div');
  tprow.className = 'cv2-crfoot-row';
  const tp = document.createElement('button');
  tp.type = 'button'; tp.className = 'cv2-tpdne'; tp.textContent = 'TPDNE';
  tp.title = 'Take a random synthetic face from thispersondoesnotexist.com and refine it by text';
  tp.addEventListener('click', () => { if (_onTpdne) _onTpdne(); });
  const tpnote = document.createElement('div');
  tpnote.className = 'cv2-crfoot-note';
  tpnote.textContent = 'A face that belongs to no one, refined by words.';
  tprow.appendChild(tp); tprow.appendChild(tpnote);
  foot.appendChild(tprow);

  panel.appendChild(foot);

  host.appendChild(panel);

  // Options first: the selects are created empty, so a value assigned before they exist has
  // nothing to stick to and the next repopulate drops it.
  refreshOptions();
  for (const k of NONE_DEFAULT) {
    const el = document.getElementById(SEL_ID(k));
    if (el && [...el.options].some(o => o.value === 'none')) el.value = 'none';
  }
  refreshOptions();

  let want = '';
  try { want = localStorage.getItem(LS_PRESET) || ''; } catch (e) {}
  if (presetById(want)) applyPreset(want); else clearPreset();

  return { currentValues, randomize, refreshOptions, applyPreset, clearPreset };
}

// ── The Create column's `text` state ────────────────────────────────────────
// Where a TPDNE face is steered. No parameters describe it - it arrived from outside - so the
// only handle is a sentence about what to change.
//
// Applying an edit deliberately does NOT re-apply the realism markers. The base face already
// carries them; adding them again on every edit compounds the effect. The old page made the
// same call at character.js:540 with { skipRealism: true }, and it is worth carrying over.
//
// The placeholder is the old field's, verbatim: fifteen worked examples beat anything invented
// fresh, and they teach the format in one glance.
const REFINE_PLACEHOLDER = 'E.g.: add a smile \u00b7 green eyes \u00b7 shorter hair \u00b7 light freckles \u00b7 sharper jawline \u00b7 10 years older \u00b7 thicker eyebrows \u00b7 dimples \u00b7 narrower nose \u00b7 tanned skin \u00b7 curly hair \u00b7 light stubble \u00b7 higher cheekbones \u00b7 fuller lips \u00b7 smaller ears';

export function buildText(host, hooks) {
  const onApply = (hooks || {}).onApply || null;
  host.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'cv2-textpanel';

  const head = document.createElement('div');
  head.className = 'cv2-fld-head';
  const lbl = document.createElement('span');
  lbl.className = 'cv2-fld-lbl';
  lbl.textContent = 'Text changes';
  const help = document.createElement('span');
  help.className = 'cv2-help';
  help.tabIndex = 0;
  help.textContent = '?';
  const tip = document.createElement('span');
  tip.className = 'cv2-tip';
  tip.textContent = 'This face came from TPDNE, so no dropdown describes it. Describe the change instead. Realism is already in the base and is not applied again.';
  help.appendChild(tip);
  head.appendChild(lbl); head.appendChild(help);
  wrap.appendChild(head);

  const ta = document.createElement('textarea');
  ta.className = 'cv2-refine';
  ta.id = 'cv2-refine';
  ta.rows = 4;
  ta.placeholder = REFINE_PLACEHOLDER;
  wrap.appendChild(ta);

  // Apply is its own action, not a second Generate: it edits the face that is already there
  // rather than making a new one from parameters.
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'cv2-apply';
  apply.id = 'cv2-apply';
  apply.textContent = 'Apply';
  apply.disabled = true;
  apply.title = 'Apply the described change to the current face';
  apply.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) return;
    if (onApply) onApply(text);
  });
  // Nothing to apply until something is written, so the button says so rather than failing.
  ta.addEventListener('input', () => { apply.disabled = !ta.value.trim(); });
  wrap.appendChild(apply);

  const note = document.createElement('div');
  note.className = 'cv2-textpanel-note';
  note.textContent = 'Delete the image in the middle column to go back to building from parameters.';
  wrap.appendChild(note);

  host.appendChild(wrap);
  return { value: () => ta.value.trim(), clear: () => { ta.value = ''; apply.disabled = true; } };
}
