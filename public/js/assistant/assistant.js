// ════════════════════════════════════════════════════════════════════════════
// THE ASSISTANT - a chat with a model on every page but the 3D Studio's, opened by its button in the top strip
// (js/app-nav.js loads this module at the first press). A generation's window (js/gen-window.js openFrame, 1280×800,
// moved and stretched, kept under `assistant`), the page under it darkened.
//
//   left   the modes as tabs - Ideas (brainstorming videos, music and prompts for the app's generators) and Help (how to do
//          things in the app) -, the model under them (the models of the agents' ladder that can be asked; a chat
//          keeps the one it was given), "+ New chat", the mode's chats - the newest first; a double press on a name
//          renames it, its ✕ pressed twice deletes it
//   right  the chat's name and what it cost ("≈ $0.012 this chat"; tokens where no price came back), the conversation,
//          ready starts over an empty chat (pressed, the words go into the field - nothing is sent), the field: Enter
//          sends, Shift+Enter a new line; while the answer is written the send button stops it. In Ideas a "+" attaches a
//          character's look, a product of IMAGES -> Props or a scenario (js/merge-v3/chat-pick.js with the tree) - the
//          server reads them as words.
//
// Help: "Guide" under "+ New chat" opens the app's book (js/assistant/guide.js); an answer of Help keeps the section of the
// guide it was answered from - "Guide: <chapter › section>" under it opens the book there.
// The answer is shown as it is written (routes/assistant.js - lines of JSON); a closed window does not stop it: the
// server writes it to the end and keeps it, and the chat shows it when opened again. Errors are the corner's popups.
// Nothing here is a generation: no Alerts row.
// ════════════════════════════════════════════════════════════════════════════

import { openFrame, GEN_SIZE } from '../gen-window.js';
import { render as md, copyButton } from './md.js';
import { showError } from '../notice.js';
import { twoPress } from '../really.js';
import * as Layers from '../layers.js';
import { loadingEl, failedEl } from '../ui-state.js';
import { openGuide, ensureCss } from './guide.js';
import { allow } from '../key-gate.js';
import * as T from '../i18n/t.js';

const GEOM = Object.freeze({ key: 'assistant', resize: true, move: true, keepSize: true, keepPos: true });
const LS = 'as_state_v1';                     // { mode, cur: {ideas, help}, pick: {ideas, help} }
const MAX_ATTACH = 6;
// A start's words become the person's own message, in the app's language - the model answers in the language it is asked in.
const STARTS = {
  ideas: [
    [T.t('Hook ideas for an ad'), T.t('Hook ideas for an ad: ')],
    [T.t('Music for my short'), T.t('Music for my short: ')],
    [T.t('Prompt for a video clip'), T.t('Prompt for a video clip: ')],
    [T.t('Script outline'), T.t('Script outline: ')],
  ],
  help: [
    [T.t('How do I make a talking head?'), T.t('How do I make a talking head?')],
    [T.t('How do I cut silences?'), T.t('How do I cut silences?')],
    [T.t('Where are my renders?'), T.t('Where are my renders?')],
  ],
};
const ABOUT = {
  ideas: T.t('Brainstorm ideas for videos, hooks, music and prompts for the app\'s generators.'),
  help: T.t('Ask how to do something in the app - where a button is, what a window does.'),
};

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const json = (url, opts) => fetch(url, opts).then(async (r) => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw Object.assign(new Error(j.error || ('HTTP ' + r.status)), { status: r.status });
  return j;
});
const post = (url, body, method) => json(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const thumbOf = (p) => '/api/thumb?src=' + encodeURIComponent(p) + '&v=strip';
const keyOf = (s) => (s ? s.provider + '|' + s.model : '');
const stepOf = (k) => { const i = String(k || '').indexOf('|'); return i > 0 ? { provider: k.slice(0, i), model: k.slice(i + 1) } : null; };

function _stored() { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
function _keep() {
  try { localStorage.setItem(LS, JSON.stringify({ mode: S.mode, cur: S.cur, pick: S.pick })); } catch (e) { /* a private window */ }
}

const was = _stored();
const S = {
  mode: was.mode === 'help' ? 'help' : 'ideas',
  cur: Object.assign({ ideas: null, help: null }, was.cur || {}),       // the chat open in each mode
  pick: Object.assign({ ideas: '', help: '' }, was.pick || {}),         // the model a new chat of each mode takes
  models: null, def: null, fake: false, modelsFailed: false,
  lists: { ideas: null, help: null }, listFailed: { ideas: false, help: false },
  running: new Set(),                                                   // chats the server is answering
  full: new Map(),                                                      // chat id -> the chat whole, as read
  live: new Map(),                                                      // chat id -> { text, by, mine } - an answer being written
  atts: [],                                                             // { kind, ref, name } for the next Ideas message
  draft: { ideas: '', help: '' },
  loading: false,
};
let W = null;              // the open window's parts
let _onOpenChange = null;  // the strip's button follows the window
let _poll = 0;

// ── Money and time in words ─────────────────────────────────────────────────
function money(usd) {
  if (!(usd > 0)) return '$0';
  if (usd < 0.001) return '<$0.001';
  return '$' + (usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2));
}
const tokens = (n) => T.tn(n, '{k} token', '{k} tokens', { k: n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n) });
function priceLine(sum) {
  if (!sum || !sum.n) return '';
  if (sum.usd > 0 && sum.priced) return T.t('≈ {usd} this chat', { usd: money(sum.usd) });
  if (sum.usd > 0) return T.t('≈ {usd} this chat · {tokens} in all', { usd: money(sum.usd), tokens: tokens(sum.tokens) });
  return sum.tokens ? T.t('{tokens} this chat', { tokens: tokens(sum.tokens) }) : '';
}
function when(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5);
  return d.toLocaleDateString(T.lang() === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short' });
}

