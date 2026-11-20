'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — the thread, kept per project.
//
// Making pictures is iterative: you say a thing, look at it, then say "the same but at night".
// A prompt box starts from nothing every time; a thread keeps what was already said, which is
// the only reason the second sentence means anything. So the conversation IS the working
// surface, and it belongs to the project the way the generations do - close the window, open it
// from another lane, come back tomorrow: the same thread.
//
// ── Why this is not one file with the generations ───────────────────────────
// A generation is a LIVE thing: it has a watcher, three states, and a picture that arrives
// minutes later. A message is a settled thing that never changes after it is written. Putting
// them in one list would mean rewriting settled rows every time a watcher ticked.
//
// So they stay apart and a message POINTS at a generation by id. One fact, one home. (One message
// is taken away by the cross in its corner, with what goes with it: remove() below.)
//
// ── The thread is not only what is in this file ─────────────────────────────
// Every generation made before the chat existed - and any made from somewhere that is not the
// chat - has no message. Rather than write invented messages for them, read() folds them in as
// they are read: a picture with no message shows as its own turn, at its own time. Nothing is
// fabricated on disk, and a generation can never be invisible in the thread it belongs to.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const GENS = require('./mv3-gens');
const I18N = require('./i18n');

const FILE = path.join(DATA_DIR, 'mv3-chat.json');

// Per project. A thread nobody has cleared for a month is not a reason for a file that grows
// without end, and what falls off is the oldest - the part nobody scrolls back to.
const KEEP_PER_PROJECT = 600;

const ROLES = ['user', 'agent'];

// ── THE DRAFTS' CONVERSATION ──────────────
// Every draft talks in ONE conversation per chat - the pictures' and the clips' - kept under the key DRAFT: what is
// said in a draft is written there, and any draft opened reads it, with the generations of the drafts before it (found
// by their ids, whatever draft made them). It keeps the last DRAFT_ANSWERS answers of the agent in each chat, with the
// person's turns before them and the turns the kept cards were written from; what falls off does not fold back in.
// A draft SAVED takes a copy as its own conversation (copyDraftTo) and talks in its own from then on - a project's
// conversation never comes into the drafts'. A draft let go of leaves it as it is.
const DRAFT = 'draft';
const DRAFT_ANSWERS = 20;
/** Where a project's messages are kept: the drafts' conversation for the draft, its own for any other project. */
function threadOf(project) {
  const p = String(project == null ? '' : project);
  if (!p) return p;
  let d = '';
  try { d = require('./merge-store').draftKey(); } catch (e) { /* no store: no draft */ }
  return p === d ? DRAFT : p;
}

// ── Cards: the video chat's writer stopping for a look ──
// A prompt card (type 'prompt') is the prompt the writer made of the person's words, theirs to edit and only then made
// into a video (Kling's first frame is one too, with its picture as `board`). Unlike a turn, a card
// CHANGES - written, edited, sent - and every change is read, made and written in one tick (update).
// 'board': the column's storyboard - the person's words, the sheet's prompt, its sheets; the video is made
// from it by a plain send of those words with the sheet among the pictures.
const CARD_TYPES = ['prompt', 'board'];
const CARD_STATES = ['writing', 'ready', 'sent', 'failed'];
// The kicks of the writers running in THIS process: a card 'writing' on a kick that is not here died with the app
// (or with its request) - read() fails it, in words, the first time anybody looks.
const WRITING = new Set();
const DIED = () => I18N.t('the writer stopped when the app was closed - nothing was made; write it again');

const _s = (v, n) => String(v == null ? '' : v).slice(0, n);

