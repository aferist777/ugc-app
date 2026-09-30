// CHARACTER v2 — the Create column.
//
// Built in three pieces, because two of them must not move when the column flips between
// building by hand and steering a reference by words:
//
//   buildHead  the name, plus rnd and Create - always present, the latter two hidden by CSS
//              in ref mode since they act on dropdowns that are not showing
//   build      the `main` panel: EITHER the eighteen parameter dropdowns or a chosen preset
//   buildFoot  TPDNE, on the column's bottom edge in both states. Pressing it again swaps
//              the face, so it has to still be there once a face exists
//   buildRef   the `ref` panel: where a face from outside is steered by a sentence
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
import * as Layers from '../layers.js';

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
  // With a preset chosen, the dice belong to the presets: the parameters are collapsed and
  // cannot be opened while one is active, so rolling them would change something invisible
  // and drop the preset as a side effect. Rolling among the presets is the same gesture -
  // "show me another one" - against what is actually on screen.
  //
  // A DIFFERENT one, always. A shuffle that can land on what you are already looking at
  // reads as a button that sometimes does nothing.
  if (_preset) {
    const others = PRESETS.filter(p => p.id !== _preset);
    if (!others.length) return;
    return applyPreset(others[Math.floor(Math.random() * others.length)].id);
  }

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

export function clearPreset() {
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
  // On the body as well as the panel: the two buttons this hides live in the head, which is a
  // sibling of the panel rather than inside it, and the rest of this page already switches on
  // body attributes rather than reaching across the tree.
  document.body.dataset.preset = _preset ? '1' : '';
  const img = document.getElementById('cv2-preset-img');
  const p = presetById(_preset);
  if (img) {
    // Through the thumbnail door, like every picture on the page.
    if (p) {
      img.src = '/api/thumb?v=preset&src=' + encodeURIComponent(exampleUrl(p.id));
      img.alt = p.name + ' example';
    }
    else { img.removeAttribute('src'); img.alt = ''; }
  }
  const ed = document.getElementById('cv2-edited');
  if (ed) ed.hidden = !(p && _edited);
  const sel = document.getElementById('cv2-preset');
  if (sel && sel.value !== _preset) sel.value = _preset;
  const use = document.getElementById('cv2-preset-use');
  if (use) use.disabled = !p;
  // Nothing to clear when nothing is chosen, and the dropdown already reads "no preset" - so
  // the way out steps aside rather than sitting there greyed, saying there is one.
  const clr = document.getElementById('cv2-preset-clear');
  if (clr) clr.hidden = !p;
  // The same button, two jobs - so it has to say which one it is on right now.
  const rnd = document.getElementById('cv2-rnd');
  if (rnd) rnd.title = p
    ? 'Show a different preset'
    : 'Randomise every parameter except marks, and the name';
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

// On the Layers stack like every other little window (js/layers.js): Escape closes it and nothing under it.
let _pop = null;
let _popLayer = null;
function closeTokenPicker() {
  if (_pop) { _pop.remove(); _pop = null; }
  if (_popLayer) { Layers.close(_popLayer); _popLayer = null; }
}
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
  _popLayer = Layers.open(pop, { modal: false, name: 'value picker', onEsc: closeTokenPicker });
}

// ── Build ───────────────────────────────────────────────────────────────────
// ── The head: the name, and the two buttons that belong to building by hand ─
// Its own host outside both panels. The name is needed in either state - a model has to be
// called something whether it came from dropdowns or from TPDNE - while rnd and Create act on
// dropdowns, so CSS hides just those two in ref mode. Nothing moves.
export function buildHead(host, hooks) {
  _onGenerate = (hooks || {}).onGenerate || _onGenerate;
  host.textContent = '';

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
  host.appendChild(head);

  return { setName: (t) => { name.value = t || ''; }, name: () => name.value.trim() };
}

// ── The foot: TPDNE, on the bottom edge in both states ──────────────────────
export function buildFoot(host, hooks) {
  _onTpdne = (hooks || {}).onTpdne || _onTpdne;
  host.textContent = '';

  const foot = document.createElement('div');
  foot.className = 'cv2-crfoot';
  const tprow = document.createElement('div');
  tprow.className = 'cv2-crfoot-row';
  const tp = document.createElement('button');
  tp.type = 'button'; tp.className = 'cv2-tpdne'; tp.textContent = 'TPDNE';
  tp.title = 'Take a random synthetic face from thispersondoesnotexist.com - press again for another';
  tp.addEventListener('click', () => { if (_onTpdne) _onTpdne(); });
  const tpnote = document.createElement('div');
  tpnote.className = 'cv2-crfoot-note';
  tpnote.textContent = 'A face that belongs to no one, refined by words.';
  tprow.appendChild(tp); tprow.appendChild(tpnote);
  foot.appendChild(tprow);
  host.appendChild(foot);
}