// ── Opening ─────────────────────────────────────────────────────────────────
/** Whether the window is open now. */
export const isOpen = () => !!(W && W.win.alive());

/** `fn(open)` is told when the window opens and closes - the strip's button lights while it is open. */
export function onOpenChange(fn) { _onOpenChange = fn; }

/** Opens the window (or, open already, puts the cursor in its field). */
export async function openAssistant() {
  if (isOpen()) { W.field.focus(); return; }
  // No model of the agents' ladder can be asked: the popup in its place (js/key-gate.js).
  if (!allow('assistant')) return;
  await ensureCss();
  const win = openFrame({ name: 'assistant', size: GEN_SIZE, geom: GEOM, cls: 'is-assistant',
    onClose: () => { clearTimeout(_poll); W = null; if (_onOpenChange) _onOpenChange(false); } });
  _build(win);
  if (_onOpenChange) _onOpenChange(true);
  _paint();
  W.field.focus();
  _loadModels();
  _loadList(S.mode);
}

function _build(win) {
  const body = win.body;
  body.classList.add('as-body');
  const left = el('div', 'as-left');
  const tabs = el('div', 'as-tabs u-tabs');
  const tab = (mode, label) => {
    const b = el('button', 'u-tab', label);
    b.type = 'button';
    b.dataset.mode = mode;
    b.title = ABOUT[mode];
    b.addEventListener('click', () => _setMode(mode));
    tabs.appendChild(b);
    return b;
  };
  const tIdeas = tab('ideas', T.t('Ideas'));
  const tHelp = tab('help', T.t('Help'));
  const mrow = el('label', 'as-mrow');
  mrow.appendChild(el('span', 'u-label', T.t('Model')));
  const model = el('select', 'as-model u-in is-s');
  model.title = T.t('Which model answers - a chat keeps its own. The models whose key is on Admin -> API keys.');
  model.addEventListener('change', _modelChosen);
  mrow.appendChild(model);
  const nb = el('button', 'as-new u-btn is-s', T.t('+ New chat'));
  nb.type = 'button';
  nb.addEventListener('click', _newChat);
  // Help's book: the app's guide in its own window, at the place read last.
  const gb = el('button', 'as-guide u-btn is-s', T.t('Guide'));
  gb.type = 'button';
  gb.title = T.t('The guide to the app - every page, window and button, with pictures');
  gb.addEventListener('click', () => openGuide());
  const brow = el('div', 'as-brow');
  brow.append(nb, gb);
  const list = el('div', 'as-list');
  left.append(tabs, mrow, brow, list);

  const right = el('div', 'as-right');
  const head = el('div', 'as-rhead');
  const title = el('span', 'as-title', '');
  const price = el('span', 'as-price u-mono', '');
  head.append(title, price);
  const thread = el('div', 'as-thread');
  const atts = el('div', 'as-atts');
  const box = el('div', 'as-box');
  const plus = el('button', 'as-plus u-btn is-icon', '+');
  plus.type = 'button';
  plus.title = T.t('Attach a character\'s look, a product of IMAGES → Props or a scenario - the model reads them as words');
  plus.addEventListener('click', _openAttach);
  const field = el('textarea', 'as-field u-area');
  field.rows = 1;
  field.spellcheck = true;
  field.addEventListener('input', () => { S.draft[S.mode] = field.value; _grow(); });
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); _send(); }
  });
  const go = el('button', 'as-go u-btn is-main', T.t('Send'));
  go.type = 'button';
  go.addEventListener('click', () => (_isBusy(S.cur[S.mode]) ? _stop() : _send()));
  box.append(plus, field, go);
  const note = el('div', 'as-note u-status is-line', '');
  right.append(head, thread, atts, box, note);
  body.append(left, right);
  W = { win, tIdeas, tHelp, model, nb, gb, list, title, price, thread, atts, plus, field, go, note, liveEl: null };
}

