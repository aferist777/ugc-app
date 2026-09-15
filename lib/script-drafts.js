'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SCRIPT DRAFTS — a script that is being written, between visits.
//
// Writing one takes four model calls and a read-through, and until now all of that lived in a
// dialog: closing it threw away the hooks you had chosen and the paragraphs you had edited.
// A draft is that work, kept, so an unfinished script can be picked up and finished.
//
// SERVER-SIDE, not localStorage. Everything in this app that is work rather than view state
// lives on the server - the same rule that put the Merge timeline there - and a draft is work:
// it cost four generations.
//
// A draft is DELETED when it becomes a scenario. Keeping both would leave two records claiming
// to be the same script, and the next question is which one is real. Discarding by hand is the
// other way out, and there is no third: a draft nobody finishes is one row in a list, which is
// cheaper than a rule that decides when your unfinished work expires.
//
// Keyed by source+topic when there is one, so returning to that topic finds its draft rather
// than starting a second. Writing without a source gets a plain id: there is nothing to key on,
// and two free-form drafts about different things are two drafts.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const FILE = path.join(require('./config').DATA_DIR, 'script-drafts.json');

const _now = () => new Date().toISOString();

function _read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(d.drafts) ? d.drafts : [];
  } catch (e) { return []; }
}

function _write(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ drafts: list }, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

const newId = () => 'dr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Which stage the work has reached, derived rather than stored: a stored stage and the fields it
// describes drift apart the first time one of them is written without the other.
function stageOf(d) {
  if ((d.paragraphs || []).length) return 'script';
  if ((d.hooks || []).length || d.hook) return 'hook';
  return 'topic';
}

const STAGE_LABEL = { topic: 'topic only', hook: 'hook chosen', script: 'script written' };

function _norm(d, now) {
  const s = d || {};
  return {
    id: String(s.id || newId()),
    // Where it is being written from. Empty for a free-form draft.
    sourceId: String(s.sourceId || ''),
    sourceTitle: String(s.sourceTitle || ''),
    topicId: String(s.topicId || ''),
    topicTitle: String(s.topicTitle || ''),
    // What the writer has decided so far.
    topic: String(s.topic || ''),
    hook: String(s.hook || ''),
    hooks: Array.isArray(s.hooks) ? s.hooks.map(h => ({
      kind: String((h && h.kind) || ''), text: String((h && h.text) || ''),
    })).filter(h => h.text) : [],
    paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs.map(p => String(p || '')) : [],
    title: String(s.title || ''),
    humanized: !!s.humanized,
    // The dropdowns, so reopening a draft reopens the settings it was written with - a script
    // continued at a different effort or in another voice is a different script.
    settings: {
      language: String((s.settings || {}).language || ''),
      tone: String((s.settings || {}).tone || ''),
      scenes: parseInt((s.settings || {}).scenes, 10) || 0,
      narratorId: String((s.settings || {}).narratorId || ''),
      narratorName: String((s.settings || {}).narratorName || ''),
      // Which reading of that narrator was pinned, if one was. Empty means "any", which is the
      // default - and a draft reopened with a different reading is a different script.
      readingIndex: String((s.settings || {}).readingIndex || ''),
      provider: String((s.settings || {}).provider || ''),
      model: String((s.settings || {}).model || ''),
      effort: String((s.settings || {}).effort || ''),
    },
    // The save form, kept for the same reason.
    save: {
      gender: String((s.save || {}).gender || ''),
      vertical: String((s.save || {}).vertical || ''),
      product: String((s.save || {}).product || ''),
    },
    createdAt: s.createdAt || now,
    updatedAt: now,
  };
}

function list() { return _read(); }

function get(id) {
  return _read().find(d => String(d.id) === String(id)) || null;
}

function summary(d) {
  return {
    id: d.id,
    sourceId: d.sourceId, sourceTitle: d.sourceTitle,
    topicId: d.topicId, topicTitle: d.topicTitle,
    topic: d.topic,
    title: d.title,
    stage: stageOf(d),
    stageLabel: STAGE_LABEL[stageOf(d)] || '',
    hooks: (d.hooks || []).length,
    paragraphs: (d.paragraphs || []).length,
    narratorName: (d.settings || {}).narratorName || '',
    createdAt: d.createdAt, updatedAt: d.updatedAt,
  };
}

function summaries() {
  return _read()
    .map(summary)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

// One writer for both cases: an id updates in place, a source+topic finds its own draft, and
// anything else is new. Called on every stage, so it must never create a second row for work
// that already has one.
function save(patch) {
  const list_ = _read();
  const now = _now();
  let i = -1;
  if (patch && patch.id) i = list_.findIndex(d => String(d.id) === String(patch.id));
  if (i < 0 && patch && patch.sourceId && patch.topicId) {
    i = list_.findIndex(d => String(d.sourceId) === String(patch.sourceId)
      && String(d.topicId) === String(patch.topicId));
  }
  if (i >= 0) {
    const merged = _norm({ ...list_[i], ...patch, id: list_[i].id, createdAt: list_[i].createdAt }, now);
    list_[i] = merged;
    _write(list_);
    return merged;
  }
  const rec = _norm({ ...patch, id: (patch && patch.id) || newId(), createdAt: now }, now);
  list_.unshift(rec);
  _write(list_);
  return rec;
}

function remove(id) {
  const list_ = _read();
  const next = list_.filter(d => String(d.id) !== String(id));
  if (next.length === list_.length) return false;
  _write(next);
  return true;
}

// Called when a draft becomes a scenario. By source+topic as well as by id, because the page may
// have saved from a draft it reopened rather than one it created.
function removeFor({ id, sourceId, topicId } = {}) {
  const list_ = _read();
  const next = list_.filter(d => {
    if (id && String(d.id) === String(id)) return false;
    if (sourceId && topicId && String(d.sourceId) === String(sourceId)
      && String(d.topicId) === String(topicId)) return false;
    return true;
  });
  const gone = list_.length - next.length;
  if (gone) _write(next);
  return gone;
}

module.exports = {
  FILE, newId, stageOf, STAGE_LABEL,
  list, get, summary, summaries,
  save, remove, removeFor, 
};
