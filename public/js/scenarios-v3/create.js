// Scenarios v3 — the "add a scenario" flow.
//
// The + button above the list swaps the centre pane for a raw text box (one
// sentence per line) and the metadata pane for input fields. Nothing is written
// to the store until Save, so a half-finished scenario never pollutes the
// library — but the draft IS mirrored into ui-state, so a stray reload does not
// throw away pasted text.
//
// Save is gated: a title and at least 5 non-empty lines. Cancel needs two
// presses within 3s, the confirmation living on the button itself.

import { saveScenario, listOptions } from './api.js';
import { createCombo } from './combo.js';
import { makeArmable } from './arm.js';

const DRAFT_KEY  = 'sv3_draft_v1';   // mirrored server-side by storage-sync.js
const MIN_LINES  = 3;   // the server's minimum (routes/scen3.js)
const DRAFT_WAIT = 400;

const $ = id => document.getElementById(id);

let _creating   = false;
let _combos     = {};
let _draftT     = null;
let _cb         = {};
let _cancelArm  = { disarm() {} };

export const isCreating = () => _creating;

// ── draft mirror ────────────────────────────────────────────────────────────
function _readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
}
function _writeDraft() {
  const d = {
    title:    ($('sv3-title')        || {}).value || '',
    text:     ($('sv3-draft-text')   || {}).value || '',
    gender:   ($('sv3-draft-gender') || {}).value || '',
    vertical: _combos.vertical ? _combos.vertical.value() : '',
    product:  _combos.product  ? _combos.product.value()  : '',
    role:     _combos.role     ? _combos.role.value()     : '',
  };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) {}
}
function _clearDraft() {
  clearTimeout(_draftT);
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}
// Throw the draft away without going through the Cancel button (used when the
// user confirms abandoning it by opening a saved scenario instead).
export function discardDraft() { _clearDraft(); }
function _queueDraft() { clearTimeout(_draftT); _draftT = setTimeout(_writeDraft, DRAFT_WAIT); }