// A card whose writer is not running any more keeps what it has: back to where it was, the words saying
// what stopped - every card. A frame card's own words are its picture's
// prompt: Kling's is put in at its start.
function _settle(x, why) {
  x.card.error = why;
  x.card.writing = '';
  // A clip that was being watched, or waiting for its turn, was not watched.
  for (const w of (Array.isArray(x.card.watch) ? x.card.watch : [])) {
    if (w && (w.state === 'watching' || w.state === 'waiting')) Object.assign(w, { state: 'failed', why: I18N.t('the app was closed before it was watched') });
  }
  const B = x.card.board;
  const made = (x.card.sends || []).length || (x.genIds || []).length;
  const written = B && B.kind === 'frame' ? (B.versions || []).length || B.prompt
    : (x.card.versions || []).length || x.card.prompt || (B && ((B.versions || []).length || B.prompt));
  x.card.state = made ? 'sent' : written ? 'ready' : 'failed';
}
function _card(c) {
  if (!c || typeof c !== 'object' || !CARD_TYPES.includes(c.type)) return null;
  const out = { type: c.type };
  out.state = CARD_STATES.includes(c.state) ? c.state : 'failed';
  // A prompt card of the PLAIN chat - the writer stopping for a look - carries the person's words too.
  if (c.type === 'board' || c.plain) out.text = _s(c.text, 20000);
  if (c.plain) out.plain = true;
  // The prompt's VARIANTS - every writing of it (the first, "write it again", for another model); the chosen
  // one (`cur`) is mirrored in prompt / model / agg / params / writer / fell / edited, which every reader reads.
  if (Array.isArray(c.versions)) {
    out.versions = c.versions.filter(v => v && typeof v === 'object').slice(-10).map(v => ({
      id: _s(v.id, 40), at: _s(v.at, 40), model: _s(v.model, 40), agg: _s(v.agg, 20), writer: _s(v.writer, 200),
      fell: _s(v.fell, 300), prompt: _s(v.prompt, 30000), edited: !!v.edited,
      params: v.params && typeof v.params === 'object' ? v.params : undefined,
      // A storyboard card's video prompt: the sheet it was written with.
      boardId: _s(v.boardId, 40),
    }));
    out.cur = _s(c.cur, 40);
  }
  // `writing`: which writer of a storyboard card runs - 'board' (the sheet's prompt) or 'video'.
  for (const k of ['kick', 'from', 'copyOf', 'model', 'agg', 'writer', 'fell', 'startedAt', 'writing']) if (c[k]) out[k] = _s(c[k], 200);
  // WHAT THE AGENT SAW of each clip (lib/clip-watch.js, routes/mv3-video.js _watchFor): one entry per clip, in
  // the clips' order - the part it is of, its description (the person may correct it; the writer writes from it as it
  // stands), who watched it, or why it was not watched.
  if (Array.isArray(c.watch)) {
    out.watch = c.watch.filter(w => w && typeof w === 'object').slice(0, 10).map(w => ({
      n: Math.max(1, Math.round(+w.n || 1)), path: _s(w.path, 600), in: Math.max(0, +w.in || 0), out: Math.max(0, +w.out || 0),
      state: ['waiting', 'watching', 'done', 'failed'].includes(w.state) ? w.state : 'failed',
      text: _s(w.text, 40000), by: _s(w.by, 200), why: _s(w.why, 600), edited: !!w.edited, cached: !!w.cached, at: _s(w.at, 40),
    }));
  }
  if (c.error) out.error = _s(c.error, 600);
  out.prompt = _s(c.prompt, 30000);
  out.edited = !!c.edited;
  if (c.params && typeof c.params === 'object') out.params = c.params;
  if (c.sent && typeof c.sent === 'object') out.sent = c.sent;
  // A made card is made again from its own field: every make is an ATTEMPT - when, how many,
  // its clips, the sheet it followed. What each was sent with is its clips' records' own (lib/mv3-video-gens.js).
  if (Array.isArray(c.sends)) {
    out.sends = c.sends.filter(s => s && typeof s === 'object').slice(-20).map(s => ({
      at: _s(s.at, 40), n: Math.max(1, Math.min(2, +s.n || 1)), boardId: _s(s.boardId, 40), ver: _s(s.ver, 40),
      genIds: (Array.isArray(s.genIds) ? s.genIds : []).map(x => _s(x, 40)).filter(Boolean).slice(0, 4),
    }));
  }
  // A two-step card's storyboard: its prompt and shape, the pictures made of it, the one chosen.
  if (c.board && typeof c.board === 'object') {
    out.board = {
      prompt: _s(c.board.prompt, 6000), aspect: _s(c.board.aspect, 8), edited: !!c.board.edited,
      genIds: (Array.isArray(c.board.genIds) ? c.board.genIds : []).map(x => _s(x, 40)).filter(Boolean).slice(-20),
      chosen: _s(c.board.chosen, 40),
    };
    // The sheet's prompt has VARIANTS too - every writing of it; the chosen one mirrored in prompt / aspect.
    if (Array.isArray(c.board.versions)) {
      out.board.versions = c.board.versions.filter(v => v && typeof v === 'object').slice(-10).map(v => ({
        id: _s(v.id, 40), at: _s(v.at, 40), prompt: _s(v.prompt, 6000), aspect: _s(v.aspect, 8), writer: _s(v.writer, 200), edited: !!v.edited,
      }));
      out.board.cur = _s(c.board.cur, 40);
    }
    // Kling's first frame: not a sheet but the clip's frame with the person's character in it, drawn
    // from the moment `at` of the clip (its seconds in the file).
    // `dur`: the clip's whole length - its moment is where the part starts, anywhere in the clip; `len`: the
    // length of the part the person chose, which the part keeps when the moment moves.
    if (c.board.kind === 'frame') {
      Object.assign(out.board, { kind: 'frame', at: Math.max(0, Math.round((+c.board.at || 0) * 100) / 100),
                                 dur: Math.max(0, +c.board.dur || 0), len: Math.max(0, +c.board.len || 0) });
    }
  }
  return out;
}

