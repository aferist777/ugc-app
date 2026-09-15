'use strict';

// The editable prompts. Each has its default in lib/config.js; an edit is kept in
// data/prompts.json with up to ten earlier versions, and a prompt can be renamed, hidden or reset
// to its default. The editor is the Character page's settings (routes/prompts.js).
//
// Three are left - the ones the Character page still runs. The rest of the old registry (lookbook
// and environment extraction, poses, emotions, the Tempo analysis, the prompt compiler, the Birols
// category prompts...) went with the features that used them.

const fs   = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR, CV2_APPEARANCE_PROMPT, CV2_FRAMING_PROMPT, CHAR_SHEET_PROMPT } = require('./config');

const STORE_FILE = path.join(DATA_DIR, 'prompts.json');

// ── Defaults (immutable originals) ───────────────────────────────────────────
const DEFAULTS = { CV2_APPEARANCE_PROMPT, CV2_FRAMING_PROMPT, CHAR_SHEET_PROMPT };

// ── Human-readable labels ─────────────────────────────────────────────────────
const LABELS = {
  CV2_APPEARANCE_PROMPT: 'Character v2: appearance analyzer — reference + user text → prompt material, refuses the rest',
  CV2_FRAMING_PROMPT:    'Character v2: framing agent - is the body in the reference, and what build is it',
  CHAR_SHEET_PROMPT:     'Character: the 4K reference sheet - portrait plus three full-body views, neutral bodysuit',
};

// ── Fixed phrases per prompt (placeholders that must survive an edit) ────────
const FIXED_PHRASES = {
  CV2_APPEARANCE_PROMPT: ['{USER_TEXT}'],
  CV2_FRAMING_PROMPT:    [],
  CHAR_SHEET_PROMPT:     ['{BODY}'],
};

// ── Store helpers ─────────────────────────────────────────────────────────────
function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveStore(store) {
  writeFileAtomic(STORE_FILE, JSON.stringify(store, null, 2));
}

function known(key) {
  if (!(key in DEFAULTS)) throw new Error('Unknown prompt key: ' + key);
}

// ── Public API ────────────────────────────────────────────────────────────────
function getPrompt(key) {
  const store = loadStore();
  return store[key]?.current ?? DEFAULTS[key] ?? '';
}

function saveVersion(key, text) {
  known(key);
  const store = loadStore();
  if (!store[key]) store[key] = { current: DEFAULTS[key], versions: [] };
  // Save previous current as a historical version
  store[key].versions = store[key].versions || [];
  store[key].versions.unshift({ text: store[key].current, ts: new Date().toISOString() });
  store[key].versions = store[key].versions.slice(0, 10);
  store[key].current = text;
  saveStore(store);
}

function resetPrompt(key) {
  known(key);
  const store = loadStore();
  if (!store[key]) store[key] = { versions: [] };
  // Archive current before reset
  if (store[key].current && store[key].current !== DEFAULTS[key]) {
    store[key].versions = store[key].versions || [];
    store[key].versions.unshift({ text: store[key].current, ts: new Date().toISOString() });
    store[key].versions = store[key].versions.slice(0, 10);
  }
  store[key].current = DEFAULTS[key];
  saveStore(store);
}

function getAllPrompts() {
  const store = loadStore();
  return Object.keys(DEFAULTS).map(key => ({
    key,
    label:        store[key]?.customLabel ?? LABELS[key] ?? key,
    defaultLabel: LABELS[key] ?? key,
    customLabel:  store[key]?.customLabel ?? null,
    fixedPhrases: FIXED_PHRASES[key] || [],
    current:      store[key]?.current ?? DEFAULTS[key],
    default:      DEFAULTS[key],
    versions:     store[key]?.versions ?? [],
    isHidden:     store[key]?.isHidden ?? false,
  }));
}

function renamePrompt(key, customLabel) {
  known(key);
  const store = loadStore();
  if (!store[key]) store[key] = {};
  if (customLabel) store[key].customLabel = customLabel;
  else delete store[key].customLabel;
  saveStore(store);
}

function hidePrompt(key) {
  known(key);
  const store = loadStore();
  if (!store[key]) store[key] = {};
  store[key].isHidden = true;
  saveStore(store);
  return true;
}

module.exports = { getPrompt, saveVersion, resetPrompt, getAllPrompts, renamePrompt, hidePrompt };
