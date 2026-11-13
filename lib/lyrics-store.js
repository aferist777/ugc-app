'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SAVED LYRICS - AUDIO -> Music -> Lyrics: data/lyrics.json, a plain list, newest first.
//
//   { id: 'ly-…', title, text, from: 'suno' | 'own', gen, date }
//     title   one line, at most 120 characters - none given: the text's first line that is not a [tag]
//     text    the lyrics as written ([Verse], [Chorus]… kept), at most 20 000 characters
//     from    'suno' - written by Suno in Generate music's Lyrics; 'own' - written by hand (Custom's "save")
//     gen     the generation record it came from (lib/audio-gens.js), '' for none
//     date    when it was saved
//
//   add({ title, text, from, gen })  a new one - the same `gen` with the same text gives the one saved before
//                                    (`already`), never a second
//   patch(id, { title, text })       renamed or rewritten
//   remove(id)                       at once - nothing else points at a saved text
//
// A text is not a file: nothing on the disk goes with it. Read, changed and written in one tick (no await between),
// atomically. A refusal is an Error with `status` and the reason in words.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'lyrics.json');
const MAX = 5000;            // saved texts
const TITLE_MAX = 120;
const TEXT_MAX = 20000;
const FROM = new Set(['suno', 'own']);

const _err = (status, message) => Object.assign(new Error(message), { status });
const _newId = () => 'ly-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** A title as it is kept: one line, no control characters, spaces squeezed. */
function cleanTitle(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX).trim();
}
/** A text as it is kept: its lines as written, the ends of lines one kind, no blank edges. */
function cleanText(v) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, '').replace(/[ \t]+$/gm, '').trim();
}
/** A title for a text that came with none: its first line that is not a [tag]. */
function titleOf(text) {
  const line = cleanText(text).split('\n').map(s => s.trim()).find(s => s && !/^\[[^\]]*\]$/.test(s)) || '';
  return cleanTitle(line.replace(/^\[[^\]]*\]\s*/, '')).slice(0, 60).trim() || 'Untitled lyrics';
}

// One entry, as the file may hold it - a hand may have written anything.
function _entry(x) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !/^[\w-]{1,60}$/.test(x.id)) return null;
  const text = cleanText(x.text);
  if (!text) return null;
  return {
    id: x.id,
    title: cleanTitle(x.title) || titleOf(text),
    text: text.slice(0, TEXT_MAX),
    from: FROM.has(x.from) ? x.from : 'own',
    gen: String(x.gen || '').slice(0, 80),
    date: String(x.date || ''),
  };
}
function _read() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return []; }
  const seen = new Set();
  const out = [];
  for (const x of (Array.isArray(raw) ? raw : [])) {
    const e = _entry(x);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}
// Newest first.
const _sorted = (list) => list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
function _write(list) {
  writeFileAtomic(FILE, JSON.stringify(_sorted(list), null, 2));
}

/** Every saved text, newest first. */
function list() { return _sorted(_read()); }

function get(id) { return _read().find(x => x.id === String(id || '')) || null; }

/** A new saved text. -> { item, already } */
function add(body) {
  const b = body || {};
  const text = cleanText(b.text);
  if (!text) throw _err(400, 'There is no text to save.');
  if (text.length > TEXT_MAX) throw _err(400, 'The text is too long to save - at most ' + TEXT_MAX + ' characters, it has ' + text.length + '.');
  const from = String(b.from || '');
  if (!FROM.has(from)) throw _err(400, 'Say where the text is from: "suno" or "own".');
  const gen = String(b.gen || '').trim().slice(0, 80);
  const l = _read();
  // The same text of the same press, saved again: the one saved before.
  if (gen) {
    const was = l.find(x => x.gen === gen && x.text === text);
    if (was) return { item: was, already: true };
  }
  if (l.length >= MAX) throw _err(409, 'Music → Lyrics holds ' + MAX + ' texts - delete one to save another.');
  const ids = new Set(l.map(x => x.id));
  let id = _newId();
  while (ids.has(id)) id = _newId();
  const item = { id, title: cleanTitle(b.title) || titleOf(text), text, from, gen, date: new Date().toISOString() };
  l.push(item);
  _write(l);
  return { item, already: false };
}

/** A saved text renamed or rewritten. -> the item */
function patch(id, body) {
  const b = body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  if (!has('title') && !has('text')) throw _err(400, 'Nothing to change - give a title or a text.');
  const l = _read();
  const it = l.find(x => x.id === String(id || ''));
  if (!it) throw _err(404, 'These lyrics are not in Music → Lyrics any more - deleted already?');
  if (has('title')) {
    const t = cleanTitle(b.title);
    if (!t) throw _err(400, 'Give the lyrics a name.');
    it.title = t;
  }
  if (has('text')) {
    const t = cleanText(b.text);
    if (!t) throw _err(400, 'The text cannot be empty - delete the lyrics instead.');
    if (t.length > TEXT_MAX) throw _err(400, 'The text is too long - at most ' + TEXT_MAX + ' characters, it has ' + t.length + '.');
    it.text = t;
  }
  _write(l);
  return it;
}

/** A saved text deleted. -> the item it was */
function remove(id) {
  const l = _read();
  const it = l.find(x => x.id === String(id || ''));
  if (!it) throw _err(404, 'These lyrics are not in Music → Lyrics any more - deleted already?');
  _write(l.filter(x => x !== it));
  return it;
}

module.exports = { FILE, MAX, TEXT_MAX, list, get, add, patch, remove, titleOf, cleanTitle, cleanText };