function _grow() {
  if (!W) return;
  const f = W.field;
  f.style.height = 'auto';
  f.style.height = Math.min(f.scrollHeight + 2, 200) + 'px';
}

// ── Loading ─────────────────────────────────────────────────────────────────
async function _loadModels() {
  try {
    const j = await json('/api/assistant/models');
    S.models = j.models || [];
    S.def = j.def || null;
    S.fake = !!j.fake;
    S.modelsOff = j.off || [];
    S.modelsFailed = false;
  } catch (e) { S.modelsFailed = true; }
  _paintModel();
}

async function _loadList(mode) {
  try {
    const j = await json('/api/assistant/chats?mode=' + mode);
    S.lists[mode] = j.chats || [];
    S.running = new Set(j.running || []);
    S.listFailed[mode] = false;
  } catch (e) { S.listFailed[mode] = true; }
  // A chat kept as open that is gone is let go.
  if (S.cur[mode] && S.lists[mode] && !S.lists[mode].some(c => c.id === S.cur[mode])) { S.cur[mode] = null; _keep(); }
  if (mode === S.mode) { _paintList(); if (S.cur[mode]) _loadChat(S.cur[mode]); else _paintChat(); }
}

async function _loadChat(id) {
  if (!S.full.has(id)) { S.loading = true; _paintChat(); }
  try {
    const j = await json('/api/assistant/chats/' + id);
    S.full.set(id, j.chat);
    _summaryIn(j.summary);
    // An answer the server is writing that this page is not reading (a reload, another opening): followed.
    if (j.live && !(S.live.get(id) || {}).mine) { S.live.set(id, { text: j.live.text || '', by: j.live.by, mine: false }); _follow(id); }
    else if (!j.live && S.live.has(id) && !S.live.get(id).mine) S.live.delete(id);
  } catch (e) {
    // A chat that is gone: the server's 404 (its words checked too).
    if (e.status === 404 || String(e.message).includes('no such chat')) { _forget(id); return; }
    showError(T.t('The chat could not be read: {why}', { why: e.message }));
  }
  S.loading = false;
  if (S.cur[S.mode] === id) { _paintModel(); _paintChat(); }
}

// Reads the chat again every second while the server writes its answer for someone else.
function _follow(id) {
  clearTimeout(_poll);
  _poll = setTimeout(async () => {
    if (!W || !S.live.has(id) || S.live.get(id).mine) return;
    try {
      const j = await json('/api/assistant/chats/' + id);
      S.full.set(id, j.chat);
      _summaryIn(j.summary);
      if (j.live) { S.live.set(id, { text: j.live.text || '', by: j.live.by, mine: false }); _follow(id); }
      else { S.live.delete(id); S.running.delete(id); }
    } catch (e) { S.live.delete(id); }
    if (S.cur[S.mode] === id) _paintChat();
    _paintList();
  }, 1000);
}