// Read-modify-write, synchronously, for the same reason the generations store does it: several
// writes can land in one tick and each one is a whole-file write. The file holds the messages and,
// beside them, the mark of what was cleared.
function _all() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
  return {
    messages: Array.isArray(raw && raw.messages) ? raw.messages : [],
    cleared: (raw && raw.cleared && typeof raw.cleared === 'object') ? raw.cleared : {},
  };
}

function _read() { return _all().messages; }

function _write(list, cleared) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const cur = _all();
  const next = { messages: list, cleared: cleared || cur.cleared };
  writeFileAtomic(FILE, JSON.stringify(next, null, 2));
}

// Two turns are often written in one millisecond (the person's turn and its card): six random characters.
const _newId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/**
 * The thread, oldest first - which is the order a conversation is read in, and the opposite of
 * the strip's.
 *
 * Generations with no message of their own are folded in at their own time. `gen` is attached
 * whole rather than by id: the window would ask for it in the next breath anyway, and a thread
 * that needs a second request per picture is a thread that draws in pieces.
 */
// ONE CONVERSATION PER PROJECT AND KIND. A message with no kind is read as 'image'; kind 'video' belongs to no
// thread - a library may hold such messages about clips with nothing behind them. The VIDEO CHAT is kind 'clip' for
// exactly that reason: a live 'video' would bring those messages back as turns with nothing in them. Its records are the video
// store's, required when read - that store requires this file's neighbours, and a require at the top would be a circle.
// 'fchat' - a talking head's frames chat: the pictures' records that are frames of the project (`frame`);
// they are cleared with the pictures' (forget), and the pictures chat never folds them in as its own.
const FRAMES = { listAll: () => GENS.listAll().filter(r => r && r.frame), forget: () => 0 };
const KINDS = { image: () => GENS, clip: () => require('./mv3-video-gens'), fchat: () => FRAMES };
const _kindOf = (v) => (v == null || v === '' ? 'image' : String(v));

/**
 * The storyboards of a two-step card, oldest first: the pictures its presses drew (`board.genIds`) and
 * those asked for again from Alerts - a retry is a new record, and it names the card as its `send`. `all` is the
 * project's picture records when the caller has them already. A sheet that landed and has left the Images shelf
 * since is `gone`: it cannot be chosen or followed, and the card says so.
 */
