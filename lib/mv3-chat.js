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
// So they stay apart and a message POINTS at a generation by id. One fact, one home - which is
// what "one store" was ever about. The drift that would follow from two lists is closed by the
// two rules below, and they are the whole of the coupling:
//
//   * removing a generation removes the message carrying it   (GENS.remove -> dropForGen)
//   * removing a message removes the generation it carries    (remove -> GENS.remove)
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
const GENS = require('./mv3-gens');

const FILE = path.join(DATA_DIR, 'mv3-chat.json');

// Per project. A thread nobody has cleared for a month is not a reason for a file that grows
// without end, and what falls off is the oldest - the part nobody scrolls back to.
const KEEP_PER_PROJECT = 600;

const ROLES = ['user', 'agent'];

// Read-modify-write, synchronously, for the same reason the generations store does it: several
// writes can land in one tick and each one is a whole-file write.
// The file was a plain array of messages and now holds a mark beside them, so both shapes are
// accepted on the way in. An older file simply has nothing cleared, which is true.
function _all() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
  if (Array.isArray(raw)) return { messages: raw, cleared: {} };
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
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

const _newId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * The thread, oldest first - which is the order a conversation is read in, and the opposite of
 * the strip's.
 *
 * Generations with no message of their own are folded in at their own time. `gen` is attached
 * whole rather than by id: the window would ask for it in the next breath anyway, and a thread
 * that needs a second request per picture is a thread that draws in pieces.
 */
// TWO CONVERSATIONS PER PROJECT, one per kind of thing being made. They share this file
// because they are the same object with a different subject, and they are kept apart because
// they are not the same conversation: "the same but at night" said about a picture means
// nothing in a thread about clips.
//
// An old message has no kind at all, and that is read as 'image' - which is what every message
// written before this existed was about.
const KINDS = { image: () => GENS, video: () => require('./mv3-vgens') };
const _kindOf = (v) => (KINDS[String(v || '')] ? String(v) : 'image');

function read(project, kind) {
  const p = String(project == null ? '' : project);
  const k = _kindOf(kind);
  const msgs = _read().filter(m => m && String(m.project || '') === p && _kindOf(m.kind) === k);
  const gens = KINDS[k]().list(p);
  const byId = {};
  for (const g of gens) byId[g.id] = g;

  const spoken = new Set(msgs.map(m => m.genId).filter(Boolean));
  const out = msgs.map(m => Object.assign({}, m, { gen: m.genId ? (byId[m.genId] || null) : null }));

  // Anything made outside this thread - before it existed, or by another way in - shows as its
  // own turn rather than not at all.
  //
  // Unless the thread was CLEARED after it was made. Clearing is a request for a clean slate,
  // and folding the same pictures straight back in would answer it with three quarters of what
  // was there before. Nothing is lost by leaving them out: they are on the strip to the right
  // and on the library shelf, which is exactly why clearing is safe to offer at all.
  const since = _all().cleared[p + '|' + k] || _all().cleared[p] || '';
  for (const g of gens) {
    if (spoken.has(g.id)) continue;
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
    id: _newId(),
    project: String(opts.project == null ? '' : opts.project),
    kind: _kindOf(opts.kind),
    role: ROLES.includes(opts.role) ? opts.role : 'user',
    text: String(opts.text || '').slice(0, 20000),
    // The local paths of what was attached, in the order they were attached - which is the order
    // the numbers written on them refer to.
    refs: (Array.isArray(opts.refs) ? opts.refs : []).map(String).filter(Boolean).slice(0, 14),
    genId: String(opts.genId || ''),
    // What was actually sent to the model, when that is not what was typed. Kept so "read more"
    // can show it: a rewrite nobody can see is a rewrite nobody can debug.
    sent: String(opts.sent || '').slice(0, 20000),
    at: new Date().toISOString(),
  };
  const list = _read();
  list.push(rec);
  _write(list);
  _trim(rec.project);
  return rec;
}

function _trim(project) {
  const all = _read();
  const mine = all.filter(m => m && String(m.project || '') === String(project || ''));
  if (mine.length <= KEEP_PER_PROJECT) return;
  const doomed = new Set(mine
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(0, mine.length - KEEP_PER_PROJECT).map(m => m.id));
  _write(all.filter(m => !doomed.has(m.id)));
}

/**
 * One turn out of the thread. A message carrying a picture takes the picture with it - leaving
 * a generation nothing points at would put it back in the thread on the next read as a loose
 * one, which is the opposite of what removing it was for.
 */
function remove(id) {
  const wanted = String(id || '');
  // A loose generation is addressed by the id read() gave it.
  if (wanted.startsWith('g:')) return GENS.remove(wanted.slice(2));

  const list = _read();
  const rec = list.find(m => m && m.id === wanted);
  if (!rec) return false;
  _write(list.filter(m => m && m.id !== wanted));
  if (rec.genId) { try { GENS.remove(rec.genId); } catch (e) {} }
  return true;
}

// The other half of the coupling: a picture taken off the strip takes its turn in the thread
// with it. Called by GENS.remove, which is why this takes an id and says nothing back.
function dropForGen(genId) {
  const id = String(genId || '');
  if (!id) return;
  const list = _read();
  const keep = list.filter(m => !(m && m.genId === id));
  if (keep.length !== list.length) _write(keep);
}

/**
 * Nothing left of a project's conversation. The pictures are the generations' to remove, and
 * they are not removed: they stay on the strip and on the library shelf.
 *
 * The moment is written down as well as the messages being dropped, because a picture made
 * before now has no turn of its own any more and read() would otherwise fold it straight back
 * in - which is not what anybody means by clearing.
 */
// One conversation, not both: clearing what was said about pictures is no reason to lose what
// was said about clips. The mark is per project AND kind for the same reason - it is what stops
// generations of that kind folding straight back in.
function clear(project, kind) {
  const p = String(project == null ? '' : project);
  const k = _kindOf(kind);
  const all = _all();
  const keep = all.messages.filter(m => !(String(m.project || '') === p && _kindOf(m.kind) === k));
  const cleared = Object.assign({}, all.cleared, { [p + '|' + k]: new Date().toISOString() });
  _write(keep, cleared);
  return all.messages.length - keep.length;
}

module.exports = { FILE, read, add, remove, clear, dropForGen };