function _summaryIn(sum) {
  if (!sum) return;
  const list = S.lists[sum.mode];
  if (!list) return;
  const i = list.findIndex(c => c.id === sum.id);
  if (i >= 0) list.splice(i, 1);
  list.unshift(sum);
  list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function _forget(id) {
  for (const m of ['ideas', 'help']) {
    if (S.lists[m]) S.lists[m] = S.lists[m].filter(c => c.id !== id);
    if (S.cur[m] === id) S.cur[m] = null;
  }
  S.full.delete(id);
  S.live.delete(id);
  _keep();
  _paint();
}

// ── Painting ────────────────────────────────────────────────────────────────
function _paint() {
  if (!W) return;
  W.win.setCrumbs([{ label: T.t('assistant') }, { label: S.mode === 'ideas' ? T.t('ideas') : T.t('help') }]);
  W.tIdeas.classList.toggle('is-cur', S.mode === 'ideas');
  W.tHelp.classList.toggle('is-cur', S.mode === 'help');
  W.plus.hidden = S.mode !== 'ideas';
  W.gb.hidden = S.mode !== 'help';
  W.field.value = S.draft[S.mode] || '';
  W.field.placeholder = S.mode === 'ideas' ? T.t('Ask for ideas, hooks, music, a prompt…  (Enter sends, Shift+Enter a new line)')
    : T.t('Ask how to do something in the app…  (Enter sends, Shift+Enter a new line)');
  _grow();
  _paintModel();
  _paintList();
  _paintChat();
}

function _chosenKey() {
  const c = S.cur[S.mode] ? S.full.get(S.cur[S.mode]) : null;
  if (c && c.step) return keyOf(c.step);
  return S.pick[S.mode] || keyOf(S.def);
}

function _paintModel() {
  if (!W) return;
  const sel = W.model;
  sel.textContent = '';
  if (S.modelsFailed) { sel.appendChild(el('option', null, T.t('the models did not load'))); sel.disabled = true; return; }
  if (!S.models) { sel.appendChild(el('option', null, T.t('reading…'))); sel.disabled = true; return; }
  if (S.fake) { const o = el('option', null, T.t('fake model (test stand)')); o.value = ''; sel.appendChild(o); }
  if (!S.models.length && !S.fake) { sel.appendChild(el('option', null, T.t('no model - add a key on Admin → API keys'))); sel.disabled = true; return; }
  sel.disabled = false;
  const groups = new Map();
  for (const m of S.models) {
    if (!groups.has(m.group)) { const g = document.createElement('optgroup'); g.label = m.group; groups.set(m.group, g); sel.appendChild(g); }
    const name = m.label.replace(/ · [^·]+$/, '');
    const o = el('option', null, m.unproven ? T.t('{model} (not checked)', { model: name }) : name);
    o.value = keyOf(m);
    groups.get(m.group).appendChild(o);
  }
  const want = _chosenKey();
  if (want && ![...sel.options].some(o => o.value === want)) {
    const s = stepOf(want);
    const o = el('option', null, T.t('{model} (cannot be asked now)', { model: s ? s.model : want }));
    o.value = want;
    o.disabled = true;
    sel.insertBefore(o, sel.firstChild);
  }
  sel.value = want || (sel.options[0] ? sel.options[0].value : '');
}

async function _modelChosen() {
  const k = W.model.value;
  S.pick[S.mode] = k;
  _keep();
  const id = S.cur[S.mode];
  if (!id) return;
  try {
    const j = await post('/api/assistant/chats/' + id, { step: stepOf(k) }, 'PATCH');
    S.full.set(id, j.chat);
    _summaryIn(j.summary);
  } catch (e) { showError(T.t('The model was not changed: {why}', { why: e.message })); }
}

function _paintList() {
  if (!W) return;
  const L = W.list;
  L.textContent = '';
  const list = S.lists[S.mode];
  if (S.listFailed[S.mode]) { L.appendChild(failedEl(T.t('The chats'), () => _loadList(S.mode), { line: true })); return; }
  if (!list) { L.appendChild(loadingEl(T.t('reading the chats'), { line: true })); return; }
  if (!list.length) { L.appendChild(el('div', 'as-none', T.t('No chats yet - the first message starts one.'))); return; }
  for (const c of list) L.appendChild(_row(c));
}

function _row(c) {
  const row = el('div', 'as-row' + (c.id === S.cur[S.mode] ? ' is-cur' : ''));
  row.tabIndex = 0;
  const name = el('span', 'as-rname', c.title || T.t('New chat'));
  name.title = T.t('{name} - a double press renames it', { name: c.title || T.t('New chat') });
  const sub = el('span', 'as-rsub', [when(c.updatedAt), c.usd > 0 ? '≈ ' + money(c.usd) : '', S.running.has(c.id) || S.live.has(c.id) ? T.t('writing…') : ''].filter(Boolean).join(' · '));
  const x = el('button', 'as-rx u-btn is-s is-icon is-quiet u-x', '');
  x.type = 'button';
  x.title = T.t('Delete this chat');
  twoPress(x, { host: row, go: (e) => { e.stopPropagation(); _delete(c.id); } });
  row.append(name, sub, x);
  row.addEventListener('click', (e) => { if (e.target.closest('button, input')) return; _open(c.id); });
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) _open(c.id); });
  name.addEventListener('dblclick', (e) => { e.stopPropagation(); _rename(c, name); });
  return row;
}