const BOARD_AT_ONCE = 2;
function boardsOf(m, all) {
  if (!m || !m.card || !m.card.board) return [];
  const ids = new Set(m.card.board.genIds || []);
  const MEDIA = require('./media');
  // Among every record: a card of the drafts' conversation drew its sheets in whichever draft it was.
  return (all || GENS.listAll()).filter(g => g && (ids.has(g.id) || (g.board && g.send && g.send === m.id)))
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
    .map(g => {
      if (g.state !== 'done' || !g.imagePath) return g;
      let abs = null;
      try { abs = MEDIA.toDiskExisting(g.imagePath); } catch (e) { /* not an address of the library */ }
      return abs && fs.existsSync(abs) ? g : Object.assign({}, g, { gone: true });
    });
}
// The sheets the video can follow: landed, and still on the shelf.
const boardReady = (g) => !!(g && g.state === 'done' && g.imagePath && !g.gone);

/**
 * Where a storyboard asked for again from Alerts belongs: the newest card that lists it and can draw - a
 * card is written (waiting, or made and made again from its field), and its copies ("again")
 * list its sheets too - with room under its limit. { card } or { error } in words.
 */
// Found by the sheet, not by the project: the record's project may be a draft let go of since, and its card
// in the drafts' conversation - a sheet's id is its own, and the card that lists it is its home.
function boardHome(genId) {
  const all = GENS.listAll();
  const cards = _read().filter(m => m && m.card && (m.card.type === 'prompt' || m.card.type === 'board') && m.card.board
    && boardsOf(m, all).some(g => g.id === genId));
  // A first frame's picture is said as a picture.
  const pic = (g0) => !!(g0 && g0.card && g0.card.board && g0.card.board.kind === 'frame');
  if (!cards.length) {
    const was = all.find(g => g.id === genId);
    // `firstFrame` on the record; an older record is known by the English words it was said with.
    return { error: was && (was.firstFrame || /^picture · /.test(String(was.said || '')))
      ? I18N.t('its card is not in the video chat any more - draw the picture on a card there')
      : I18N.t('its card is not in the video chat any more - draw a storyboard on a card there') };
  }
  const open = cards.filter(m => m.card.state === 'ready' || m.card.state === 'sent');
  if (!open.length) {
    return { error: pic(cards[cards.length - 1]) ? I18N.t('its card is being written again - draw the picture there when it is written')
      : I18N.t('its card is being written again - draw the storyboard there when it is written') };
  }
  const card = open[open.length - 1];
  if (boardsOf(card, all).filter(g => g.state === 'pending').length >= BOARD_AT_ONCE) {
    return { error: pic(card) ? I18N.tn(BOARD_AT_ONCE, '{n} picture is being drawn for its card already - wait for it', '{n} pictures are being drawn for its card already - wait for one')
      : I18N.tn(BOARD_AT_ONCE, '{n} storyboard is being drawn for its card already - wait for it', '{n} storyboards are being drawn for its card already - wait for one') };
  }
  return { card };
}