export function build(host, hooks) {
  _onGenerate = (hooks || {}).onGenerate || _onGenerate;

  host.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'cv2-create-main';
  panel.id = 'cv2-create-main';

  // The preset row sits at the top of the panel, ABOVE the example it selects, and is
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

  // USE takes the example itself rather than the parameters behind it. A preset is two things
  // at once - a set of values you can generate from, and a face already made - and until now
  // only the first was reachable: choosing one filled the dropdowns and you paid for a
  // generation to see a face very like the one already on screen.
  //
  // Beside the picker rather than under the example, because it acts on what the picker
  // chose. Disabled with no preset, since there would be nothing to take.
  const puse = document.createElement('button');
  puse.type = 'button';
  puse.className = 'cv2-preset-use';
  puse.id = 'cv2-preset-use';
  puse.textContent = 'use';
  puse.title = 'Put this preset\u2019s face in the middle column and start editing it - no generation';
  puse.addEventListener('click', () => {
    const p2 = presetById(_preset);
    if (p2 && hooks && typeof hooks.onUse === 'function') hooks.onUse(p2);
  });
  prow.appendChild(puse);

  // Back to building by hand. The dropdown can already do this - its first option is "no
  // preset" - but that is a menu you have to open and read to find the way out of, and the
  // way out of one choice deserves to be one press beside it.
  const pclr = document.createElement('button');
  pclr.type = 'button';
  pclr.className = 'cv2-preset-clear';
  pclr.id = 'cv2-preset-clear';
  pclr.textContent = '✕';
  pclr.title = 'Clear the preset and go back to the parameters';
  pclr.addEventListener('click', () => clearPreset());
  prow.appendChild(pclr);

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
// Where a face from outside is steered: a TPDNE face, or one the user dropped into the middle
// column. No parameters describe either, so the only handle is a sentence about what to change.
//
// Applying an edit deliberately does NOT re-apply the realism markers. The base face already
// carries them; adding them again on every edit compounds the effect. The old page made the
// same call with { skipRealism: true }, and it was worth carrying over.
//
// The examples are appearance only - no clothing among them, because the analyzer is forbidden
// to change clothing and a placeholder should not advertise what will be refused. They run from
// the everyday to the outright synthetic, so the field shows how far it can be pushed.
const REFINE_PLACEHOLDER = 'E.g.: bald \u00b7 shaved head \u00b7 silver hair \u00b7 green eyes \u00b7 heterochromia \u00b7 freckles \u00b7 sharper jawline \u00b7 full beard \u00b7 scar across the cheek \u00b7 vitiligo patches \u00b7 heavier build \u00b7 very slim \u00b7 broader shoulders \u00b7 bone leg \u00b7 mechanical arm \u00b7 cybernetic eye';

export function buildRef(host, hooks) {
  const onApply = (hooks || {}).onApply || null;
  const onExit = (hooks || {}).onExit || null;
  host.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'cv2-textpanel';

  // The way out, as a 5px strip across the top - the arrow points back up at the parameters it
  // returns you to. Its own control rather than only the image's cross, because leaving this
  // mode is a decision about the column. It discards the face: another one costs nothing.
  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'cv2-refout';
  out.id = 'cv2-refout';
  out.title = 'Back to the parameters - discards this face';
  out.appendChild(document.createElement('i'));
  out.addEventListener('click', () => { if (onExit) onExit(); });
  wrap.appendChild(out);

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
  tip.textContent = 'This face came from outside, so no dropdown describes it - describe the change instead. Appearance only: hair, skin, eyes, face and build. Clothing, background and pose stay as they are.';
  help.appendChild(tip);
  head.appendChild(lbl); head.appendChild(help);
  wrap.appendChild(head);

  const ta = document.createElement('textarea');
  ta.className = 'cv2-refine';
  ta.id = 'cv2-refine';
  ta.rows = 4;
  ta.placeholder = REFINE_PLACEHOLDER;
  wrap.appendChild(ta);

  // Its own action, not a second Create: it works from the face that is already there rather
  // than from parameters. What it means depends on where that face came from, so the button says
  // which - and a TPDNE head is worth generating from even with nothing typed, because turning
  // a bare crop into the house portrait is itself the job. An uploaded photo is already what the
  // user wanted, so there it stays disabled until they ask for something.
  let src = '';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'cv2-apply';
  apply.id = 'cv2-apply';
  const sync = () => {
    const typed = !!ta.value.trim();
    const tpdne = src === 'tpdne';
    apply.disabled = tpdne ? false : !typed;
    apply.textContent = tpdne ? 'Generate' : 'Apply';
    apply.title = tpdne
      ? 'Build the studio portrait from this face, with whatever is described above'
      : 'Apply the described change and keep the rest of the image as it is';
  };
  apply.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text && src !== 'tpdne') return;
    if (onApply) onApply(text);
  });
  ta.addEventListener('input', sync);
  sync();
  wrap.appendChild(apply);

  const note = document.createElement('div');
  note.className = 'cv2-textpanel-note';
  note.textContent = 'TPDNE below swaps the face. The arrow above, or the cross on the image, goes back to the parameters.';
  wrap.appendChild(note);

  host.appendChild(wrap);
  return {
    value: () => ta.value.trim(),
    clear: () => { ta.value = ''; sync(); },
    // Which reference is in the middle, so the button can mean the right thing.
    setSource: (s) => { src = s || ''; sync(); },
    // Re-assert the button from the field. A job's control lock restores what it disabled, which
    // would otherwise hand back an enabled Apply over a field the job just emptied.
    sync,
  };
}