function _rename(c, nameEl) {
  const inp = el('input', 'as-rin u-in is-s');
  inp.value = c.title || '';
  inp.maxLength = 80;
  nameEl.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  // Escape belongs to this field while it is open, not to the window.
  const layer = Layers.open(inp, { modal: false, name: 'rename', onEsc: () => finish(false) });
  const finish = async (save) => {
    if (done) return;
    done = true;
    Layers.close(layer);
    const t = inp.value.replace(/\s+/g, ' ').trim();
    if (save && t && t !== c.title) {
      try {
        const j = await post('/api/assistant/chats/' + c.id, { title: t }, 'PATCH');
        S.full.set(c.id, j.chat);
        _summaryIn(j.summary);
      } catch (e) { showError(T.t('Not renamed: {why}', { why: e.message })); }
    }
    _paintList();
    _paintHead();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } });
  inp.addEventListener('blur', () => finish(true));
}

async function _delete(id) {
  try { await json('/api/assistant/chats/' + id, { method: 'DELETE' }); _forget(id); }
  catch (e) { showError(T.t('The chat was not deleted: {why}', { why: e.message })); }
}

function _open(id) {
  if (S.cur[S.mode] === id) return;
  S.cur[S.mode] = id;
  _keep();
  _paintList();
  _paintModel();
  _loadChat(id);
}

function _newChat() {
  S.cur[S.mode] = null;
  _keep();
  _paintList();
  _paintModel();
  _paintChat();
  W.field.focus();
}

function _setMode(mode) {
  if (S.mode === mode) return;
  S.mode = mode;
  _keep();
  _paint();
  if (!S.lists[mode]) _loadList(mode);
  else if (S.cur[mode]) _loadChat(S.cur[mode]);
  W.field.focus();
}

function _paintHead() {
  if (!W) return;
  const id = S.cur[S.mode];
  const sum = id && S.lists[S.mode] ? S.lists[S.mode].find(c => c.id === id) : null;
  W.title.textContent = sum ? (sum.title || T.t('New chat')) : (S.mode === 'ideas' ? T.t('New chat · Ideas') : T.t('New chat · Help'));
  W.price.textContent = priceLine(sum);
  W.price.title = sum && !sum.priced ? T.t('Some answers came with no price (Replicate says none) - their tokens are counted') : '';
}

function _paintChat() {
  if (!W) return;
  _paintHead();
  _paintAtts();
  _paintGo();
  const TH = W.thread;
  TH.textContent = '';
  W.liveEl = null;
  const id = S.cur[S.mode];
  const chat = id ? S.full.get(id) : null;
  if (id && !chat) { TH.appendChild(S.loading ? loadingEl(T.t('reading the chat')) : el('div')); return; }
  const msgs = chat ? chat.messages : [];
  const live = id ? S.live.get(id) : null;
  if (!msgs.length && !live) { TH.appendChild(_starts()); return; }
  for (const m of msgs) TH.appendChild(m.role === 'user' ? _userEl(m) : _answerEl(m));
  if (live) { W.liveEl = _answerEl({ text: live.text, by: live.by, stage: live.stage }, true); TH.appendChild(W.liveEl); }
  TH.scrollTop = TH.scrollHeight;
}

function _starts() {
  const box = el('div', 'as-starts');
  box.appendChild(el('div', 'as-sh', S.mode === 'ideas' ? T.t('Ideas') : T.t('Help')));
  box.appendChild(el('div', 'as-sabout', ABOUT[S.mode]));
  const row = el('div', 'as-srow');
  for (const [label, text] of STARTS[S.mode]) {
    const b = el('button', 'as-start u-btn', label);
    b.type = 'button';
    b.title = T.t('Put it into the field - nothing is sent');
    b.addEventListener('click', () => {
      W.field.value = text;
      S.draft[S.mode] = text;
      _grow();
      W.field.focus();
      W.field.setSelectionRange(text.length, text.length);
    });
    row.appendChild(b);
  }
  box.appendChild(row);
  if (S.mode === 'ideas') box.appendChild(el('div', 'as-shint', T.t('+ beside the field attaches a character\'s look, a product or a scenario.')));
  return box;
}