// EACH FILE ONCE PER READ: the thread is asked for every four seconds while anything is being made. The chat once - the dead cards settled in that same list and written once -, the records once.
const _isDead = (m) => !!(m && m.card && (m.card.type === 'prompt' || m.card.type === 'board') && m.card.state === 'writing' && !WRITING.has(m.card.kick));
function read(project, kind) {
  const real = String(project == null ? '' : project);
  const p = threadOf(real);
  const k = _kindOf(kind);
  if (!KINDS[k]) return [];
  const doc = _all();
  const mine = (m) => m && String(m.project || '') === p && _kindOf(m.kind) === k;
  let settled = false;
  for (const m of doc.messages) {
    if (!mine(m) || !_isDead(m)) continue;
    _settle(m, DIED());
    m.card = _card(m.card);
    settled = true;
  }
  if (settled) _write(doc.messages, doc.cleared);
  const msgs = doc.messages.filter(mine);
  // Every record of the kind, read once: the project's own - folded in as loose turns; for the drafts' conversation,
  // the open draft's - and every one a turn points at, whatever project made it.
  const all = KINDS[k]().listAll();
  const gens = all.filter(g => String(g.project || '') === real);
  const byId = {};
  for (const g of all) byId[g.id] = g;
  const pics = msgs.some(m => m.card && m.card.board) ? (k === 'image' ? all : GENS.listAll()) : [];

  // Every generation a turn speaks for, not just its first: without this the others would be
  // folded in again below as loose turns of their own, which is the duplication the list exists
  // to prevent.
  const spoken = new Set();
  for (const m of msgs) {
    for (const id of (m.genIds && m.genIds.length ? m.genIds : [m.genId])) if (id) spoken.add(id);
  }
  const out = msgs.map(m => Object.assign({}, m, {
    gen: m.genId ? (byId[m.genId] || null) : null,
    gens: (m.genIds && m.genIds.length ? m.genIds : (m.genId ? [m.genId] : []))
      .map(id => byId[id]).filter(Boolean),
  }, m.card && m.card.board ? {
    // The storyboards a two-step card made - pictures of the pictures chat's store, read with the thread.
    boards: boardsOf(m, pics),
  } : {}));

  // Anything made outside this thread - before it existed, or by another way in - shows as its
  // own turn rather than not at all.
  //
  // Unless the thread was CLEARED after it was made. A clearing mark asks for a clean slate, and
  // folding the same pictures straight back in would undo it. A library may hold such marks, and the
  // draft writes its own (_trimDraft, and copyDraftTo hands them to a project). Nothing is lost by
  // leaving them out: they stay on the library shelf.
  const since = doc.cleared[p + '|' + k] || doc.cleared[p] || '';
  for (const g of gens) {
    if (spoken.has(g.id)) continue;
    // A storyboard has its home on a card of the video chat - not a loose turn of the pictures chat.
    if (g.board) continue;
    // A frame of the frames chat is that chat's.
    if (k === 'image' && g.frame) continue;
    if (since && String(g.at || '') <= since) continue;
    out.push({
      id: 'g:' + g.id, project: p, kind: k, role: 'agent', text: '', refs: g.refs || [],
      genId: g.id, gen: g, at: g.at, loose: true,
    });
  }

  out.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return out;
}

function add(o) {
  const opts = o || {};
  const rec = {
    // Given by the caller when the pictures of the turn were asked for before it was written (they
    // carry the turn's id as their `send`).
    id: /^m[a-z0-9]{6,30}$/.test(String(opts.id || '')) ? String(opts.id) : _newId(),
    project: threadOf(opts.project),
    kind: _kindOf(opts.kind),
    role: ROLES.includes(opts.role) ? opts.role : 'user',
    text: String(opts.text || '').slice(0, 20000),
    // The local paths of what was attached, in the order they were attached - which is the order
    // the numbers written on them refer to.
    refs: (Array.isArray(opts.refs) ? opts.refs : []).map(String).filter(Boolean).slice(0, 14),
    genId: String(opts.genId || ''),
    // ONE TURN CAN CARRY SEVERAL PICTURES. Asking for four in one breath is one answer, and four
    // turns for it is a thread nobody can read back. `genId` stays as the first of them for every
    // reader of a single id - the folding below, the delete.
    genIds: Array.isArray(opts.genIds)
      ? opts.genIds.map(x => String(x || '')).filter(Boolean).slice(0, 12)
      : [],
    // What was actually sent to the model, when that is not what was typed. Kept so "read more"
    // can show it: a rewrite nobody can see is a rewrite nobody can debug.
    sent: String(opts.sent || '').slice(0, 20000),
    // What was attached in the video chat, with what each is FOR: a picture, a clip or a sound, its role
    // (person, product, motion...) and, for a clip, the part of it that goes. `refs` keeps the paths alone.
    media: (Array.isArray(opts.media) ? opts.media : []).filter(m => m && m.path).slice(0, 30).map(m => ({
      path: String(m.path), kind: String(m.kind || 'image').slice(0, 10), role: String(m.role || '').slice(0, 20),
      // What it is called on the card ('storyboard' for the sheet a video follows).
      label: String(m.label || '').slice(0, 40),
      in: +m.in || 0, out: +m.out || 0,
    })),
    at: new Date().toISOString(),
  };
  // The person's words on the answer itself - the video chat draws one message per send, and a turn
  // trimmed away must not take what was asked with it.
  if (opts.asked != null && String(opts.asked).trim()) rec.asked = String(opts.asked).slice(0, 20000);
  // The frames chat's `ideas`: frames in words, each one a press away from the message box.
  if (Array.isArray(opts.ideas)) rec.ideas = opts.ideas.map(x => String(x || '').trim().slice(0, 600)).filter(Boolean).slice(0, 8);
  const card = _card(opts.card);
  if (card) rec.card = card;
  const list = _read();
  list.push(rec);
  _write(list);
  _trim(rec.project, rec.kind);
  return rec;
}