// ── the lines a draft would produce: one per non-empty text line ────────────
function _lines() {
  const raw = ($('sv3-draft-text') || {}).value || '';
  return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

// ── Save gate + the explanation shown when it is disabled ───────────────────
function _updateGate() {
  const btn  = $('sv3-save');
  const wrap = $('sv3-save-wrap');
  const st   = $('sv3-save-status');
  if (!btn) return;

  const title  = (($('sv3-title') || {}).value || '').trim();
  const gender = ($('sv3-draft-gender') || {}).value || '';
  const n      = _lines().length;

  let reason = '';
  if (!title)             reason = 'A title is required.';
  else if (n < MIN_LINES) reason = `At least ${MIN_LINES} lines are needed — currently ${n}.`;


  btn.disabled = !!reason;
  if (wrap) wrap.title = reason || `Save this scenario (${n} lines)`;

  // Cancel only needs confirming once there are lines to lose. If the box goes
  // back to empty while it is armed, drop the armed state so the label cannot
  // keep promising a confirmation that no longer applies.
  const cancel = $('sv3-cancel');
  if (cancel) {
    if (!n) _cancelArm.disarm();
    cancel.title = n ? 'Discard this draft (press twice)' : 'Discard this draft';
  }
  if (st) {
    st.textContent = reason || `${n} lines — ready to save`;
    st.className = 'sv3-status' + (reason ? '' : ' ok');
  }
}

// ── enter / leave ───────────────────────────────────────────────────────────
export async function enterCreate(draft) {
  _creating = true;
  document.body.dataset.view = 'create';
  _cancelArm.disarm();

  const d = draft || {};
  const ttl = $('sv3-title');
  if (ttl) {
    ttl.disabled = false;
    ttl.placeholder = 'vertical - name - role';
    ttl.value = d.title || '';
  }
  const txt = $('sv3-draft-text'); if (txt) txt.value = d.text || '';
  const gen = $('sv3-draft-gender'); if (gen) gen.value = d.gender || '';
  if (_combos.vertical) _combos.vertical.setValue(d.vertical || '');
  if (_combos.product)  _combos.product .setValue(d.product  || '');
  if (_combos.role)     _combos.role    .setValue(d.role     || '');

  // nothing is selected while drafting, so the per-scenario actions are off
  ['sv3-dup', 'sv3-del'].forEach(id => { const b = $(id); if (b) b.disabled = true; });

  _refreshOptions();
  _updateGate();
  if (txt) txt.focus();
}

export function exitCreate() {
  _creating = false;
  _cancelArm.disarm();
  document.body.dataset.view = 'view';
  const ttl = $('sv3-title');
  if (ttl) ttl.placeholder = 'untitled';
  const st = $('sv3-save-status'); if (st) { st.textContent = ''; st.className = 'sv3-status'; }
  if (_cb.onExit) _cb.onExit();
}

async function _refreshOptions() {
  try {
    const o = await listOptions();
    if (_combos.vertical) _combos.vertical.setOptions(o.verticals);
    if (_combos.product)  _combos.product .setOptions(o.products);
    if (_combos.role)     _combos.role    .setOptions(o.roles);
  } catch (e) { console.error('[sv3] options load failed', e); }
}

// ── Save ────────────────────────────────────────────────────────────────────
async function _onSave() {
  const btn = $('sv3-save');
  if (!btn || btn.disabled) return;
  btn.disabled = true;

  const title    = (($('sv3-title') || {}).value || '').trim();
  const gender   = ($('sv3-draft-gender') || {}).value || '';
  const role     = _combos.role     ? _combos.role.value()     : '';
  const vertical = _combos.vertical ? _combos.vertical.value() : '';
  const product  = _combos.product  ? _combos.product.value()  : '';

  const rec = {
    title, vertical, product,
    lines: _lines().map(text => ({ text })),
    // ugc_ad has a single presenter, so a single role entry
    roles: (role || gender) ? [{ id: 'r0', name: role, gender }] : [],
  };

  const st = $('sv3-save-status');
  if (st) { st.textContent = 'Saving…'; st.className = 'sv3-status'; }

  try {
    const saved = await saveScenario(rec);
    _clearDraft();
    _creating = false;
    document.body.dataset.view = 'view';
    const ttl = $('sv3-title'); if (ttl) ttl.placeholder = 'untitled';
    if (_cb.onSaved) await _cb.onSaved(saved.id);   // list reloads and selects the new scenario
    if (st) { st.textContent = 'Saved.'; st.className = 'sv3-status ok'; }
  } catch (e) {
    btn.disabled = false;
    if (st) { st.textContent = 'Save failed: ' + e.message; st.className = 'sv3-status err'; }
  }
}

// ── wiring ──────────────────────────────────────────────────────────────────
export function initCreate(cb) {
  _cb = cb || {};

  // three identical remembered-option fields
  const mk = (kind, slotId, placeholder) => {
    const slot = $(slotId);
    if (!slot) return null;
    const c = createCombo({ kind, placeholder, onChange: _queueDraft });
    slot.appendChild(c.el);
    return c;
  };
  _combos.vertical = mk('verticals', 'sv3-slot-vertical', 'e.g. male_enhancement');
  _combos.product  = mk('products',  'sv3-slot-product',  'what it sells');
  _combos.role     = mk('roles',     'sv3-slot-role',     'e.g. doctor');

  const plus = $('sv3-new');
  // "+" MEANS A BLANK ONE, ALWAYS. The guard here used to be `if (!_creating)` and nothing
  // else, so pressing + while a draft was open did literally nothing - no blank sheet, no
  // message, no clue. And a draft is open more often than it looks: the page RESTORES one on
  // load, silently entering create mode with the old text already in the field. So the usual
  // way to meet this was to open Scenarios, press +, and watch a button do nothing at all.
  //
  // The guard itself was right to exist - a stray click should not wipe work in progress - it
  // was just answering by staying silent. Now it answers.
  if (plus) plus.addEventListener('click', () => {
    if (!_creating) { enterCreate(null); return; }
    // Already drafting, with nothing in it: there is nothing to lose and nothing to ask.
    const hasText  = _lines().length > 0;
    const hasTitle = (($('sv3-title') || {}).value || '').trim().length > 0;
    if (!hasText && !hasTitle) { _clearDraft(); enterCreate(null); return; }
    // Something is written. confirm() rather than the two-press arm the other destructive
    // buttons use: that gesture works by swapping the button's label, and this one is a "+"
    // the width of a character.
    const n = _lines().length;
    const what = n ? (n === 1 ? 'one unsaved line' : n + ' unsaved lines') : 'an unsaved title';
    if (!confirm('The scenario you are writing has ' + what
      + '. Start a blank one and discard it?')) return;
    _clearDraft();
    enterCreate(null);
  });

  const txt = $('sv3-draft-text');
  if (txt) txt.addEventListener('input', () => { _updateGate(); _queueDraft(); });

  const gen = $('sv3-draft-gender');
  if (gen) gen.addEventListener('change', () => { _updateGate(); _queueDraft(); });

  const save = $('sv3-save');
  if (save) save.addEventListener('click', _onSave);

  _cancelArm = makeArmable($('sv3-cancel'), {
    idleLabel: 'Cancel',
    armedLabel: 'Press again to discard',
    // an empty scenario box has nothing to lose -> leave without asking
    skipConfirm: () => !_lines().length,
    onConfirm: () => { _clearDraft(); exitCreate(); },
  });

  // the title field is shared with view mode; only react to it while drafting
  const ttl = $('sv3-title');
  if (ttl) ttl.addEventListener('input', () => { if (_creating) { _updateGate(); _queueDraft(); } });

  // A reload mid-draft resumes where the user left off.
  const d = _readDraft();
  if (d && (d.text || d.title)) { enterCreate(d); return true; }
  return false;
}