// An attachment's chip: what it is and its name.
const KIND_CHIP = {
  look: (name) => T.t('character · {name}', { name }),
  prop: (name) => T.t('product · {name}', { name }),
  scenario: (name) => T.t('scenario · {name}', { name }),
};
const _chipText = (a) => (KIND_CHIP[a.kind] ? KIND_CHIP[a.kind](a.name) : String(a.name || ''));

function _userEl(m) {
  const w = el('div', 'as-msg is-user');
  const b = el('div', 'as-ubody');
  b.textContent = m.text || '';
  w.appendChild(b);
  if (m.attached && m.attached.length) {
    const chips = el('div', 'as-uatt');
    for (const a of m.attached) chips.appendChild(el('span', 'as-chip', _chipText(a)));
    w.appendChild(chips);
  }
  return w;
}

function _answerEl(m, live) {
  const w = el('div', 'as-msg is-answer' + (live ? ' is-live' : ''));
  if (m.text || live) {
    const b = el('div', 'as-abody');
    if (m.text) b.appendChild(md(m.text));
    if (live) b.appendChild(el('span', 'as-caret', ''));
    w.appendChild(b);
  }
  const foot = el('div', 'as-afoot');
  const who = m.by ? m.by.label : '';
  if (live) foot.appendChild(el('span', 'as-by', who ? T.t('writing · {model}', { model: who }) : (m.stage || T.t('asking…'))));
  else {
    if (who) foot.appendChild(el('span', 'as-by', who));
    if (m.usd != null && m.usd > 0) foot.appendChild(el('span', 'as-cost u-mono', '≈ ' + money(m.usd)));
    else if (m.usage && (m.usage.in || m.usage.out)) foot.appendChild(el('span', 'as-cost u-mono', tokens((m.usage.in || 0) + (m.usage.out || 0) + (m.usage.cacheRead || 0))));
    // Help's answer: the section of the guide it was answered from - the book opens there.
    if (m.guide && m.guide.chapter) {
      const g = el('button', 'as-glink-b', T.t('Guide: {place}', { place: m.guide.title || T.t('open') }));
      g.type = 'button';
      g.title = T.t('Open the guide at this place');
      g.addEventListener('click', () => openGuide({ chapter: m.guide.chapter, section: m.guide.section || '' }));
      foot.appendChild(g);
    }
    if (m.text) foot.appendChild(copyButton(m.text, T.t('copy answer')));
  }
  w.appendChild(foot);
  if (!live && (m.error || m.stopped || m.cut)) {
    const why = m.stopped ? T.t('Stopped.') : m.cut ? T.t('Cut off at its length.') : m.text ? T.t('Broken off - {why}', { why: m.error }) : T.t('No answer - {why}', { why: m.error });
    const line = el('div', 'as-err' + (m.stopped ? ' is-quiet' : ''), why);
    if (m.tried && m.tried.length) line.title = m.tried.join('\n');
    w.appendChild(line);
  }
  return w;
}

function _isBusy(id) { return !!id && (S.live.has(id) || S.running.has(id)); }

function _paintGo() {
  if (!W) return;
  const busy = _isBusy(S.cur[S.mode]);
  W.go.textContent = busy ? T.t('Stop') : T.t('Send');
  W.go.classList.toggle('is-main', !busy);
  W.go.title = busy ? T.t('Stop the answer where it is') : T.t('Send (Enter)');
  const live = S.cur[S.mode] ? S.live.get(S.cur[S.mode]) : null;
  W.note.textContent = live ? (live.by ? T.t('writing · {model}', { model: live.by.label }) : (live.stage || T.t('asking the model…'))) : '';
}

// The answer being written, drawn again at most once a frame.
let _raf = 0;
function _paintLive() {
  if (_raf) return;
  _raf = requestAnimationFrame(() => {
    _raf = 0;
    if (!W) return;
    const id = S.cur[S.mode];
    const live = id ? S.live.get(id) : null;
    if (!live) return;
    const TH = W.thread;
    const atEnd = TH.scrollHeight - TH.scrollTop - TH.clientHeight < 40;
    const fresh = _answerEl({ text: live.text, by: live.by, stage: live.stage }, true);
    if (W.liveEl && W.liveEl.isConnected) W.liveEl.replaceWith(fresh);
    else { const s = TH.querySelector('.as-starts'); if (s) s.remove(); TH.appendChild(fresh); }
    W.liveEl = fresh;
    if (atEnd) TH.scrollTop = TH.scrollHeight;
    _paintGo();
  });
}