// Per project AND kind: a long conversation about pictures must not push out what was said about
// clips, and the other way round.
function _trim(project, kind) {
  if (project === DRAFT) { _trimDraft(kind); return; }
  const all = _read();
  const k = _kindOf(kind);
  const mine = all.filter(m => m && String(m.project || '') === String(project || '') && _kindOf(m.kind) === k);
  if (mine.length <= KEEP_PER_PROJECT) return;
  const doomed = new Set(mine
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(0, mine.length - KEEP_PER_PROJECT).map(m => m.id));
  _write(all.filter(m => !doomed.has(m.id)));
}

// The drafts' conversation keeps its last DRAFT_ANSWERS answers - the agent's turns the person reads - with
// the person's turns just before the oldest kept and the turns the kept cards were written from (`from`). The oldest
// turn kept is written down as its mark, so the generations of what fell off do not fold back in as loose turns.
function _trimDraft(kind) {
  const all = _all();
  const k = _kindOf(kind);
  const mine = all.messages.filter(m => m && m.project === DRAFT && _kindOf(m.kind) === k)
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  const answers = mine.filter(m => m.role === 'agent');
  if (answers.length <= DRAFT_ANSWERS) return;
  let cut = mine.indexOf(answers[answers.length - DRAFT_ANSWERS]);
  while (cut > 0 && mine[cut - 1].role === 'user') cut--;
  const kept = mine.slice(cut);
  const need = new Set(kept.map(m => m.card && m.card.from).filter(Boolean));
  const doomed = new Set(mine.slice(0, cut).filter(m => !need.has(m.id)).map(m => m.id));
  if (!doomed.size) return;
  const cleared = Object.assign({}, all.cleared, { [DRAFT + '|' + k]: String(kept[0].at || new Date().toISOString()) });
  _write(all.messages.filter(m => !doomed.has(m.id)), cleared);
}

/**
 * A draft saved under a name: the drafts' conversation, as it is, copied into the
 * project's own - new ids, the cards' `from` followed - and the project talks in its own from then on. The drafts'
 * goes on as it was. A card still being written is copied as it stands, its writer's answer landing in the drafts'.
 */
function copyDraftTo(project) {
  const p = String(project || '');
  if (!p || p === DRAFT) return 0;
  const all = _all();
  const src = all.messages.filter(m => m && m.project === DRAFT);
  if (!src.length) return 0;
  const ids = new Map(src.map(m => [m.id, _newId()]));
  const copies = src.map(m => {
    const c = JSON.parse(JSON.stringify(m));
    c.id = ids.get(m.id);
    c.project = p;
    if (c.card && c.card.from && ids.has(c.card.from)) c.card.from = ids.get(c.card.from);
    if (c.card && c.card.state === 'writing') _settle(c, I18N.t('it was being written when the draft was saved - the drafts\' chat has the rest; write it again here'));
    return c;
  });
  const cleared = Object.assign({}, all.cleared);
  for (const k of Object.keys(KINDS)) if (all.cleared[DRAFT + '|' + k]) cleared[p + '|' + k] = all.cleared[DRAFT + '|' + k];
  _write(all.messages.concat(copies), cleared);
  return copies.length;
}

/** How many cards of a project's clip chat a writer is writing now - without the whole read: a card on a
 *  writer that is not running is not counted (read() settles it). */
function writingCount(project) {
  const p = threadOf(project);
  return _read().filter(m => m && String(m.project || '') === p && _kindOf(m.kind) === 'clip' && m.card
    && (m.card.type === 'prompt' || m.card.type === 'board') && m.card.state === 'writing' && WRITING.has(m.card.kick)).length;
}

/** One message by its id - a card, to be changed or made from. */
function get(id) {
  return _read().find(m => m && m.id === String(id || '')) || null;
}

/**
 * Change one message - a card - in ONE tick: read, `fn(message)` changes it (synchronously; false: no change), write.
 * Answers the message as it is now, or null when it is gone (the thread was cleared meanwhile).
 */
function update(id, fn) {
  const list = _read();
  const i = list.findIndex(m => m && m.id === String(id || ''));
  if (i < 0) return null;
  const m = JSON.parse(JSON.stringify(list[i]));
  const r = fn(m);
  if (r && typeof r.then === 'function') throw new Error('update() takes a synchronous change');
  if (r === false) return list[i];
  if (m.card) m.card = _card(m.card);
  list[i] = m;
  _write(list);
  return m;
}

/**
 * A project deleted - its timeline only, or with its files: both of its conversations go,
 * and the finished records of what was made for it. What was made stays on its shelf. A record another conversation
 * still points at stays (a saved draft's copy points at the records of the drafts before it), and so does one still
 * being made. The drafts' conversation is never a project's to take.
 */
function forget(project) {
  const p = String(project || '');
  if (!p || p === DRAFT || threadOf(p) === DRAFT) return { messages: 0, records: 0 };
  const all = _all();
  const keep = all.messages.filter(m => !(m && String(m.project || '') === p));
  const cleared = {};
  for (const [k, v] of Object.entries(all.cleared)) if (k !== p && !k.startsWith(p + '|')) cleared[k] = v;
  _write(keep, cleared);
  const ids = new Set();
  const turns = new Set();
  for (const m of keep) {
    if (!m) continue;
    turns.add(m.id);
    if (m.genId) ids.add(m.genId);
    for (const id of (m.genIds || [])) ids.add(id);
    for (const id of ((m.card && m.card.board && m.card.board.genIds) || [])) ids.add(id);
  }
  const spoken = (g) => ids.has(g.id) || (!!g.send && turns.has(g.send));
  let records = 0;
  for (const k of Object.keys(KINDS)) {
    try { records += KINDS[k]().forget(p, spoken); } catch (e) { console.warn('[mv3-chat] the ' + k + ' records of ' + p + ' were not cleared:', e.message); }
  }
  return { messages: all.messages.length - keep.length, records };
}

// ── ONE MESSAGE TAKEN AWAY (the cross in a message's corner, in all three chats) ──
// What goes with it:
//   - a turn of the person: its answers too - what follows it up to the person's next turn (the pictures chat draws turns);
//   - an answer or a card: the person's turn it answers - the message just before it (the video chat and the frames chat
//     draw no turns - the answer carries what was asked) - and the turn a card was written from, when no other card was
//     written from it;
//   - the settled records of what they made - a video's, a storyboard's, a picture's, a frame's - or they would fold back
//     in as loose turns (read). What was made stays on its shelf and on the timeline; a record another message still points
//     at stays (a saved draft's copy points at the drafts' records); the Alerts rows stay as they are - a retry there makes
//     a new record of what the row keeps, and it shows as a turn of its own.
// Nothing goes while anything in it is still being made: a record pending, a card a writer is writing.
// A loose turn ('g:<record id>', a record no message speaks for) is its record.
const BUSY = () => I18N.t('something in it is still being made - wait for it, or stop it with the cross on its countdown');
const GONE_MSG = () => I18N.t('that message is not in the chat any more');