// ── Attachments (Ideas) ─────────────────────────────────────────────────────
function _paintAtts() {
  if (!W) return;
  const A = W.atts;
  A.textContent = '';
  A.hidden = S.mode !== 'ideas' || !S.atts.length;
  if (A.hidden) return;
  for (const a of S.atts) {
    const chip = el('span', 'as-chip is-att', _chipText(a));
    const x = el('button', 'as-chipx', '✕');
    x.type = 'button';
    x.title = T.t('Take it off');
    x.addEventListener('click', () => { S.atts = S.atts.filter(t => t !== a); _paintAtts(); });
    chip.appendChild(x);
    A.appendChild(chip);
  }
}

// The rows of the attachment window: the characters with their looks (in groups), the scenarios.
async function _people() {
  const [c, l] = await Promise.all([json('/api/library/shelf/characters').catch(() => null), json('/api/library/shelf/looks').catch(() => null)]);
  if (!c) return { items: [], why: T.t('the characters could not be read'), failed: true };
  const looks = (l && l.items) || [];
  const groups = (c.items || []).map((ch) => {
    const mine = looks.filter(x => (x.meta || {}).charId === ch.id);
    const items = [{ path: ch.media, name: ch.name, sub: T.t('character'), thumb: thumbOf(ch.media), as: 'look', aspect: '16:9' }]
      .concat(mine.map(lk => ({ path: lk.media, name: lk.name, sub: T.t('{name} · look', { name: ch.name }), thumb: thumbOf(lk.media), as: 'look' })))
      .filter(x => x.path);
    return { key: 'c:' + ch.id, label: ch.name || T.t('character'), n: mine.length, sub: T.tn(mine.length, '{n} look', '{n} looks'), items };
  }).filter(g => g.items.length).sort((a, b) => b.n - a.n);
  return { items: groups.flatMap(g => g.items), groups };
}

async function _scenarios() {
  const j = await json('/api/library/shelf/scenarios').catch(() => null);
  if (!j) return { items: [], why: T.t('the scenarios could not be read'), failed: true };
  return { items: (j.items || []).map(s => ({ path: 'scen:' + s.id, id: s.id, name: s.name || T.t('untitled'), sub: T.t('scenario'), as: 'scenario' })) };
}

const _isProp = (p) => String(p || '').split('?')[0].startsWith('/media/props/');
const _refOf = (it) => (it.as === 'scenario' ? String(it.id) : String(it.path || '').split('?')[0]);
const _kindOf = (it) => it.as || 'prop';

async function _openAttach() {
  if (S.mode !== 'ideas') return;
  let Pick;
  try { Pick = await import('../merge-v3/chat-pick.js'); }
  catch (e) { showError(T.t('The attachment window could not be opened: {why}', { why: e.message })); return; }
  const has = (it) => S.atts.find(a => a.kind === _kindOf(it) && a.ref === _refOf(it));
  Pick.openPick({
    kind: 'image', title: T.t('attach to the message'), hint: T.t('A character\'s look, a product of IMAGES → Props or a scenario - read as words'),
    project: { key: '', title: '' },
    sources: [
      { id: 'people', label: T.t('Characters & looks'), load: _people, empty: T.t('No characters yet - New Character makes one in the Library.') },
      { id: 'scenarios', label: T.t('Scenarios'), load: _scenarios, empty: T.t('No scenarios yet - the Library makes them.') },
    ],
    tree: { roots: ['images'], page: 'pk_assistant', fallback: 'images', home: 'images', type: 'photo',
            map: (f) => ({ path: f.path, name: f.name || '', thumb: thumbOf(f.path), aspect: f.aspect || '' }) },
    start: ['row:people'],
    anchor: W ? W.win.box : null,
    left: () => MAX_ATTACH - S.atts.length,
    room: () => (MAX_ATTACH - S.atts.length > 0 ? T.t('{n} more can go with the message', { n: MAX_ATTACH - S.atts.length }) : ''),
    mark: (path) => (S.atts.some(a => (a.kind === 'scenario' ? 'scen:' + a.ref : a.ref) === String(path || '').split('?')[0]) ? T.t('attached') : ''),
    why: (it) => (it.as || _isProp(it.path) ? '' : T.t('only a product of Props')),
    press: (it) => {
      const here = has(it);
      if (here) S.atts = S.atts.filter(a => a !== here);
      else S.atts.push({ kind: _kindOf(it), ref: _refOf(it), name: it.name || T.t('untitled') });
      _paintAtts();
      Pick.pickChanged();
    },
    onClose: () => { _paintAtts(); if (W) W.field.focus(); },
  });
}