// Every record a message speaks for: its pictures or clips, every make of a card, its storyboards.
function _spokenBy(m) {
  const ids = new Set();
  if (!m) return ids;
  if (m.genId) ids.add(String(m.genId));
  for (const x of (m.genIds || [])) if (x) ids.add(String(x));
  const c = m.card || {};
  for (const s of (Array.isArray(c.sends) ? c.sends : [])) for (const x of ((s && s.genIds) || [])) if (x) ids.add(String(x));
  for (const x of ((c.board && c.board.genIds) || [])) if (x) ids.add(String(x));
  return ids;
}

/** Take one message away, with what goes with it: { messages, records } or { code, error } in words. */
function remove(id) {
  const want = String(id || '').trim();
  if (!want) return { code: 400, error: I18N.t('which message?') };
  const VGENS = require('./mv3-video-gens');
  const stores = [GENS, VGENS];
  const records = GENS.listAll().concat(VGENS.listAll());
  const doc = _all();

  // A loose turn is a record no message speaks for: the record itself goes.
  if (want.startsWith('g:')) {
    const gid = want.slice(2);
    const g = records.find(r => r && String(r.id) === gid);
    if (!g) return { code: 404, error: GONE_MSG() };
    if (g.state === 'pending') return { code: 409, error: BUSY() };
    let n = 0;
    for (const s of stores) n += s.drop([gid]);
    return { messages: 0, records: n };
  }

  const m = doc.messages.find(x => x && x.id === want);
  if (!m) return { code: 404, error: GONE_MSG() };
  const k = _kindOf(m.kind);
  const thread = doc.messages.filter(x => x && String(x.project || '') === String(m.project || '') && _kindOf(x.kind) === k)
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  const at = thread.indexOf(m);
  const doomed = new Set([m.id]);
  const answersOf = (i) => { const out = []; for (let j = i + 1; j < thread.length && thread[j].role !== 'user'; j++) out.push(thread[j]); return out; };
  if (m.role === 'user') {
    for (const x of answersOf(at)) doomed.add(x.id);
  } else {
    // The turn it answers is the message just before it - every send writes its turn and then its one answer (a card, a
    // clip's answer, the analyst's question). Not "the last turn of the person before it": the turn of an earlier send
    // left hidden in the thread would head the next message drawn after it.
    const t = at - 1;
    if (t >= 0 && thread[t].role === 'user') doomed.add(thread[t].id);
  }
  // The turn a card was written from goes when no card left was written from it.
  for (const x of thread) {
    if (!doomed.has(x.id) || !x.card || !x.card.from) continue;
    const from = String(x.card.from);
    if (!doomed.has(from) && !doc.messages.some(o => o && !doomed.has(o.id) && o.card && String(o.card.from || '') === from)) doomed.add(from);
  }

  const gone = doc.messages.filter(x => x && doomed.has(x.id));
  if (gone.some(x => x.card && x.card.state === 'writing' && WRITING.has(x.card.kick))) return { code: 409, error: BUSY() };
  const ids = new Set();
  for (const x of gone) for (const i of _spokenBy(x)) ids.add(i);
  for (const r of records) if (r && r.send && doomed.has(String(r.send))) ids.add(String(r.id));
  if (records.some(r => r && ids.has(String(r.id)) && r.state === 'pending')) return { code: 409, error: BUSY() };

  // What the messages left still speak for stays.
  const keep = doc.messages.filter(x => !(x && doomed.has(x.id)));
  const spoken = new Set();
  const turns = new Set();
  for (const x of keep) { if (!x) continue; turns.add(x.id); for (const i of _spokenBy(x)) spoken.add(i); }
  const drop = records.filter(r => r && ids.has(String(r.id)) && !spoken.has(String(r.id)) && !(r.send && turns.has(String(r.send))))
    .map(r => String(r.id));
  _write(keep, doc.cleared);
  let n = 0;
  for (const s of stores) n += s.drop(drop);
  return { messages: gone.length, records: n };
}

module.exports = { FILE, read, add, get, update, forget, remove, writingCount, newId: _newId, writing: WRITING,
                   boardsOf, boardReady, boardHome, BOARD_AT_ONCE, threadOf, copyDraftTo, DRAFT, DRAFT_ANSWERS };