// ── Sending ─────────────────────────────────────────────────────────────────
async function _send() {
  if (!W) return;
  const mode = S.mode;
  const text = W.field.value.trim();
  if (!text) return;
  let id = S.cur[mode];
  if (_isBusy(id)) return;
  const attach = mode === 'ideas' ? S.atts.map(a => ({ kind: a.kind, ref: a.ref })) : [];
  const shown = mode === 'ideas' ? S.atts.slice() : [];
  W.field.value = '';
  S.draft[mode] = '';
  S.atts = [];
  _grow();
  if (!id) {
    try {
      const j = await post('/api/assistant/chats', { mode, step: stepOf(W.model.value) });
      id = j.chat.id;
      S.full.set(id, j.chat);
      if (!S.lists[mode]) S.lists[mode] = [];
      _summaryIn(j.summary);
      S.cur[mode] = id;
      _keep();
    } catch (e) {
      showError(T.t('The chat could not be started: {why}', { why: e.message }));
      _restore(mode, text, shown);
      return;
    }
  }
  const chat = S.full.get(id);
  const local = { id: 'local', role: 'user', text, attached: shown.map(a => ({ kind: a.kind, ref: a.ref, name: a.name })) };
  if (chat) chat.messages.push(local);
  S.live.set(id, { text: '', by: null, mine: true });
  if (S.cur[S.mode] === id) _paintChat();
  _paintList();
  let res;
  try {
    res = await fetch('/api/assistant/chats/' + id + '/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, attach }) });
  } catch (e) { res = null; }
  if (!res || !res.ok) {
    const j = res ? await res.json().catch(() => ({})) : {};
    S.live.delete(id);
    if (chat) chat.messages = chat.messages.filter(m => m !== local);
    showError(T.t('Not sent: {why}', { why: j.error || T.t('the app did not answer') }));
    _restore(mode, text, shown);
    if (S.cur[S.mode] === id) _paintChat();
    return;
  }
  await _read(id, res, local);
}

function _restore(mode, text, shown) {
  S.draft[mode] = text;
  if (mode === 'ideas' && !S.atts.length) S.atts = shown;
  if (W && S.mode === mode) { W.field.value = text; _grow(); _paintAtts(); }
}

// The answer's lines as they come: user (the message as kept), step, delta, replace, done.
async function _read(id, res, local) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let ended = false;
  const take = (o) => {
    const chat = S.full.get(id);
    const live = S.live.get(id);
    if (o.t === 'user') {
      if (chat) { const i = chat.messages.indexOf(local); if (i >= 0) chat.messages[i] = o.message; }
      _summaryIn(o.summary);
      _paintList();
      _paintHead();
    } else if (o.t === 'stage' && live) { live.stage = o.text; _visible(id) && _paintLive(); }
    else if (o.t === 'step' && live) { live.by = o.by; live.text = ''; _visible(id) && _paintLive(); }
    else if (o.t === 'delta' && live) { live.text += o.text; _visible(id) && _paintLive(); }
    else if (o.t === 'replace' && live) { live.text = o.text; _visible(id) && _paintLive(); }
    else if (o.t === 'done') {
      ended = true;
      S.live.delete(id);
      S.running.delete(id);
      if (chat) chat.messages.push(o.message);
      _summaryIn(o.summary);
      if (o.message && o.message.error && !o.message.text) showError(T.t('No answer: {why}', { why: o.message.error }));
      if (_visible(id)) _paintChat();
      _paintList();
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { take(JSON.parse(line)); } catch (e) { /* a broken line is skipped */ }
      }
    }
  } catch (e) { /* the connection went: the server still keeps the answer */ }
  if (!ended) {
    // The answer goes on on the server, or ended unseen: read the chat again.
    const live = S.live.get(id);
    if (live) live.mine = false;
    _loadChat(id);
  }
}

const _visible = (id) => !!W && S.cur[S.mode] === id;

async function _stop() {
  const id = S.cur[S.mode];
  if (!id) return;
  try { await post('/api/assistant/chats/' + id + '/stop', {}); }
  catch (e) { showError(T.t('Not stopped: {why}', { why: e.message })); }
}
