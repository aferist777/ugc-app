'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SCENARIOS V3 — scenario library store (talking head only).
//
// Deliberately standalone: this module owns its own JSON store and its own record
// shape, which is why the old scenarios backend could be deleted without touching v3.
//
// Record — nothing else is stored:
//   { id, title, lines:[{text}], type:'talking_head', vertical, product, roles,
//     createdAt, updatedAt }
//
// lineCount is DERIVED from lines.length on read, never stored, so it cannot
// drift away from the actual content. There is one text track per line (no
// clean/colored split — that was the v2 model).
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const sharp   = require('sharp');
// A picture brought in, in a format the aggregators take (phase V24).
const IMGIN   = require('../lib/image-in');

const router = express.Router();
// Who may change a project - the same rule Merge timelines answer to.
const OWN = require('../lib/ownership');

// Only engine offered for now. NOTE: lib/helpers' "…Pro…" helpers are legacy
// NAMES — they all post to Replicate 'google/nano-banana-2', so nothing here
// runs a pro model.
const DEFAULT_ENGINE = 'nano-banana-2';

const { DATA_DIR } = require('../lib/config');
const FILE     = path.join(DATA_DIR, 'scen3-scenarios.json');
const OPT_FILE = path.join(DATA_DIR, 'scen3-options.json');
// Projects are folders (lib/projects-store.js): data/project-list.json names them, and
// projects/<folder>/project.json is each one, beside its voice/, frames/ and clips/.
const PROJECTS = require('../lib/projects-store');

// Minimum usable scenario length, enforced on both ends (the client greys out
// Save below this, the server refuses it). Three: fewer than that is a note, not an ad,
// and five turned out to refuse scenarios the owner actually wanted.
const MIN_LINES = 3;
// The narrator's gender when the scenario states one. It is OPTIONAL: it narrows the
// character picker, and a scenario that does not say offers every character instead
// (filterByGender in the casting). Refusing to save without it bought nothing.
const GENDERS = ['male', 'female'];

function _read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function _save(list) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  writeFileAtomic(FILE, JSON.stringify(list, null, 2));
}

// Coerce any incoming (or legacy) record into the v3 shape. Line COUNT is
// preserved exactly — empty lines are kept, because a user who clears a line to
// retype it must not have that row vanish under them mid-edit.
function _norm(r, now) {
  const src = r || {};
  return {
    id:        String(src.id != null ? src.id : Date.now()),
    title:     String(src.title || '').trim() || 'untitled',
    lines:     Array.isArray(src.lines)
      ? src.lines.map(l => ({ text: String((l && l.text) || '') }))   // single track: any legacy textColored is dropped
      : [],
    // What kind of scenario (phase F7: a field and a filter, editable in the Library). Only
    // talking_head exists so far (the owner, 2026-09-30); whatever a record carries is kept.
    type:      String(src.type || '').trim() || 'talking_head',
    // Out of the way, not gone: a scenario that has been used and is not wanted in the list
    // any more is archived rather than deleted, because deleting it is the one thing that
    // cannot be taken back. The list hides these and one filter shows only them.
    archived:  !!src.archived,
    vertical:  String(src.vertical || ''),
    product:   String(src.product  || ''),
    roles:     Array.isArray(src.roles) ? src.roles.map(x => ({
      id:     String((x && x.id)     || ''),
      name:   String((x && x.name)   || ''),
      gender: String((x && x.gender) || ''),
    })) : [],
    // WHERE THIS SCENARIO CAME FROM, when it was generated rather than typed. Kept because
    // this normaliser drops anything it does not name, so without a home here the answer to
    // "which video was this written from, in whose voice" is lost on the first autosave.
    // Null for everything written by hand, which is every scenario that existed before
    // generation did.
    origin:    _normOrigin(src.origin),
    // THE SCENARIO'S OWN LABEL (phase F7): the narrator - the voice of the WRITING, not the reader's
    // gender, which lives on the role. `origin` says what the generator used and stays provenance; this
    // says what the scenario is, editable, and a generated one shows its origin's narrator until it is
    // set. null = never set (the origin shows through); an empty name = set to none on purpose. There is
    // no language: every scenario is English (phase V29), and a `language` an older record carries is
    // dropped here like any field this normaliser does not name.
    narrator:  _normNarrator(src.narrator),
    createdAt: src.createdAt || now,
    updatedAt: src.updatedAt || now,
  };
}

function _normNarrator(n) {
  if (n == null || typeof n !== 'object') return null;
  return { id: String(n.id || ''), name: String(n.name || '').trim() };
}

// What a scenario's narrator IS: its own when set, otherwise what the generator wrote it with. Read by
// the list, the Library shelf and its filters.
function effectiveLabels(s) {
  const o = (s && s.origin) || {};
  const nar = s && s.narrator
    ? (s.narrator.name ? { id: s.narrator.id || '', name: s.narrator.name } : null)
    : (o.narratorName ? { id: o.narratorId || '', name: o.narratorName } : null);
  return { narrator: nar };
}

function _normOrigin(o) {
  const s = (o && typeof o === 'object') ? o : null;
  if (!s) return null;
  const out = {
    sourceId:   String(s.sourceId   || ''),
    sourceTitle: String(s.sourceTitle || ''),
    topicId:    String(s.topicId    || ''),
    topicTitle: String(s.topicTitle || ''),
    narratorId: String(s.narratorId || ''),
    narratorName: String(s.narratorName || ''),
    // The hook is the one line the whole script had to deliver on, so it is worth keeping
    // beside the result: reading them together is how you tell a script that kept its promise
    // from one that wandered.
    hook:       String(s.hook       || ''),
    tone:       String(s.tone       || ''),
    provider:   String(s.provider   || ''),
    model:      String(s.model      || ''),
    // (phase V38) A scenario of the shelf it was rewritten from, in a narrator's voice.
    fromId:     String(s.fromId     || ''),
    fromTitle:  String(s.fromTitle  || ''),
    at:         String(s.at || ''),
  };
  // An object of empty strings is not provenance.
  return Object.values(out).some(v => v && v !== false) ? out : null;
}

// The store is its own from here on. It used to seed itself from the v2 file on first
// boot; that file is gone (Ph13.5) and its four scenarios have lived here since.
function _load() {
  const cur = _read(FILE);
  if (Array.isArray(cur)) return cur;
  _save([]);
  return [];
}

// Timestamp ids can collide when two writes land in the same millisecond.
function _newId(list) {
  let id = Date.now();
  while (list.some(x => String(x.id) === String(id))) id++;
  return String(id);
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED OPTION LISTS — vertical / product / role
//
// These are remembered across scenarios: whatever the user types into one of
// those three fields is HARVESTED into the shared list when the scenario is
// saved, and offered in that field's dropdown from then on. Removing a value
// (/scen3/values/remove, phase G4) takes it off the scenarios as well - the
// dropdowns are built from the scenarios too, so a value left on one of them
// would come straight back.
// ════════════════════════════════════════════════════════════════════════════

function _saveOptions(o) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  writeFileAtomic(OPT_FILE, JSON.stringify(o, null, 2));
}

// Case-insensitive append; keeps the first spelling it saw. True when it added.
function _pushUniq(arr, value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (arr.some(x => String(x).trim().toLowerCase() === v.toLowerCase())) return false;
  arr.push(v);
  return true;
}

function _loadOptions() {
  const cur = _read(OPT_FILE);
  if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
    return {
      verticals: Array.isArray(cur.verticals) ? cur.verticals : [],
      products:  Array.isArray(cur.products)  ? cur.products  : [],
      roles:     Array.isArray(cur.roles)     ? cur.roles     : [],
    };
  }
  // First boot: derive the suggestions from whatever the migrated scenarios
  // already carry, so the dropdowns are not empty on day one.
  const seeded = { verticals: [], products: [], roles: [] };
  try {
    _load().forEach(s => {
      _pushUniq(seeded.verticals, s.vertical);
      _pushUniq(seeded.products,  s.product);
      (s.roles || []).forEach(r => _pushUniq(seeded.roles, r && r.name));
    });
  } catch (e) {}
  _saveOptions(seeded);
  return seeded;
}

const _sorted = o => ({
  verticals: o.verticals.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
  products:  o.products .slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
  roles:     o.roles    .slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
});

function _harvest(rec) {
  const o = _loadOptions();
  let changed = false;
  if (_pushUniq(o.verticals, rec.vertical)) changed = true;
  if (_pushUniq(o.products,  rec.product))  changed = true;
  (rec.roles || []).forEach(r => { if (_pushUniq(o.roles, r && r.name)) changed = true; });
  if (changed) _saveOptions(o);
}

router.get('/scen3/options', (_req, res) => {
  try { res.json({ success: true, options: _sorted(_loadOptions()) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// REMOVING A VALUE (phase G4, the owner 2026-09-30: "I added a wrong offer - it has to go somehow"). A value
// of type, role, vertical or product leaves the suggestions AND every scenario that carries it, archived
// ones included: the column's dropdowns and the filters are built from the scenarios themselves, so a value
// left on one would come straight back. Type falls back to talking_head (which itself cannot be removed),
// a role keeps its gender and loses its name. updatedAt is left alone - this tidies a vocabulary, it does
// not edit a script. The generator's drafts lose it from their save form too. Body: { field, value, dry } -
// dry only counts, for the question the page asks before the second press.
const VALUE_FIELDS = { type: '', role: 'roles', vertical: 'verticals', product: 'products' };
const DEFAULT_TYPE = 'talking_head';
router.post('/scen3/values/remove', (req, res) => {
  const b = req.body || {};
  const field = String(b.field || '');
  const value = String(b.value || '').trim();
  if (!Object.prototype.hasOwnProperty.call(VALUE_FIELDS, field)) {
    return res.status(400).json({ success: false, error: 'only a type, role, vertical or product can be removed' });
  }
  if (!value) return res.status(400).json({ success: false, error: 'which value?' });
  const same = (v) => String(v || '').trim().toLowerCase() === value.toLowerCase();
  if (field === 'type' && same(DEFAULT_TYPE)) {
    return res.status(400).json({ success: false, error: DEFAULT_TYPE + ' is the type every scenario falls back to - it stays' });
  }
  try {
    const list = _load();
    const has = (s) => field === 'role' ? (s.roles || []).some(r => r && same(r.name)) : same(s[field]);
    const hit = list.filter(s => s && has(s));
    const archived = hit.filter(s => s.archived).length;
    if (b.dry) return res.json({ success: true, count: hit.length, archived });
    if (hit.length) {
      _save(list.map(s => {
        if (!s || !has(s)) return s;
        if (field === 'role') return { ...s, roles: s.roles.map(r => (r && same(r.name) ? { ...r, name: '' } : r)) };
        if (field === 'type') return { ...s, type: DEFAULT_TYPE };
        return { ...s, [field]: '' };
      }));
    }
    const key = VALUE_FIELDS[field];
    if (key) {
      const o = _loadOptions();
      const kept = o[key].filter(v => !same(v));
      if (kept.length !== o[key].length) _saveOptions({ ...o, [key]: kept });
    }
    const drafts = (field === 'vertical' || field === 'product') ? require('../lib/script-drafts').clearSaveValue(field, value) : 0;
    res.json({ success: true, count: hit.length, archived, ids: hit.map(s => String(s.id)), drafts });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The narrator's gender lives on the single role entry (one presenter).
const _genderOf = s => String(((s.roles || [])[0] || {}).gender || '').toLowerCase();

// SAVED OR GENERATED is decided by one thing: whether it carries provenance. A scenario written or
// pasted by hand has none; one the Library's generator wrote (js/library/make.js, routes/scriptgen.js)
// records what it was written from and in whose voice. One store read two ways, which is why a
// generated scenario can still be edited like any other.
const _libOf = s => (s.origin ? 'library2' : 'library1');

// THE SOURCE IS NAMED BY ITS CURRENT TITLE (phase F2, the owner 2026-09-30: renaming a source
// changes "written from"): the copy saved in `origin` is what it was called at the save, and is
// kept for a source since deleted - then marked `sourceGone`. Read, never rewritten: a rename
// writes nothing into the scenarios.
function _sourceTitles() {
  try {
    return new Map(require('../lib/sources-store').list().map(x => [String(x.id), x.title || x.originalName || '']));
  } catch (e) { return null; }
}
function _liveOrigin(o, titles) {
  if (!o || !o.sourceId) return o || null;
  const map = titles || _sourceTitles();
  if (!map) return o;
  const id = String(o.sourceId);
  return map.has(id) ? { ...o, sourceTitle: map.get(id), sourceGone: false } : { ...o, sourceGone: true };
}

const _summary = (s, titles) => ({
  id: s.id, title: s.title, type: s.type,
  vertical: s.vertical, product: s.product, roles: s.roles, archived: !!s.archived,
  gender: _genderOf(s),
  lib: _libOf(s),
  narrator: effectiveLabels(s).narrator,
  // The source it was written from, by id (phase E7): Merge groups the generated ones by it. By id,
  // not by title - the title here is a snapshot, and renaming a source must not split its group.
  sourceId: (s.origin && s.origin.sourceId) || '',
  // Enough of the provenance for a row to say where it came from, without the hook and the
  // model ids a list has no use for.
  origin: s.origin ? {
    narratorName: s.origin.narratorName || '',
    sourceTitle: (_liveOrigin(s.origin, titles) || {}).sourceTitle || '',
    topicTitle: s.origin.topicTitle || '',
  } : null,
  lineCount: (s.lines || []).length,
  createdAt: s.createdAt, updatedAt: s.updatedAt,
});
// The full record carries the WHOLE provenance, not the three fields a list row needs: opening
// one scenario is exactly when the hook, the tone and the model become worth reading.
const _full = s => {
  const titles = _sourceTitles();
  return { ..._summary(s, titles), lines: s.lines || [], origin: _liveOrigin(s.origin, titles) };
};

// The generated scenarios by the source they came from (phase E7), newest group first: its id, the
// name to show - the source's CURRENT title, or the last one a scenario remembers when the source is
// gone, or "deleted source" - and how many. Written without a source is its own count.
function _bySource(live) {
  let titles = new Map();
  try { titles = new Map(require('../lib/sources-store').list().map(x => [String(x.id), x.title || x.originalName || ''])); }
  catch (e) { /* the names are decoration; the groups stand without them */ }
  const groups = new Map();
  let noSource = 0;
  for (const s of live) {
    if (!s.origin) continue;
    const id = String(s.origin.sourceId || '');
    if (!id) { noSource++; continue; }
    const g = groups.get(id) || { id, title: '', n: 0, last: '', gone: !titles.has(id) };
    g.n++;
    const at = String(s.createdAt || s.updatedAt || '');
    if (at >= g.last) { g.last = at; if (g.gone && s.origin.sourceTitle) g.title = s.origin.sourceTitle; }
    groups.set(id, g);
  }
  const sources = [...groups.values()]
    .map(g => ({ id: g.id, title: g.gone ? (g.title || 'deleted source') : (titles.get(g.id) || g.title || 'untitled source'), n: g.n, gone: g.gone, last: g.last }))
    .sort((a, b) => b.last.localeCompare(a.last))
    .map(({ last, ...g }) => g);
  return { sources, noSource };
}

// ── List: summaries only, most recently edited first ────────────────────────
// ?lib=library1 narrows the list to the saved (hand-written) ones, ?lib=archive to the archived; ?source=<id>
// to the ones written from one source, ?source=none to the ones generated without a source.
// Filtered HERE rather than in each page, so the callers cannot disagree about what "generated"
// means - the answer is "it has provenance", and only this file knows that.
//
// The counts come back either way: a picker that cannot say how many are on the other side is a
// picker you have to click to understand.
router.get('/scen3/scenarios', (req, res) => {
  try {
    const all = _load().slice()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    // Archived ones are not part of "all": the point of archiving is that the list stops
    // showing them. They come back only when they are what was asked for.
    const live = all.filter(s => !s.archived);
    const asked = String((req.query && req.query.lib) || '').trim();
    // Only a name we know narrows anything; anything else means all, and the answer says `all`
    // rather than echoing a filter that was not applied.
    const want = ['library1', 'archive'].includes(asked) ? asked : '';
    const source = want ? '' : String((req.query && req.query.source) || '').trim();
    const list = want === 'archive' ? all.filter(s => s.archived)
      : want ? live.filter(s => _libOf(s) === want)
      : source === 'none' ? live.filter(s => s.origin && !s.origin.sourceId)
      : source ? live.filter(s => s.origin && String(s.origin.sourceId || '') === source)
      : live;
    const groups = _bySource(live);
    res.json({
      success: true,
      scenarios: (() => { const titles = _sourceTitles(); return list.map(s => _summary(s, titles)); })(),
      lib: want || 'all',
      source,
      counts: {
        library1: live.filter(s => _libOf(s) === 'library1').length,
        library2: live.filter(s => _libOf(s) === 'library2').length,
        all: live.length,
        archive: all.length - live.length,
        sources: groups.sources,
        noSource: groups.noSource,
      },
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── One scenario, with its lines ────────────────────────────────────────────
router.get('/scen3/scenarios/:id', (req, res) => {
  try {
    const s = _load().find(x => String(x.id) === String(req.params.id));
    if (!s) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, scenario: _full(s) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// (phase V29, the owner 2026-10-14: "набранное переводится") Lines typed in another language, made English before they
// are kept - the scenario window's save, the Library column's lines when they are left, a talking head made from a
// scenario, a line of one edited or put in, the generator's save. { texts, translated } or { fail } in words.
async function _englishLines(texts) {
  try { return await AGENT.toEnglishLines(texts); } catch (e) { return { fail: 'the lines could not be translated: ' + e.message }; }
}
// The same for ONE prompt typed in a field - a fragment's Seedance prompt, a line's motion, a place's "how it moves", a
// dressing note: English goes as typed, another language is translated (quoted words too). { text } or { fail }.
async function _englishText(text) {
  const t = String(text || '').trim();
  if (!t || AGENT.english(t)) return { text: t };
  try { return await AGENT.toEnglish(t); } catch (e) { return { fail: 'it could not be translated: ' + e.message }; }
}

// ── Upsert by id: creates when the id is unknown, else saves edits in place ──
// This is what line edits and renames hit (autosaved, no Save button). `english` (phase V29): the lines are made English
// first - sent by a save the person made on purpose, never by the autosave while they type, which would put the
// translation in the field under their hands.
router.post('/scen3/scenarios', async (req, res) => {
  try {
    const { edit, english, ...b } = req.body || {};
    if (english && Array.isArray(b.lines)) {
      const texts = b.lines.map(l => String((l && typeof l === 'object' ? l.text : l) || ''));
      const t = await _englishLines(texts);
      if (t.fail) return res.status(502).json({ success: false, error: t.fail });
      if (t.translated) b.lines = b.lines.map((l, i) => ({ ...(l && typeof l === 'object' ? l : {}), text: t.texts[i] }));
    }
    const now  = new Date().toISOString();
    const list = _load();
    const i    = b.id != null ? list.findIndex(x => String(x.id) === String(b.id)) : -1;
    // An EDIT of a scenario that is gone is not a creation: the Library's column sends only the
    // lines, and a scenario made from them would have lost its roles and where it came from.
    if (edit && i < 0) return res.status(404).json({ success: false, error: 'this scenario no longer exists' });

    if (i >= 0) {
      // keep the original id + createdAt; the request may only carry changed fields
      const merged = _norm({ ...list[i], ...b, id: list[i].id, createdAt: list[i].createdAt }, now);
      // Going INTO the archive is not an edit and keeps the date; coming back is news and gets a new
      // one, so the scenario heads the list again (phase I1, the owner 2026-10-01).
      const sent = Object.keys(b).filter(k => k !== 'id');
      const outOnly = sent.length === 1 && sent[0] === 'archived' && b.archived === true;
      merged.updatedAt = outOnly ? (list[i].updatedAt || now) : now;
      list[i] = merged;
      _save(list);
      _harvest(merged);
      return res.json({ success: true, scenario: _full(merged) });
    }

    // CREATION is gated: a new scenario needs a title and at least MIN_LINES
    // lines. Edits are not gated, so clearing the title field mid-typing can
    // never make an autosave fail (_norm falls back to "untitled").
    const rec = _norm({ ...b, id: b.id || _newId(list), createdAt: now, updatedAt: now }, now);
    if (!String(b.title || '').trim()) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }
    const filled = rec.lines.filter(l => l.text.trim()).length;
    if (filled < MIN_LINES) {
      return res.status(400).json({ success: false, error: `at least ${MIN_LINES} lines are required (got ${filled})` });
    }
    list.unshift(rec);
    _save(list);
    _harvest(rec);
    res.json({ success: true, scenario: _full(rec) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Creating a scenario from inside the server, for routes/scriptgen.js. The SAME gates and the
// same normaliser as the endpoint above: a title and at least MIN_LINES filled lines. Exported
// rather than duplicated because a second writer would be a second
// opinion about what a scenario is - and rather than reached over HTTP, because a request from
// this process to this process is only a new way for it to fail.
router.createScenario = function createScenario(body) {
  const b = body || {};
  const now = new Date().toISOString();
  const list = _load();
  const rec = _norm({ ...b, id: _newId(list), createdAt: now, updatedAt: now }, now);
  if (!String(b.title || '').trim()) throw new Error('title is required');
  const filled = rec.lines.filter(l => l.text.trim()).length;
  if (filled < MIN_LINES) throw new Error(`at least ${MIN_LINES} lines are required (got ${filled})`);
  list.unshift(rec);
  _save(list);
  _harvest(rec);
  return _full(rec);
};
router.MIN_LINES = MIN_LINES;
router.effectiveLabels = effectiveLabels;
// (phase V38, block D4) One scenario as the page reads it - the generator makes a draft of it to rewrite in a narrator's voice.
router.getScenario = function getScenario(id) {
  const s = _load().find(x => String(x.id) === String(id));
  return s ? _full(s) : null;
};

// THE SUGGESTION LISTS REBUILT FROM WHAT SCENARIOS USE, once per library (phase F7, the owner
// 2026-09-30: "delete all the junk you find"). Typed-and-abandoned values ("fesdfsd", "dsfsdfds")
// go; values scenarios carry but the lists lacked ("history", "social") come in. The old file is
// kept in backups/, and a mark in cache/ stops it running twice.
function _rebuildOptionsOnce() {
  const CFGX = require('../lib/config');
  const mark = require('path').join(CFGX.CACHE_DIR, 'scen3-options-rebuilt.json');
  if (fs.existsSync(mark)) return;
  // Only a store that could be READ drives this one-time rewrite: an unreadable file is not "no
  // scenarios", and rebuilding from it would empty the lists for good.
  const list = _read(FILE);
  if (!Array.isArray(list)) return;
  const was = _read(OPT_FILE);
  const used = { verticals: [], products: [], roles: [] };
  for (const s of list) {
    _pushUniq(used.verticals, s.vertical);
    _pushUniq(used.products, s.product);
    (s.roles || []).forEach(r => _pushUniq(used.roles, r && r.name));
  }
  const gone = [];
  if (was && typeof was === 'object') {
    for (const k of ['verticals', 'products', 'roles']) {
      for (const v of (Array.isArray(was[k]) ? was[k] : [])) {
        if (!used[k].some(x => String(x).toLowerCase() === String(v).trim().toLowerCase())) gone.push(k + ': ' + v);
      }
    }
    const day = new Date().toISOString().slice(0, 10);
    const dir = require('path').join(CFGX.BACKUPS_DIR, day + ' options');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(OPT_FILE, require('path').join(dir, 'scen3-options.json'));
  }
  _saveOptions(used);
  fs.mkdirSync(CFGX.CACHE_DIR, { recursive: true });
  writeFileAtomic(mark, JSON.stringify({ at: new Date().toISOString(), removed: gone }, null, 2));
  if (gone.length) console.log('[scen3] suggestion lists rebuilt from the scenarios; removed: ' + gone.join(', '));
}
try { _rebuildOptionsOnce(); } catch (e) { console.warn('[scen3] could not rebuild the suggestion lists:', e.message); }

// A source about to be deleted leaves its CURRENT name in the scenarios written from it (phase F2):
// the name is read live while the source exists, and once it is gone this copy is all there is.
// Their edit dates are left alone - the lists sort by them, and nobody edited anything.
router.keepSourceTitle = function keepSourceTitle(sourceId, title) {
  if (!sourceId || !title) return 0;
  const list = _load();
  let n = 0;
  for (const s of list) {
    if (s && s.origin && String(s.origin.sourceId) === String(sourceId) && s.origin.sourceTitle !== title) {
      s.origin = { ...s.origin, sourceTitle: title };
      n++;
    }
  }
  if (n) _save(list);
  return n;
};
router.GENDERS = GENDERS;


// ── Delete one scenario (single id only, never a bulk wipe) ─────────────────
// A scenario the generator wrote from a source's topic is one of that topic's "written" marks
// (routes/scriptgen.js, save). The mark goes with it (phase D5): the topic would otherwise go on
// counting a script that no longer exists. A mark that cannot be taken off does not stop the delete.
function _unmarkTopic(s) {
  const o = s && s.origin;
  if (!o || !o.sourceId || !o.topicId) return;
  try {
    const SOURCES = require('../lib/sources-store');
    const rec = SOURCES.get(o.sourceId);
    const topics = (rec && Array.isArray(rec.topics)) ? rec.topics : [];
    const i = topics.findIndex(t => String(t.id) === String(o.topicId));
    if (i < 0 || !Array.isArray(topics[i].usedBy)) return;
    const used = topics[i].usedBy.filter(u => String((u && u.id) || '') !== String(s.id));
    if (used.length === topics[i].usedBy.length) return;
    const next = topics.slice();
    next[i] = { ...topics[i], usedBy: used };
    SOURCES.update(o.sourceId, { topics: next });
  } catch (e) { console.warn('[scen3] could not take the written mark off its topic:', e.message); }
}

router.delete('/scen3/scenarios/:id', (req, res) => {
  try {
    const list = _load();
    const gone = list.find(x => String(x.id) === String(req.params.id));
    if (!gone) return res.status(404).json({ success: false, error: 'not found' });
    _save(list.filter(x => x !== gone));
    _unmarkTopic(gone);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// PREVIEW TIER
//
// Three sizes exist per asset:
//   thumbs/<name>.jpg   600px  — grids and cards (lib/helpers.js createThumbnail)
//   preview/<name>.jpg  2048px — the popup's centre image (lib/thumbs.js PREVIEW)
//   <name>.jpg          full 4K — only ever loaded on purpose
//
// A still no bigger than a preview is its own. Built on demand and cached on disk, so
// assets that existed before this tier get one the first time they are viewed. Dressing
// results have theirs written right after generation. The route keeps its old name.
// ════════════════════════════════════════════════════════════════════════════

const CFG = require('../lib/config');
const { toDiskWithin, toDiskExisting, toUrl } = require('../lib/media');
// The mannequins ship with the program, under the static root; everything else is the library's media.
const POSES_DIR = path.join(CFG.PUBLIC_DIR, 'poses');

// Map a public URL to an absolute file, refusing anything outside the library's media and
// project folders and the shipped mannequins (so a crafted ../ path cannot reach anything else).
// `exts` defaults to stills, which is what every caller but the lipsync render wants —
// that one also has to hand over an mp3, and widening the default would quietly let any
// file type through the other paths.
const MEDIA_IMG = /\.(jpg|jpeg|png|webp)$/i;
function _resolveMedia(urlPath, exts) {
  const roots = [CFG.MEDIA_DIR, CFG.PROJECTS_DIR, POSES_DIR];
  const abs = toDiskWithin(String(urlPath || '').split('?')[0], roots);
  if (!abs) return null;
  if (!(exts || MEDIA_IMG).test(abs)) return null;
  const root = roots.find(r => abs.startsWith(path.resolve(r) + path.sep));
  const shipped = root === POSES_DIR;
  const rel = path.relative(root, abs).split(path.sep).join('/');
  return { abs, shipped, rel, root };
}

const { needsPreview, makePreview } = require('../lib/thumbs');

// Where the preview of a file is written, and the URL it answers at: beside its source, in
// a preview/ folder. The mannequins are the exception - they ship with the program in public/poses,
// which an update replaces - so theirs are made again into the library's cache/poses/.
function _previewTarget(hit) {
  const base = path.basename(hit.rel).replace(/\.[^.]+$/, '') + '.jpg';
  const sub  = path.posix.dirname(hit.rel);
  const relOut = path.posix.join(sub === '.' ? '' : sub, 'preview', base);
  const abs = path.resolve(hit.shipped ? CFG.POSES_CACHE_DIR : hit.root, relOut);
  return { abs, url: toUrl(abs) };
}

// ════════════════════════════════════════════════════════════════════════════
// GENERATION
//
// The workshop owns its own prompts and endpoints; only the ENGINE layer is shared (lib/helpers task
// creators and the resolveTask poller), never routes/char-store.js.
//
// Every reference image is re-hosted through uploadToPublicHost first: Replicate and kie cannot fetch
// this computer.
// ════════════════════════════════════════════════════════════════════════════

const H = require('../lib/helpers');

// THE REALISM MARKERS (owner, 2026-09-18 - research in docs/local-app/PLAN.md, "Модель для
// картинок мастерской"). What the sources agree on: say "photorealistic" and describe a PHOTOGRAPH
// being taken; name the material, finish and wear of what is in it rather than piling up quality
// words; no staging, no grading. Nothing here says 8K, ultra-detailed or hyperrealistic, on
// purpose - those buy a rendered look, not detail. Each block is said AFTER whatever the agent
// wrote, so no rewording of the agent's part can lose it.
//
// Fabric, for a flat outfit on white: the weave shows under low side light, and a faint contact
// shadow is what makes a garment lie ON the white instead of floating in front of it.
const TEXTILE_REAL =
  ' Photorealistic studio product photograph of real garments: soft, low side light that brings out the texture of every fabric -'
  + ' the weave, the knit, the grain of leather, the pile of fleece - and a faint natural contact shadow under each item on the white.'
  + ' Seams, stitching, buttons, zips and other hardware in sharp focus; the fabric lies with its real weight and a few natural soft creases,'
  + ' never stiff, glossy or plastic. Not a 3D render, not an illustration.';

// A person, dressed or composed into a place: the waxy, retouched skin is what reads as a render.
const PERSON_REAL =
  ' The result is a photorealistic photograph of a real person, like the source image: real skin with visible pores, fine lines and'
  + ' natural unevenness, unretouched and unsmoothed, never waxy or plastic; soft natural light and true colours as in the source image.'
  + ' The clothes are real fabric with visible weave or knit, seams, stitching and natural creases where the body bends, hanging with real weight.'
  + ' Not a 3D render, not CGI, not a game character, not an illustration.';

// A mascot shell is an object too: foam, fur and felt have a surface, and a face in it is still skin.
const COSTUME_REAL =
  ' The result is a photorealistic photograph: the costume is a real physical object - real foam, felt, fur or fabric with visible texture,'
  + ' seams and slight wear - and the face in its opening is real skin with pores, unretouched. Soft natural light and true colours as in the'
  + ' source image. Not a 3D render, not CGI, not a game asset, not an illustration.';

// Knolling discipline — the part that makes every garment separately visible.
//
// TWO RULES EARNED THE CAPITALS. Every item appears ONCE: the models like to show the same
// trousers folded and again unfolded, and a lookbook with one garment twice reads as two
// garments. And NO PERSON: a costume drawn on somebody is a picture of that somebody, and
// what gets worn later is the character already cast. A mannequin is allowed only where a
// costume cannot be understood flat - a mascot suit, a full-body character costume - and
// then a plain featureless one.
const KNOLL_TAIL =
  ' Top-down orthographic view, camera directly overhead. Knolling layout: every garment and accessory laid out completely flat,'
  + ' grouped by type, edges parallel or at right angles, evenly spaced, NOTHING overlapping or tucked behind another item —'
  + ' each piece fully visible and uncropped, both shoes and both socks shown as a pair.'
  + ' Show each item EXACTLY ONCE: no duplicates, no second view of the same garment, no folded and unfolded version of one item,'
  + ' no alternative colourways, no detail insets.'
  + ' Pure white seamless background (#FFFFFF).'
  + TEXTILE_REAL
  + ' NO PERSON and no body parts of any kind. No hanger, no text, no labels, no watermark. 1:1 square.';

// A mascot or full-body costume cannot be read flat - it is one shell, and laid out it looks
// like a heap. That is the one case where something wears it, and it is a plain mannequin.
//
// THE FACE OPENING IS OPEN. Real mascot suits hide the wearer behind a dark one-way mesh, and
// the agent knows it: left alone it draws one, the dressing then puts the character's face
// BEHIND it, and at the size a sheet is rendered the mesh reads as grain all over the face
// (the owner's bus costume, 2026-09-17). The person in this costume speaks to the camera.
const NO_MESH =
  ' The face opening is OPEN: no mesh, no net, no screen, no grille, no glass, no visor, no veil and no tinted panel across it.';
const MASCOT_TAIL =
  ' Show the costume as a single complete piece, standing, worn by a plain featureless neutral-grey mannequin'
  + ' with no face, no hair and no skin detail — the mannequin is there only to show how the costume sits, and must not read as a person.'
  + NO_MESH + ' The mannequin head shows through it freely.'
  + ' Full length, nothing cropped, front view. Show it EXACTLY ONCE: one costume, no second view, no duplicates, no detail insets.'
  + ' Pure white seamless background (#FFFFFF).'
  + ' Photorealistic studio product photograph of a real physical costume: soft, low side light that brings out the texture of the foam,'
  + ' felt, fur or fabric, visible seams and stitching, a faint natural contact shadow on the white. Not a 3D render, not an illustration.'
  + ' No text, no labels, no watermark. 1:1 square.';

// Dressing keeps the sheet's composition; only what is worn may change.
const DRESS_LOCK =
  ' Keep the SAME person, the SAME face, the SAME body, the SAME pose, the SAME framing, crop and background exactly as in the source image.'
  + ' Change ONLY what the person is wearing. Nothing covers the face: no mesh, no net, no veil, no visor, no screen over it.'
  + PERSON_REAL
  + ' Do not add text, logos or watermarks.';

// A MASCOT SUIT IS NOT CLOTHING. It is a shell with its own size and shape, and the person
// goes inside it: the head is inside the head, the arms are inside the arms, and the body it
// ends up with is the COSTUME's body, not theirs. Told nothing, the engine paints the picture
// onto the person like a printed leotard - which is exactly what the owner saw.
const COSTUME_LOCK =
  ' The person is INSIDE the costume, wearing it as a full-body suit: it has its own volume and proportions,'
  + ' thick and padded where the reference is thick, and it does NOT follow the body underneath.'
  + ' Do not paint the costume onto the skin, do not make it skin-tight, do not turn it into a printed bodysuit or leotard.'
  + ' Keep the SAME framing, crop, camera and background as the source image, and keep the pose readable.'
  + ' The person face shows in the costume face opening - the SAME face as in the source image, fully visible, sharp and unobstructed.'
  + ' There is NO mesh, net, screen, grille, glass, visor, veil or tinted panel over the face: where the costume reference has one, that part is an open hole.'
  + COSTUME_REAL
  + ' Do not add text, logos or watermarks.';

/**
 * WHAT IS BEING PUT ON, decided by looking at both pictures at once.
 *
 * The lookbook is a flat picture, sometimes on a plain mannequin. Only the agent can tell a
 * padded mascot shell from a jacket and trousers, and the two need opposite instructions - so
 * it is asked, and it also writes the sentence that does the dressing. When the lookbook was
 * made here it already carries a description of itself (scen3-lookbook-meta.json); that is
 * handed over too, because words about the inside of a costume survive being photographed
 * flat and a picture of it does not.
 */
async function _readDressing(personUrl, outfitUrl, note, described) {
  const ask = [
    'Two pictures: IMAGE 1 is a reference sheet of a person, IMAGE 2 is an outfit laid out flat or shown on a plain mannequin.',
    'The mannequin, if there is one, is not part of the outfit - it stands in for the person, and the person from IMAGE 1 takes its place.',
    'First decide what IMAGE 2 is: "outfit" for ordinary clothing, or "costume" for a mascot suit, a full-body character costume, a cosplay shell or an inflatable - anything the wearer gets inside rather than puts on.',
    'Then write ONE image-generation prompt, 80-160 words, telling the model to dress the person from IMAGE 1 in it.',
    'Describe the garments or the costume part by part, naming colours, materials and how each part sits on the body. Name each item once.',
    'Name the fabric of every garment concretely - its fibre and its weave or knit (cotton twill, linen, fine rib knit, denim, wool felt, faux fur) and whether it is matte or has a sheen - because the result is a photograph of real clothes on a real person.',
    'For a costume, say plainly that the person is inside it, that it keeps its own bulk and proportions and does not follow the body underneath, and where the person face shows.',
    'The face always shows fully, uncovered, in an OPEN face opening - never behind mesh, a net, a screen, glass, a visor or a veil. If IMAGE 2 or its description puts one there, write that the opening is open instead.',
    'Never describe the background, the camera or the pose - those stay as they are in IMAGE 1.',
    'Write the prompt in English, whatever language the person wrote in.',
    'Answer with JSON only: {"kind":"outfit"|"costume","prompt":"..."}',
  ].join(' ')
    + (described ? ' What IMAGE 2 is, as recorded when it was made: "' + String(described).slice(0, 1500) + '".' : '')
    + (note ? ' The person also asked for: "' + note + '".' : '');
  const content = [
    { type: 'text', text: ask },
    { type: 'image_url', image_url: { url: personUrl } },
    { type: 'image_url', image_url: { url: outfitUrl } },
  ];
  const rawOut = await _ask([{ role: 'user', content }]);
  const m = String(rawOut || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('the agent did not say how to dress this');
  let plan;
  try { plan = JSON.parse(m[0]); } catch (e) { throw new Error('the agent answered with something unreadable'); }
  const prompt = String((plan && plan.prompt) || '').trim();
  if (!prompt) throw new Error('the agent wrote no prompt');
  return { kind: plan.kind === 'costume' ? 'costume' : 'outfit', prompt };
}

// The agents' ladder (lib/agents.js, phase V25: Admin -> AI settings) - the one New Character reads photos with and the
// chats' writers write with, instead of a cascade of this popup's own. One place decides which models look at an image,
// and every step listed there answered a live call with a real photo. It also reports what went wrong per step.
const _ask = (messages) => H.callAIVisionWithFallback(messages, { timeout: 60000 });

/**
 * THE ONE CALL THAT DECIDES WHAT A LOOKBOOK IS.
 *
 * It is given whatever the person gave - a picture, a sentence, or both - and answers with
 * JSON: either { ok:false, why } when there is nothing to make, or { ok:true, kind, prompt,
 * description } when there is.
 *
 * Three things it is told that are worth stating here, because each of them is a bug we would
 * otherwise ship:
 *
 *   NOT EVERY PICTURE HAS CLOTHES IN IT. A train, a bird, a building: the answer is a costume
 *   OF that thing, not a refusal and not a picture of the thing. Only a photo of somebody
 *   dressed means "reproduce this outfit".
 *
 *   GIBBERISH IS REFUSED HERE, before an image is paid for. This call costs a fraction of a
 *   cent; the picture is the expensive half.
 *
 *   THE DESCRIPTION IS LONG ON PURPOSE (200+ words, English). It is what the dressing will be
 *   told later - where the sleeves end, what the shoes are, how the head piece sits - so it
 *   has to name the parts, not admire them.
 */
async function _readLookbookIdea(note, imageUrl) {
  const rules = [
    'You are preparing a CLOTHING LOOKBOOK: a flat product-style picture of one outfit or costume, made to be worn later by a character.',
    'Decide first whether there is something to make.',
    'If the text is gibberish, a random string, a test, or says nothing about clothing, a costume or a look, answer {"ok":false,"why":"..."} - one short sentence, addressed to the person.',
    'If a picture is given, it always gives you something: a person wearing clothes means REPRODUCE that outfit; anything else - an object, an animal, a vehicle, a building, a plant, a character - means INVENT a wearable full-body costume of it (a mascot-style costume) that a person could actually wear.',
    'When both a picture and a text are given, the text is a change to make to what the picture shows.',
    'Then answer with JSON only: {"ok":true,"kind":"outfit"|"costume","prompt":"...","description":"..."}',
    'kind is "costume" for mascot suits, full-body character costumes and cosplay shells; "outfit" for ordinary clothing.',
    'prompt: an image-generation prompt for the picture itself, 120-220 words, garment by garment - every item, its colour, fabric, cut, fastenings, trims, shoes and accessories. Name each item ONCE. Describe ONLY the clothing or costume: no person, no face, no body, no pose, no scene, no background - those are added separately.',
    'Name the fabric of every item concretely - its fibre and its weave or knit (heavyweight cotton twill, washed linen with natural slubs, fine merino rib knit, raw indigo denim, full-grain leather, wool felt, faux fur) and its finish (matte, brushed, glossy, with a soft sheen) - because the picture is a photograph of real garments, and a fabric that is not named comes out as plastic.',
    'description: 200 words or more, English, written for whoever will later dress a character in this. Say what the look IS, then go through it part by part - head and headwear, shoulders and arms and sleeve length, torso and fastening, waist, hips, legs and hem, feet, hands, and any tail, wings, mask or props. Say how each part sits on a body, what it is made of and what colour it is. For a mascot or full-body costume, say what creature or object it is, how the wearer gets into it, where the wearer face sits and what the proportions are. Be concrete and plain; no marketing language.',
    'A costume ALWAYS leaves the wearer face uncovered in an open face opening, in the prompt and in the description alike: never mesh, a net, a screen, glass, a visor or a veil over it. Whoever wears it will speak to the camera, and the face has to be seen.',
    // (phase V29) Everything in English, whatever the person typed in.
    'Write everything in English - the prompt, the description and "why" - whatever language the person wrote in.',
  ].join(' ');
  const ask = rules
    + (note ? ' The person wrote: "' + note + '".' : ' The person wrote nothing.')
    + (imageUrl ? ' Judge the picture as well.' : ' There is no picture.');
  const content = imageUrl
    ? [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: imageUrl } }]
    : ask;
  const rawOut = await _ask([{ role: 'user', content }]);
  const text = String(rawOut || '').trim();
  // Models wrap JSON in prose or fences often enough that fishing the object out is the rule,
  // not the fallback.
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('the agent did not answer with a plan');
  let plan;
  try { plan = JSON.parse(m[0]); } catch (e) { throw new Error('the agent answered with something unreadable'); }
  if (!plan || plan.ok === false) {
    const why = String((plan && plan.why) || 'that does not describe an outfit').trim();
    return { ok: false, why };
  }
  const prompt = String(plan.prompt || '').trim();
  if (!prompt) throw new Error('the agent wrote no prompt');
  return {
    ok: true,
    kind: plan.kind === 'costume' ? 'costume' : 'outfit',
    prompt,
    description: String(plan.description || '').trim(),
  };
}

// ── The picture itself ──────────────────────────────────────────────────────
// NANO-BANANA-2 MAKES ALL THREE - the lookbook, the look and the environment - the owner's decision
// after the A/B of 2026-09-18 (docs/local-app/PLAN.md, "Модель для картинок мастерской"). The
// gpt-image-2.5 that made them before is gone from the workshop: its "4K" is an upscale in the
// pixels - halos, over-sharpened edges, surfaces that melt, the textures the owner saw swim - and
// its honest 2K is too small, while nano-banana-2 kept natural texture at both sizes.
//
// Through the dispatch every other picture on this page already uses (_t2i / _i2i, on kie): this
// model takes its references as `image_input`, and a wrong name there is accepted and quietly
// ignored - the picture comes back made from the words alone.
const IMG_ENGINE = 'nano-banana-2';
// A dressed look at 4K: it is the reference every frame of the ad is built from, and nano's 4K is
// the character sheet's own size (5504 on the long side), so the face on it loses nothing. A
// lookbook at 2K: a flat outfit on white is read for what it is, not looked into.
const DRESS_RES = '4K';
const LB_RES = '2K';

const _lbTask = (prompt, urls) => (urls && urls.length
  ? _i2i(IMG_ENGINE, prompt, urls, '1:1', LB_RES)
  : _t2i(IMG_ENGINE, prompt, '1:1', LB_RES));

// ── Lookbook gender ─────────────────────────────────────────────────────────
// Which gender an outfit suits, judged from the INPUT (the description and/or the
// uploaded photo) so the call can run while the image is still rendering. Kept in
// a v3-owned side file keyed by public path — the shared lookbook backend has no
// metadata of its own and is not touched. Lookbooks that predate this stay
// unknown on purpose and are always visible.
// The store itself is lib/shelf-meta.js - shared with the environments, and with the Library's
// delete, which drops a picture's entry together with the picture.
const SHELF_META = require('../lib/shelf-meta');
const GENDER_VALUES = ['male', 'female', 'unisex'];

const _lbMeta = () => SHELF_META.read('lookbooks');
const _lbMetaSave = (m) => SHELF_META.write('lookbooks', m);

async function _detectGender(note, photoUrl) {
  const ask = 'Which gender is this outfit meant for? Answer with exactly one word: male, female, or unisex. '
    + 'Use "unisex" only when the outfit genuinely works for either. No explanation, one word only.'
    + (note ? ' The outfit: "' + note + '".' : '');
  try {
    const content = photoUrl
      ? [{ type: 'text', text: ask + ' Judge from the photo.' }, { type: 'image_url', image_url: { url: photoUrl } }]
      : ask;
    const raw = await _ask([{ role: 'user', content }]);
    const w = String(raw || '').toLowerCase().match(/male|female|unisex/);
    if (!w) return '';
    // "female" contains "male", so prefer the longest match found
    if (/female/.test(String(raw).toLowerCase())) return 'female';
    return GENDER_VALUES.includes(w[0]) ? w[0] : '';
  } catch (e) {
    console.warn('[scen3] gender detection failed:', e.message);
    return '';
  }
}

router.get('/scen3/lookbook-meta', (_req, res) => {
  try { res.json({ success: true, meta: _lbMeta() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Re-host a local media path so an external generator can fetch it.
// The generator fetches these URLs itself, so a slow host shows up as a fetch
// timeout minutes later with nothing to point at. Size and elapsed time are
// logged per reference to make that diagnosable from the log alone.
async function _hostLocal(urlPath, opts) {
  const { exts, ...up } = (opts || {});
  const hit = _resolveMedia(urlPath, exts);
  if (!hit || !fs.existsSync(hit.abs)) throw new Error('reference not found: ' + urlPath);
  const buf = fs.readFileSync(hit.abs);
  const ext = path.extname(hit.abs).replace('.', '') || 'jpg';
  const t0 = Date.now();
  // forceFresh for anything a paid render depends on: a cached URL that has gone cold
  // fails as "fetch failed" only after the task is created and the money committed.
  const url = await H.uploadToPublicHost(buf, { ext, ...up });
  console.log(`[scen3/host] ${path.basename(hit.abs)} ${(buf.length / 1024).toFixed(0)}KB`
    + ` in ${Date.now() - t0}ms -> ${String(url).slice(0, 60)}`);
  return url;
}

// ── engine dispatch ─────────────────────────────────────────────────────────
// The AGGREGATOR decides which service the task is created on; kie.ai is the
// default and hosts both models, Replicate hosts nano-banana-2 only.
//
// On kie the two models' input schemas DIFFER, and the difference is easy to get
// wrong (verified against docs.kie.ai/market/google/nanobanana2 and
// .../nano-banana-2-lite):
//
//   nano-banana-2       image_input (<=14 urls, 30MB total) | resolution 1K/2K/4K | output_format
//   nano-banana-2-lite  image_urls  (<=10 urls)             | no resolution field | no output_format
//
// Both take aspect_ratio. A kie taskId has no 'repl:' prefix and a Replicate one
// does, so the shared resolveTask routes either by itself.
const axios = require('axios');

async function _kieTask(model, input) {
  console.log('[scen3/kie] createTask', model, '| input keys:', Object.keys(input).join(','));
  const r = await axios.post(
    `${CFG.KIE_BASE}/api/v1/jobs/createTask`,
    { model, input },
    { headers: H.kieHeaders(), timeout: 30000 },
  );
  const id = r.data && r.data.data && r.data.data.taskId;
  if (!id) throw new Error('kie returned no taskId: ' + JSON.stringify(r.data).slice(0, 200));
  return id;
}

// `quality` maps onto nano-banana-2's resolution input; lite has no such field.
const _resOf = (q) => (['1K', '2K', '4K'].includes(q) ? q : '2K');
const _isLite = (e) => String(e) === 'nano-banana-2-lite';
// kie unless Replicate is asked for by name, and lite only exists on kie
const _isRepl = (agg, engine) => String(agg) === 'replicate' && !_isLite(engine);

async function _t2i(engine, prompt, aspect, quality, agg) {
  const ar = aspect || '1:1';
  if (_isRepl(agg, engine)) {
    return await H.createNanoBananaProTask(prompt, null, ar, { resolution: _resOf(quality) });
  }
  if (_isLite(engine)) return await _kieTask('nano-banana-2-lite', { prompt, aspect_ratio: ar });
  return await _kieTask('nano-banana-2', {
    prompt, aspect_ratio: ar, resolution: _resOf(quality), output_format: 'jpg',
  });
}

// With SEVERAL reference images of different shapes, 'match_input_image' does not
// reliably follow the first one — dressing a 16:9 sheet against a 1:1 lookbook came
// back square. So the ratio is measured from the base image and passed explicitly.
const RATIOS = [
  ['1:1', 1], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4], ['4:3', 4 / 3],
  ['4:5', 4 / 5], ['5:4', 5 / 4], ['9:16', 9 / 16], ['16:9', 16 / 9], ['21:9', 21 / 9],
];

async function _ratioOf(urlPath) {
  try {
    const hit = _resolveMedia(urlPath);
    if (!hit || !fs.existsSync(hit.abs)) return '';
    const m = await sharp(hit.abs).metadata();
    if (!m.width || !m.height) return '';
    const r = m.width / m.height;
    let best = RATIOS[0];
    for (const c of RATIOS) if (Math.abs(c[1] - r) < Math.abs(best[1] - r)) best = c;
    console.log(`[scen3] base ${m.width}x${m.height} (${r.toFixed(3)}) -> aspect ${best[0]}`);
    return best[0];
  } catch (e) {
    console.warn('[scen3] ratio probe failed:', e.message);
    return '';
  }
}

// The two models name their image array differently — image_urls on lite,
// image_input on the full model. Sending the wrong one is silently ignored and
// comes back as a text-to-image result, so the key is chosen per engine.
async function _i2i(engine, prompt, urls, aspect, quality, agg) {
  const ar = aspect || '1:1';
  const imgs = (urls || []).filter(Boolean);
  if (_isRepl(agg, engine)) {
    return await H.createMultiRefEditTask(
      'nano-banana-2', prompt, imgs, ar, undefined, { resolution: _resOf(quality) },
    );
  }
  if (_isLite(engine)) {
    if (imgs.length > 10) throw new Error(`lite takes at most 10 reference images, got ${imgs.length}`);
    return await _kieTask('nano-banana-2-lite', { prompt, image_urls: imgs, aspect_ratio: ar });
  }
  if (imgs.length > 14) throw new Error(`nano-banana-2 takes at most 14 reference images, got ${imgs.length}`);
  return await _kieTask('nano-banana-2', {
    prompt, image_input: imgs, aspect_ratio: ar, resolution: _resOf(quality), output_format: 'jpg',
  });
}

// ── Lookbook generator: three modes, decided by what came in ────────────────
//   prompt only        -> N distinct prompts -> N text-to-image runs
//   photo only         -> extract the outfit as it is
//   photo + prompt     -> read the photo against the note, then generate
// The route's own work, as a function. A generation started from Merge is seen through by the
// server (lib/gen-jobs.js) and "try again" has to ask for exactly the same thing, so what the route
// does has to be callable without a request. It answers what was submitted, and what filing the
// result will need later; the agent's refusal is thrown with `refused` on it, because that is an
// answer to the person rather than a fault.
//
// `hooks` (phase I, the Library's chats, which write the Alerts row at the press and do this behind
// it; Merge and "try again" pass none): stage(words) says what it is doing now, stop() is asked just
// before the money - true when the row was let go of meanwhile, and then nothing is asked for -
// and asked({taskId, engine, file}) hears the task the moment it exists.
const _stopped = () => Object.assign(new Error('let go of before it was asked for'), { stopped: true });
async function _submitLookbook(b, hooks) {
  const hk = hooks || {};
  const say = (w) => { if (hk.stage) hk.stage(w); };
  const note = String(b.prompt || '').trim();
  const b64  = String(b.imageBase64 || '');
  // A picture the library already holds - another lookbook as the base, or (the Library's chat) any
  // picture on its shelves as the photo. Sent as a PATH rather than as bytes: it is on this disk, and
  // pulling it through the browser as base64 only to upload it again would be a round trip for nothing.
  const ref  = String(b.imagePath || '').trim();
  let refToken = String(b.refToken || '').trim();
  if (!note && !b64 && !ref && !refToken) {
    throw Object.assign(new Error('describe an outfit or add a photo'), { status: 400 });
  }

  // The engines fetch their references over the internet, so either way the picture goes to
  // R2 first - ours, the one host (lib/helpers.js, uploadToPublicHost). A photo brought from
  // this computer is also kept under a token until the lookbook exists, and then filed in the
  // library (_fileRef). The token instead of the bytes is that same photo again - which is what
  // a second attempt sends.
  let photoUrl = '';
  let fresh = false;
  try {
    if (b64 || refToken || ref) say('sending the picture');
    if (b64) {
      fresh = true;
      const up = await _takeUpload(b64);
      refToken = up.token;
      photoUrl = up.url;
    } else if (refToken) {
      photoUrl = (await _reuseUpload(refToken)).url;
    } else if (ref) {
      photoUrl = await _hostLocal(ref, { verify: true });
    }

    // The agent goes first, and it is the cheap half: if what it is given is not something to
    // wear, nothing is generated and nothing is spent.
    say(photoUrl ? 'reading the picture' : 'reading your words');
    const plan = await _readLookbookIdea(note, photoUrl);
    if (!plan.ok) throw Object.assign(new Error(plan.why), { status: 400, refused: true });

    const mode = photoUrl ? (note ? 'edit' : 'extract') : 'draw';
    const prompt = plan.prompt + (plan.kind === 'costume' ? MASCOT_TAIL : KNOLL_TAIL);
    if (hk.stop && hk.stop()) throw _stopped();
    say('asking for the picture');
    const taskId = await _lbTask(prompt, photoUrl ? [photoUrl] : []);
    if (!taskId) throw Object.assign(new Error('the engine did not accept the task'), { status: 502 });
    // What filing it will need when it lands - the same fields the old page sends to finalize. A
    // picture that came by its path is where it was made from; one that came as bytes is filed in
    // Images when the lookbook lands (_fileRef) and says so then.
    const file = {
      prompt, description: plan.description, refToken,
      refName: String(b.refName || ''), ...(ref && !refToken ? { from: ref } : {}),
    };
    // The task exists and is paid for: whoever holds the row writes it down now, before the gender
    // is asked for - an app closed in those two seconds must not lose a task it can still collect.
    if (hk.asked) hk.asked({ taskId, engine: IMG_ENGINE, file });

    // The task is already submitted, so this ~2s call overlaps with the rendering.
    const gender = await _detectGender(note, photoUrl);
    console.log(`[scen3/gen/lookbook] mode=${mode} kind=${plan.kind} gender=${gender || 'unknown'}`);
    return {
      taskId, mode, kind: plan.kind, prompt, gender, refToken,
      description: plan.description,
      engine: IMG_ENGINE,
      file: { ...file, gender },
    };
  } catch (e) {
    // A photo brought in THIS call and not got past it is not kept; one sent by its token stays,
    // because whoever holds the token may try again with it.
    if (fresh && refToken) _unstash(refToken);
    throw e;
  }
}

router.post('/scen3/gen/lookbook', async (req, res) => {
  try {
    const b = req.body || {};
    const out = await _submitLookbook(b);
    // A row in Alerts, and the server sees it through; the page only follows the record. (`where`
    // says which panel asked, so the row can take you back to it.)
    res.json({ success: true, alertId: _journal('lookbook', 'image', out, b).id, mode: out.mode, kind: out.kind, refToken: out.refToken });
  } catch (e) {
    console.error('[scen3/gen/lookbook]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message, ...(e.refused ? { refused: true } : {}) });
  }
});

// ── Frame parameter presets (global) ───────────────────────────────────────
// Camera options carry OPTICS ONLY — how the body is posed or framed is chosen
// separately, so the two never fight each other in the prompt.
const FRAME_OPT_FILE = path.join(DATA_DIR, 'scen3-frame-options.json');

// Camera presets lead with FOCAL LENGTH and APERTURE, not with a brand: image
// models learned these terms from photo captions, so focal length reliably steers
// facial geometry and background compression while a camera-body name is close to
// decorative. The label is for the human; the payload is what the model reads.
const FRAME_OPT_DEFAULTS = {
  // `summary` is the short technical digest shown under the dropdown; `prompt` is
  // the full wording the model reads.
  cameras: [
    { id: 'phone-selfie', label: 'Phone selfie',     summary: '24mm equiv · f/2.2 · deep focus · slight barrel distortion',
      prompt: '24mm equivalent, f/2.2, deep focus with the face and the background both acceptably sharp, slight barrel distortion toward the frame edges, small-sensor rendering with mild luminance noise in the shadows' },
    { id: 'phone-rear',   label: 'Phone rear cam',   summary: '26mm equiv · f/1.8 · deep focus · crisp edge to edge',
      prompt: '26mm equivalent, f/1.8, deep focus, natural perspective, crisp corner-to-corner detail, clean small-sensor rendering' },
    { id: 'doc-35',       label: '35mm documentary', summary: '35mm · f/2.8 · mild background separation',
      prompt: '35mm, f/2.8, honest geometry with mild background separation, full-frame rendering' },
    { id: 'nat-50',       label: '50mm natural',     summary: '50mm · f/2.0 · eye-level perspective · moderate falloff',
      prompt: '50mm, f/2.0, perspective closest to the human eye, moderate background falloff' },
    { id: 'port-85',      label: '85mm portrait',    summary: '85mm · f/1.8 · compressed · shallow depth of field',
      prompt: '85mm, f/1.8, compressed perspective that flatters the face, shallow depth of field, background dissolving into smooth bokeh' },
    { id: 'webcam',       label: 'Webcam',           summary: '30mm equiv · f/2.4 · soft optics · visible noise',
      prompt: '30mm equivalent, f/2.4, soft low-contrast optics, visible sensor noise, slightly flat colour' },
  ],
  // Framing is a GROUP: every mannequin belongs to exactly one of these, so a
  // pose can never carry a crop that contradicts the chosen framing.
  // `crop` states where the frame CUTS, in terms anyone could check by looking at
  // the result. It leads the prompt, because naming the shot size ('medium-close')
  // was not enough on its own — the generator kept pulling back to full length.
  framings: [
    { id: 'closeup',     label: 'Close-up',    prompt: 'head-and-shoulders framing',
      crop: 'the bottom edge of the frame cuts across the CHEST, just below the shoulders. Nothing below the chest is visible — no waist, no hips, no legs, no feet. The head reaches close to the top of the frame' },
    { id: 'half-body',   label: 'Half body',   prompt: 'framed from the head down to just below the waist',
      crop: 'the bottom edge of the frame cuts just below the WAIST. No hips below the belt, no legs and no feet are visible' },
    { id: 'knees-up',    label: 'Knees up',    prompt: 'framed from the head down to the knees',
      crop: 'the bottom edge of the frame cuts across the KNEES. The lower legs and the feet are outside the frame' },
    { id: 'full-height', label: 'Full height', prompt: 'the whole figure in frame from head to feet, with room above and below',
      crop: 'the WHOLE figure is inside the frame, from the top of the head to the feet, with a little empty room above the head and below the feet' },
  ],
};

function _normOptList(arr, fallback) {
  const byId = new Map((fallback || []).map(o => [o.id, o]));
  const list = Array.isArray(arr) ? arr.map(o => {
    const id = String((o && o.id) || '').trim();
    const def = byId.get(id) || {};
    return {
      id,
      label:   String((o && o.label) || '').trim(),
      prompt:  String((o && o.prompt) || '').trim(),
      summary: String((o && o.summary) || '').trim(),
      // `crop` was added after the first presets were written to disk, so a stored
      // option without one inherits the default for its id rather than losing it.
      crop:    String((o && o.crop) || def.crop || '').trim(),
    };
  }).filter(o => o.id && o.label) : [];
  return list.length ? list : fallback.slice();
}

// Read-only since phase G: the page that edited these went, and what is left reads the file (or
// the defaults it is seeded from) for the camera and the shot size of a set.
function _loadFrameOpts() {
  const cur = _read(FRAME_OPT_FILE);
  // An older file carried `shots` instead of `framings`; the fallback quietly
  // migrates it by re-seeding the group list.
  const out = {
    cameras:  _normOptList(cur && cur.cameras,  FRAME_OPT_DEFAULTS.cameras),
    framings: _normOptList(cur && cur.framings, FRAME_OPT_DEFAULTS.framings),
  };
  if (!cur || !Array.isArray(cur.framings)) {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); writeFileAtomic(FRAME_OPT_FILE, JSON.stringify(out, null, 2)); } catch (e) {}
  }
  return out;
}


// ── Mannequin poses (v3's own store) ────────────────────────────────────────
// Each pose belongs to exactly ONE framing group. The grey mannequins ship with the program
// in public/poses/scen3/; `desc` is what the compose prompt reads - a mannequin has no face,
// so the wording carries the pose, and static pose wording steers a model far better than
// motion verbs do.
const POSE_FILE = path.join(DATA_DIR, 'scen3-poses.json');

const POSE_SEED = [
  // Every mannequin is named here explicitly. That is deliberate: the store is reseeded from
  // this array whenever data/scen3-poses.json is missing, and a seed that omitted `file`
  // silently dropped eight finished mannequins - the images stayed on disk but the library
  // forgot them.

  // Close-up — self-filming: the arm reaches TOWARD the lens and is cut by the frame edge,
  // so the hand and phone stay outside the picture.
  { id: 'closeup-selfie-r', group: 'closeup', label: 'Selfie, right arm',
    desc: 'filming themselves with the right arm, the arm reaching toward the lens across the lower left of frame, hand and phone outside the picture',
    file:  '/poses/scen3/closeup-selfie-r_replw5r98en2m4_1786200891960.jpg',
    thumb: '/poses/scen3/thumbs/closeup-selfie-r_replw5r98en2m4_1786200891960.jpg' },
  { id: 'closeup-selfie-l', group: 'closeup', label: 'Selfie, left arm',
    desc: 'filming themselves with the left arm, the arm reaching toward the lens across the lower right of frame, hand and phone outside the picture',
    file:  '/poses/scen3/closeup-selfie-l_replw5r98en2m4_1786200891960.jpg',
    thumb: '/poses/scen3/thumbs/closeup-selfie-l_replw5r98en2m4_1786200891960.jpg' },

  // Half body.
  { id: 'half-standing', group: 'half-body', label: 'Standing, facing camera',
    desc: 'standing squarely, shoulders level, arms relaxed at the sides, looking into the lens',
    file:  '/poses/scen3/half-standing_cf11f848c251cdaefc266711321645e1_1786265530392.jpg',
    thumb: '/poses/scen3/thumbs/half-standing_cf11f848c251cdaefc266711321645e1_1786265530392.jpg' },
  { id: 'half-arms-crossed', group: 'half-body', label: 'Standing, arms crossed',
    desc: 'standing with the forearms folded across the chest, shoulders square to the lens',
    file:  '/poses/scen3/half-arms-crossed_3db3c0ddab7d6d9e93c12f0b11b67181_1786265577172.jpg',
    thumb: '/poses/scen3/thumbs/half-arms-crossed_3db3c0ddab7d6d9e93c12f0b11b67181_1786265577172.jpg' },
  { id: 'half-hands-pockets', group: 'half-body', label: 'Hands in pockets',
    desc: 'standing at a slight angle with both hands in the pockets, shoulders loose, weight on one leg',
    file:  '/poses/scen3/half-hands-pockets_10d4ad1a620bae3bf03cc12e276c583d_1786265603816.jpg',
    thumb: '/poses/scen3/thumbs/half-hands-pockets_10d4ad1a620bae3bf03cc12e276c583d_1786265603816.jpg' },

  // Knees up. The first two show no knees at all, which is fine: the mannequin supplies the
  // BODY and the framing group supplies the crop.
  { id: 'knees-seated-table', group: 'knees-up', label: 'Seated at a table',
    desc: 'seated behind a table facing the lens, one forearm resting on the tabletop with the hand loosely closed, the other arm raised with the forearm upright and the hand closed at chest height',
    file:  '/poses/scen3/knees-seated-table_tabled_1786278401276.jpg',
    thumb: '/poses/scen3/thumbs/knees-seated-table_tabled_1786278401276.jpg' },
  { id: 'knees-sofa-back', group: 'knees-up', label: 'Sofa, leaning back',
    desc: 'sitting well back into a sofa, reclined against the backrest with both arms raised and bent behind the head, elbows out wide, shoulders relaxed',
    file:  '/poses/scen3/knees-sofa-back_ef4ccd235576a0651abfb062e8e0d2ff_1786278538648.jpg',
    thumb: '/poses/scen3/thumbs/knees-sofa-back_ef4ccd235576a0651abfb062e8e0d2ff_1786278538648.jpg' },
  { id: 'knees-desk-edge', group: 'knees-up', label: 'Half-seated on a desk',
    desc: 'half-seated on the front edge of a desk with one hip taking the weight, torso upright and turned slightly toward the lens, arms folded across the chest',
    file:  '/poses/scen3/knees-desk-edge_e4e8317fed2fb9cdb929b5a681733810_1786277422518.jpg',
    thumb: '/poses/scen3/thumbs/knees-desk-edge_e4e8317fed2fb9cdb929b5a681733810_1786277422518.jpg' },
  { id: 'knees-elbows-knees', group: 'knees-up', label: 'Elbows on knees',
    desc: 'seated on a low stool with the knees apart, torso tipped forward toward the lens, both elbows resting on the knees and the fingers interlocked between them',
    file:  '/poses/scen3/knees-elbows-knees_163c3ea892ff1e0f39da4806b5d61a0f_1786277449731.jpg',
    thumb: '/poses/scen3/thumbs/knees-elbows-knees_163c3ea892ff1e0f39da4806b5d61a0f_1786277449731.jpg' },
  { id: 'knees-wall-shoulder', group: 'knees-up', label: 'Shoulder against a wall',
    desc: 'standing at a slight angle with one shoulder and upper arm resting back against a wall, one hand in the pocket, the other arm raised with the hand up near the shoulder',
    file:  '/poses/scen3/knees-wall-shoulder_0ea594916f898e33b543cefec840212c_1786278602120.jpg',
    thumb: '/poses/scen3/thumbs/knees-wall-shoulder_0ea594916f898e33b543cefec840212c_1786278602120.jpg' },
  { id: 'knees-weight-hip', group: 'knees-up', label: 'Weight on one hip',
    desc: 'standing with the weight thrown onto one leg and that hip pushed out, one hand resting on the hip with the elbow out, the other arm hanging relaxed at the side',
    file:  '/poses/scen3/knees-weight-hip_cropped_1786277518467.jpg',
    thumb: '/poses/scen3/thumbs/knees-weight-hip_cropped_1786277518467.jpg' },

  // Full height, 9:16 - the same shape as the frame the mannequin composes.
  { id: 'full-hands-clasped', group: 'full-height', label: 'Hands clasped in front',
    desc: 'standing upright facing the lens with both hands clasped together low in front of the body, elbows relaxed and close to the sides, feet apart',
    file:  '/poses/scen3/full-hands-clasped_750056713a27fd491c7d4c71d455af5b_1786275299750.jpg',
    thumb: '/poses/scen3/thumbs/full-hands-clasped_750056713a27fd491c7d4c71d455af5b_1786275299750.jpg' },
  { id: 'full-straight', group: 'full-height', label: 'Standing straight',
    desc: 'standing upright and squarely facing the lens, both arms hanging relaxed at the sides, shoulders level, feet a little apart',
    file:  '/poses/scen3/full-straight_c2d6af597008bce2e54d1ca5ce829cc8_1786275326273.jpg',
    thumb: '/poses/scen3/thumbs/full-straight_c2d6af597008bce2e54d1ca5ce829cc8_1786275326273.jpg' },
  { id: 'full-contrapposto', group: 'full-height', label: 'Contrapposto',
    desc: 'standing in contrapposto with the weight on one leg and the other knee bent and relaxed, that hip pushed out and the shoulders tilted the opposite way, head turned slightly aside',
    file:  '/poses/scen3/full-contrapposto_b138090178166f7d938298931275550b_1786275389990.jpg',
    thumb: '/poses/scen3/thumbs/full-contrapposto_b138090178166f7d938298931275550b_1786275389990.jpg' },
  { id: 'full-turned-back', group: 'full-height', label: 'Looking over the shoulder',
    desc: 'standing with the back to the lens, the torso turned away, the head turned back over one shoulder to look into the camera, arms hanging at the sides',
    file:  '/poses/scen3/full-turned-back_58636e8e1d3d35beb3578c8ba01ef4c0_1786275416798.jpg',
    thumb: '/poses/scen3/thumbs/full-turned-back_58636e8e1d3d35beb3578c8ba01ef4c0_1786275416798.jpg' },
  { id: 'full-mirror-selfie', group: 'full-height', label: 'Mirror selfie',
    desc: 'standing at a slight angle filming itself in a mirror, one arm raised holding a phone at chest to head height toward the lens, the other arm relaxed, weight on one leg',
    file:  '/poses/scen3/full-mirror-selfie_c09381f804061d64ec73ad171b61a845_1786275443473.jpg',
    thumb: '/poses/scen3/thumbs/full-mirror-selfie_c09381f804061d64ec73ad171b61a845_1786275443473.jpg' },
];

function _normPose(p) {
  const s = p || {};
  return {
    id:      String(s.id || '').trim(),
    group:   String(s.group || '').trim(),
    label:   String(s.label || '').trim(),
    desc:    String(s.desc || '').trim(),
    file:    String(s.file || ''),             // the mannequin
    thumb:   String(s.thumb || ''),
    active:  s.active !== false,
  };
}

function _loadPoses() {
  const cur = _read(POSE_FILE);
  if (Array.isArray(cur)) return cur.map(_normPose).filter(p => p.id && p.group);
  const seeded = POSE_SEED.map(_normPose);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); writeFileAtomic(POSE_FILE, JSON.stringify(seeded, null, 2)); } catch (e) {}
  console.log(`[scen3] seeded ${seeded.length} mannequin poses across 4 framing groups`);
  return seeded;
}

router.get('/scen3/poses', (_req, res) => {
  try { res.json({ success: true, poses: _loadPoses().filter(p => p.active) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Crop a generated frame into a NEW file. Generation is not always obedient — a
// half-body request can come back knees-up — and a crop fixes the shot for nothing
// and instantly, where a re-roll costs money and throws the dice again.
//
// The rect arrives as FRACTIONS of the source, so the client never has to know the
// real pixel size or worry about how the preview letterboxes it. The result keeps its
// own pixels: no upscale, no interpolation, and the honest size comes back with it.
const CROP_MIN = 1 / 3;    // at least a third of each side, or the crop is mush

// The pixel size of a stored asset. The centre preview shows a DERIVATIVE, so the
// page cannot read the real dimensions off the <img> it is displaying — labelling a
// selection from that reported a size several times smaller than the crop it produced.


const _cleanText = (s) => String(s || '').replace(/^["'`\s]+|["'`\s]+$/g, '').trim();

// The pose whose mannequin should ride along, or null — resolved server-side so the
// client cannot ask for a pose belonging to a different framing group than it chose.
// Returns the record, because its `desc` is fed to the reading pass as a hint.
function _poseFor(poseId, framingId) {
  const pose = _loadPoses().find(p => p.id === String(poseId || ''));
  if (!pose || !pose.file) return null;
  const opts    = _loadFrameOpts();
  const framing = opts.framings.find(f => f.id === String(framingId || '')) || null;
  if (framing && pose.group !== framing.id) return null;
  const hit = _resolveMedia(pose.file);
  return (hit && fs.existsSync(hit.abs)) ? pose : null;
}

// Pull the labelled blocks out of the analysis. Anything the model puts before the
// first label is kept as LIGHTING, which is what a label-less answer used to be.
const _BLOCK_KEYS = ['POSE', 'CHARACTER', 'CLOTHES', 'ENVIRONMENT', 'LIGHTING', 'DIRECTION'];
// The garments of the CLOTHES block, one per line, each with where it is worn in front of it
// (phase N7). Kept as lines because the frame prompt picks among them by where they are.
const CLOTHES_WHERE = ['HEAD', 'TOP', 'BOTTOM', 'FEET', 'HANDS'];
function _clothesLines(raw) {
  const text = String(raw || '');
  const at = text.search(/^\s*\**\s*CLOTHES\s*\**\s*:/im);
  if (at < 0) return '';
  const rest = text.slice(at).replace(/^\s*\**\s*CLOTHES\s*\**\s*:/i, '');
  const next = rest.search(new RegExp('^\\s*\\**\\s*(' + _BLOCK_KEYS.join('|') + ')\\s*\\**\\s*:', 'im'));
  const body = next < 0 ? rest : rest.slice(0, next);
  return body.split(/\r?\n/)
    .map(l => l.replace(/^[\s*•\-–]+/, '').trim())
    .filter(l => new RegExp('^(' + CLOTHES_WHERE.join('|') + ')\\b', 'i').test(l))
    .map(l => l.replace(/\s+/g, ' ').slice(0, 300))
    .slice(0, 12)
    .join('\n');
}

function _splitBlocks(raw) {
  const text = String(raw || '');
  const out = { pose: '', character: '', clothes: '', environment: '', lighting: '', direction: '' };
  const re = new RegExp('^\\s*\\**\\s*(' + _BLOCK_KEYS.join('|') + ')\\s*\\**\\s*:', 'gim');
  const hits = [];
  let m;
  while ((m = re.exec(text))) hits.push({ key: m[1].toUpperCase(), from: m.index, to: re.lastIndex });
  if (!hits.length) { out.lighting = _cleanText(text); return out; }
  if (hits[0].from > 0) out.lighting = _cleanText(text.slice(0, hits[0].from));
  hits.forEach((h, i) => {
    const body = text.slice(h.to, i + 1 < hits.length ? hits[i + 1].from : undefined);
    const key = h.key.toLowerCase();
    // a repeated label appends rather than overwrites
    out[key] = _cleanText(out[key] ? out[key] + ' ' + body : body);
  });
  return out;
}

// Step 1 of every generation, as its own call so the popup can honestly show
// "Reading 1/2" and then "Generating 2/2" instead of one opaque wait.
//
//   compose (no basePath)  -> reads the location's light, and turns the user's note
//                             into clean direction when there is one
//   edit    (basePath)     -> reads THAT frame against the note
//
// Whatever comes back is creative wording only. The invariants — identity lock,
// one person, no watermark — stay on the server so a rewrite cannot drop them.


// ── Environments ────────────────────────────────────────────────────────────
// ONE place, photographed empty, that a person is later put into to speak to the camera. Made
// the way a lookbook is: the agent reads what it was given first, and only then is a picture
// paid for (docs/local-app/PLAN.md, "create environment").
//
// 3:2, on the owner's instruction (2026-09-17). An environment is not one frame but a set to take
// frames FROM: a wide room gives several different vertical 9:16 frames - by the window, in the
// middle, by the wall - with the same place and the same light, so the fragments of a video stop
// looking identical.
//
// 2K since the A/B of 2026-09-18 (the owner): nano-banana-2's 2K is 2528x1696 and clean at 100%.
// A frame is DRAWN with the environment as its reference (the fragments phase), not cut out of it,
// so the place has to be right more than it has to be enormous.
const ENV_ASPECT = '3:2';
const ENV_RES = '2K';
const ENV_RATIO = 3 / 2;

// Said after whatever the agent wrote, so no rewrite of the words can lose it. The EMPTY rule is
// the one in capitals: a person left in the place is a second person in every frame made from it.
//
// The research behind every clause (PLAN, "Модель для картинок мастерской"): a PHOTOGRAPH being
// taken - where the camera stands and with what lens, verticals straight - because camera words
// steer realism better than quality words; the light of the place itself and no grading, because
// staged light is the showroom look; and SURFACES, because a wide scene is exactly where a model
// trades texture for mood unless it is told what each surface is made of. "As taken on a
// smartphone" is gone: a phone's own processing smooths fine texture away, which is the very fault
// the owner saw - textures that swim.
const ENV_TAIL =
  ' Photorealistic photograph of a real place, taken handheld at chest height with a 28mm lens, vertical lines straight, natural perspective.'
  + ' The light is the light of the place itself - daylight from its windows or openings, or its own lamps - with true colours,'
  + ' soft natural shadows and no colour grading.'
  + ' Every surface shows its real material in crisp, natural detail: the grain of wood, the weave of fabric, the pores of stone and'
  + ' concrete, the grout between tiles, with everyday wear - scuffs, dust, faded and uneven patches. Unstaged and lived-in;'
  + ' not a 3D render, not CGI, not an illustration, not a showroom or stock photo.'
  + ' The place is EMPTY: NO people, no body parts, no reflections or silhouettes of people, no mannequins, no text, no logos, no watermark.'
  + ' 3:2 landscape, filling the whole frame edge to edge, no borders.';

// Changing an environment already made: the rest of it is the thing being kept.
const ENV_KEEP =
  ' Keep the SAME place as in the picture - the same architecture, furniture, materials, colours, light and camera -'
  + ' and change only what the prompt asks for.';

// THE TAIL OF A CHANGE (phase V26.4, the owner 2026-10-10). ENV_TAIL describes a photograph being TAKEN - a 28mm lens at
// chest height, the light of the place - and said after a change it asks the model to take the picture again, which is
// the redraw a change must not be. What it keeps of ENV_TAIL: the change is a real thing photographed here, the place
// stays EMPTY, 3:2 with no borders. The framing is the picture's own unless the picture has to be continued to 3:2.
const ENV_EDIT_TAIL =
  ' Whatever is changed or added is a real thing photographed in this same place: its real material in crisp, natural detail,'
  + ' with everyday wear, lit by the same light, with the same perspective and shadows as the rest - not a 3D render, not CGI, not an illustration.'
  + ' The place stays EMPTY: NO people, no body parts, no reflections or silhouettes of people, no mannequins, no text, no logos, no watermark.';
const _envEditFrame = (shape) => (shape && shape.extend
  ? ' 3:2 landscape, filling the whole frame edge to edge, no borders.'
  : ' 3:2 landscape, the same framing as the picture, no borders.');

// A picture with no place in it lends its atmosphere, not its contents: without this the model
// puts the cup it was shown on every table of the café it was asked for.
const ENV_MOOD_ONLY =
  ' The picture given is a reference for atmosphere only - its palette, light, mood and style.'
  + ' Do not reproduce it, and do not put what it shows into the place.';

// Where a picture has to be continued to become 3:2, measured rather than guessed. Nothing to
// continue within 5% of the shape: a picture that close is re-framed, not extended.
function _envShape(w, h) {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0, extend: '' };
  const r = w / h;
  const extend = r < ENV_RATIO * 0.95 ? 'left and right' : r > ENV_RATIO * 1.05 ? 'top and bottom' : '';
  return { w, h, extend };
}

// A phone photo's pixels are often stored on their side with a tag saying which way is up.
async function _sizeOf(input) {
  try {
    const m = await sharp(input).metadata();
    const turned = (m.orientation || 1) >= 5;
    return turned ? { w: m.height || 0, h: m.width || 0 } : { w: m.width || 0, h: m.height || 0 };
  } catch (e) {
    return { w: 0, h: 0 };
  }
}

/**
 * THE CALL THAT DECIDES WHAT AN ENVIRONMENT IS.
 *
 * Given whatever the person gave - a photo they brought, an environment already made, a sentence,
 * the places they picked - it answers with JSON, one of three:
 *
 *   { ok:false, why }                       nothing to make: said to the person, nothing is paid
 *   { ok:true, choose:true, why, options }  a picture with no place in it, and the panel can ask:
 *                                           a handful of places to pick from, and still nothing paid
 *   { ok:true, prompt, description }        the place, as a prompt and as a description
 *
 * WHY IT ASKS INSTEAD OF INVENTING. A cup, a logo or a drawing suits a dozen places, and which one
 * the agent would reach for is exactly the unpredictable part (the owner, 2026-09-17). So it names
 * a few; the person picks any number; this is called again with those, and only that call writes
 * a prompt. A page that cannot show the choice (the old Scenarios popup) does not offer it, and
 * then the agent picks the single best place itself.
 *
 * CONTINUING A PICTURE. The model has no mask, so "extend this" is said in words - and said
 * briefly: the part of the picture that exists is kept as it is, and it goes on in the same style,
 * light and perspective. The agent is not asked to describe the new part at length; the more it
 * invents there in words, the more the model redraws what was already right.
 *
 * CHANGING AN ENVIRONMENT is the same lesson (phase V26.4, the owner 2026-10-10): the prompt is a SHORT instruction -
 * what changes and where, and what stays - not the whole place described again, which the model took as a picture to
 * draw anew, so every change redrew everything and a chain of changes was a copy of a copy. Google's guide for
 * nano-banana edits says the same: "change only <this> to <that>, keep everything else exactly the same". The
 * description is still of the whole place, as it will be after the change - the frames are composed from it.
 */
async function _readEnvironmentIdea({ note, imageUrl, source, shape, choices, canChoose }) {
  const picked = (choices || []).filter(Boolean);
  const editing = source === 'saved' && !picked.length;
  const rules = [
    'You are preparing an ENVIRONMENT for a UGC-style video: one real place, photographed empty, that a person will later be put into to speak to the camera.',
    'Decide first whether there is something to make.',
    'Refuse only when there is no picture and the text is gibberish, a random string, a test, or says nothing about a place, a setting or an atmosphere: answer {"ok":false,"why":"..."} - one short sentence addressed to the person.',
  ];
  if (source === 'photo' && !picked.length) {
    rules.push('The picture is a photo the person brought. If it shows a place - indoors or outdoors, with or without people - the place to make is THAT place: the same architecture, furniture, materials, colours and light, with every person and everything they hold removed and the space behind them filled in naturally.');
    rules.push(canChoose
      ? 'If it shows NO place at all - an object or a product on a plain background, an animal, a drawing, a logo, a pattern - do not choose a place yourself: answer {"ok":true,"choose":true,"why":"...","options":["...","..."]} with 5 short, clearly different, concrete places, 2 to 6 words each, that would suit what the picture shows and its colours, mood, style and era. "why" is one short sentence telling the person the picture has no place in it.'
      : 'If it shows NO place at all - an object on a plain background, an animal, a drawing, a logo - invent the ONE place that suits it best, its colours, mood, style and era.');
  }
  if (source === 'saved') {
    rules.push('The picture is an environment already made. The text is a change to make to it; everything the text does not mention stays exactly as it is.');
  }
  if (picked.length) {
    rules.push('The person picked ' + (picked.length > 1 ? 'these places' : 'this place') + ': ' + picked.map(p => '"' + p + '"').join(', ') + '. Make ONE coherent place out of what they picked.'
      + (imageUrl ? ' Carry the atmosphere of the picture into it - its palette, light, mood, style and era - but not what the picture shows.' : ''));
  }
  if (note && source === 'photo') rules.push('The text is a change to make to the place.');
  rules.push('Then answer with JSON only: {"ok":true,"prompt":"...","description":"..."}');
  if (editing) {
    rules.push('prompt: a SHORT editing instruction for an image model that is given this picture, 40-100 words - not a description of the whole place, which would make the model draw it anew. Start with "Using the provided image of" and the place in a few words, then say ONLY what changes: "change only" the thing (or things) to the new state, where exactly in the picture it is, and, for anything new or changed, its material, finish and colour concretely ("a muted sage-green matte paint", "a tall fiddle-leaf fig in a worn terracotta pot"). For something taken away, say that the space where it was shows what is naturally behind it. Then say what stays, by name: "Keep everything else exactly the same" - the walls, floor, furniture and objects near the change, the light and the framing. Say what is wanted, not what is not; plain sentences, no keyword lists, never words like 8K, ultra-detailed, hyperrealistic or masterpiece. Do not fill the open floor where a person could stand unless the text asks for it.');
  } else {
    rules.push('prompt: an image-generation prompt, 150-230 words, for a real photograph of the place: what it is, then the foreground, middle ground and background, left and right - objects, materials and colours - and the light: where it comes from, how soft, how warm, what time of day. The place is EMPTY: no people, no body parts, no mannequins, no text, logos or watermarks. Leave open floor space in several parts of the scene - left, centre and right - where a person could stand or sit facing the camera: the picture will be cut into several vertical frames.');
    // The one lever every source agrees on, and the one this agent is best placed to pull: it is the
    // agent that says what the surfaces ARE. A wide scene told only "wood" and "tiles" comes back
    // with textures that swim.
    rules.push('In the prompt, name the MATERIAL, the FINISH and the WEAR of every large surface - floor, walls, ceiling if seen, furniture, fabrics - concretely: not "wood" but "worn white-oak boards with visible grain and a few scuffs", not "tiles" but "matte grey ceramic tiles with darker grout lines". Everyday imperfections belong in it: dust, scuffs, fingerprints, creased fabric, faded paint. Write flowing sentences in order, not a list of keywords, and never use words like 8K, ultra-detailed, hyperrealistic or masterpiece.');
  }
  if (shape && shape.extend && source !== '' && !picked.length) {
    rules.push('The picture is ' + shape.w + 'x' + shape.h + ' and the result is a 3:2 landscape, so it has to be continued to the ' + shape.extend + '. Say so in the prompt in ONE or TWO plain sentences: the place in the picture stays exactly as it is, and it continues to the ' + shape.extend + ' in the same style, light and perspective. Do not describe the added part at length.');
  }
  // (phase V29) Everything in English, whatever the person typed in.
  rules.push('Write everything in English - the prompt, the description, "why" and any options - whatever language the person wrote in.');
  rules.push('description: 150 words or more, English, for whoever will later compose frames in this place'
    + (editing ? ' - the whole place as it will be AFTER the change, not the change alone' : '') + ': what the place is; how it is laid out from left to right and from front to back; surfaces, materials and colours; the light - where it comes from, how soft and how warm, what time of day it reads as; where a person can stand or sit and what is behind them there; the camera height. Plain and concrete, no marketing language.');

  const ask = rules.join(' ')
    + (note ? ' The person wrote: "' + note + '".' : ' The person wrote nothing.')
    + (imageUrl ? ' Judge the picture as well.' : ' There is no picture.');
  const content = imageUrl
    ? [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: imageUrl } }]
    : ask;
  const rawOut = await _ask([{ role: 'user', content }]);
  const m = String(rawOut || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('the agent did not answer with a plan');
  let plan;
  try { plan = JSON.parse(m[0]); } catch (e) { throw new Error('the agent answered with something unreadable'); }
  if (!plan || plan.ok === false) {
    return { ok: false, why: String((plan && plan.why) || 'that does not describe a place').trim() };
  }
  if (plan.choose) {
    const options = (Array.isArray(plan.options) ? plan.options : [])
      .map(o => String(o || '').trim()).filter(Boolean).slice(0, 6);
    // Asked when it may not be - or asked with nothing to pick from. Either way there is no
    // place to make and no question the panel can put, so it is said as a failure.
    if (!canChoose || !options.length) throw new Error('the agent could not decide what place to make');
    return { ok: true, choose: true, why: String(plan.why || '').trim(), options };
  }
  const prompt = String(plan.prompt || '').trim();
  if (!prompt) throw new Error('the agent wrote no prompt');
  return { ok: true, prompt, description: String(plan.description || '').trim() };
}

const _envTask = (prompt, urls) => (urls.length
  ? _i2i(IMG_ENGINE, prompt, urls, ENV_ASPECT, ENV_RES)
  : _t2i(IMG_ENGINE, prompt, ENV_ASPECT, ENV_RES));

// ── The picture somebody brought ────────────────────────────────────────────
// A photo uploaded into a maker is kept for two reasons: a second pass must not send it again
// (the environment's choice of places), and once something has been MADE from it, it is filed in
// the library - Images, under uploads_lookbooks or uploads_environments (the owner, 2026-09-17).
// Until then it waits in scratch, outside the library, under a token the page holds: a photo that
// came to nothing is not the library's business. Scratch is swept of anything a day old.
const REF_DIR = path.join(CFG.TEMP_DIR, 'maker-refs');
const REF_TTL_MS = 24 * 3600 * 1000;
const REF_CATS = { lookbook: 'uploads_lookbooks', environment: 'uploads_environments' };
const _refUrls = new Map();                        // token -> its public URL, while this server runs
const _refOk = (t) => /^[a-f0-9]{20}$/.test(String(t || ''));

function _stashRef(buf, ext) {
  fs.mkdirSync(REF_DIR, { recursive: true });
  for (const f of fs.readdirSync(REF_DIR)) {
    try { if (Date.now() - fs.statSync(path.join(REF_DIR, f)).mtimeMs > REF_TTL_MS) fs.unlinkSync(path.join(REF_DIR, f)); } catch (e) {}
  }
  const token = require('crypto').randomBytes(10).toString('hex');
  fs.writeFileSync(path.join(REF_DIR, token + '.' + ext), buf);
  return token;
}

function _stashed(token) {
  if (!_refOk(token) || !fs.existsSync(REF_DIR)) return '';
  const f = fs.readdirSync(REF_DIR).find(n => n.startsWith(token + '.'));
  return f ? path.join(REF_DIR, f) : '';
}

function _unstash(token) {
  const f = _stashed(token);
  if (f) { try { fs.unlinkSync(f); } catch (e) {} }
  _refUrls.delete(token);
}

// A data URL from the page -> the bytes, what they are, and a token for them. In a format the
// aggregators take (phase V24, lib/image-in.js): an AVIF went up as it was, named .heic, and kie
// answered "File type not supported" after the press.
async function _takeUpload(dataUrl) {
  const raw = String(dataUrl || '').replace(/^data:[^;,]*;base64,/i, '');
  const got = Buffer.from(raw, 'base64');
  if (!got.length) throw Object.assign(new Error('unreadable photo'), { status: 400 });
  const pic = await IMGIN.sendable(got);
  const buf = pic.buf, ext = pic.ext;
  const token = _stashRef(buf, ext);
  let url = '';
  try {
    url = await H.uploadToPublicHost(buf, { ext });
  } catch (e) {
    _unstash(token);                               // nobody holds the token yet: it would only wait for the sweep
    throw e;
  }
  _refUrls.set(token, url);
  return { token, url, buf };
}

// The same photo again, by its token: the URL it already has, or the file sent up once more.
async function _reuseUpload(token) {
  const file = _stashed(token);
  if (!file) throw Object.assign(new Error('the photo is no longer here - add it again'), { status: 400, gone: true });
  let buf = fs.readFileSync(file);
  let url = _refUrls.get(token);
  if (!url) {
    // A photo stashed before phase V24 may be in a format the aggregators refuse: made sendable now.
    const pic = await IMGIN.sendable(buf);
    buf = pic.buf;
    url = await H.uploadToPublicHost(buf, { ext: pic.ext });
    _refUrls.set(token, url);
  }
  return { token, url, buf };
}

// File it in Images, once something exists that was made from it. The same photo twice is one
// picture on the shelf: it is recognised by its bytes, not its name.
async function _fileRef(token, kind, name) {
  const src = _stashed(token);
  const label = REF_CATS[kind];
  if (!src || !label) return '';
  const IMG = require('../lib/images-store');
  const LC = require('../lib/library-cats');
  const buf = fs.readFileSync(src);
  const sha1 = require('crypto').createHash('sha1').update(buf).digest('hex');
  const { cat } = LC.add('images', label);
  let out = '';
  const same = IMG.read().find(e => e && e.categoryId === cat.id && e.meta && e.meta.sha1 === sha1);
  const sameHit = same && _resolveMedia(same.imagePath);
  if (sameHit && fs.existsSync(sameHit.abs)) {
    out = same.imagePath;
  } else {
    // Scratch can be on another drive than the library: COPY in, never rename.
    const file = 'ref_' + Date.now() + '_' + token.slice(0, 6) + path.extname(src);
    fs.mkdirSync(CFG.MEDIA.work, { recursive: true });
    fs.copyFileSync(src, path.join(CFG.MEDIA.work, file));
    const clean = String(name || '').replace(/\.[^.]+$/, '').replace(/[^\wа-яА-ЯёЁ\- .]/g, '').trim().slice(0, 120);
    const { item } = await IMG.add(toUrl(path.join(CFG.MEDIA.work, file)), {
      name: clean || label, source: 'upload', categoryId: cat.id, categoryLabel: cat.label,
      meta: { sha1, made: kind },
    });
    out = item.imagePath;
  }
  _unstash(token);
  return out;
}

//   POST /api/scen3/gen/env
//     { prompt, imageBase64 | refToken | imagePath (basePath), choices? }
//   -> 400 { error, refused }                           the agent said there is nothing to make
//   -> 200 { choose:true, why, options, refToken }      pick places first; nothing was paid for
//   -> 200 { mode, taskId, prompt, description, refToken }
//
// `choices` present - even empty - says the page can show a choice of places. Absent (the old
// Scenarios popup, the Library's chat) the agent picks a place itself.
//
// `photoPath` (phase I, the Library's chat): a picture already in the library - on the Images shelf,
// say - read as a PHOTO, the place taken out of it; `imagePath` is an environment to CHANGE. `hooks`
// as for _submitLookbook.
async function _submitEnv(b, hooks) {
  const hk = hooks || {};
  const say = (w) => { if (hk.stage) hk.stage(w); };
  let token = '';
  let fresh = false;                             // the photo came in THIS call
  const note = String(b.prompt || '').trim();
  const photoPath = String(b.photoPath || '').trim();
  const saved = photoPath ? '' : String(b.imagePath || b.basePath || '').trim();
  const canChoose = Array.isArray(b.choices);
  const choices = canChoose ? b.choices.map(c => String(c || '').trim()).filter(Boolean).slice(0, 6) : [];
  if (!note && !b.imageBase64 && !b.refToken && !saved && !photoPath) {
    throw Object.assign(new Error('describe a place or add a photo'), { status: 400 });
  }
  if (saved && !note && !b.imageBase64 && !b.refToken) {
    throw Object.assign(new Error('say what to change in this environment'), { status: 400 });
  }

  try {
    // The picture, and where it came from: a photo brought now, the same photo again, a picture of
    // the library's read as a photo, or an environment already on the shelf.
    let url = '';
    let source = '';
    let shape = null;
    if (b.imageBase64 || b.refToken || photoPath || saved) say('sending the picture');
    if (b.imageBase64 || b.refToken) {
      fresh = !!b.imageBase64;
      const up = fresh ? await _takeUpload(b.imageBase64) : await _reuseUpload(String(b.refToken));
      token = up.token;
      url = up.url;
      source = 'photo';
      const s = await _sizeOf(up.buf);
      shape = _envShape(s.w, s.h);
    } else if (photoPath) {
      url = await _hostLocal(photoPath, { verify: true });
      source = 'photo';
      const hit = _resolveMedia(photoPath);
      const s = hit ? await _sizeOf(hit.abs) : { w: 0, h: 0 };
      shape = _envShape(s.w, s.h);
    } else if (saved) {
      url = await _hostLocal(saved, { verify: true });
      source = 'saved';
      const hit = _resolveMedia(saved);
      const s = hit ? await _sizeOf(hit.abs) : { w: 0, h: 0 };
      shape = _envShape(s.w, s.h);
    }

    say(url ? 'reading the picture' : 'reading your words');
    const plan = await _readEnvironmentIdea({ note, imageUrl: url, source, shape, choices, canChoose });
    if (!plan.ok) {
      if (token) _unstash(token);
      throw Object.assign(new Error(plan.why), { status: 400, refused: true });
    }
    if (plan.choose) {
      console.log(`[scen3/gen/env] choose: ${plan.options.length} places offered`);
      return { choose: true, why: plan.why, options: plan.options, refToken: token };
    }

    // A place picked for a picture that had none keeps the picture only for its atmosphere.
    const mode = choices.length ? 'picked' : source === 'saved' ? 'edit' : source === 'photo' ? 'photo' : 'draw';
    // A change keeps the picture's own camera and light (phase V26.4): its tail does not describe the photograph again.
    const prompt = plan.prompt
      + (mode === 'edit' ? ENV_KEEP + ENV_EDIT_TAIL + _envEditFrame(shape) : '')
      + (mode === 'picked' && url ? ENV_MOOD_ONLY : '')
      + (mode === 'edit' ? '' : ENV_TAIL);
    if (hk.stop && hk.stop()) throw _stopped();
    say('asking for the picture');
    const taskId = await _envTask(prompt, url ? [url] : []);
    if (!taskId) throw Object.assign(new Error('the engine did not accept the task'), { status: 502 });
    console.log(`[scen3/gen/env] mode=${mode} aspect=${ENV_ASPECT} res=${ENV_RES}`
      + (shape && shape.extend && mode !== 'picked' ? ` extend=${shape.extend}` : '') + (choices.length ? ` picked=${choices.length}` : ''));
    // A picture that came by its path is where the place was made from (a photo as bytes is filed
    // in Images when the place lands, _fileRef, and says so then).
    const from = photoPath || saved;
    return {
      taskId, mode, prompt, description: plan.description, refToken: token,
      engine: IMG_ENGINE,
      file: {
        description: plan.description, prompt, refToken: token, refName: String(b.refName || ''),
        ...(from && !token ? { from } : {}),
      },
    };
  } catch (e) {
    // A photo brought in this call and not got past it is not kept. One sent back by its token
    // stays: whoever holds the token may try again with it.
    if (fresh && token) _unstash(token);
    throw e;
  }
}

router.post('/scen3/gen/env', async (req, res) => {
  try {
    const b = req.body || {};
    const out = await _submitEnv(b);
    // A choice of places is not a generation: nothing was submitted and nothing is journalled.
    if (out.choose) return res.json({ success: true, choose: true, why: out.why, options: out.options, refToken: out.refToken });
    res.json({ success: true, alertId: _journal('environment', 'image', out, b).id, mode: out.mode, refToken: out.refToken });
  } catch (e) {
    console.error('[scen3/gen/env]', e.message);
    res.status(e.status || 500).json({
      success: false, error: e.message,
      ...(e.refused ? { refused: true } : {}), ...(e.gone ? { gone: true } : {}),
    });
  }
});

router.get('/scen3/env-meta', (_req, res) => {
  try { res.json({ success: true, meta: SHELF_META.read('environments') }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── How a place MOVES ───────────────────────────────────────────────────────
   POST /api/scen3/env/motion  { path, motion? } -> { success, path, entry }

   The one or two sentences that say what is alive in the background of a shot filmed here - a
   curtain breathing, steam off a cup, leaves, traffic far behind, light shifting. It belongs to the
   PLACE and not to a project (the owner, 2026-09-21): every talking head set here animates the same
   way, so it lives beside the picture in scen3-env-meta.json and every project reads it.

   With `motion` in the body it is written as given - that is the Library's environment column, "how it
   moves", edited by hand (phase V26.8: the video field's box for it went). Without it the agent looks at
   the picture and writes one, which is what the video zone's `generate` and a clip do.
   People and camera moves are deliberately out: the person is animated by the line's own prompt, and
   a camera move would fight the shot size the frames were drawn in.
   ──────────────────────────────────────────────────────────────────────────── */
const ENV_MOTION_ASK =
  'This is an empty location - a place a person will be filmed standing or sitting in, talking to the'
  + ' camera. In ONE or TWO sentences, say what MOVES in it by itself while that is filmed: the things'
  + ' in the background and the air and light around them - a curtain lifting, steam rising, leaves or'
  + ' branches, water, traffic or people far behind a window, dust in a sunbeam, a screen flickering.'
  + ' Only what is actually visible in this picture, and only small ambient movement that could run'
  + ' under a few seconds of speech. Do NOT mention the person, their face, hands or clothes, and do'
  + ' NOT describe any camera movement, cut or zoom. Plain sentences, no list, no heading.';

// Writing a place's motion down, and having the agent write one. Wanted in two places: by the
// route below, and by a clip about to be made in a place nobody has looked at yet (phase U4) -
// a fragment's own `make clip` must not render before that analysis exists.
function _keepEnvMotion(url, motion) {
  const meta = SHELF_META.read('environments');
  const entry = { ...(meta[url] || {}), motion: String(motion || ''), motionAt: new Date().toISOString() };
  meta[url] = entry;
  SHELF_META.write('environments', meta);
  return entry;
}
const _envMotionOf = (url) => String((SHELF_META.read('environments')[String(url || '')] || {}).motion || '');
// ONE ANALYSIS PER PLACE AT A TIME (phase V23, the rest of X0): several clips started together on a place with no
// motion yet all wait for the same answer - each used to ask the agent for its own.
const _envMotionAsking = new Map();      // address -> the analysis under way

function _askEnvMotion(url) {
  const key = String(url);
  const live = _envMotionAsking.get(key);
  if (live) return live;
  const p = (async () => {
    const imageUrl = await _hostLocal(url);
    const motion = _cleanText(await _ask([{ role: 'user', content: [
      { type: 'text', text: ENV_MOTION_ASK },
      { type: 'image_url', image_url: { url: imageUrl } },
    ] }])).slice(0, 600);
    if (!motion) throw new Error('the agent said nothing about this place');
    console.log('[scen3/env/motion] ' + String(url).split('/').pop() + ' -> ' + motion.length + 'ch');
    return _keepEnvMotion(url, motion);
  })().finally(() => { _envMotionAsking.delete(key); });
  _envMotionAsking.set(key, p);
  return p;
}

router.post('/scen3/env/motion', async (req, res) => {
  try {
    const b = req.body || {};
    const url = String(b.path || '').trim();
    if (!url) return res.status(400).json({ success: false, error: 'path is required' });
    // The picture has to be one on the environments shelf: the store is keyed by address, and an
    // entry under an address that is not a place would never be read by anything.
    const hit = _resolveMedia(url);
    if (!hit || !fs.existsSync(hit.abs)) return res.status(404).json({ success: false, error: 'no such picture' });
    if (!hit.abs.startsWith(path.resolve(CFG.ENVIRONMENTS_DIR) + path.sep)) {
      return res.status(400).json({ success: false, error: 'that picture is not an environment' });
    }

    let given = typeof b.motion === 'string' ? _cleanText(b.motion).slice(0, 600) : null;
    // (phase V29) Typed in another language, it is kept in English - it goes into the clip's prompt.
    if (given) {
      const t = await _englishText(given);
      if (t.fail) return res.status(502).json({ success: false, error: t.fail });
      given = _cleanText(t.text).slice(0, 600);
    }
    const entry = given === null ? await _askEnvMotion(url) : _keepEnvMotion(url, given);
    res.json({ success: true, path: url, entry });
  } catch (e) {
    console.error('[scen3/env/motion]', e.message);
    res.status(e.status || 502).json({ success: false, error: e.message });
  }
});

// ── Alerts: the server sees a generation through ────────────────────────────
// A generation started from Merge becomes a row in the journal (lib/alerts.js), and the runner
// (lib/gen-jobs.js) waits for it, files the result and writes the answer back into the row. The
// page that asked only follows the row, so leaving the page loses nothing - which is the whole
// point (docs/local-app/PLAN.md, "Alerts").
//
// `where` is what the panel says about itself - the project, the step, the level inside it - so
// the row in the journal can take you back to where the work was started.
const JOBS = require('../lib/gen-jobs');
// The journal itself, for the two questions the routes ask of it directly: is a clip of this
// fragment already running, and - when a clip is re-asked with fresh links - which task the record
// is now following (lib/alerts.js).
const ALERTS = require('../lib/alerts');
const REFUSAL = require('../lib/gen-refusal');
// The project's own timeline is a mirror of its lines (lib/frag-mirror.js, phase T'): every
// place below that changes what a line HAS asks for it to be laid again.
const MIRROR = require('../lib/frag-mirror');

const WHAT_TITLE = { lookbook: 'Lookbook', look: 'Look', environment: 'Environment' };

// What a second attempt would send: the same request, without the photo's bytes - the token is
// that same photo, still in scratch.
const _retryRequest = (b, out) => ({
  ...b, imageBase64: '', refToken: String((out && out.refToken) || b.refToken || ''),
});

function _journal(type, kind, out, b) {
  return JOBS.submitted({
    kind,
    what: type,
    title: String(b.title || '').trim() || WHAT_TITLE[type] || type,
    where: b.where,
    engine: out.engine || '',
    taskIds: [out.taskId],
    job: { type, params: { request: _retryRequest(b, out), file: out.file || {} } },
  });
}

// The look a project asked for is written into that project's casting here, because by the time it
// lands the page that asked may be closed. (phase V67) Through the cast route's own move (_applyCast) - its character with
// it, which the old patch of the look alone left behind - and NOT when it would put work aside: that is asked of the person
// (the look is there in "who" to press).
function _castMade(projectId, look) {
  const next = _normLook(look);
  if (!next || !next.obrazId) return null;
  let moved = false, asked = false;
  const saved = PROJECTS.apply(projectId, (fresh) => {
    const plan = _castPlan(fresh, next);
    if (plan.ask) { asked = true; return; }
    moved = _applyCast(fresh, next, plan, new Date().toISOString());
  });
  if (asked) console.log('[scen3] the look made is not put on ' + projectId + ': it would put work aside - the person decides');
  if (saved && moved) MIRROR.touch(projectId, { project: saved });
  return saved;
}
// A character's name as the Characters shelf has it now.
function _charNameOf(id) {
  const chars = _read(path.join(DATA_DIR, 'characters.json'));
  const arr = Array.isArray(chars) ? chars : (chars && chars.characters) || [];
  const ch = arr.find(c => String(c.id) === String(id || ''));
  return ch ? String(ch.name || '') : '';
}

// The three kinds Merge starts, and what finishing each one means. The waiting is the same for all
// three - ask kie about the task, and the answer lands in media/work.
const _pollTask = (rec) => H.resolveTask(rec.taskIds[0], CFG.MEDIA.work, 'generated');
const _fileParams = (rec) => ((rec.job || {}).params || {}).file || {};

// A ROW WRITTEN AT THE PRESS (phase I, the Library's chats): it exists before the agent has read
// anything and before there is a task, and is told the task when it is asked for. Until then it is
// "not started yet" - as long as the asking is still going on in this process. Its `kick` is the
// token of that asking: one that is not here any more died with the app, and the row says so at once
// instead of waiting out its time limit for a task nobody asked for. A row from Merge has its task
// from the start and never gets here.
const _asking = new Set();
function _pollMaker(rec) {
  if (rec.taskIds && rec.taskIds[0]) return _pollTask(rec);
  const kick = ((rec.job || {}).params || {}).kick;
  if (kick && _asking.has(kick)) return { state: 'pending' };
  return { state: 'failed', error: 'the app was closed before the picture was asked for - try again' };
}

// A chat's row whose first asking is still going on is not asked for again yet (lib/gen-jobs.js retry).
const _stillAsking = (rec) => _asking.has(((rec.job || {}).params || {}).kick);

JOBS.register('lookbook', {
  poll: _pollMaker,
  busy: _stillAsking,
  file: async (rec, landed) => {
    const filed = await _fileGenerated('lookbook', landed.imagePath, _fileParams(rec));
    return { path: filed.path, preview: filed.preview, from: filed.from || '', media: 'image' };
  },
  submit: async (request) => {
    const out = await _submitLookbook(request);
    return { taskId: out.taskId, engine: out.engine, file: out.file };
  },
});

JOBS.register('environment', {
  poll: _pollMaker,
  busy: _stillAsking,
  file: async (rec, landed) => {
    const filed = await _fileGenerated('environment', landed.imagePath, _fileParams(rec));
    return { path: filed.path, preview: filed.preview, from: filed.from || '', media: 'image' };
  },
  submit: async (request) => {
    const out = await _submitEnv(request);
    // A picture with no place in it asks a question instead of making anything, and a question
    // cannot be answered without the person.
    if (out.choose) throw new Error('that picture has no place in it - pick one on the page');
    return { taskId: out.taskId, engine: out.engine, file: out.file };
  },
});

JOBS.register('look', {
  poll: _pollTask,
  file: async (rec, landed) => {
    const p = _fileParams(rec);
    const saved = await _saveObraz({ ...p, imagePath: landed.imagePath });
    // Dressed for a project, so that project wears it - even with nobody looking. (phase V67) As the cast route casts it,
    // and only when that puts nothing aside: work to put aside is the person's question, at their press on the look.
    if (p.projectId) {
      try { _castMade(p.projectId, { characterId: p.charId, characterName: _charNameOf(p.charId) || p.charName, obrazId: String(saved.obrazId), obrazImage: saved.path }); }
      catch (e) { console.warn('[scen3] could not put the look on the project:', e.message); }
    }
    return { path: saved.path, preview: saved.preview, obrazId: saved.obrazId, media: 'image' };
  },
  submit: async (request) => {
    const out = await _submitDress(request);
    return { taskId: out.taskId, engine: out.engine, file: out.file };
  },
});

// ── Dressing: Apply one lookbook onto the sheet, or Re-dress the shown image ──
async function _submitDress(b) {
  const base = String(b.basePath || '').trim();       // the image being dressed
  const lb   = String(b.lookbookPath || '').trim();   // optional lookbook reference
  let note   = String(b.note || '').trim();           // optional clothing-only steering
  if (!base) throw Object.assign(new Error('basePath is required'), { status: 400 });
  if (!lb && !note) throw Object.assign(new Error('pick a lookbook or write a note'), { status: 400 });
  // (phase V29) A note in another language goes into the picture's prompt in English.
  if (note) {
    const t = await _englishText(note);
    if (t.fail) throw Object.assign(new Error('the note ' + t.fail), { status: 502 });
    note = t.text;
  }

  const urls = [await _hostLocal(base)];
  let prompt;
  let kind = 'outfit';
  if (lb) {
    urls.push(await _hostLocal(lb));
    // The agent reads both pictures before anything is generated: a mascot shell and a
    // jacket need opposite instructions, and only looking at them can tell which is which.
    const plan = await _readDressing(urls[0], urls[1], note, (_lbMeta()[lb] || {}).description);
    kind = plan.kind;
    prompt = plan.prompt + (kind === 'costume' ? COSTUME_LOCK : DRESS_LOCK);
  } else {
    prompt = 'Re-dress the person in the image according to this note: ' + note + '.' + DRESS_LOCK;
  }

  // keep the output in the base image's shape (a 16:9 sheet must stay 16:9)
  const aspect = (await _ratioOf(base)) || 'match_input_image';
  // 4K (the owner): the result is a reference sheet every frame of the ad is built from, so it is
  // the one picture in the chain that must not be soft. kie calls "follow the input" `auto`.
  const taskId = await _i2i(IMG_ENGINE, prompt, urls, aspect === 'match_input_image' ? 'auto' : aspect, DRESS_RES);
  if (!taskId) throw Object.assign(new Error('the engine did not accept the task'), { status: 502 });
  console.log(`[scen3/gen/dress] ${lb ? 'apply' : 're-dress'} kind=${kind} refs=${urls.length} res=${DRESS_RES}`);
  return {
    taskId, kind, prompt, mode: lb ? 'apply' : 'redress',
    // WHICH ENGINE MADE IT, for the look's record - said by the route that made it, not by the
    // engine setting a page may still send when it saves the look.
    engine: IMG_ENGINE,
    // A dressed picture is filed as a LOOK on the character, and when the dressing was asked for
    // by a project, that project wears it from then on.
    file: {
      charId: String(b.charId || ''), charName: String(b.charName || 'look'),
      gender: String(b.gender || ''), lookbookPath: lb, engine: IMG_ENGINE,
      projectId: String(b.projectId || ''),
    },
  };
}

router.post('/scen3/gen/dress', async (req, res) => {
  try {
    const b = req.body || {};
    const out = await _submitDress(b);
    res.json({ success: true, alertId: _journal('look', 'image', out, b).id, mode: out.mode, kind: out.kind });
  } catch (e) {
    console.error('[scen3/gen/dress]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// ── Save a dressed result as an obraz on the character ──────────────────────
// The user chose that dressed looks join the character's own library, so they show up on the Library's
// Characters shelf too. Writes are APPEND-ONLY and done here, on the server, so a racing writer cannot drop
// entries.
const OBRAZY_JSON = path.join(DATA_DIR, 'obrazy.json');
const OStore = require('../lib/obrazy-store');

// Filing a dressed picture as a look. A FUNCTION, not only a route: when the dressing is started
// from Merge the server finishes it itself (lib/gen-jobs.js), and that path must file it exactly
// the way the page used to (docs/local-app/PLAN.md, "Alerts").
async function _saveObraz(b) {
  const charId   = String(b.charId || '');
  const charName = String(b.charName || 'look');
  const src      = String(b.imagePath || '');
  if (!charId) throw Object.assign(new Error('charId is required'), { status: 400 });

  const hit = _resolveMedia(src);
  if (!hit || !fs.existsSync(hit.abs)) throw Object.assign(new Error('image not found'), { status: 400 });

    // Refuse to touch the library if it exists but cannot be parsed — appending
    // to a fresh array would silently wipe every obraz the user owns.
  let list = [];
  if (fs.existsSync(OBRAZY_JSON)) {
    const parsed = _read(OBRAZY_JSON);
    if (!Array.isArray(parsed)) {
      throw Object.assign(new Error('obrazy.json is unreadable - refusing to write'), { status: 500 });
    }
    list = parsed;
  }

  const id   = String(Date.now());
  const name = `${charName} - look ${new Date().toISOString().slice(0, 10)}`;
  const folder = OStore.obrazAbsFolder(name, id);
  fs.mkdirSync(folder, { recursive: true });

  const file   = path.basename(hit.abs);
  const destAbs = path.join(folder, file);
  if (!fs.existsSync(destAbs)) fs.copyFileSync(hit.abs, destAbs);
  const rel = toUrl(destAbs);

  // both derived tiers, so the gallery and the centre column are instant
  try { await H.createThumbnail(destAbs, path.join(folder, 'thumbs', file.replace(/\.[^.]+$/, '') + '.jpg')); } catch (e) {}
  let preview = rel;
  try {
    if (await needsPreview(destAbs)) {
      const outAbs = path.join(folder, 'preview', file.replace(/\.[^.]+$/, '') + '.jpg');
      if (!fs.existsSync(outAbs)) await makePreview(destAbs, outAbs);
      preview = toUrl(outAbs);
    }
  } catch (e) {}

  list.unshift({
    id, charId, name,
    char: rel,
    variations: [rel],
    pool: [{ file: rel, card: 1, final: true }],
    gender: String(b.gender || ''),
    lb: b.lookbookPath || null,
    env: null,
    imageEngine: String(b.engine || DEFAULT_ENGINE),
    date: new Date().toISOString(),
    seed: null, slotTasks: {}, projectId: null, voice: null,
  });
  writeFileAtomic(OBRAZY_JSON, JSON.stringify(list, null, 2));
  console.log(`[scen3/obraz-save] char=${charId} obraz=${id} -> ${rel} (library now ${list.length})`);
  return { obrazId: id, path: rel, preview };
}


// ── Filing a finished picture ───────────────────────────────────────────────
// Filing a finished picture where it belongs: a lookbook or an environment onto its shelf, with its
// description, the photo it was made from and a preview for the centre column. A FUNCTION for the
// same reason _saveObraz is one - a generation started in Merge is finished by the server
// (lib/gen-jobs.js), and it has to be filed exactly as the page used to file it.
async function _fileGenerated(kind, src, b) {
  const hit = _resolveMedia(src);
  if (!hit || !fs.existsSync(hit.abs)) throw Object.assign(new Error('result not found'), { status: 400 });

  let finalUrl = src;

  // A generated environment or lookbook is filed into its shared library folder.
  const LIB = kind === 'environment'
    ? { dir: CFG.ENVIRONMENTS_DIR, mount: toUrl(CFG.ENVIRONMENTS_DIR), prefix: 'env_' }
    : kind === 'lookbook'
      ? { dir: CFG.LOOKBOOKS_DIR, mount: toUrl(CFG.LOOKBOOKS_DIR), prefix: 'lb_' }
      : null;

  if (LIB) {
    const name = LIB.prefix + path.basename(hit.abs).replace(/\.[^.]+$/, '') + '.jpg';
    const dest = path.resolve(LIB.dir, name);
    fs.mkdirSync(LIB.dir, { recursive: true });
    if (!fs.existsSync(dest)) fs.copyFileSync(hit.abs, dest);
    finalUrl = LIB.mount + '/' + name;
    try { await H.createThumbnail(dest, path.resolve(LIB.dir, 'thumbs', name)); } catch (e) {}
  }

  // The photo it was made from, now that there is something made from it: into Images, and its
  // address beside the description, so the viewer can say what this came from.
  let from = '';
  if (LIB && b.refToken) {
    try { from = await _fileRef(String(b.refToken), kind, String(b.refName || '')); }
    catch (e) { console.warn('[scen3/finalize] could not file the reference:', e.message); }
  }
  // A picture that came by its path is in the library already (phase I).
  if (LIB && !from && b.from) from = String(b.from);

  if (kind === 'lookbook') {
    // The gender the caller resolved in parallel with the generation, and WHAT THIS IS: the
    // long description the agent wrote, filed here because this is where the picture gets
    // its final path - the key everything else refers to it by. A lookbook made before this
    // existed simply has no entry, and behaves as it always did.
    const gender = String(b.gender || '').toLowerCase();
    const description = String(b.description || '').trim();
    const prompt = String(b.prompt || '').trim();
    if (GENDER_VALUES.includes(gender) || description || from) {
      const m = _lbMeta();
      m[finalUrl] = {
        ...(GENDER_VALUES.includes(gender) ? { gender } : {}),
        ...(description ? { description } : {}),
        ...(prompt ? { prompt } : {}),
        ...(from ? { from } : {}),
        at: new Date().toISOString(),
      };
      _lbMetaSave(m);
    }
  }

  if (kind === 'environment') {
    // The same for a place: what the agent wrote about it is what the first frames will be
    // composed from later, and it is filed under the path the shelf knows it by.
    const description = String(b.description || '').trim();
    const prompt = String(b.prompt || '').trim();
    if (description || prompt || from) {
      const m = SHELF_META.read('environments');
      m[finalUrl] = {
        ...(description ? { description } : {}),
        ...(prompt ? { prompt } : {}),
        ...(from ? { from } : {}),
        at: new Date().toISOString(),
      };
      SHELF_META.write('environments', m);
    }
  }

  // the preview for the centre column
  let previewUrl = finalUrl;
  try {
    const fh = _resolveMedia(finalUrl);
    if (fh && await needsPreview(fh.abs)) {
      const out = _previewTarget(fh);
      if (!fs.existsSync(out.abs)) await makePreview(fh.abs, out.abs);
      previewUrl = out.url;
    }
  } catch (e) { console.warn('[scen3/finalize] preview failed:', e.message); }

  return { path: finalUrl, preview: previewUrl, ...(from ? { from } : {}) };
}

// ── voice moods ─────────────────────────────────────────────────────────────
// A mood is what the user picks in Montage; its `tags` are the ONLY ones the tagging
// pass may insert. The set is deliberately small: a short vocabulary is placed far
// more consistently than a menu of two hundred, and a tag the model does not know
// risks being SPOKEN instead of performed.
//
// Seeded from lib/voice-tags.js, then editable on disk like the frame presets. Every
// tag is checked against that library's tts-safe list, so an edit cannot smuggle in
// an accent or a stage direction — neither of which a TTS model can act on.
const VT = require('../lib/voice-tags');
const MP = require('../lib/motion-presets');
const TH = require('../lib/th-video');
const SDP = require('../lib/sd-prompt');
// (phase V26.8) The writer of a Seedance fragment's performance (thinkTalk).
const AGENT = require('../lib/mv3-agent');
const VF = require('../lib/voice-filters');
const VD = require('../lib/voice-demo');
const VSHELF = require('../lib/voice-shelf');


// What the general zone's menus offer: the models of the clips, each with its qualities and what a
// second of them costs (phase V26.8, lib/th-video.js), Seedance's ways of voicing a clip, and the
// moods - with a few words on how each moves the body, for the gestures menu. No defaults (phase
// V24): a project made since starts at none and the person chooses.
router.get('/scen3/motion-presets', (_req, res) => {
  res.json({
    success: true,
    models: TH.models(),
    sounds: TH.SOUNDS,
    moods: MP.MOODS.map(m => ({ id: m.id, label: m.label, about: m.about, gloss: m.gloss })),
  });
});

// The whole tag library, for the help panel. Read-only: it is reference material,
// and it carries which tags are delivery instructions, which are voice casting and
// which are body language for the video prompt rather than the spoken text.

// ── the casting director: inserting voice tags ──────────────────────────────
// One call over the WHOLE script, never line by line: the mood briefs describe an arc
// across the ad, and a model shown one line at a time cannot place a turn or hold a
// build. Nothing is sent to TTS here — the user reads what was inserted first.
//
// Two guards make the promise "the words never change" real rather than hopeful:
//
//   1. Every returned line is stripped of its brackets and compared with the original.
//      A single altered word rejects that line.
//   2. Any tag outside the chosen mood's list is removed. An unknown tag is not a
//      harmless extra: ElevenLabs v3 will SPEAK it.

const _stripTags = (s) => String(s || '').replace(/\[[^\]]*\]/g, ' ');
// what the comparison actually compares: the words, with spacing made irrelevant
const _words = (s) => _stripTags(s).replace(/\s+/g, ' ').trim();

// Drop tags the mood does not list, then tidy the spacing the removals leave behind.
function _keepAllowedTags(text, allowed) {
  const set = new Set(allowed.map(t => t.toLowerCase()));
  const dropped = [];
  const out = String(text || '').replace(/\[([^\]]*)\]/g, (m, inner) => {
    const tag = String(inner).trim().toLowerCase();
    if (set.has(tag)) return '[' + tag + ']';
    dropped.push(tag);
    return ' ';
  });
  return { text: out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim(), dropped };
}

function _tagPrompt(mood, lines) {
  const tags = mood.tags.map(t => '[' + t + ']').join(' ');
  return VT.CASTING_DIRECTOR_ROLE
    + `\n\nMOOD: ${mood.label}\n${mood.brief}`
    + `\n\nYou may use ONLY these tags, spelled exactly like this: ${tags}`
    + '\n\nRules:'
    + '\n- NEVER change, add, remove or reorder a single word. Punctuation stays exactly as it is.'
    + ' You are only inserting [tags] between the existing words.'
    + '\n- A tag goes immediately before the words it affects.'
    + (mood.voiceover
      // (phase V62, (во28)) A voiceover is often ONE long line: tags go by its sentences, or the mood would be one tag deep.
      ? '\n- Tag by SENTENCES, not by lines: one or two tags every few sentences, wherever a tag changes how those'
        + ' sentences are delivered. A line may be many sentences long - tag through it, all the way to its end.'
      : '\n- Most lines take one or two tags. Some take none: if a tag would not change how the'
        + ' line is delivered, leave that line untouched.')
    + '\n- Never place two tags next to each other.'
    + '\n- Shape the arc described above ACROSS the whole script. Where the read should be flat,'
    + ' leave it flat, so the marked moments actually stand out.'
    + `\n\nThe script has ${lines.length} lines. Reply with strict JSON only:`
    + '\n{"lines":["line 1 with tags", "line 2 with tags", ...]}'
    + `\nexactly ${lines.length} strings, in the same order.`
    + '\n\nLines:\n' + lines.map((t, i) => `${i + 1}. ${t}`).join('\n');
}

async function _tagOnce(mood, texts) {
  const raw = await _ask([{ role: 'user', content: _tagPrompt(mood, texts) }]);
  const j = H.parseLooseJson(raw);
  const got = (j && Array.isArray(j.lines)) ? j.lines.map(x => String(x == null ? '' : x)) : null;
  if (!got || got.length !== texts.length) {
    throw new Error(`the model returned ${got ? got.length : 'no'} lines for ${texts.length}`);
  }
  return got;
}

// Re-tag SOME lines without touching the rest. The whole script still goes in, with
// the tags the other lines already carry, because the mood briefs describe an arc:
// a line marked in isolation gets a tag that argues with its neighbours. What comes
// back is only the lines that were asked for.
function _retagPrompt(mood, lines, want) {
  const tags = mood.tags.map(t => '[' + t + ']').join(' ');
  const body = lines.map((l, i) => {
    // A line being re-tagged is shown by its CURRENT words, never by its old tagged
    // take: that take is stale precisely because the words changed under it. Showing
    // it would have the model mark up wording that no longer exists, and the guard
    // would then reject the answer for not matching.
    const cur = want.includes(i) ? l.text : (l.tagged || l.text);
    const mark = want.includes(i) ? '  <-- RE-TAG THIS LINE' : '';
    return `${i + 1}. ${cur}${mark}`;
  }).join('\n');
  return VT.CASTING_DIRECTOR_ROLE
    + `\n\nMOOD: ${mood.label}\n${mood.brief}`
    + `\n\nYou may use ONLY these tags, spelled exactly like this: ${tags}`
    + '\n\nThe script below is already marked up, except for the lines flagged RE-TAG.'
    + ' Those lines were edited and their old tags no longer fit the words.'
    // A line that reads like a note rather than like ad copy invites the model to
    // write copy instead of tagging it. Restating the exact words as final, quoted
    // text is what stops that: they are the deliverable, not a brief.
    + '\n\nThese are the FINAL words of the flagged line(s). They are the script itself,'
    + ' not a description of what to write. You are not writing copy — you are only'
    + ' inserting [tags] between these exact words, however they read:\n'
    + want.map(i => `${i + 1}. "${lines[i].text}"`).join('\n')
    + '\n\nRules:'
    + '\n- Return ONLY the flagged lines. Leave every other line alone; they are approved.'
    + '\n- Match the pattern the surrounding lines already establish, so the arc still reads'
    + ' as one performance. Do not restart the arc.'
    + '\n- NEVER change, add, remove or reorder a word of the flagged line. Punctuation stays'
    + ' exactly as it is. You are only inserting [tags] between the existing words.'
    + (mood.voiceover
      ? '\n- Tag by sentences: one or two tags every few sentences of the flagged line, all the way to its end.'
      : '\n- One or two tags, or none at all if the line is better plain.')
    + '\n\nReply with strict JSON only:'
    + '\n{"lines":[{"n":<line number>,"text":"the line with tags"}]}'
    + `\nexactly ${want.length} entr${want.length === 1 ? 'y' : 'ies'}, for line(s) ${want.map(i => i + 1).join(', ')}.`
    + '\n\nScript:\n' + body;
}

async function _retagOnce(mood, lines, want) {
  const raw = await _ask([{ role: 'user', content: _retagPrompt(mood, lines, want) }]);
  const j = H.parseLooseJson(raw);
  const arr = (j && Array.isArray(j.lines)) ? j.lines : null;
  if (!arr) throw new Error('the model returned no lines');
  const out = {};
  arr.forEach(e => {
    const n = parseInt((e && e.n), 10);
    if (Number.isInteger(n) && want.includes(n - 1)) out[n - 1] = String((e && e.text) || '');
  });
  const missing = want.filter(i => out[i] === undefined);
  if (missing.length) throw new Error(`no answer for line(s) ${missing.map(i => i + 1).join(', ')}`);
  return out;
}

// (phase V26.8) The tags are written into the lines by their numbers when the tagger answers: a line put in meanwhile
// waits (_holdLines).
router.post('/scen3/voice/tag', async (req, res) => {
  const free = _holdLines((req.body || {}).projectId);
  try { await _tagRoute(req, res); } finally { free(); }
});
async function _tagRoute(req, res) {
  try {
    const id = String((req.body || {}).projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'projectId is required' });

    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: `no project "${id}"` });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);

    // A line TAKEN OFF the script (phase Z) is tagged with the rest, and deliberately: tags belong
    // to the WORDS, not to the cut, so a line put back comes back already marked and needs no
    // second pass. It costs nothing - it is the same one call - and the zone that asks for the
    // tagging counts only the lines that are in the video when it decides it is done.
    const lines = (proj.lines || []).map(_normLine);
    const texts = lines.map(l => l.text);
    if (!texts.some(t => t.trim())) return res.status(400).json({ success: false, error: 'this project has no lines' });

    const voice = _normVoice(proj.voice);
    // The mood of the VIDEO, always: one vocabulary for the read, the frames and the animation
    // (lib/motion-presets.js; docs/local-app/PLAN.md, phase W). Every line touched gets its words
    // back as `tagged`, marked or not, so the tagged read IS the read and the project is switched
    // to it. The second caller - the Scenarios page, with a mood list of its own - went with the
    // page in phase G, and its list went with it.
    const vm = req.body.mood ? MP.moodById(String(req.body.mood)) : null;
    if (!vm) return res.status(400).json({ success: false, error: req.body.mood ? 'no such mood' : 'a mood is needed' });
    const merge = true;
    const mood = { id: vm.id, label: vm.label, brief: vm.brief, tags: vm.tags, voiceover: proj.type === 'voiceover' };

    // `only` re-tags just those lines, leaving every approved line untouched. Sent
    // empty (or absent) it is a full pass over the script.
    const only = Array.isArray(req.body.only)
      ? [...new Set(req.body.only.map(n => parseInt(n, 10)).filter(n => n >= 0 && n < lines.length))].sort((a, b) => a - b)
      : [];
    const partial = only.length > 0;

    // One retry, and it is told what went wrong: a rewritten word is the failure this
    // pass makes most often, and naming it is usually enough.
    let got = null, lastErr = '';
    for (let attempt = 1; attempt <= 2 && !got; attempt++) {
      try {
        const answer = partial
          ? await _retagOnce(mood, lines, only)
          : await _tagOnce(mood, texts);
        const idx = partial ? only : texts.map((_, i) => i);
        const changed = idx.filter(i => _words(answer[i]) !== _words(texts[i]));
        if (!changed.length) { got = answer; break; }
        lastErr = `the wording changed on line(s) ${changed.map(i => i + 1).join(', ')}`;
        console.warn(`[scen3/voice/tag] attempt ${attempt}: ${lastErr}`);
        if (attempt === 2) got = answer;      // keep it; the mismatched lines fall back below
      } catch (e) {
        lastErr = e.message;
        console.warn(`[scen3/voice/tag] attempt ${attempt} failed: ${e.message}`);
      }
    }
    if (!got) return res.status(502).json({ success: false, error: lastErr || 'the tagging pass failed' });

    const report = { tagged: 0, plain: 0, rejected: [], dropped: [], only };
    const touch = partial ? only : lines.map((_, i) => i);
    touch.forEach(i => {
      const l = lines[i];
      const cand = got[i] || '';
      if (_words(cand) !== _words(l.text)) {
        // the words moved: refuse this line rather than quietly altering the script.
        // Clearing `tagged` is deliberate — a stale take is worse than none, because
        // it would be voiced with the wrong words.
        report.rejected.push(i + 1);
        l.tagged = '';
        return;
      }
      const kept = _keepAllowedTags(cand, mood.tags);
      if (kept.dropped.length) report.dropped.push({ line: i + 1, tags: [...new Set(kept.dropped)] });
      const has = /\[[^\]]*\]/.test(kept.text);
      l.tagged = (has || merge) ? kept.text : '';
      if (has) report.tagged++; else report.plain++;
    });

    // The tagger thought for a while, and reads and clips write this project meanwhile (phase X0):
    // the record is read AGAIN and only the tags of the lines this pass touched are put on it.
    const saved = PROJECTS.apply(id, (fresh) => {
      fresh.lines = (fresh.lines || []).map(_normLine);
      for (const i of touch) if (fresh.lines[i]) fresh.lines[i].tagged = lines[i].tagged;
      fresh.voice = _normVoice({ ...(fresh.voice || {}), ...voice });
      if (merge) {
        // v3 from here on: the tagged read is what the counters read and what every line is spoken from.
        fresh.voice.tagsOn = true;
        fresh.voice.variant = 'tagged';
      } else if (report.tagged > 0 && lines.some(l => l.tagged)) {
        // The take on show follows the work: after a pass that produced tags, the tagged read is
        // what the user asked to see.
        fresh.voice.variant = 'tagged';
      }
      fresh.updatedAt = new Date().toISOString();
    });
    const out = saved || proj;
    console.log(`[scen3/voice/tag] ${id} mood=${mood.id}`
      + (partial ? ` only=${only.map(i => i + 1).join(',')}` : ' full')
      + ` tagged=${report.tagged} plain=${report.plain}`
      + ` rejected=${report.rejected.length} droppedTags=${report.dropped.length}`);
    res.json({ success: true, project: _projFull(out), report });
  } catch (e) {
    console.error('[scen3/voice/tag]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
}

// ── the read: ElevenLabs ─────────────────────────────────────────────────────
// Two models, and the switch between them is the tag checkbox rather than a separate
// choice: v3 performs [tags], v2 has no idea what they are and would read the brackets
// out loud as words. Both ids were confirmed against the live account.
const EL_MODEL_PLAIN  = 'eleven_multilingual_v2';
const EL_MODEL_TAGGED = 'eleven_v3';
const EL_TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

const _elKey = () => {
  const s = _read(path.join(DATA_DIR, 'settings.json')) || {};
  return String(s.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || '').trim();
};

// Duration straight out of ffmpeg's own header dump — no ffprobe dependency. The clip length
// will be read off this later.
function _audioDur(file) {
  return new Promise(resolve => {
    let out = '';
    try {
      const proc = require('child_process').spawn(require('ffmpeg-static'),
        ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      proc.stderr.on('data', c => { out += c.toString(); });
      proc.on('error', () => resolve(0));
      proc.on('close', () => {
        const m = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
        resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0);
      });
    } catch (e) { resolve(0); }
  });
}

// (phase V62) A voiceover is read in the language it is written in: Cyrillic - Russian, plain English letters only - English,
// anything else (Spanish with its ñ, German with its ü...) - nothing said, v3 decides by itself. A talking head's lines are
// always English (V29).
const _langOfText = (t) => {
  const s = String(t || '').replace(/\[[^\]]*\]/g, ' ');           // the mood's [tags] are English whatever the line is
  if (/\p{Script=Cyrillic}/u.test(s)) return 'ru';
  return /\p{L}/u.test(s) && !/[^\x00-\x7F]/.test(s.replace(/[‘’“”–—… ]/g, '')) ? 'en' : null;
};
// (phase V62, (во28)) A voiceover's line, at most: ElevenLabs v3 reads 5 000 characters at a time, tags included - 500 are
// left for the mood's tags. The page's fields stop at it too.
const VO_MAX = 4500;

async function _speakLine(key, voiceId, model, text, params, lang) {
  const code = lang === undefined ? 'en' : lang;
  const r = await axios.post(
    `${EL_TTS_BASE}/${encodeURIComponent(voiceId)}`,
    {
      text,
      model_id: model,
      // (phase V29) Every line is English, and v3 is told so - its accent does not drift with a name or a loan word.
      // multilingual_v2 does not take the code (ElevenLabs' reference, 2026-10-14) and is sent nothing. A voiceover's
      // line says its own (V62, `lang`).
      ...(model === EL_MODEL_TAGGED && code ? { language_code: code } : {}),
      voice_settings: {
        stability: typeof params.stability === 'number' ? params.stability : 0.5,
        similarity_boost: 0.75,
        // Always 1: v3 takes no speed, so the project's speed is applied to the file afterwards (_tempo).
        speed: 1,
      },
    },
    // Two minutes for a line of a talking head; a voiceover's line of up to 4 500 characters (~5 minutes of speech, V62)
    // is given longer by its length.
    { headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      responseType: 'arraybuffer', timeout: Math.max(120000, String(text || '').length * 80) },
  );
  return Buffer.from(r.data);
}

/* ── The read, and who drives it (phase X2) ─────────────────────────────
   POST /api/scen3/voice/speak      { projectId, only? }  -> { success, project, report }
   POST /api/scen3/voice/speak-all  { projectId }         -> { success, queued, state }
   GET  /api/scen3/voice/state      ?projectId=           -> { success, state }

   The page used to drive the whole script: three lines per call, and the next three only after the
   previous three had answered. Leaving the page mid-read left the rest unread, and the same shape
   in the clips is what lost the owner four fragments (PLAN, phase X). So the SERVER reads the
   script now: `speak-all` works out what needs reading, answers at once, and starts one line a
   second without waiting for the ones already going. The page follows `state`.

   Reads are NOT in the journal (decided in phase A: a dozen quick rows would bury the things worth
   waiting for, and phase X3 measures the wait from that journal). The progress lives in memory and
   the truth lives in the project, so closing the app mid-read keeps every take already spoken and
   simply leaves the rest unread - one press finishes them.
   ─────────────────────────────────────────────────────────────────────────── */
const READ_GAP_MS = 1000;
// HOW MANY MAY BE SPEAKING AT ONCE (phase N, the owner 2026-09-23, after ElevenLabs refused a run
// saying five is the limit). The queue starts a line a second and waits for none of them, so a
// script of ten with a six-second read had seven in the air. Four, not five: a line read by hand
// from the fragment's own menu goes through the same gate, and it must not be the one that breaks
// it. The gate is the PROCESS's, not the queue's, for exactly that reason.
const READ_AT_ONCE = 4;
let _speaking = 0;
const _speakWaiting = [];
async function _speakSlot() {
  if (_speaking < READ_AT_ONCE) { _speaking++; return; }
  await new Promise(r => _speakWaiting.push(r));
  _speaking++;
}
function _speakDone() {
  _speaking = Math.max(0, _speaking - 1);
  const next = _speakWaiting.shift();
  if (next) next();
}
const _reads = new Map();                 // projectId -> { total, done, skipped, failed, running }

// What ElevenLabs actually said, when it said no: the body of its answer beats "Request failed".
const _elError = (e) => (e.response && e.response.data
  ? Buffer.from(e.response.data).toString('utf8').slice(0, 200)
  : (e.message || String(e)));

const _readTextOf = (l, variant) => (variant === 'tagged' ? (l.tagged || '') : (l.text || ''));
// A take is stale when the words it was made from are no longer the words on the line.
const _readNeeds = (l, variant) => {
  const t = (l.audio || {})[variant];
  return !t || !t.path || t.said !== _readTextOf(l, variant);
};

// Everything one read of this project needs, worked out once.
function _readCtx(proj) {
  const voice = _normVoice(proj.voice);
  const variant = voice.variant === 'tagged' ? 'tagged' : 'plain';
  return {
    id: String(proj.id),
    voiceover: proj.type === 'voiceover',
    lines: (proj.lines || []).map(_normLine),
    voice,
    variant,
    model: voice.tagsOn && variant === 'tagged' ? EL_MODEL_TAGGED : EL_MODEL_PLAIN,
    // The cast character's voice when they have one; the project's own pick before a character is
    // cast, or for a character without a voice (phase W2.5). One ad, one voice, and the same rule
    // the page shows (_castVoice). Saying plainly what is missing beats a 404 from ElevenLabs.
    cast: _castVoice(proj),
    dir: PROJECTS.dirOf(proj.id, 'voice'),
  };
}

// ONE LINE SPOKEN AND FILED. ElevenLabs takes seconds, and nothing of this project is written while
// it speaks: the take goes on in a single tick afterwards (lib/projects-store.js, `apply`). That is
// what lets ten of these run at once without losing each other's takes.
async function _speakOne(key, ctx, i) {
  const line = ctx.lines[i] || {};
  const text = _readTextOf(line, ctx.variant);
  if (!text.trim()) return { skipped: true };
  // Through the gate: at most four of these are inside ElevenLabs at any moment (N2). Everything
  // after the call is ours - the file, the length, the one-tick write - so the slot is given back
  // as soon as the sound is in hand, not when the project has been saved.
  await _speakSlot();
  let buf;
  try { buf = await _speakLine(key, ctx.cast.id, ctx.model, text, ctx.voice.ttsParams, ctx.voiceover ? _langOfText(line.text || text) : undefined); }
  finally { _speakDone(); }
  const name = `v${ctx.id}_${i + 1}_${ctx.variant}_${Date.now()}.mp3`;
  const abs = path.join(ctx.dir, name);
  fs.writeFileSync(abs, buf);
  const { stability } = ctx.voice.ttsParams;
  const speed = _speedOf(line, ctx);
  // Read again only because the settings changed - the same words - and the line's clip stays the
  // line's until a new one is made (the owner, 2026-10-10).
  const keep = !!_unsettled(line, ctx);
  // At another speed, the file ElevenLabs sent is kept as it is and the take plays a retimed copy.
  const play = speed === 1 ? abs : await _tempo(abs, speed);
  const dur = await _audioDur(play);
  const take = {
    path: toUrl(play),
    ...(play !== abs ? { raw: toUrl(abs) } : {}),
    dur: Math.round(dur * 100) / 100,
    at: new Date().toISOString(),
    said: text,                           // what was actually spoken; the staleness check reads this
    stability, speed,                     // what it was spoken with (V26.1)
  };
  return { take: _fileTake(ctx, i, take, '', keep) };
}

// The take goes onto its line in one tick, and the timeline follows.
// `keep` (phase V26.1, the owner 2026-10-10): the read is redone only because the stability or the speed
// changed - the same words - so the clip the line has now (chosen by hand, else the last made from this
// frame and this read) is CHOSEN for it and stays on the timeline with its own sound until a new clip is
// made. Otherwise a new read is asked for a new performance and the choice goes (V23).
function _fileTake(ctx, i, take, ifPath, keep, quiet) {
  const saved = PROJECTS.apply(ctx.id, (fresh) => {
    fresh.lines = (fresh.lines || []).map(_normLine);
    const l = fresh.lines[i];
    if (!l) return;
    l.audio = l.audio || { plain: null, tagged: null };
    // A retiming is of THAT take: if the line was read again meanwhile, the new read stands.
    if (ifPath && ((l.audio[ctx.variant] || {}).path || '') !== ifPath) return;
    const held = keep ? _clipNow(fresh, l, i, ctx.variant) : '';
    l.audio[ctx.variant] = take;
    // (phase V62, (во36)) A VOICEOVER DRAFT IS A PROJECT FROM ITS FIRST READ: the reads are its files. Its name - the
    // scenario's or the text's - and its folder were given when its script was chosen (/scen3/projects/:id/script).
    if (fresh.draft) delete fresh.draft;
    if (held) l.chosen = { ...(l.chosen || {}), [ctx.variant]: held };
    else if (l.chosen) l.chosen = { ...l.chosen, [ctx.variant]: '' };
    fresh.updatedAt = take.at;
  });
  // The timeline mirrors the lines (T') - unless the caller re-lays it once itself, after several (`quiet`).
  if (saved && !quiet) MIRROR.touch(saved.id, { project: saved });
  return take;
}

// A READ AT ANOTHER SPEED (phase V26.1): ffmpeg's atempo keeps the pitch of the voice. The copy is
// written beside the original with the speed in its name; the original stays, so the next speed is
// made from what ElevenLabs sent and not from a copy of a copy.
function _tempo(abs, speed) {
  const out = abs.replace(/\.mp3$/i, '') + '_x' + speed.toFixed(2) + '_' + Date.now() + '.mp3';
  return new Promise((resolve, reject) => {
    let err = '';
    const proc = require('child_process').spawn(require('ffmpeg-static'),
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', abs, '-filter:a', 'atempo=' + speed.toFixed(2),
        '-c:a', 'libmp3lame', '-b:a', '128k', out],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    proc.stderr.on('data', c => { err += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 && fs.existsSync(out) ? resolve(out)
      : reject(new Error('the read could not be retimed' + (err ? ': ' + err.trim().slice(0, 160) : '')))));
  });
}

// Was this line read with the settings the project has now? A take from before them was spoken at
// natural and 1. Only a READ line can be unsettled - one not read is simply to be read.
function _unsettled(l, ctx) {
  const t = (l.audio || {})[ctx.variant];
  if (!t || !t.path || _readNeeds(l, ctx.variant)) return '';
  const want = ctx.voice.ttsParams;
  const st = t.stability === undefined ? 0.5 : t.stability;
  if (st !== want.stability) return 'stability';
  return (t.speed || 1) !== _speedOf(l, ctx) ? 'speed' : '';
}

// The speed a line is read at: its own when it has one (set in its fragment), else the project's.
const _speedOf = (l, ctx) => (l && l.speed) || ctx.voice.ttsParams.speed;

// The clip a line has NOW, by the rule the timeline lays it by (lib/frag-mirror.js _clipOf): chosen by
// hand, else the last made from the frame it opens on, of these words and this read. '' when none.
function _clipNow(proj, l, i, variant) {
  const takes = ((l.video || {})[variant] || []).filter(c => c && c.path);
  if (!takes.length) return '';
  const hand = String((l.chosen || {})[variant] || '');
  if (hand && takes.some(c => c.id === hand)) return hand;
  const video = _normVideo(proj.video);
  const frame = _frameOfLine(_framePool(proj), l, i, video.spread, proj.id);
  if (!frame || !frame.id) return '';
  const said = variant === 'tagged' ? (l.tagged || '') : (l.text || '');
  const take = (l.audio || {})[variant];
  const fresh = takes.filter(c => c.fromFrame === frame.id && c.said === said && (!c.fromAudio || !take || c.fromAudio === take.path));
  if (!fresh.length) return '';
  const picked = fresh.find(c => c.id === String((l.pick || {})[variant] || ''));
  return (picked || fresh[fresh.length - 1]).id;
}

// ONLY THE SPEED IS OTHER: made again from the original file, free, without ElevenLabs.
async function _retempoOne(ctx, i, quiet) {
  const t = (ctx.lines[i].audio || {})[ctx.variant];
  const rawUrl = t.raw || t.path;
  const rawAbs = toDiskWithin(rawUrl, [CFG.PROJECTS_DIR]);
  if (!rawAbs || !fs.existsSync(rawAbs)) throw new Error('the original read is gone - read the line again');
  const speed = _speedOf(ctx.lines[i], ctx);
  const play = speed === 1 ? rawAbs : await _tempo(rawAbs, speed);
  const dur = await _audioDur(play);
  const take = {
    ...t,
    path: toUrl(play),
    dur: Math.round(dur * 100) / 100,
    at: new Date().toISOString(),
    speed,
  };
  delete take.id;                         // a new file has its own handle (_normTake derives it)
  if (play === rawAbs) delete take.raw; else take.raw = rawUrl;
  return { take: _fileTake(ctx, i, take, t.path, true, quiet) };
}

// Which lines a read is about: the ones named, or every one that needs it. Without an explicit
// `only` nobody pays twice for the same words.
// `settle` (the voice field's own `generate`, V26.1) counts in the lines read with other settings
// too; the chain and every other caller read only what is not read.
function _readWanted(ctx, only, settle) {
  const live = (i) => !(ctx.lines[i] || {}).removed;      // a line taken off is not read (phase Z)
  if (Array.isArray(only)) {
    return [...new Set(only.map(n => parseInt(n, 10)).filter(n => n >= 0 && n < ctx.lines.length))]
      .filter(live).sort((a, c) => a - c);
  }
  return ctx.lines.map((_, i) => i).filter(i => live(i)
    && (_readNeeds(ctx.lines[i], ctx.variant) || (settle && _unsettled(ctx.lines[i], ctx))));
}

// The project as it is NOW - with every take these reads filed - for the page to paint from.
const _projNow = (id) => {
  const p = _loadProjects().find(x => String(x.id) === String(id));
  return p ? _projFull(p) : null;
};

// The lines this call is about, spoken together and answered for: one press of a fragment's own
// button, or an explicit list. (phase V26.8) Each read lands on its line by number: a line put in meanwhile waits.
router.post('/scen3/voice/speak', async (req, res) => {
  const free = _holdLines((req.body || {}).projectId);
  try { await _speakRoute(req, res); } finally { free(); }
});
async function _speakRoute(req, res) {
  try {
    const b  = req.body || {};
    const id = String(b.projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'projectId is required' });
    const key = _elKey();
    if (!key) return res.status(400).json({ success: false, error: 'no ElevenLabs key in settings' });
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: `no project "${id}"` });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);

    const ctx = _readCtx(proj);
    if (!ctx.cast.has) return res.status(400).json({ success: false, error: ctx.cast.reason });
    const only = _readWanted(ctx, b.only);

    const report = { variant: ctx.variant, model: ctx.model, spoken: 0, skipped: [], failed: [] };
    await Promise.all(only.map(async (i) => {
      try {
        const out = await _speakOne(key, ctx, i);
        if (out.skipped) report.skipped.push(i + 1); else report.spoken++;
      } catch (e) {
        const why = _elError(e);
        console.warn(`[scen3/voice/speak] line ${i + 1} failed:`, why);
        report.failed.push({ line: i + 1, error: why });
      }
    }));
    report.skipped.sort((a, c) => a - c);
    report.failed.sort((a, c) => a.line - c.line);
    console.log(`[scen3/voice/speak] ${id} ${ctx.model} ${ctx.variant} spoken=${report.spoken}`
      + ` skipped=${report.skipped.length} failed=${report.failed.length}`);
    res.json({ success: true, project: _projNow(id), report });
  } catch (e) {
    console.error('[scen3/voice/speak]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
}

// THE WHOLE SCRIPT, READ BY THE SERVER. One line a second, and none of them waits for another.
async function _readQueue(key, ctx, only) {
  const st = _reads.get(ctx.id);
  const going = [];
  let spoken = 0;
  for (const i of only) {
    // A line that is read and only at another speed is retimed here, without ElevenLabs - and
    // without the gap, which is there for ElevenLabs (V26.1).
    const retime = _unsettled(ctx.lines[i], ctx) === 'speed';
    if (!retime && spoken++) await _wait(READ_GAP_MS);
    going.push((retime ? _retempoOne(ctx, i) : _speakOne(key, ctx, i)).then(
      (out) => { if (out.skipped) st.skipped.push(i + 1); else st.done++; },
      (e) => {
        const why = _elError(e);
        console.warn(`[scen3/voice/speak-all] line ${i + 1} failed:`, why);
        st.failed.push({ line: i + 1, error: why });
      },
    ));
  }
  await Promise.all(going);
  st.running = false;
  st.endedAt = new Date().toISOString();
  console.log(`[scen3/voice/speak-all] ${ctx.id} done=${st.done}`
    + ` skipped=${st.skipped.length} failed=${st.failed.length}`);
}

router.post('/scen3/voice/speak-all', (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'projectId is required' });
    const key = _elKey();
    if (!key) return res.status(400).json({ success: false, error: 'no ElevenLabs key in settings' });
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: `no project "${id}"` });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const now = _reads.get(id);
    if (now && now.running) return res.json({ success: true, queued: 0, already: true, state: now });

    const ctx = _readCtx(proj);
    if (!ctx.cast.has) return res.status(400).json({ success: false, error: ctx.cast.reason });
    const only = _readWanted(ctx, b.only, !!b.settle);
    if (!only.length) return res.json({ success: true, queued: 0, state: null });

    const st = {
      total: only.length, done: 0, skipped: [], failed: [], running: true,
      startedAt: new Date().toISOString(), endedAt: null, variant: ctx.variant,
      only,                                  // which lines, so a line cannot be taken off mid-read (Z)
    };
    _reads.set(id, st);
    res.json({ success: true, queued: only.length, lines: only.map(i => i + 1), state: st });
    _readQueue(key, ctx, only).catch((e) => {
      st.running = false;
      st.error = e.message;
      console.error('[scen3/voice/speak-all]', e.message);
    });
  } catch (e) {
    console.error('[scen3/voice/speak-all]', e.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
});

/* ── The speed of the read, applied at once (phase V26.1, the owner 2026-10-10) ──────────────────
   POST /api/scen3/voice/speed  { projectId, speed }               the project's speed
                                { projectId, line, lineSpeed }     a line's own speed; null - back to the project's
   -> { success, project, retimed, failed }

   The speed is ours, not ElevenLabs' (_tempo), so a new one costs nothing and takes a moment: it is saved,
   and every read line whose take is at another speed is retimed from its original before the answer - the
   timeline follows (MIRROR in _fileTake), and a line with a clip keeps that clip until a new one is made.
   ───────────────────────────────────────────────────────────────────────────────────────────── */
// (phase V26.8) The retimed reads land on their lines by number: a line put in meanwhile waits.
router.post('/scen3/voice/speed', async (req, res) => {
  const free = _holdLines((req.body || {}).projectId);
  try { await _speedRoute(req, res); } finally { free(); }
});
async function _speedRoute(req, res) {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'projectId is required' });
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: `no project "${id}"` });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const hasLine = b.line !== undefined && b.line !== null;
    const li = parseInt(b.line, 10);
    if (hasLine && !(li >= 0 && li < (proj.lines || []).length)) return res.status(400).json({ success: false, error: 'no such line' });
    if (!hasLine && !(Number(b.speed) > 0)) return res.status(400).json({ success: false, error: 'speed is required' });
    const st = _reads.get(id);
    if (st && st.running) return res.status(409).json({ success: false, error: 'the script is being read - change the speed when it is done' });

    const saved = PROJECTS.apply(id, (fresh) => {
      if (hasLine) {
        fresh.lines = (fresh.lines || []).map(_normLine);
        const l = fresh.lines[li];
        if (Number(b.lineSpeed) > 0) l.speed = _ttsParams({ speed: b.lineSpeed }).speed;
        else delete l.speed;
      } else {
        const v = _normVoice(fresh.voice);
        fresh.voice = { ...(fresh.voice || {}), ttsParams: { ...v.ttsParams, speed: _ttsParams({ speed: b.speed }).speed } };
      }
      fresh.updatedAt = new Date().toISOString();
    });
    if (!saved) return res.status(404).json({ success: false, error: `no project "${id}"` });

    const ctx = _readCtx(saved);
    const want = ctx.lines.map((_, i) => i).filter(i => !ctx.lines[i].removed && _unsettled(ctx.lines[i], ctx) === 'speed');
    const failed = [];
    let retimed = 0;
    await Promise.all(want.map(i => _retempoOne(ctx, i, true).then(() => { retimed++; }, (e) => {
      console.warn(`[scen3/voice/speed] line ${i + 1}:`, e.message);
      failed.push({ line: i + 1, error: e.message });
    })));
    // The timeline, re-laid ONCE and waited for (as taking a line off is): the page shows it the moment
    // the answer comes - a new speed is meant to be heard on the timeline at once (the owner).
    if (retimed) {
      try { await MIRROR.rebuild(id); }
      catch (e) { console.warn('[scen3/voice/speed] the timeline was not re-laid:', e.message); }
    }
    console.log(`[scen3/voice/speed] ${id}` + (hasLine ? ` line ${li + 1}` : '') + ` retimed=${retimed} failed=${failed.length}`);
    res.json({ success: true, project: _projNow(id), retimed, failed });
  } catch (e) {
    console.error('[scen3/voice/speed]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
}

// How far the read has got. In memory on purpose: it is about a RUN, not about the project, and a
// run does not survive the app being closed - what it had already spoken does.
router.get('/scen3/voice/state', (req, res) => {
  const id = String(req.query.projectId || '').trim();
  res.json({ success: true, state: (id && _reads.get(id)) || null });
});

// Build the preview for a freshly generated frame. The frame stays where it is;
// only the preview is made, exactly as POST /scen3/finalize does for the page.
async function _framePreview(finalUrl) {
  try {
    const fh = _resolveMedia(finalUrl);
    if (!fh || !fs.existsSync(fh.abs)) return finalUrl;
    if (!(await needsPreview(fh.abs))) return finalUrl;
    const out = _previewTarget(fh);
    if (!fs.existsSync(out.abs)) await makePreview(fh.abs, out.abs);
    return out.url;
  } catch (e) {
    console.warn('[scen3/watch] preview failed:', e.message);
    return finalUrl;
  }
}

// resolveTask cannot be reused here: it names every download .jpg, compresses it as an
// image and builds a thumbnail. A clip needs its own extension and its real duration.
async function _fetchClip(taskId, projectId) {
  const r = await axios.get(`${CFG.KIE_BASE}/api/v1/jobs/recordInfo`,
    { params: { taskId }, headers: H.kieHeaders(), timeout: 15000 });
  // One reader for every kie answer - see H.readKieRecord. This used to compare the state
  // against 'failed' while kie says 'fail', so a render that died in fifteen seconds went on
  // being polled as "pending" for twenty minutes and then reported a timeout instead of its
  // actual reason. `failCode` comes back too: an upload/fetch failure is retryable and the
  // caller decides that, so it is passed on rather than flattened into the message.
  const read = H.readKieRecord(r.data);
  const data = read.data;
  if (read.state === 'failed') return { state: 'failed', error: read.error, failCode: read.failCode || '', raw: read.raw };
  if (read.state !== 'success') return { state: 'pending', raw: read.raw };

  let url = null;
  try {
    const out = JSON.parse(data.resultJson);
    url = (out.resultUrls && out.resultUrls[0]) || out.video_url || out.url || null;
  } catch (e) {}
  if (!url) return { state: 'failed', error: 'the render came back without a video URL' };

  const dir = PROJECTS.dirOf(projectId, 'clips');
  if (!dir) return { state: 'failed', error: 'the project is gone' };
  const name = `c${taskId}_${Date.now()}.mp4`;
  const abs = path.join(dir, name);
  const dl = await axios({ url, method: 'GET', responseType: 'arraybuffer', timeout: 180000 });
  fs.writeFileSync(abs, Buffer.from(dl.data));
  // H.264 + yuv420p + faststart, so the browser plays it and the concat demuxer can
  // later join these clips without a re-encode. A failure here is not worth losing the
  // clip over — the file is already on disk and playable in most cases.
  try { await H.normalizeVideoForBrowser(abs); }
  catch (e) { console.warn('[scen3/clip] normalize failed:', e.message); }
  // same ffmpeg-header trick the reads use — it reports any container's duration
  return {
    state: 'success', path: toUrl(abs), dur: await _audioDur(abs),
    thumb: await _clipPoster(abs, name),
  };
}

// One frame out of the clip, for the card. Half a second in rather than frame zero: the
// very first frame of a lipsync render is often mid-blink or still settling.
async function _clipPoster(absVideo, name) {
  const out = path.join(path.dirname(absVideo), 'thumbs', name.replace(/\.mp4$/i, '.jpg'));
  try {
    const VThumb = require('../lib/video-thumb');
    await VThumb.posterFrame(absVideo, out, { width: VThumb.CLIP_POSTER_W, at: 0.5 });
    return toUrl(out);
  } catch (e) {
    console.warn('[scen3/clip] no poster frame for', name, '-', e.message);
    return '';
  }
}

// ── Resubmit a clip the renderer could not fetch ─────────────────────────────
// "audio upload failed" is not a failed render: the task never started, no credits were
// consumed (measured: creditsConsumed 0, costTime 15s), and the file it could not read is
// sitting on our disk. Every clip's audio went to catbox.moe because imgbb refuses mp3, and
// catbox is exactly what kie.ai could not fetch - so the only useful answer is to put the
// file somewhere else and ask again. Free, and it fixes the common case without the user
// pressing anything.
//
// ONE retry, recorded on the render marker so a restart cannot reset the count.
const _FETCH_FAIL_RE = /upload failed|fetch failed|download failed|cannot (?:be )?(?:fetch|download|access)|invalid url|url is not accessible/i;

// ════════════════════════════════════════════════════════════════════════════
// PROJECTS
//
// A project is created FROM a scenario and holds a SNAPSHOT of it: the lines are
// copied in, so later edits to the library scenario never reach a project that
// is already in production. `scenarioId` is kept purely as a back-reference to
// where it came from. Several projects may come from one scenario (same script,
// different characters) — creating one never reuses an existing one.
//
// The shape is deliberately thin and will grow as Casting / Fragments / Montage
// land on top of it.
// ════════════════════════════════════════════════════════════════════════════

// Writes only the records that changed; a record missing from `list` is NOT deleted - that is
// PROJECTS.remove, and only the delete route calls it.
function _saveProjects(list) {
  PROJECTS.saveAll(list);
}

function _loadProjects() {
  return PROJECTS.list();
}

// The casting is per project (one character + one location for the whole script).
// Only ids and a THUMBNAIL-able path are stored — characters and environments stay
// owned by their own backends.
function _normCasting(c) {
  const s = (c && typeof c === 'object') ? c : {};
  return {
    characterId:   String(s.characterId   || ''),
    characterName: String(s.characterName || ''),
    obrazId:       String(s.obrazId       || ''),
    obrazImage:    String(s.obrazImage    || ''),
    locationId:    String(s.locationId    || ''),
    locationImage: String(s.locationImage || ''),
  };
}

/* ── WHOSE WORK IS IN THE FIELDS (phase V67, the owner 2026-11-01, (об2)-(об4), (об9)) ─────────────────────────────────────
   A talking head's reads are its character's VOICE; its frames and its clips show its LOOK. A look of ANOTHER character cast
   PUTS ASIDE what was made - the lines' reads (with their cut silence and merges) and the voice picked by hand under the
   character, the set's frames and the lines' clips (with their prompts and the frames picked by hand) under the look - IN
   THE PROJECT ITSELF (`shelf`): the files stay in its folder, nothing is deleted ((об2)), and it all comes back as it was
   when that character in that look is cast again. Another look of the SAME character puts aside its frames and clips only
   - the voice is the same ((об4)). The CHOICES stay ((об3)): the mood and the [tags] it marked, stability and speed, the
   model, the quality, the shot size, the spread, Seedance's settings; the voice follows the character by itself
   (_castVoiceOf). `workOf` - the look the fields' work was made for (the cast look before V67); `cast0` - the first look cast
   (V67 block 3). Asked before it moves anything (POST /scen3/projects/:id/cast, below).
   ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const SHELF_READ = ['audio', 'cuts', 'merge'];                              // a line's, kept by the character
const SHELF_LOOK = ['video', 'pick', 'chosen', 'sd', 'shot', 'frameId'];    // a line's, kept by the look
const SHELF_MIX = ['variants', 'order', 'approved', 'banned', 'activeId'];  // the set's, kept by the look
// What a line holds when that part of it is put aside - a missing key is the line's own default (_normLine).
const SHELF_EMPTY = {
  audio: () => ({ plain: null, tagged: null }), video: () => ({ plain: [], tagged: [] }),
  pick: () => ({ plain: '', tagged: '' }), chosen: () => ({ plain: '', tagged: '' }), shot: () => null, frameId: () => '',
};
const SHELF_MIX_EMPTY = { variants: () => [], order: () => [], approved: () => [], banned: () => [], activeId: () => '' };

// A look cast, as `workOf` and `cast0` keep it - null without a character.
function _normLook(c) {
  const s = _normCasting(c);
  if (!s.characterId) return null;
  return { characterId: s.characterId, characterName: s.characterName, obrazId: s.obrazId, obrazImage: s.obrazImage };
}
const _lineBits = (arr) => (Array.isArray(arr) ? arr.map(x => ((x && typeof x === 'object') ? x : {})) : []);
function _normShelf(sh) {
  const src = (sh && typeof sh === 'object') ? sh : {};
  const each = (m, fn) => {
    const out = {};
    for (const [k, v] of Object.entries((m && typeof m === 'object') ? m : {})) {
      const x = (k && v && typeof v === 'object') ? fn(v) : null;
      if (x) out[String(k)] = x;
    }
    return out;
  };
  return {
    chars: each(src.chars, v => ({ name: String(v.name || ''), lines: _lineBits(v.lines), pick: (v.pick && typeof v.pick === 'object') ? v.pick : null, at: String(v.at || '') })),
    looks: each(src.looks, (v) => {
      const m = _normMix((v.mix && typeof v.mix === 'object') ? v.mix : {});
      return {
        characterId: String(v.characterId || ''), name: String(v.name || ''), image: String(v.image || ''),
        lines: _lineBits(v.lines), mix: Object.fromEntries(SHELF_MIX.map(k => [k, m[k]])), at: String(v.at || ''),
      };
    }),
  };
}
const _shelfAny = (sh) => !!(sh && (Object.keys(sh.chars || {}).length || Object.keys(sh.looks || {}).length));

// What is in the fields now, counted the way the question says it ((об5)): the lines read, the frames of the set, the clips.
function _workCount(p) {
  const lines = (Array.isArray(p.lines) ? p.lines : []).map(_normLine);
  return {
    reads: lines.filter(l => (l.audio.plain && l.audio.plain.path) || (l.audio.tagged && l.audio.tagged.path)).length,
    frames: _normMix(p.mix).variants.length,
    clips: lines.reduce((n, l) => n + l.video.plain.length + l.video.tagged.length + ((l.sd && l.sd.clips) || []).length, 0),
  };
}

// What casting `next` (a look, or null for none) would move: `work` - whose the fields are; `look` - its frames and clips go
// aside and next's come back; `char` - its reads go aside and next's come back; `ask` - the counts to ask about, or null.
function _castPlan(p, next) {
  const now = _normLook(p.casting);
  const work = _normLook(p.workOf) || now;
  if (!next) return { work, look: false, char: false, ask: null };
  const sameChar = !!work && work.characterId === next.characterId;
  const sameLook = sameChar && work.obrazId === next.obrazId;
  const plan = { work, look: !sameLook, char: !sameChar, ask: null };
  if (work) {
    const w = _workCount(p);
    const n = { reads: plan.char ? w.reads : 0, frames: plan.look ? w.frames : 0, clips: plan.look ? w.clips : 0 };
    if (n.reads || n.frames || n.clips) plan.ask = { ...n, from: work.characterName, to: next.characterName, sameChar };
  }
  return plan;
}

// The move itself, on a project's raw record inside PROJECTS.apply: what is put aside goes into `shelf`, what next had put
// aside comes back, the casting is next. Synchronous - nothing slow is asked here. Returns whether any work moved.
function _applyCast(p, next, plan, now) {
  let moved = false;
  const shelf = _normShelf(p.shelf);
  const lines = (Array.isArray(p.lines) ? p.lines : []).map(_normLine);
  const take = (l, keys) => Object.fromEntries(keys.filter(k => l[k] !== undefined).map(k => [k, l[k]]));
  const clear = (l, keys) => { for (const k of keys) { if (SHELF_EMPTY[k]) l[k] = SHELF_EMPTY[k](); else delete l[k]; } };
  const back = (from, keys) => lines.forEach((l, i) => {
    const bit = (from.lines || [])[i] || {};
    clear(l, keys);
    for (const k of keys) if (bit[k] !== undefined && bit[k] !== null) l[k] = bit[k];
  });
  const mix = (p.mix && typeof p.mix === 'object') ? p.mix : {};
  const work = plan.work;
  if (next && work && plan.look && work.obrazId) {
    const n = _normMix(mix);
    const b = { characterId: work.characterId, name: work.characterName, image: work.obrazImage, at: now,
      lines: lines.map(l => take(l, SHELF_LOOK)), mix: Object.fromEntries(SHELF_MIX.map(k => [k, n[k]])) };
    const any = b.mix.variants.length || lines.some(l => l.video.plain.length || l.video.tagged.length || l.sd
      || (l.shot && l.shot.motion) || l.frameId || l.pick.plain || l.pick.tagged || l.chosen.plain || l.chosen.tagged);
    if (any) { shelf.looks[work.obrazId] = b; moved = true; }
    lines.forEach(l => clear(l, SHELF_LOOK));
    for (const k of SHELF_MIX) mix[k] = SHELF_MIX_EMPTY[k]();
    mix.lastError = '';
  }
  if (next && work && plan.char) {
    const pick = _normVoice(p.voice).pick;
    const b = { name: work.characterName, at: now, pick, lines: lines.map(l => take(l, SHELF_READ)) };
    if (pick || lines.some(l => l.audio.plain || l.audio.tagged || l.cuts || l.merge)) { shelf.chars[work.characterId] = b; moved = true; }
    lines.forEach(l => clear(l, SHELF_READ));
    p.voice = { ...((p.voice && typeof p.voice === 'object') ? p.voice : {}), pick: null };
  }
  // What next had put aside comes back - its reads with the character, its frames and clips with the look.
  if (next && (plan.char || !work) && shelf.chars[next.characterId]) {
    const b = shelf.chars[next.characterId];
    back(b, SHELF_READ);
    p.voice = { ...((p.voice && typeof p.voice === 'object') ? p.voice : {}), pick: b.pick || null };
    delete shelf.chars[next.characterId];
    moved = true;
  }
  if (next && (plan.look || !work) && next.obrazId && shelf.looks[next.obrazId]) {
    const b = shelf.looks[next.obrazId];
    back(b, SHELF_LOOK);
    for (const k of SHELF_MIX) mix[k] = (b.mix && b.mix[k] !== undefined) ? b.mix[k] : SHELF_MIX_EMPTY[k]();
    delete shelf.looks[next.obrazId];
    moved = true;
  }
  p.lines = lines;
  p.mix = mix;
  if (_shelfAny(shelf)) p.shelf = shelf; else delete p.shelf;
  // Whose the fields are: next's; with none cast, still the one whose work they hold (a ✕ on the stage takes nothing aside).
  if (next) p.workOf = next;
  else if (work) p.workOf = work;
  // (об9) The first look cast - the one there was when the first change came, for a project from before V67.
  if (!_normLook(p.cast0) && (work || next)) p.cast0 = work && work.obrazId ? work : next;
  const cast = (p.casting && typeof p.casting === 'object') ? p.casting : {};
  p.casting = next ? { ...cast, ...next } : { ...cast, characterId: '', characterName: '', obrazId: '', obrazImage: '' };
  p.updatedAt = now;
  return moved;
}

// A line put in at `at` (/line/insert): the lines put aside keep their numbers - an empty place goes in there too.
function _shelfSplice(p, at) {
  if (!_shelfAny(p.shelf)) return;
  for (const b of [...Object.values(p.shelf.chars || {}), ...Object.values(p.shelf.looks || {})]) {
    if (!Array.isArray(b.lines)) continue;
    while (b.lines.length < at) b.lines.push({});
    b.lines.splice(at, 0, {});
  }
}

// ── Mix workspace ───────────────────────────────────────────────────────────
// The whole state of the Build-mix popup lives on the project, so closing it and
// coming back — even in another session — restores exactly what was there. Each
// project therefore has its own independent workspace.
const MIX_AGGS      = ['kie', 'replicate'];
const MIX_MODELS    = ['nano-banana-2', 'nano-banana-2-lite'];
const MIX_FORMATS   = ['9:16', '2:3', '3:4', '1:1', '16:9'];
const MIX_QUALITIES = ['1K', '2K', '4K'];
const MIX_MODES     = ['same', 'cycle', 'random', 'manual'];

function _normMix(m) {
  const s   = (m && typeof m === 'object') ? m : {};
  const set = (s.settings && typeof s.settings === 'object') ? s.settings : {};
  const model = MIX_MODELS.includes(set.model) ? set.model : 'nano-banana-2';
  const q     = MIX_QUALITIES.includes(set.quality) ? set.quality : '2K';
  return {
    settings: {
      // kie.ai is the default aggregator; projects saved before it existed get it too
      aggregator: MIX_AGGS.includes(set.aggregator) ? set.aggregator : 'kie',
      model,
      format:  MIX_FORMATS.includes(set.format) ? set.format : '9:16',
      // The user's CHOICE is kept as-is. A model that cannot deliver it (lite only
      // renders 1K) is clamped where the value is used, not here — otherwise a
      // glance at lite would silently downgrade a 2K/4K preference for good.
      quality: q,
    },
    // every frame ever generated here; approving or banning only tags it
    variants: Array.isArray(s.variants) ? s.variants.map(v => ({
      id:      String((v && v.id) || ''),
      path:    String((v && v.path) || ''),
      preview: String((v && v.preview) || ''),
      prompt:  String((v && v.prompt) || ''),
      at:      String((v && v.at) || ''),
      // Which generation produced it. The page and the server watcher can BOTH
      // file a finished frame, so this is the key that makes the second one a
      // no-op instead of a duplicate.
      taskId:  String((v && v.taskId) || ''),
      // Where a cropped frame came from, and which part of it was taken. Without this
      // two near-identical frames in the strip are indistinguishable a day later.
      croppedFrom: String((v && v.croppedFrom) || ''),
      crop:    (v && v.crop && typeof v.crop === 'object')
        ? { x: +v.crop.x || 0, y: +v.crop.y || 0, w: +v.crop.w || 0, h: +v.crop.h || 0 } : null,
      size:    (v && v.size && typeof v.size === 'object')
        ? { w: +v.size.w || 0, h: +v.size.h || 0 } : null,
      // A frame of a SET (docs/local-app/PLAN.md, phase W2) says which set, which shot size and its
      // number in it - so the pool keeps the order the frames were asked in, and the lines take
      // from it in turn. Frames from the old pool have none of it and simply come first.
      set:     String((v && v.set) || ''),
      framing: String((v && v.framing) || ''),
      n:       Number.isInteger(v && v.n) ? v.n : 0,
      // The one sentence that makes this frame different from the others in its set - the head,
      // the hands, the gaze at that instant. Written by the agent that planned the set (phase W2)
      // and read by the one that writes the animation prompts (W3b), which is what a clip made from
      // this frame has to continue. Frames drawn before it carry none and are read from the picture.
      moment:  String((v && v.moment) || ''),
      // (phase V26.5) A frame made to order in the frames chat: 'chat', and the chat's record it came from.
      made:    (v && v.made === 'chat') ? 'chat' : '',
      genId:   String((v && v.genId) || ''),
      // (phase V26.6) The products it was drawn with in the frames chat - { path, name, description }, at most two: the
      // clips' writers of a line that opens on it know them (_writePromptsNow, _writeSdPromptsNow).
      props:   _framePropsOf(v && v.props),
    })).filter(v => v.id && v.path) : [],
    // The order the frames were dragged into (the owner, 2026-09-21), by id. A frame not named
    // here - a new one - keeps its natural place, after the ones that were arranged.
    order: Array.isArray(s.order) ? s.order.map(String).filter(Boolean) : [],
    // A generation the server is watching on the project's behalf, so it lands even
    // if the page is reloaded or closed mid-run. Cleared once the frame is filed.
    lastError: String(s.lastError || ''),
    approved:     Array.isArray(s.approved) ? s.approved.map(String) : [],
    banned:       Array.isArray(s.banned)   ? s.banned.map(String)   : [],
    activeId:     s.activeId == null ? '' : String(s.activeId),   // '' = the two sources are active
    note:         String(s.note || ''),
    // frame parameters: camera optics, the framing group, and its mannequin pose
    camera:       String(s.camera  == null ? 'phone-rear'    : s.camera),
    framing:      String(s.framing == null ? 'half-body'     : s.framing),
    poseId:       String(s.poseId  == null ? 'half-standing' : s.poseId),
    distribution: MIX_MODES.includes(s.distribution) ? s.distribution : 'same',
  };
}

function _normProject(p, now) {
  const src = p || {};
  return {
    id:         String(src.id != null ? src.id : Date.now()),
    // Whose it is - see lib/ownership.js. Null on anything made before there were people to
    // own things: shared, read by everyone, the admin's to edit.
    owner:      src.owner ? String(src.owner) : null,
    casting:    _normCasting(src.casting),
    // (phase V67) Whose work the fields hold, the first look cast, and the work of the others put aside (_applyCast).
    ...(_normLook(src.workOf) ? { workOf: _normLook(src.workOf) } : {}),
    ...(_normLook(src.cast0) ? { cast0: _normLook(src.cast0) } : {}),
    ...(_shelfAny(_normShelf(src.shelf)) ? { shelf: _normShelf(src.shelf) } : {}),
    mix:        _normMix(src.mix),
    // How the look and the place read, for the frames of the fragments step: the person to keep,
    // the place, its light. Read once for a look and a place, and again only when either changes.
    frameRef:   _normFrameRef(src.frameRef),
    name:       String(src.name || '').trim() || 'untitled project',
    scenarioId: src.scenarioId != null ? String(src.scenarioId) : '',
    // (phase V62) A voiceover is the same record with no who / where, frames or clips; everything else is a talking head.
    type:       src.type === 'voiceover' ? 'voiceover' : 'talking_head',
    // (phase V62, (во29), (во35)) THE VOICEOVER DRAFT - one; a project once its first line is read (_fileTake).
    ...(src.type === 'voiceover' && src.draft ? { draft: true } : {}),
    gender:     String(src.gender || '').toLowerCase(),
    title:      String(src.title || ''),
    lines:      Array.isArray(src.lines) ? src.lines.map(_normLine) : [],
    voice:      _normVoice(src.voice),
    video:      _normVideo(src.video),
    vertical:   String(src.vertical || ''),
    product:    String(src.product  || ''),
    roles:      Array.isArray(src.roles) ? src.roles : [],
    // (phase V26.8, sixth round) What Seedance keeps is on each LINE (`sd`, _normLine) - the project's `sd.frags` of the
    // merged fragments is not carried over.
    createdAt:  src.createdAt || now,
    updatedAt:  src.updatedAt || now,
  };
}

// One fragment. Voice and video are PAIRS, one per text variant: the plain words and
// the same words carrying [tags]. A clip is lipsynced to a specific take, so keeping
// them apart is what stops a silent desync — switching the variant swaps both the
// audio and the clip together, and neither can ever belong to the other take.
function _normTake(t) {
  const s = (t && typeof t === 'object') ? t : {};
  const p = String(s.path || '');
  if (!p) return null;
  return {
    // A stable handle for one variant, so the page can say WHICH clip a fragment is set
    // to. Derived from the filename when absent, which already carries the task id and a
    // timestamp — that way clips saved before variants existed get an id without a
    // migration table, and the same file always resolves to the same id.
    id: String(s.id || '').trim() || ('v' + path.basename(p).replace(/\.[^.]+$/, '')),
    path: p, dur: +s.dur || 0, at: String(s.at || ''),
    // The exact words this take was made from. Comparing them with the current text
    // is how a stale take is spotted, computed on the spot — a stored "is stale" flag
    // would eventually disagree with the file it describes.
    said: String(s.said || ''),
    // For a video take: which audio take it was lipsynced to. Re-voicing a line has to
    // make its clip stale, and the clip has to be able to say what it was synced to.
    fromAudio: String(s.fromAudio || ''),
    // And which first frame it was animated FROM. A lipsync is that picture moving, so a
    // clip belongs to one frame and to no other: swap the frame and this clip is not a
    // clip of the fragment any more.
    fromFrame: String(s.fromFrame || ''),
    // Also for a video take: the motion and the sharpness it was rendered with, so
    // changing either is visible as staleness instead of being silently ignored. Empty
    // on an audio take, which has neither.
    preset:  String(s.preset || ''),
    quality: String(s.quality || ''),
    // A clip's poster frame. The cards show stills only — the clip itself belongs to a
    // viewer, not to a list of ten of them all decoding at once.
    thumb:   String(s.thumb || ''),
    // For an audio take (phase V26.1): what it was spoken with, and - when it was retimed - the
    // file ElevenLabs sent, so another speed is made from it again rather than from a copy.
    // A take from before carries none: it was spoken at natural and 1.
    ...(s.raw ? { raw: String(s.raw) } : {}),
    ...(s.stability !== undefined && s.stability !== null && s.stability !== '' ? { stability: +s.stability } : {}),
    ...(s.speed ? { speed: +s.speed } : {}),
  };
}

// EVERY render is kept as a variant — a second take on the same frame, or a take on a
// different one. Nothing is silently replaced: these are paid seconds of video, and
// judging two of them side by side is the whole point of keeping both.
const CLIPS_PER_FRAGMENT = 10;
function _normClips(v, frameId, pickId) {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  const byId = new Map();
  arr.forEach(t => {
    const c = _normTake(t);
    if (!c) return;
    // A clip made before the frame was recorded belongs to the frame its line points at.
    // That is measured, not assumed: comparing every existing poster against each frame
    // in the pool matched it to its own line's current frame by a factor of four.
    if (!c.fromFrame) c.fromFrame = String(frameId || '');
    byId.set(c.id, c);          // an id twice is a double-write, not a second variant
  });
  const all = [...byId.values()];
  if (all.length <= CLIPS_PER_FRAGMENT) return all;
  // Over the ceiling the OLDEST go, except the one on show: dropping the variant the
  // fragment is currently set to would change the cut behind the user's back.
  const drop = all.length - CLIPS_PER_FRAGMENT;
  let gone = 0;
  return all.filter(c => {
    if (gone >= drop || c.id === String(pickId || '')) return true;
    gone++;
    return false;
  });
}

function _normLine(l) {
  const s = (l && typeof l === 'object') ? l : {};
  return {
    text:    String(s.text || ''),          // the words, never rewritten by the tagger
    tagged:  String(s.tagged || ''),        // the same words with [tags] inserted
    // No per-line variant: ONE switch in the voice settings picks the take for the
    // whole project. Per line it could drift, and two lines showing different takes
    // of the same read has no meaning.
    frameId: String(s.frameId || ''),       // the first frame chosen in the mix popup
    // (phase V26.8) THE NUMBER THE LINE TAKES ITS FRAME BY, kept: given to every line when one is put in above some of
    // them (/line/insert), so the lines that moved down a place stay on their frames. Absent - its place in the list.
    ...(Number.isInteger(s.slot) && s.slot >= 0 ? { slot: s.slot } : {}),
    // TAKEN OFF THE SCRIPT (phase Z, the owner 2026-09-22). A line is never deleted: it is taken
    // off, keeps its place in this list, and can be put back. Keeping its place is the whole point
    // - a line that is not picked by hand takes its first frame from the set BY ITS NUMBER, and a
    // clip is the take made from the frame its line opens on, so closing the gap would move every
    // line below onto another frame and their clips would vanish from the fragments and from the
    // timeline while the files sat there. Nothing reads a line that is off: not the reads, not the
    // clips, not the prompts, not the mirror. The TAGGER is the one exception - see /voice/tag.
    removed: !!s.removed,
    // How this line is filmed and how the person moves on it - the directing agent's reading (the
    // fragments step, docs/local-app/PLAN.md F2), or null until the script has been read.
    shot:    _normShot(s.shot),
    audio:   { plain: _normTake((s.audio || {}).plain), tagged: _normTake((s.audio || {}).tagged) },
    // Clips are a LIST per variant, one per first frame. A read has a single take because
    // the words have one right sounding of them, but a fragment can legitimately have a
    // clip for each frame it has been tried on, and paying twice to see one again would
    // be absurd.
    video:   {
      plain:  _normClips((s.video || {}).plain,  s.frameId, (s.pick || {}).plain),
      tagged: _normClips((s.video || {}).tagged, s.frameId, (s.pick || {}).tagged),
    },
    // Which variant this fragment is SET to, per take. An id and not an index: variants
    // come and go, and an index would quietly come to mean a different clip.
    pick:    {
      plain:  String((s.pick || {}).plain  || ''),
      tagged: String((s.pick || {}).tagged || ''),
    },
    // (phase V23, the owner 2026-10-09) A clip CHOSEN BY HAND in the fragment's takes: it is the line's clip on the
    // timeline even when it is stale - made from another frame, other words or another read. Cleared by a new clip and
    // by a new read of the line.
    chosen:  {
      plain:  String((s.chosen || {}).plain  || ''),
      tagged: String((s.chosen || {}).tagged || ''),
    },
    // (phase V26.1, the owner 2026-10-10) The line's OWN speed, set in its fragment: the project's speed does not
    // touch it. Absent - the line reads at the project's speed.
    ...(Number(s.speed) > 0 ? { speed: _ttsParams({ speed: s.speed }).speed } : {}),
    // (phase V26.8, sixth round, the owner 2026-10-15: "Всегда по одной строке") WHAT SEEDANCE KEEPS FOR THIS LINE - a
    // line is a fragment of its own: its prompt and its clips (_normSdLine). Absent until it has either.
    ...(s.sd && typeof s.sd === 'object' ? { sd: _normSdLine(s.sd) } : {}),
    // (phase V44) WHAT CUT SILENCE TOOK OUT OF THE LINE'S SOUND - stretches of its file, bound to the take they were cut in
    // (lib/line-cuts.js): written by a save of its timeline, laid by the mirror. Absent - the line plays whole.
    ...(require('../lib/line-cuts').normalize(s.cuts) ? { cuts: require('../lib/line-cuts').normalize(s.cuts) } : {}),
    // (phase V45) THE LINES MERGED INTO ONE FILE FROM THIS ONE ON - the file, its length, and each line's take and pieces
    // (lib/line-cuts.js): written by a save of the timeline, laid by the mirror as one cell while those takes stand.
    ...(require('../lib/line-cuts').normalizeMerge(s.merge) ? { merge: require('../lib/line-cuts').normalizeMerge(s.merge) } : {}),
    // A clip being rendered right now. It cannot live in `video` above, which only
    // accepts a take that already has a file — and it has to be on the PROJECT rather
    // than in memory, so a render survives a reload and even a server restart.
  };
}

function _normFrameRef(r) {
  if (!r || typeof r !== 'object' || !r.look || !r.place) return null;
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  return {
    look: String(r.look), place: String(r.place),
    character: str(r.character, 1500), environment: str(r.environment, 1500), lighting: str(r.lighting, 1200),
    // One garment a line, where it is worn in front (N7).
    clothes: str(r.clothes, 3000),
    // Which questions the reading answered: 2 since the clothes were asked for (N7). An older one is
    // read again once; one that is new and simply has no clothes lines is NOT, or a look the agent
    // cannot list would cost a vision call on every set for ever.
    v: Number(r.v) || 1,
    at: str(r.at, 40),
  };
}

// A line's animation: the prompt that goes to the video model (`motion`), the agent's own last text
// for it (`motionAgent`, so a prompt edited by hand survives a new pass and can be put back), and
// what it was written FROM - the words and the mood - so a line whose words or whose video's mood
// changed since is stale, which is worked out wherever it is shown rather than stored. The shot
// size, the pose and the camera of a frame used to live here too (F2); the frames are a set for the
// whole video now (docs/local-app/PLAN.md, phase W2), and a line only says which one it opens on.
function _normShot(sh) {
  if (!sh || typeof sh !== 'object') return null;
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  return {
    motion:       str(sh.motion, 900),
    motionAgent:  str(sh.motionAgent, 900),
    motionEdited: !!sh.motionEdited,
    said:         String(sh.said || ''),
    mood:         str(sh.mood, 40),
    at:           str(sh.at, 40),
  };
}

// Voice settings live on the PROJECT: one read for the whole ad.
const VOICE_PROVIDERS = ['elevenlabs'];

// How the fragments are turned into clips. Three choices and no more: the lipsync model,
// how the character moves, and how sharp the result is. The kie model id is deliberately
// NOT stored — it is derived from the quality at render time, so a tier being renamed
// upstream does not leave old projects pointing at a model that no longer exists.
//
// CHOSEN, NOT ASSUMED (phase V24, the owner 2026-10-09). A project made since carries `v: 2`, and its
// choices start at NONE - '' for the mood, the quality, the shot size and the spread, 0 for how many -
// until the person makes them; the panel's fields are red while one is missing and nothing fills it
// in here. An older project keeps the defaults it was always read with: 70 of the owner's 80 had no
// mood stored and were marked up in 'sincere'.
const _normVideo = (v) => {
  const s = (v && typeof v === 'object') ? v : {};
  const chosen = s.v === 2;
  const n = parseInt(s.frames, 10);
  // WHAT FILMS IT (phase V26.8, lib/th-video.js): Kling avatar - a clip per line - or one of the Seedance models. Chosen
  // like the rest since V24: a project made since starts at none - except one that already chose a quality, which was
  // Kling's (the only model there was), so a project halfway through on Kling stays on it. An older project is Kling.
  const model = TH.byId(s.model) ? s.model : (chosen && !s.quality ? '' : 'kling');
  return {
    ...(chosen ? { v: 2 } : {}),
    model,
    // The family of the model, kept for whatever read `mode` before V26.8.
    mode:    TH.isSeedance(model) ? 'seedance' : 'kling',
    // The emotion of the whole video (lib/motion-presets.js, MOODS): what the directing agent reads
    // every shot and animation prompt from.
    mood:    MP.moodById(s.mood) ? s.mood : (chosen ? '' : MP.DEFAULT_MOOD),
    preset:  MP.presetById(s.preset)  ? s.preset  : MP.DEFAULT_PRESET,
    // A quality the model makes - another model's is no choice at all (720p is Kling's and Seedance's, 1080p not mini's).
    quality: TH.qualityOf(model, s.quality) ? s.quality
      : (chosen || model !== 'kling' ? '' : MP.DEFAULT_QUALITY),
    // SEEDANCE'S OWN SETTINGS (phase V26.8; read only while a Seedance model films it). `sound` - how the clip is voiced
    // (lib/th-video.js SOUNDS; '' = SOUND_DEFAULT); `gestures` - whose mood the body moves by ('' = the project's mood).
    // The lines are never merged (the owner 2026-10-15: "Удаляем эту функцию по объединению фрагментов"): `merge` goes.
    sound:    TH.soundById(s.sound) ? s.sound : '',
    gestures: MP.moodById(s.gestures) ? s.gestures : '',
    // The set of first frames (docs/local-app/PLAN.md, phase W2): the shot size it is made in (the
    // ids of FRAME_SETS below), how many, and what the person asked for in words.
    framing: ['selfie', 'half', 'full'].includes(s.framing) ? s.framing : (chosen ? '' : 'half'),
    frames:  n >= 1 ? Math.min(5, n) : (chosen ? 0 : 4),
    wish:    String(s.wish || '').slice(0, 600),
    // How the lines take frames from that set (the owner, 2026-09-21): the pool in turn, or a
    // frame drawn for each line - drawn once and always the same one, so a repaint does not
    // reshuffle the video (_frameOfLine).
    spread:  (s.spread === 'random' || s.spread === 'cycle') ? s.spread : (chosen ? '' : 'cycle'),
  };
};
// (phase V26.8, part 4; on the line since the sixth round) WHAT SEEDANCE KEEPS FOR A LINE: the prompt as it goes, the
// writer's own to go back to, whether it was edited by hand, what it was written for (`sig`, lib/sd-prompt.js), who
// wrote it and when; (part 5) its clips - every take kept, as Kling's - and the one chosen by hand, whatever it was made from.
function _normSdLine(f) {
  const s = (f && typeof f === 'object') ? f : {};
  return {
    prompt: String(s.prompt || '').slice(0, 20000), agent: String(s.agent || '').slice(0, 20000),
    edited: !!s.edited, sig: String(s.sig || ''), writer: String(s.writer || ''), at: String(s.at || ''),
    clips: (Array.isArray(s.clips) ? s.clips : []).map(_normSdClip).filter(Boolean),
    chosen: String(s.chosen || ''),
  };
}
// One take of a line filmed by Seedance: the file, its poster and length, and what it was made from - the frame, the
// sound it was voiced with (`read` / `sample`), the read it heard (`take`, with `read`), the words (`words`, their
// fingerprint) and the voice (`voice`, with `sample`) - which is what decides whether it is still the line's
// (_sdFresh) - the model and the quality.
function _normSdClip(c) {
  if (!c || typeof c !== 'object' || !c.path) return null;
  const p = String(c.path);
  return {
    id: String(c.id || path.basename(p).replace(/\.[^.]+$/, '')), path: p, thumb: String(c.thumb || ''),
    dur: +c.dur > 0 ? Math.round(+c.dur * 100) / 100 : 0, frameId: String(c.frameId || ''),
    sound: TH.soundById(c.sound) ? c.sound : 'read', model: String(c.model || ''), quality: String(c.quality || ''),
    secs: +c.secs > 0 ? +c.secs : 0, at: String(c.at || ''),
    take: String(c.take || ''), words: String(c.words || ''), voice: String(c.voice || ''),
    // (the sixth round) Where the speech ends in its own sound (lib/speech-end.js) - 0 when it runs to the end.
    speechEnd: +c.speechEnd > 0 ? Math.round(+c.speechEnd * 100) / 100 : 0,
  };
}

// What a project made since phase V24 has not chosen yet, of the choices a step needs, in words -
// '' when nothing is missing (an older project never misses any: its defaults stand).
function _unchosen(video, which) {
  const v = video || {};
  const words = {
    mood: !v.mood && 'the mood (field 1)',
    framing: !v.framing && 'the shot size (field 2)',
    frames: !v.frames && 'how many frames (field 2)',
    spread: !v.spread && 'how the fragments take their frames (field 2)',
    model: !v.model && 'the model of the clips (field 3)',
    quality: !v.quality && 'the quality of the clips (field 3)',
  };
  const miss = which.map(k => words[k]).filter(Boolean);
  return miss.length ? 'choose ' + miss.join(', ') + ' first' : '';
}
const _normVoice = (v) => {
  const s = (v && typeof v === 'object') ? v : {};
  const p = (s.ttsParams && typeof s.ttsParams === 'object') ? s.ttsParams : {};
  return {
    // Which service speaks the lines. Every field below belongs to it, so a second
    // provider brings its own set rather than borrowing these.
    provider:  VOICE_PROVIDERS.includes(s.provider) ? s.provider : 'elevenlabs',
    // The read uses the CAST CHARACTER's voice when there is one. Before a character is cast
    // the project may choose a voice of its own (the owner, 2026-09-21, phase W2.5): `pick` is
    // that voice - the entry the picker took, as a character's voice list keeps it - and the
    // read falls back to it. A character with a saved voice wins the moment they are cast.
    pick:      (s.pick && typeof s.pick === 'object' && s.pick.voiceId) ? {
      voiceId: String(s.pick.voiceId), name: String(s.pick.name || ''), sample: String(s.pick.sample || ''),
      gender: String(s.pick.gender || ''), age: String(s.pick.age || ''), accent: String(s.pick.accent || ''),
      descriptive: String(s.pick.descriptive || ''), language: String(s.pick.language || ''),
    } : null,
    tagsOn:    !!s.tagsOn,                  // off -> v2, on -> v3 with tags
    mood:      String(s.mood || ''),        // which mood's tag set the tagger may use
    // The one switch. It decides what the cards show, what Voice all produces, and
    // which take the counters read. Locked to plain while there is nothing tagged.
    variant:   s.variant === 'tagged' ? 'tagged' : 'plain',
    ttsParams: _ttsParams(p),
  };
};
// HOW THE SCRIPT IS SPOKEN (phase V26.1, the owner 2026-10-10): one stability and one speed for the
// whole video. v3 knows three stabilities - creative 0, natural 0.5, robust 1 - so anything else is
// put on the nearest (`+p.stability || 0.5` used to turn creative into natural). The speed is OURS,
// not ElevenLabs': v3 takes none, so a read is spoken at 1 and then retimed (_tempo), 0.7-1.2.
const STABILITIES = [0, 0.5, 1];
const SPEED_MIN = 0.7;
const SPEED_MAX = 1.2;
function _ttsParams(p) {
  const s = Number(p && p.stability);
  const v = Number(p && p.speed);
  return {
    stability: Number.isFinite(s) && p.stability !== '' && p.stability !== null
      ? STABILITIES.reduce((a, c) => (Math.abs(c - s) < Math.abs(a - s) ? c : a), 0.5) : 0.5,
    speed: Number.isFinite(v) && v > 0
      ? Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, v)) * 20) / 20 : 1,
  };
}

const _projSummary = p => ({
  id: p.id, name: p.name, scenarioId: p.scenarioId, type: p.type, draft: !!p.draft,   // (phase V62) the voiceover draft
  gender: p.gender, title: p.title,
  vertical: p.vertical, product: p.product, roles: p.roles,
  casting: _normCasting(p.casting),
  lineCount: (p.lines || []).length,
  createdAt: p.createdAt, updatedAt: p.updatedAt,
  ...OWN.ownerView(p),
});
// The mix workspace is heavy (every generated frame), so it rides on the full
// record only — the dropdown list stays light.
// Lines go through the normaliser on the way OUT too: a project saved before voice
// existed has bare {text, frameId}, and the montage column would read undefined for
// every audio and video pair.
// Whether the CAST CHARACTER has a voice, worked out at read time from the character
// record. Derived and never stored: a copy on the project would go stale the moment a
// voice is set in the Character tab, and the page would keep refusing to read.
//
// The page needs this to say so BEFORE anything is pressed — without it Voice all fires a
// request per line, every one of them refused for the same reason, and the column reports
// ten failures without ever naming the cause.
function _castVoice(p) {
  const cv = _castVoiceOf(p);
  // (phase V26.8, sixth round) Whether the voice has a demo - what Seedance takes its timbre from by the voice sample.
  return cv.has ? { ...cv, demo: !!_sampleOf(cv.id) } : cv;
}
function _castVoiceOf(p) {
  const cast = _normCasting((p || {}).casting);
  // The project's own pick reads when there is no character to read for, or the character has
  // no voice of their own (phase W2.5).
  const pick = _normVoice((p || {}).voice).pick;
  const own = pick ? { has: true, id: pick.voiceId, character: '', index: 1, count: 1, own: true, name: pick.name } : null;
  if (!cast.characterId && !cast.characterName) return own || { has: false, reason: 'no character cast yet' };
  const chars = _read(path.join(DATA_DIR, 'characters.json'));
  const arr = Array.isArray(chars) ? chars : (chars && chars.characters) || [];
  const ch = arr.find(c => String(c.id) === cast.characterId)
          || arr.find(c => String(c.name) === cast.characterName);
  if (!ch) return own || { has: false, reason: `"${cast.characterName}" is not in the character library any more` };
  const id = String(ch.voice || '').trim();
  if (!id) return own || { has: false, reason: `"${ch.name}" has no voice saved — give it one in its column on the Library's Characters shelf` };
  // The voice is NAMED after the character plus its number in that character's list, because
  // "Adrian - Cinematic Deep Male" says nothing about whose voice it is while a project is
  // being read. An id not in the list yet still counts as the first one.
  const list = Array.isArray(ch.voices) ? ch.voices : [];
  const at = list.findIndex(v => v && String(v.voiceId) === id);
  return {
    has: true, id, character: String(ch.name || ''),
    index: at >= 0 ? at + 1 : 1,
    count: Math.max(list.length, 1),
  };
}

const _projFull = p => ({
  ..._projSummary(p),
  castVoice: _castVoice(p),
  lines: (p.lines || []).map(_normLine),
  voice: _normVoice(p.voice),
  video: _normVideo(p.video),
  mix:   _normMix(p.mix),
  sdFrags: _sdView(p),
});

router.get('/scen3/projects/:id', (req, res) => {
  try {
    const p = _loadProjects().find(x => String(x.id) === String(req.params.id));
    if (!p) return res.status(404).json({ success: false, error: 'not found' });
    // Opening a project is when the timeline catches up with what was made before the mirror
    // existed, or while this app was not running (phase U1). It asks a cheap question first and
    // lays nothing unless the answer differs from what is there.
    MIRROR.catchUp(p.id, { project: p });
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Create from a scenario ({ scenarioId }), or upsert an existing project by id
// so later phases can persist casting / montage onto it.
router.post('/scen3/projects', async (req, res) => {
  try {
    const b    = req.body || {};
    // (phase V67) Whose the work is and what is put aside are the cast route's alone - never a page's copy written back.
    delete b.workOf; delete b.cast0; delete b.shelf;
    // (phase V29) A talking head made from a scenario with lines in another language - kept before the translation
    // came in - gets them in English, and so does the scenario: what is spoken is English. (A voiceover is not made
    // here: it is THE voiceover draft, /scen3/voiceover/draft - phase V62.)
    if (b.id == null && b.scenarioId != null) {
      const s0 = _load().find(x => String(x.id) === String(b.scenarioId));
      const texts = s0 ? (s0.lines || []).map(l => String((l && l.text) || '')) : [];
      if (texts.some(t => t.trim() && !AGENT.english(t))) {
        const t = await _englishLines(texts);
        if (t.fail) return res.status(502).json({ success: false, error: t.fail });
        const all = _load();
        const k = all.findIndex(x => String(x.id) === String(b.scenarioId));
        // Written only over the lines it translated: lines edited meanwhile are not put back.
        if (k >= 0 && JSON.stringify((all[k].lines || []).map(l => String((l && l.text) || ''))) === JSON.stringify(texts)) {
          all[k] = _norm({ ...all[k], lines: all[k].lines.map((l, i) => ({ ...l, text: t.texts[i] })) }, new Date().toISOString());
          all[k].updatedAt = new Date().toISOString();
          _save(all);
        }
      }
    }
    const now  = new Date().toISOString();
    const list = _loadProjects();

    if (b.id != null) {
      const i = list.findIndex(x => String(x.id) === String(b.id));
      if (i < 0) return res.status(404).json({ success: false, error: 'not found' });
      if (!OWN.canEdit(list[i], req.user)) return OWN.refuse(res, list[i]);
      // CASTING IS MERGED, not replaced. The server can write a finished look into it while a page
      // is open (lib/gen-jobs.js), and that page's next save - which carries its own older copy of
      // the casting - must not put the old one back. Every caller sends the keys it changed.
      const casting = (b.casting && typeof b.casting === 'object')
        ? { ...(list[i].casting || {}), ...b.casting } : undefined;
      // The clip settings are merged the same way: a page changing the tier sends the tier, and
      // the preset it did not touch stays what it is on disk rather than what the page last saw.
      const video = (b.video && typeof b.video === 'object')
        ? { ...(list[i].video || {}), ...b.video } : undefined;
      // And the voice settings: the page picks a voice for the project (`pick`) while the tagger
      // and the reads write the rest on the server.
      const voice = (b.voice && typeof b.voice === 'object')
        ? { ...(list[i].voice || {}), ...b.voice } : undefined;
      // The owner is pinned like the id: a save cannot hand a project to somebody else.
      const merged = _normProject({
        ...list[i], ...b, ...(casting ? { casting } : {}), ...(video ? { video } : {}), ...(voice ? { voice } : {}),
        id: list[i].id, owner: list[i].owner || null, createdAt: list[i].createdAt,
      }, now);
      merged.updatedAt = now;
      const was = _normVideo(list[i].video);
      list[i] = merged;
      _saveProjects(list);
      // (phase V26.8) The timeline lays the clips of the project's mode (lib/frag-mirror.js): another model, another cut -
      // and another sound (the sixth round: by the voice sample, the reads are not laid).
      const nowV = _normVideo(merged.video);
      if (video && (nowV.model !== was.model || nowV.sound !== was.sound)) MIRROR.touch(merged.id, { project: merged });
      return res.json({ success: true, project: _projFull(merged) });
    }

    const scen = _load().find(x => String(x.id) === String(b.scenarioId || ''));
    if (!scen) return res.status(400).json({ success: false, error: 'scenarioId not found' });
    // '' when the scenario does not say, and that is allowed: the casting then offers
    // every character rather than none.
    const gender = GENDERS.includes(_genderOf(scen)) ? _genderOf(scen) : '';

    const day = now.slice(0, 10);
    const rec = _normProject({
      id: _newId(list),
      owner: OWN.uidOf(req),
      name: `${day} — ${scen.title}`,
      scenarioId: scen.id,
      gender,
      title: scen.title,
      lines: scen.lines,          // SNAPSHOT — later scenario edits do not reach here
      vertical: scen.vertical,
      product: scen.product,
      roles: scen.roles,
      // Its choices start at none and are made by the person (phase V24, _normVideo).
      video: { v: 2 },
      createdAt: now, updatedAt: now,
    }, now);
    list.unshift(rec);
    _saveProjects(list);
    res.json({ success: true, project: _projFull(rec) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A LOOK CAST (phase V67, the owner 2026-11-01: "при смене образа спрашивать, точно ли сменить. и если пользователь
   говорит да, то сбрасывать") - the ONE way "who" is written, the stage's ✕ too (js/merge-v3/wk-setup.js _cast) ──────────
   POST /api/scen3/projects/:id/cast  { characterId, characterName, obrazId, obrazImage, sure? } | { clear: true }
        -> { success, project, moved }   cast; `moved` - work was put aside or came back, and the timeline was re-laid
        -> { success: false, ask: { reads, frames, clips, from, to, sameChar } }   it would put work aside: asked first,
           cast with `sure` after a yes
        -> 409 { success: false, error }  something of the project is being made - after it
   The ✕ (`clear`) takes the look off and puts nothing aside: the same look cast again finds everything as it was ((об1)).
   ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
function _castBusy(id) {
  const busy = _scriptBusy(id);
  if (busy) return busy;
  // A set's frame (/scen3/frames/plan - old rows tried again) files itself into the set it was asked for.
  const frame = ALERTS.list().some(r => r.state === 'running' && r.what === 'frame'
    && String((((r.job || {}).params || {}).request || {}).projectId || '') === String(id));
  return frame ? 'a frame is being drawn' : '';
}

router.post('/scen3/projects/:id/cast', async (req, res) => {
  try {
    const id = String(req.params.id);
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'not found' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    if (proj.type === 'voiceover') return res.status(400).json({ success: false, error: 'a voiceover has nobody to cast' });
    const b = req.body || {};
    const next = b.clear ? null : _normLook(b);
    if (!b.clear && !(next && next.obrazId)) return res.status(400).json({ success: false, error: 'a look is needed' });
    const plan = _castPlan(proj, next);
    // A question, not a refusal: answered 200, so the page's console stays clean at every ask.
    if (plan.ask && !b.sure) return res.json({ success: false, ask: plan.ask, error: 'asked' });
    if (next && (plan.look || plan.char)) {
      const busy = _castBusy(id);
      if (busy) return res.status(409).json({ success: false, error: busy + ' - change the look when it is done' });
    }
    const now = new Date().toISOString();
    let moved = false;
    const saved = PROJECTS.apply(id, (fresh) => { moved = _applyCast(fresh, next, _castPlan(fresh, next), now); });
    if (!saved) return res.status(404).json({ success: false, error: 'not found' });
    if (moved) {
      try { await MIRROR.rebuild(id, { project: saved }); }
      catch (e) { console.warn('[scen3/cast] the timeline was not re-laid:', e.message); }
    }
    console.log('[scen3/cast] ' + id + (next ? ' cast ' + next.characterName + ' / ' + next.obrazId : ' cleared') + (moved ? ' - work moved' : ''));
    res.json({ success: true, project: _projFull(PROJECTS.get(id) || saved), moved });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── THE VOICEOVER DRAFT (phase V62, the owner 2026-10-30: (во29) "давай проект будет создаваться только когда пользователь
   сгенерировал голоса. до этого - это черновик voiceover"; (во30) "можно отменить выбраный сценарий и вернуться к списку
   сценариев и добавить свой текст"; (во35) one, as Merge's draft; (во36) a project from its first read; (во37) then its script
   stays) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   POST /api/scen3/voiceover/draft                               -> { success, project, key, timeline }
        THE draft - the one there is, or a new empty one ("voiceover draft"): what "+ new project -> voiceover" and Home's
        "+ voiceover" open. `timeline` says whether its timeline is made yet (the page makes it, /mv3/timeline/new).
   POST /api/scen3/projects/:id/script  { scenarioId } | { text, name } | { clear: true }   -> { success, project }
        Its script, while it is the draft: a scenario's lines (a snapshot, in their own language), one's own text as ONE line
        (at most VO_MAX), or none again - back to the list. The project takes the scenario's title or the text's name, and
        its folder that name; cleared, it is "voiceover draft" again. Its mood and voice stay. The first read files it as a
        project (_fileTake) - from then on its script is its own.
   ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const VO_DRAFT_NAME = 'voiceover draft';
const _voDraftOf = (list) => list.find(p => p && p.type === 'voiceover' && p.draft) || null;

router.post('/scen3/voiceover/draft', (req, res) => {
  try {
    const now = new Date().toISOString();
    const list = _loadProjects();
    let rec = _voDraftOf(list);
    if (!rec) {
      rec = _normProject({
        id: _newId(list), owner: OWN.uidOf(req), type: 'voiceover', draft: true,
        name: VO_DRAFT_NAME, title: '', lines: [], video: { v: 2 }, createdAt: now, updatedAt: now,
      }, now);
      list.unshift(rec);
      _saveProjects(list);
    }
    const key = 'sv3_' + rec.id;
    res.json({ success: true, project: _projFull(rec), key, timeline: !!require('../lib/merge-store').locate(key) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/scen3/projects/:id/script', async (req, res) => {
  try {
    const id = String(req.params.id);
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'not found' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    if (proj.type !== 'voiceover' || !proj.draft) {
      return res.status(409).json({ success: false, error: 'its voices are read - the script is this project\'s now; another one is a new voiceover' });
    }
    const busy = _scriptBusy(id);
    if (busy) return res.status(409).json({ success: false, error: busy + ' - change the script when it is done' });
    const b = req.body || {};
    let lines = [], title = '', scenarioId = '', extra = {};
    if (b.clear) { /* back to the list: no script */ }
    else if (b.scenarioId != null) {
      const scen = _load().find(x => String(x.id) === String(b.scenarioId));
      if (!scen) return res.status(400).json({ success: false, error: 'scenarioId not found' });
      lines = (scen.lines || []).map(l => String((l && l.text) || '').trim()).filter(Boolean);
      if (!lines.length) return res.status(400).json({ success: false, error: 'this scenario has no lines' });
      if (lines.some(t => t.length > VO_MAX)) return res.status(400).json({ success: false, error: 'a line of this scenario is longer than ' + VO_MAX + ' characters' });
      title = String(scen.title || '').trim() || 'untitled';
      scenarioId = String(scen.id);
      extra = { vertical: scen.vertical || '', product: scen.product || '', roles: scen.roles || [] };
    } else {
      const text = String(b.text == null ? '' : b.text).replace(/\s+/g, ' ').trim();
      if (!text) return res.status(400).json({ success: false, error: 'the text is empty' });
      if (text.length > VO_MAX) return res.status(400).json({ success: false, error: 'the text is longer than ' + VO_MAX + ' characters' });
      lines = [text];
      title = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 120) || text.split(' ').slice(0, 6).join(' ').slice(0, 120);
    }
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    const saved = PROJECTS.apply(id, (fresh) => {
      fresh.lines = lines.map(text => _normLine({ text }));
      fresh.title = title;
      fresh.scenarioId = scenarioId;
      Object.assign(fresh, { vertical: '', product: '', roles: [] }, extra);
      // The name, and so the folder (lib/projects-store.js): given now, while the folder holds nothing but the timeline.
      fresh.name = lines.length ? `${day} — ${title}` : VO_DRAFT_NAME;
      fresh.updatedAt = now;
    });
    if (!saved) return res.status(404).json({ success: false, error: 'not found' });
    // The timeline's name follows, as a new talking head's is made (routes/mergev3.js /mv3/timeline/new).
    try {
      require('../lib/merge-store').update('sv3_' + id, (t) => {
        t.title = lines.length ? `${day} - ${title}` : VO_DRAFT_NAME;
        t.updatedAt = now;
      });
    } catch (e) { console.warn('[scen3/script] the timeline was not renamed:', e.message); }
    const fresh = PROJECTS.get(id) || saved;
    try { await MIRROR.rebuild(id, { project: fresh }); }
    catch (e) { console.warn('[scen3/script] the timeline was not re-laid:', e.message); }
    console.log('[scen3/script] ' + id + (b.clear ? ' cleared' : ' takes ' + lines.length + ' line(s) - ' + title));
    res.json({ success: true, project: _projFull(fresh) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Deletes the project only — the source scenario stays in the library.
// (DELETE /scen3/projects/:id went in phase C3: nothing called it. A talking head's folder is deleted with its
// last timeline from Merge - DELETE /mv3/timeline/:key?files=1, routes/mergev3.js.)

/* ── The words of ONE line ───────────────────────────────────────────────
   POST /api/scen3/projects/:id/line  { index, text } -> { success, project }

   The words are edited where the read is (docs/local-app/PLAN.md, phase V3): a line is judged by
   how it sounds, so the place to change it is beside the take of it. Deliberately not a save of
   the whole project - a page holding its own copy of the lines would put that copy's `audio` back
   over whatever a read had just written into them, and a read is the thing most likely to be
   running while somebody types.

   Nothing is done to the take here. It goes stale by itself, because stale means "the words are
   no longer the ones that were spoken" - each take keeps its `said` - and that comparison is made
   wherever the line is shown. Putting the text back to what was said is how a line stops being
   stale: the same call, with those words.
   ───────────────────────────────────────────────────────────────────────── */
router.post('/scen3/projects/:id/line', async (req, res) => {
  try {
    let text = String((req.body || {}).text == null ? '' : (req.body || {}).text).trim();
    if (!text) return res.status(400).json({ success: false, error: 'a line cannot be empty' });
    // (phase V62) A voiceover's line is kept in its own language, and no longer than VO_MAX.
    const vo = (_loadProjects().find(p => String(p.id) === String(req.params.id)) || {}).type === 'voiceover';
    if (vo && text.length > VO_MAX) return res.status(400).json({ success: false, error: 'a line is at most ' + VO_MAX + ' characters' });
    // (phase V29) Typed in another language, the words are made English before they are kept - the field shows the
    // English. Then the project is read and written in one go, as before.
    if (!vo && !AGENT.english(text)) {
      const t = await _englishLines([text]);
      if (t.fail) return res.status(502).json({ success: false, error: t.fail });
      text = String(t.texts[0] || '').trim();
    }
    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === String(req.params.id));
    if (!proj) return res.status(404).json({ success: false, error: 'not found' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);

    const lines = (proj.lines || []).map(_normLine);
    const i = parseInt((req.body || {}).index, 10);
    if (!(i >= 0 && i < lines.length)) return res.status(400).json({ success: false, error: 'no such line' });

    // The words with their [tags], when the page edits those too (Merge, phase W). Kept only when
    // the words in it are these words: tags belong to the words they sit between. Sent nothing, a
    // change of words drops the old tags - they were made for other words - and the next read tags
    // the line again.
    const tagged = (req.body || {}).tagged == null ? null : String((req.body || {}).tagged).trim();
    if (tagged !== null || text !== lines[i].text) {
      lines[i].tagged = (tagged !== null && _words(tagged) === _words(text)) ? tagged : '';
    }
    lines[i].text = text;
    proj.lines = lines;
    proj.updatedAt = new Date().toISOString();
    _saveProjects(list);
    MIRROR.touch(proj.id, { project: proj });   // the timeline mirrors the lines (T'): the words of a line
    res.json({ success: true, project: _projFull(proj) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A line taken off the script, and put back ───────────────────────────────
   POST /api/scen3/projects/:id/line/state  { index, removed } -> { success, project }

   The owner's decision (2026-09-22): a line is never deleted. It is taken off - the panel dims it
   and moves it to the foot of the script with a `restore` on it - and its files stay in the project
   folder. It keeps its PLACE in the list (see `removed` in _normLine), so nothing below it moves
   onto another frame and no clip disappears; putting it back is simply the flag going away.

   The timeline is the one thing that has to change, and it changes by itself: the mirror lays only
   the lines that are in the video, so the cut closes over the line that went and opens again when
   it comes back (lib/frag-mirror.js). This route WAITS for that re-laying before it answers, unlike
   every other caller of the mirror: the person is looking straight at the timeline through the blur
   when they press this, and the page refreshes it the moment the answer arrives (phase Z', the
   owner 2026-09-22). Everywhere else the mirror is fire-and-forget, because nothing is watching.

   A line cannot be taken off WHILE IT IS BEING MADE: the money would buy a fragment that is no
   longer in the video. Its neighbours are free - the numbers do not move, so a clip in flight
   cannot land on somebody else's line.
   ──────────────────────────────────────────────────────────────────────────── */
// Is this very line being made right now? The journal is what knows about a clip - it is the one
// place a run is written down - and a read run keeps the lines it is walking.
function _lineBusy(id, i) {
  const clip = ALERTS.list().some(r => r.state === 'running' && r.what === 'clip'
    && r.job && r.job.params && r.job.params.file
    && String(r.job.params.file.projectId) === String(id) && Number(r.job.params.file.line) === i);
  if (clip) return 'this fragment is being filmed right now';
  const run = _reads.get(String(id));
  if (run && run.running && Array.isArray(run.only) && run.only.includes(i)) return 'this fragment is being read right now';
  return '';
}

router.post('/scen3/projects/:id/line/state', async (req, res) => {
  try {
    const id = String(req.params.id);
    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'not found' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);

    const lines = (proj.lines || []).map(_normLine);
    const i = parseInt((req.body || {}).index, 10);
    if (!(i >= 0 && i < lines.length)) return res.status(400).json({ success: false, error: 'no such line' });
    const off = !!(req.body || {}).removed;
    if (off) {
      const busy = _lineBusy(id, i);
      if (busy) return res.status(409).json({ success: false, error: busy });
    }
    if (lines[i].removed === off) return res.json({ success: true, project: _projFull(proj) });

    lines[i].removed = off;
    proj.lines = lines;
    proj.updatedAt = new Date().toISOString();
    _saveProjects(list);
    // The cut closes over it, or opens again (T') - and this one is WAITED for, so the page can
    // show the new timeline the moment it gets the answer. A mirror that could not be built must
    // never fail the thing that prompted it, so a failure is logged and the answer goes anyway.
    try { await MIRROR.rebuild(proj.id, { project: proj }); }
    catch (e) { console.warn('[scen3/line/state] the timeline was not re-laid:', e.message); }
    console.log('[scen3/line/state] ' + id + ' line ' + (i + 1) + (off ? ' taken off' : ' restored'));
    res.json({ success: true, project: _projFull(proj) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A LINE PUT IN (phase V26.8, the owner 2026-10-13) ───────────────────────
   POST /api/scen3/projects/:id/line/insert  { after, text } -> { success, project, index }

   The "+" on the border under a fragment: a new line below it, with the words typed for it. The
   script was only ever shortened before (a line is taken off, never deleted, phase Z) - and that is
   because a line takes its first frame from the set BY ITS NUMBER: moving the lines below down a
   place would put each of them on another frame, and their clips would drop out of the fragments
   and off the timeline. So before anything moves, every line is given the number it has now to
   KEEP (`slot`, read by _frameOfLine instead of the index), and the new line takes the one after the
   line above it - the next frame of the set (the owner's answer (ф)).

   NOT WHILE ANYTHING IS BEING MADE in the project: a read, a clip, a tagging or a prompt lands on
   its line by number, and with a line put in above it, it would land on the one above its own. The
   person is told what to wait for. The timeline is re-laid and WAITED for, as when a line is taken
   off: its cells are numbered by the lines.
   ──────────────────────────────────────────────────────────────────────────── */
// WORK THAT WRITES INTO A LINE BY ITS NUMBER, under way in a project - a tagging, a read by hand, a retiming, an
// animation prompt being written - counted while it runs (the routes and _writePrompts hold it).
const _lineWork = new Map();              // projectId -> how many are under way
function _holdLines(id) {
  const key = String(id || '');
  _lineWork.set(key, (_lineWork.get(key) || 0) + 1);
  return () => {
    const n = (_lineWork.get(key) || 1) - 1;
    if (n > 0) _lineWork.set(key, n); else _lineWork.delete(key);
  };
}
// Is anything being made in this project that a line put in would move? '' when nothing is.
function _scriptBusy(id) {
  const key = String(id);
  if (_lineWork.get(key)) return 'a line is being marked up, read or written for';
  const run = _reads.get(key);
  if (run && run.running) return 'the script is being read';
  const clip = ALERTS.list().some(r => r.state === 'running' && r.what === 'clip'
    && r.job && r.job.params && r.job.params.file && String(r.job.params.file.projectId) === key);
  return clip ? 'a clip is being made' : '';
}

router.post('/scen3/projects/:id/line/insert', async (req, res) => {
  try {
    const id = String(req.params.id);
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'not found' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const b = req.body || {};
    let text = String(b.text == null ? '' : b.text).replace(/\s+/g, ' ').trim();
    if (!text) return res.status(400).json({ success: false, error: 'a line cannot be empty' });
    const after = parseInt(b.after, 10);
    if (!(after >= 0 && after < (proj.lines || []).length)) return res.status(400).json({ success: false, error: 'no such line' });
    const busy = _scriptBusy(id);
    if (busy) return res.status(409).json({ success: false, error: busy + ' - put the line in when it is done' });
    // (phase V62) A voiceover's line goes in as typed, in its own language, and no longer than VO_MAX.
    const vo = proj.type === 'voiceover';
    if (vo && text.length > VO_MAX) return res.status(400).json({ success: false, error: 'a line is at most ' + VO_MAX + ' characters' });
    // (phase V29) Typed in another language, it goes in English - and nothing may have started while it was translated.
    if (!vo && !AGENT.english(text)) {
      const t = await _englishLines([text]);
      if (t.fail) return res.status(502).json({ success: false, error: t.fail });
      text = String(t.texts[0] || '').replace(/\s+/g, ' ').trim();
      const busy2 = _scriptBusy(id);
      if (busy2) return res.status(409).json({ success: false, error: busy2 + ' - put the line in when it is done' });
    }

    const saved = PROJECTS.apply(id, (fresh) => {
      fresh.lines = (fresh.lines || []).map(_normLine);
      fresh.lines.forEach((l, k) => { if (!Number.isInteger(l.slot)) l.slot = k; });
      // (phase V61) ITS OWN NUMBER: the one after the line above was the line below's too, so the new line opened on the same
      // frame as the next one. It takes a number no line has - the first past the largest whose frame, by the project's own
      // rule, is neither of its neighbours' when the pool has room for that.
      const pool = _framePool(fresh);
      const spread = _normVideo(fresh.video).spread;
      const near = [after, after + 1].filter(k => fresh.lines[k])
        .map(k => (_frameOfLine(pool, fresh.lines[k], k, spread, id) || {}).id).filter(Boolean);
      const base = Math.max(-1, ...fresh.lines.map(l => l.slot)) + 1;
      let slot = base;
      for (let k = 0; pool.length > near.length && k < pool.length; k++) {
        const fr = _frameOfLine(pool, { slot: base + k }, base + k, spread, id);
        if (fr && !near.includes(fr.id)) { slot = base + k; break; }
      }
      fresh.lines.splice(after + 1, 0, _normLine({ text, slot }));
      _shelfSplice(fresh, after + 1);        // (phase V67) the work put aside keeps its lines' numbers too
      fresh.updatedAt = new Date().toISOString();
    });
    if (!saved) return res.status(404).json({ success: false, error: 'not found' });
    try { await MIRROR.rebuild(id, { project: saved }); }
    catch (e) { console.warn('[scen3/line/insert] the timeline was not re-laid:', e.message); }
    console.log('[scen3/line/insert] ' + id + ' a line put in after line ' + (after + 1));
    res.json({ success: true, project: _projFull(saved), index: after + 1 });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── THE LINES SEEDANCE FILMS, AND THEIR PROMPTS (phase V26.8, part 4, the owner 2026-10-13) ──────────
   POST /api/scen3/sd/prompts  { projectId, lines? }               -> { success, project, report: { written, failed } }
   POST /api/scen3/sd/prompt   { projectId, line, prompt }          a prompt edited by hand
                               { projectId, line, useAgent: true }  back to the writer's own   -> { success, project }

   A LINE IS A FRAGMENT OF ITS OWN (the sixth round, the owner 2026-10-15: "Удаляем эту функцию по объединению
   фрагментов. Всегда по одной строке") - one clip per line, as Kling. Its prompt is written by ONE request of its own
   (lib/mv3-agent.js thinkTalk, lib/sd-prompt.js assemble) - the writer sees the frame the line opens on and the
   character's sheet, and is told the line, the mood and the way of moving - and kept on the line (`sd`, _normSdLine).
   `lines` names the lines to write; without it, every line that has no prompt, or one written for other settings and
   not edited by hand. A few at once. Text in seconds and fractions of a cent: no Alerts row, as the animation prompts
   of Kling (section 9 of the plan). The prompts land on the lines by number: a line put in meanwhile waits (_holdLines).
   ──────────────────────────────────────────────────────────────────────────── */
const SD_WRITE_AT_ONCE = 3;

// What every line's prompt is written FOR, as things stand: the effective sound and way of moving, the place.
function _sdSetting(p) {
  const video = _normVideo(p.video);
  return {
    video,
    sound: video.sound || TH.SOUND_DEFAULT,
    gestures: SDP.gesturesOf(video),
    place: _envMotionOf(_normCasting(p.casting).locationImage) || '',
  };
}

// A take of a line is FRESH while the line opens on the frame it was made from and says the words it was made of -
// and, by the rule of the sound it was made with (the owner's answer (я16): a take made the other way stays the line's
// until a new one), with `read` by the read it heard (one from before that was recorded counts as fresh, as Kling's),
// with `sample` in the voice it was made in.
function _sdFresh(c, frameId, take, words, voice) {
  if (c.frameId !== frameId) return false;
  if (c.words && c.words !== words) return false;
  if (c.sound === 'sample') return !c.voice || !voice || c.voice === voice;
  return !c.take || !take || c.take === take.path;
}
// (the owner's answer (я17)) A line too long for a clip of the model's length can only be guessed at by `sample` - no
// length is estimated: it goes as it is, and the open line says so. English is spoken at about 2.5 words a second.
const SD_WORDS_A_SECOND = 2.5;
const _wordCount = (l) => String((l && l.text) || '').replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean).length;

// THE LINES OF A SEEDANCE PROJECT, for the page and for the clips, each with its place in the video (`n`), the frame
// it opens on, the seconds its clip is asked for, its prompt - edited by hand, written for other settings (`stale`) - or
// none yet, and its takes (`clip` - chosen by hand, else the newest fresh). BY THE SOUND (the sixth round): with `read`
// every live line that is read - its read is what Seedance hears, and its length the clip's; with `sample` every live
// line with words - nothing is read (the owner: "генерировать голоса не нужно"), and the clip's length is Seedance's own
// (`secs` -1). null for Kling.
function _sdView(p) {
  const st = _sdSetting(p);
  if (!TH.isSeedance(st.video.model)) return null;
  const sample = st.sound === 'sample';
  const pool = _framePool(p);
  const cap = TH.maxSecs(st.video.model);
  const voice = String((_castVoice(p) || {}).id || '');
  const out = [];
  let n = 0;
  (p.lines || []).map(_normLine).forEach((l, i) => {
    if (l.removed) return;
    n++;
    const take = MIRROR.readOf(l);
    // With `read` a line not read is no fragment - unless it has takes, made by the voice sample before (the owner's
    // answer (я16): a take made the other way stays the line's, and on the timeline, until a new one is made).
    const noRead = !sample && !take;
    if (sample ? !String(l.text || '').trim() : (noRead && !(l.sd && l.sd.clips.length))) return;
    const fr = _frameOfLine(pool, l, i, st.video.spread, p.id);
    const frameId = fr ? fr.id : '';
    const words = SDP.wordsSig(l);
    const dur = !sample && take ? Math.round((+take.dur || 0) * 100) / 100 : 0;
    // (phase V26.6) The products whose pictures go with the clip - another set of them makes the prompt stale.
    const prodSig = _frameProds(fr).filter(x => x.have).map(x => x.path).join('|');
    const sig = SDP.sigOf({ frameId, mood: st.video.mood, gestures: st.gestures && st.gestures.id, sound: st.sound, place: st.place, words,
      take: take && !sample ? take.path : '', voice: sample ? voice : '', props: prodSig });
    const k = l.sd || null;
    const clips = ((k && k.clips) || []).map(c => ({ ...c, fresh: _sdFresh(c, frameId, take, words, voice) }));
    const clip = (k && k.chosen && clips.find(c => c.id === k.chosen)) || clips.filter(c => c.fresh).pop() || null;
    out.push({
      n, line: i, dur, tooLong: !sample && dur > cap + 1e-6, audio: take && !sample ? take.path : '', frameId, noRead,
      secs: sample ? -1 : noRead ? 0 : SDP.clipSecs(dur), sig, words,
      long: sample && _wordCount(l) > cap * SD_WORDS_A_SECOND,
      prompt: k ? k.prompt : '', edited: !!(k && k.edited), stale: !!(k && k.prompt && k.sig !== sig),
      hasAgent: !!(k && k.agent), writer: k ? k.writer : '',
      clips, clip, chosen: !!(k && k.chosen && clip && clip.id === k.chosen),
    });
  });
  return out;
}

// A picture the writer can look at: its public address (R2, as Kling's writer), or - with nowhere to host it - the
// picture itself, made small, inside the request.
async function _seeable(url) {
  try { return await _hostLocal(url); }
  catch (e) {
    const abs = toDiskExisting(url);
    if (!abs || !fs.existsSync(abs)) return '';
    const buf = await require('sharp')(abs).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  }
}

async function _writeSdPrompts(id, only) {
  const free = _holdLines(id);
  try { return await _writeSdPromptsNow(id, only); } finally { free(); }
}
async function _writeSdPromptsNow(id, only) {
  const proj0 = _loadProjects().find(x => String(x.id) === String(id));
  if (!proj0) throw Object.assign(new Error('no such project'), { status: 404 });
  const st = _sdSetting(proj0);
  if (!TH.isSeedance(st.video.model)) throw Object.assign(new Error('this project is not filmed by Seedance'), { status: 400 });
  const missing = _unchosen(st.video, ['mood']);
  if (missing) throw Object.assign(new Error(missing), { status: 400 });
  const cast = _normCasting(proj0.casting);
  if (!cast.obrazImage) throw Object.assign(new Error('choose the character in a look first - its sheet goes with every clip'), { status: 400 });
  const pool = _framePool(proj0);
  if (!pool.length) throw Object.assign(new Error('make a frame in the frames chat first: a clip begins on one'), { status: 400 });
  const view = _sdView(proj0) || [];
  const want = view.filter(f => !f.tooLong && !f.noRead && (Array.isArray(only) ? only.includes(f.line) : (!f.prompt || (f.stale && !f.edited))));
  const report = { written: 0, failed: [] };
  if (!want.length) return { project: proj0, report };

  const lines = (proj0.lines || []).map(_normLine);
  const mood = MP.moodById(st.video.mood);
  const covered = _faceCovered(proj0);
  const facts0 = { mood: { label: mood.label, face: mood.face }, gestures: st.gestures, covered };
  // (phase V61) The shot of the line's OWN frame - from the frames chat, each with its edge; the project's old menu for a
  // frame without one: whether it is a selfie, and which garments it shows.
  const shotOf = (fr) => String((fr && fr.framing) || st.video.framing || '');
  const sheet = await _seeable(cast.obrazImage);
  // (the sixth round, probe P7) Who speaks and, by the voice sample, the voice in words and the mood's own tone - the
  // caption of a piece of the line that has no [tag] (lib/sd-prompt.js captioned).
  const cv = _castVoiceOf(proj0);
  const labels = cv.has ? _voiceLabels(cv.id) : null;
  const gender = (labels && labels.gender) || String(proj0.gender || '');
  const said = { gender, voiceWords: SDP.voiceWords(labels, gender), moodTone: (mood.tags || [])[0] || '' };
  const write = new Map();                  // line -> what is written for it
  const one = async (f) => {
    try {
      const fr = pool.find(v => v.id === f.frameId);
      const frame = fr ? await _seeable(fr.preview || fr.path) : '';
      const rows = SDP.rows(lines[f.line]);
      const shot = shotOf(fr);
      // (phase V26.6, the owner's (пр4)) The products of the line's frame: told to the writer, and their pictures go with the clip
      // after the sheet ({{image:3}} on) - each said in the prompt.
      const prods = _frameProds(fr).filter(x => x.have);
      const prodPics = await Promise.all(prods.map(x => _seeable(x.path)));
      const t = await AGENT.thinkTalk({ facts: { ...facts0, selfie: shot === 'selfie', clothes: _clothesShown(proj0, _frameSet(shot) ? shot : 'full'),
        dur: f.secs > 0 ? f.dur : 0, lines: rows, products: prods.map(x => ({ name: x.name, label: x.label, held: x.held })) },
      picUrls: [frame, sheet].concat(prodPics).filter(Boolean) });
      if (t.fail) { report.failed.push({ n: f.n, error: t.fail }); return; }
      const prompt = SDP.assemble({ model: st.video.model, covered, sound: st.sound, rows, body: t.body, place: st.place, ...said,
        products: prods.map(x => ({ name: x.name, what: x.what })) });
      write.set(f.line, { prompt, agent: prompt, edited: false, sig: f.sig, writer: t.writer || '', at: new Date().toISOString() });
      report.written++;
    } catch (e) { report.failed.push({ n: f.n, error: e.message }); }
  };
  for (let k = 0; k < want.length; k += SD_WRITE_AT_ONCE) await Promise.all(want.slice(k, k + SD_WRITE_AT_ONCE).map(one));
  // The writer took a while and other things write this project meanwhile: read again, and only these prompts touched -
  // each line's takes and hand choice stay as they are.
  const saved = PROJECTS.apply(id, (fresh) => {
    fresh.lines = (fresh.lines || []).map(_normLine);
    for (const [i, w] of write) {
      if (!fresh.lines[i]) continue;
      fresh.lines[i].sd = { ...(fresh.lines[i].sd || _normSdLine(null)), ...w };
    }
    fresh.updatedAt = new Date().toISOString();
  });
  console.log('[scen3/sd/prompts] ' + id + ' written=' + report.written + ' failed=' + report.failed.length);
  return { project: saved || proj0, report };
}

router.post('/scen3/sd/prompts', async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const proj = _loadProjects().find(x => String(x.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const only = Array.isArray(b.lines) ? b.lines.map(n => parseInt(n, 10)).filter(n => n >= 0) : null;
    const out = await _writeSdPrompts(id, only);
    res.json({ success: true, project: _projFull(out.project), report: out.report });
  } catch (e) {
    console.error('[scen3/sd/prompts]', e.message);
    res.status(e.status || 502).json({ success: false, error: e.message });
  }
});

router.post('/scen3/sd/prompt', async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const i = parseInt(b.line, 10);
    const proj = _loadProjects().find(x => String(x.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const f = (_sdView(proj) || []).find(x => x.line === i);
    if (!f) return res.status(400).json({ success: false, error: 'no such line, or it is not read yet' });
    let text = String(b.prompt == null ? '' : b.prompt).trim().slice(0, 20000);
    // (phase V29) Written by hand in another language, it is kept - and sent - in English.
    if (text && !b.useAgent) {
      const t = await _englishText(text);
      if (t.fail) return res.status(502).json({ success: false, error: t.fail });
      text = String(t.text || '').trim().slice(0, 20000);
    }
    const saved = PROJECTS.apply(id, (fresh) => {
      fresh.lines = (fresh.lines || []).map(_normLine);
      const line = fresh.lines[i];
      if (!line) return;
      const was = line.sd || _normSdLine(null);
      if (b.useAgent) {
        if (!was.agent) return;
        line.sd = { ...was, prompt: was.agent, edited: false };
      } else {
        // Written by hand it is the line's as things stand now; the same words as the writer's are the writer's.
        line.sd = { ...was, prompt: text, edited: !!text && text !== was.agent, sig: text === was.agent ? was.sig : f.sig, at: new Date().toISOString() };
      }
      fresh.updatedAt = new Date().toISOString();
    });
    res.json({ success: true, project: _projFull(saved || proj) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── THE CLIP OF A LINE FILMED BY SEEDANCE (phase V26.8, part 5, the owner 2026-10-13; a line each since the sixth round) ──
   Asked for through the clip routes of a fragment (/scen3/fragments/clip and /clips hand a Seedance project here),
   addressed by the line. The video chat's way to Seedance (lib/video-models.js, the only place a field is written;
   lib/video-task.js): kie first - Replicate refused our AI faces on Seedance - each rung's references made to its
   limits (lib/video-prep.js) and hosted fresh on R2.

   What goes: the frame the line opens on (@Image1), the character's 4K sheet (@Image2), the sound (@Audio1 - the
   line's read, or a 10 s sample of the voice), the prompt; the clip as long as the read, rounded up to the whole
   second; Seedance's own sound always on - it voices the line itself (the read under a silent clip went in the sixth
   round: its lips drifted from the read, Ch2 and Ch3).

   EVERYTHING IS SETTLED BEFORE THE MONEY, and said when it cannot be: the model, the quality and the mood chosen, a
   line read and not longer than the model takes, a frame, the look, a voice sample when one is wanted; the place
   analysed and the prompt written - each a stage of the row. PAID ONCE: `asked` is written just
   before each paid create; a create with no answer stops the ladder (lib/task-started.js `unsure`); a row found at
   start with `asked` and no task "may have been paid for" and is not asked again by itself.
   ─────────────────────────────────────────────────────────────────────────── */
const VMOD = require('../lib/video-models');
const VTASK = require('../lib/video-task');
const SPEECH = require('../lib/speech-end');
const FAKE = require('../lib/fake-agg');
const _sdAsking = new Set();              // the rows being asked for now, in this process - their poll waits
const SD_BOOT_AT = Date.now();            // ...and every row made since this process started is this process's

// The voice sample for `sample`: the cast voice's demo on the Voices shelf, else the character's own record of it -
// a file that is on disk.
function _sdSample(p) {
  const cv = _castVoiceOf(p);
  return cv && cv.has && cv.id ? _sampleOf(cv.id) : '';
}
// A voice's labels (gender, age, accent, descriptive) - the Voices shelf's, else the character's record of the voice.
function _voiceLabels(voiceId) {
  const shelf = VSHELF.get(voiceId);
  if (shelf && shelf.labels) return shelf.labels;
  const chars = _read(path.join(DATA_DIR, 'characters.json'));
  const arr = Array.isArray(chars) ? chars : (chars && chars.characters) || [];
  for (const ch of arr) {
    const v = (Array.isArray(ch.voices) ? ch.voices : []).find(x => x && String(x.voiceId) === String(voiceId));
    if (v && v.labels) return v.labels;
  }
  return null;
}
function _sampleOf(voiceId) {
  const there = (u) => { const abs = u ? toDiskExisting(String(u)) : ''; return !!(abs && fs.existsSync(abs)); };
  const shelf = VSHELF.get(voiceId);
  if (shelf && shelf.demo && there(shelf.demo)) return String(shelf.demo);
  const chars = _read(path.join(DATA_DIR, 'characters.json'));
  const arr = Array.isArray(chars) ? chars : (chars && chars.characters) || [];
  for (const ch of arr) {
    const v = (Array.isArray(ch.voices) ? ch.voices : []).find(x => x && String(x.voiceId) === String(voiceId));
    if (v && v.sample && there(v.sample)) return String(v.sample);
  }
  return '';
}

/* ── A VOICE'S DEMO, MADE WHEN IT HAS NONE (phase V26.8, sixth round, the owner's answer (я7)) ──────────
   POST /api/scen3/voice/demo  { projectId }  -> { success, made, project }

   By the voice sample Seedance takes the timbre of the voice's demo. A voice taken from the ElevenLabs library got its
   demo when it was taken (/scen3/voices/take); a character's voice set before that has none (6 of the owner's 27,
   2026-10-15). The owner: "генерируем демку после выбора голоса. Кнопка генерации недоступна пока демка не готова" -
   so the page asks for it the moment a voice without one is chosen in a project filmed by the voice sample, and its
   buttons wait. The same phrase a take reads (lib/voice-demo.js) - ElevenLabs credits, about ten seconds - filed into
   media/voice/demos/ and onto the Voices shelf, so it is made once for every project the voice is in. One at a time
   per voice: a second ask waits for the first.
   ──────────────────────────────────────────────────────────────────────────── */
const _demoMaking = new Map();            // voiceId -> the making under way
function _makeDemo(voiceId, name) {
  const live = _demoMaking.get(voiceId);
  if (live) return live;
  const run = (async () => {
    const key = _elKey();
    if (!key) throw Object.assign(new Error('no ElevenLabs key in settings - the voice demo cannot be made'), { status: 400 });
    const buf = await _speakLine(key, voiceId, VD.DEMO_MODEL, VD.DEMO_TEXT, { stability: 0.5, speed: 1 });
    const dir = path.join(CFG.MEDIA.voice, 'demos');
    fs.mkdirSync(dir, { recursive: true });
    const file = 'demo_' + voiceId + '_' + Date.now() + '.mp3';
    fs.writeFileSync(path.join(dir, file), buf);
    const demo = '/media/voice/demos/' + file;
    const dur = await _audioDur(path.join(dir, file));
    await VSHELF.register({ voiceId, name, demo, dur });
    console.log('[scen3/voice/demo] made for', voiceId, dur.toFixed(1) + 's');
    return demo;
  })();
  _demoMaking.set(voiceId, run);
  run.then(() => _demoMaking.delete(voiceId), () => _demoMaking.delete(voiceId));
  return run;
}
router.post('/scen3/voice/demo', async (req, res) => {
  try {
    const id = String((req.body || {}).projectId || '').trim();
    const proj = _loadProjects().find(x => String(x.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const cv = _castVoiceOf(proj);
    if (!cv.has || !cv.id) return res.status(400).json({ success: false, error: 'choose a voice first' });
    let made = false;
    if (!_sampleOf(cv.id)) {
      await _makeDemo(cv.id, cv.name || (cv.character ? cv.character + ' - voice ' + cv.index : ''));
      made = true;
    }
    res.json({ success: true, made, project: _projFull(_loadProjects().find(x => String(x.id) === id) || proj) });
  } catch (e) {
    const d = (e.response && e.response.data) || {};
    const msg = (d.detail && (d.detail.message || d.detail)) || e.message;
    console.error('[scen3/voice/demo]', msg);
    res.status(e.status || 502).json({ success: false, error: String(msg) });
  }
});

// What a clip of line `i` would be made of, or why it cannot be.
function _sdClipPlan(proj, i) {
  const video = _normVideo(proj.video);
  const missing = _unchosen(video, ['model', 'quality', 'mood']);
  if (missing) return { skipped: missing };
  const f = (_sdView(proj) || []).find(x => x.line === i);
  if (!f || f.noRead) return { skipped: video.sound === 'sample' ? 'this line has no words' : 'this line is not read yet - Seedance hears its read' };
  const model = TH.byId(video.model);
  if (f.tooLong) return { skipped: 'this line is ' + f.dur.toFixed(1) + ' s - longer than ' + (model ? model.label : 'the model') + ' takes' };
  if (!f.frameId) return { skipped: 'no frame for this line - make one in the frames chat' };
  const cast = _normCasting(proj.casting);
  if (!cast.obrazImage) return { skipped: 'choose the character in a look first - its sheet goes with the clip' };
  const sound = video.sound || TH.SOUND_DEFAULT;
  const sample = sound === 'sample' ? _sdSample(proj) : '';
  if (sound === 'sample' && !sample) return { skipped: 'the voice has no demo yet - it is made in field 1, mood & voice' };
  const quality = TH.qualityOf(video.model, video.quality);
  if (!quality) return { skipped: 'choose the quality of the clips (field 3) first' };
  const voice = sound === 'sample' ? String((_castVoice(proj) || {}).id || '') : '';
  // With `sample` Seedance picks the length (-1) and bills what it made: no price beforehand (the owner's answer (я10)).
  return { frag: f, video, sound, sample, voice, quality, cast, cost: f.secs > 0 ? +(quality.pricePerSec * f.secs).toFixed(4) : null };
}
function _sdPlanAgain(id, i) {
  const proj = _loadProjects().find(p => String(p.id) === String(id));
  if (!proj) throw Object.assign(new Error('no such project'), { status: 404 });
  const plan = _sdClipPlan(proj, i);
  if (plan.skipped) throw Object.assign(new Error(plan.skipped), { status: 400 });
  return { proj, plan };
}

// One Seedance clip asked for: the place, the prompt and the sound made sure of, the references prepared and hosted,
// the ladder walked. `onAsk(true|false)` marks the row's `asked` around each paid create.
async function _submitSdClip(b, onStage, onAsk) {
  const say = typeof onStage === 'function' ? onStage : () => {};
  const ask = typeof onAsk === 'function' ? onAsk : () => {};
  const id = String(b.projectId || '').trim();
  const i = parseInt(b.line, 10);
  let { proj, plan } = _sdPlanAgain(id, i);
  const place = _normCasting(proj.casting).locationImage;
  if (place && !_envMotionOf(place)) {
    say('analysis · the place');
    try { await _askEnvMotion(place); } catch (e) { console.warn('[scen3/sdclip] the place was not analysed:', e.message); }
    ({ proj, plan } = _sdPlanAgain(id, i));
  }
  if (!plan.frag.prompt || (plan.frag.stale && !plan.frag.edited)) {
    say('writing the prompt');
    const out = await _writeSdPrompts(id, [i]);
    if (out.report.failed.length) throw new Error('the prompt was not written: ' + out.report.failed[0].error);
    ({ proj, plan } = _sdPlanAgain(id, i));
    if (!plan.frag.prompt) throw new Error('the prompt was not written');
  }
  const f = plan.frag;
  const fr = _framePool(proj).find(v => v.id === f.frameId);
  const srcs = { frame: fr && fr.path, sheet: plan.cast.obrazImage, sound: plan.sound === 'sample' ? plan.sample : f.audio };
  // (phase V26.6, the owner's (пр4)) The products of the frame go as pictures after the sheet - as many as the prompt was
  // written for (its fingerprint holds them); a prompt naming a picture that is not sent is refused in words.
  const prods = _frameProds(fr).filter(x => x.have);
  prods.forEach((x, k) => { srcs['prop' + k] = x.path; });
  const named = Math.max(0, ...[...String(f.prompt || '').matchAll(/@Image(\d+)/g)].map(m => +m[1]));
  if (named > 2 + prods.length) throw new Error('the prompt names a product picture that is not in Props any more - write the prompt again');
  const abs = {};
  for (const [k, u] of Object.entries(srcs)) {
    abs[k] = u ? toDiskExisting(u) : '';
    if (!abs[k] || !fs.existsSync(abs[k])) throw new Error('a reference of this clip is not in the library any more: ' + (u || k));
  }
  const ladder = VMOD.ladder(plan.video.model, 'kie');
  if (!ladder.length) throw new Error(VMOD.noRoute(plan.video.model));
  const format = _normMix(proj.mix).settings.format;
  const reasons = [];
  let hosted = null;
  for (const pair of ladder) {
    if (!hosted) {
      say('sending the references');
      if (FAKE.on()) {
        hosted = { frame: FAKE.host(srcs.frame), sheet: FAKE.host(srcs.sheet), sound: FAKE.host(srcs.sound), secs: plan.sound === 'sample' ? Math.min(pair.limits.audioSecs || 15, await _audioDur(abs.sound) || 10) : f.dur,
          props: prods.map((x, k) => FAKE.host(srcs['prop' + k])) };
      } else {
        const VP = require('../lib/video-prep');
        const one = await VP.image(abs.frame, pair);
        const two = await VP.image(abs.sheet, pair);
        // The sample as long as the model takes a reference sound - all of it when it is shorter (probe P7c: 15 s on 2.0).
        const snd = await VP.sound(abs.sound, pair, plan.sound === 'sample'
          ? { from: 0, to: Math.min(pair.limits.audioSecs || 15, await _audioDur(abs.sound) || 10) } : { from: 0, to: f.dur });
        try {
          const props = [];
          for (let k = 0; k < prods.length; k++) {
            const pic = await VP.image(abs['prop' + k], pair);
            props.push(await H.uploadToPublicHost(pic.buf, { ext: pic.ext, verify: true, forceFresh: true }));
          }
          hosted = {
            frame: await H.uploadToPublicHost(one.buf, { ext: one.ext, verify: true, forceFresh: true }),
            sheet: await H.uploadToPublicHost(two.buf, { ext: two.ext, verify: true, forceFresh: true }),
            sound: await H.uploadToPublicHost(snd.file, { ext: 'mp3', verify: true, forceFresh: true }),
            secs: snd.secs, props,
          };
        } finally { if (typeof snd.drop === 'function') snd.drop(); }
      }
    }
    // The prompt is kept in kie's names (@Image1); another aggregator gets its own ([Image1] on Replicate).
    const prompt = pair.agg === 'kie' ? f.prompt : f.prompt.replace(/@(Image|Video|Audio)(\d+)/g, '[$1$2]');
    const req = {
      prompt,
      media: [{ kind: 'image', url: hosted.frame }, { kind: 'image', url: hosted.sheet }]
        .concat((hosted.props || []).map(url => ({ kind: 'image', url })), [{ kind: 'audio', url: hosted.sound, in: 0, out: hosted.secs }]),
      params: { resolution: plan.video.quality, duration: f.secs, aspect: FRAG_FORMATS.includes(format) ? format : '9:16', audio: true },
    };
    try { VMOD.check(pair, req); } catch (e) { reasons.push(pair.aggLabel + ': ' + e.message); continue; }
    say('asking ' + pair.aggLabel);
    ask(true);                                    // THE PAID MOMENT
    let sub;
    try {
      sub = await VTASK.submit(pair, req);
    } catch (e) {
      const why = String((e && e.message) || e).slice(0, 300);
      console.warn('[scen3/sdclip]', pair.key, e.unsure ? 'no answer:' : 'refused:', why);
      if (e.unsure) throw new Error(why + ' - it may have been paid for and not followed; look at ' + pair.aggLabel + '’s own history before asking again');
      ask(false);
      reasons.push(pair.aggLabel + ': ' + why);
      if (REFUSAL.isRefusal(why)) break;            // another aggregator would refuse the same content too
      continue;
    }
    console.log('[scen3/sdclip] ' + id + ' line ' + (i + 1) + ' ' + pair.key + ' ' + plan.video.quality + ' ' + f.secs + 's -> ' + String(sub.taskId).slice(0, 24));
    return {
      taskId: sub.taskId, engine: pair.key,
      // What the take is made of - what later tells whether it is still the line's (_sdFresh).
      file: { projectId: id, line: i, frameId: f.frameId, sound: plan.sound, model: plan.video.model, quality: plan.video.quality, secs: f.secs,
        take: plan.sound === 'read' ? f.audio : '', words: f.words, voice: plan.sound === 'sample' ? plan.voice : '' },
    };
  }
  throw new Error(reasons.join(' · ') || 'no aggregator could take it');
}

// The row is written first; the rest goes on without the page, and what comes of it is written into the row.
function _sdStartClip(rec, request) {
  _sdAsking.add(rec.id);
  const mark = (asked) => {
    const row = ALERTS.get(rec.id);
    if (row && row.job) ALERTS.update(rec.id, { job: { ...row.job, params: { ...(row.job.params || {}), asked } } });
  };
  return _submitSdClip(request, (s) => ALERTS.update(rec.id, { stage: s }), mark)
    .then((out) => {
      ALERTS.update(rec.id, {
        taskIds: [out.taskId], engine: out.engine, stage: 'rendering',
        job: { type: 'sdclip', params: { request, file: out.file, asked: true } },
      });
    })
    .catch((e) => {
      console.error('[scen3/sdclip]', e.message);
      ALERTS.fail(rec.id, e.message, REFUSAL.isRefusal(e.message) ? { refused: true } : undefined);
    })
    .finally(() => _sdAsking.delete(rec.id));
}
function _sdRunning(id) {
  return new Set(ALERTS.list()
    .filter(r => r.state === 'running' && r.what === 'clip' && r.job && r.job.params && r.job.params.file
      && String(r.job.params.file.projectId) === String(id))
    .map(r => Number(r.job.params.file.line)));
}

// POST /scen3/fragments/clip for a Seedance project.
function _sdClipRoute(req, res, proj) {
  const b = req.body || {};
  const id = String(proj.id);
  const i = parseInt(b.line, 10);
  const plan = _sdClipPlan(proj, i);
  if (plan.skipped) return res.json({ success: true, skipped: plan.skipped });
  if (_sdRunning(id).has(i)) return res.json({ success: true, skipped: 'this line is already being filmed' });
  const request = { projectId: id, line: i };
  const rec = JOBS.submitted({
    kind: 'video', what: 'clip', title: 'Clip · fragment ' + plan.frag.n, where: b.where || null,
    stage: 'getting ready', taskIds: [],
    job: { type: 'sdclip', params: { request, file: { projectId: id, line: i } } },
  });
  res.json({ success: true, alertId: rec.id });
  _sdStartClip(rec, request);
}

// POST /scen3/fragments/clips for a Seedance project: every line that needs its clip, a row each at once, then asked a
// second apart.
function _sdClipsRoute(req, res, proj) {
  const b = req.body || {};
  const id = String(proj.id);
  const key = String(b.key || '');
  const title = String(proj.name || proj.title || 'talking head');
  const busy = _sdRunning(id);
  const queued = [], skipped = [];
  for (const f of _sdView(proj) || []) {
    const i = f.line;
    if (busy.has(i)) { skipped.push({ line: i + 1, why: 'already being made' }); continue; }
    const plan = _sdClipPlan(proj, i);
    if (plan.skipped) { skipped.push({ line: i + 1, why: plan.skipped }); continue; }
    if (!b.again && f.clip) { skipped.push({ line: i + 1, why: 'already clipped' }); continue; }
    const request = { projectId: id, line: i };
    const rec = JOBS.submitted({
      kind: 'video', what: 'clip', title: 'Clip · fragment ' + f.n, where: _whereClip(key, title, i, f.n),
      stage: 'getting ready', taskIds: [],
      job: { type: 'sdclip', params: { request, file: { projectId: id, line: i } } },
    });
    queued.push({ line: i + 1, alertId: rec.id, request, rec });
  }
  console.log('[scen3/sdclips] ' + id + ' queued=' + queued.length + ' skipped=' + skipped.length);
  res.json({ success: true, queued: queued.map(q => ({ line: q.line, alertId: q.alertId })), skipped });
  (async () => {
    for (let k = 0; k < queued.length; k++) {
      if (k) await _wait(SUBMIT_GAP_MS);
      _sdStartClip(queued[k].rec, queued[k].request);
    }
  })().catch(e => console.error('[scen3/sdclips]', e.message));
}

// A take chosen by hand (the line's Seedance takes, or none - back to the newest fresh one). The timeline follows.
router.post('/scen3/sd/pick', (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const proj = _loadProjects().find(x => String(x.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const i = parseInt(b.line, 10);
    const clipId = String(b.clipId || '');
    const saved = PROJECTS.apply(id, (fresh) => {
      fresh.lines = (fresh.lines || []).map(_normLine);
      const sd = fresh.lines[i] && fresh.lines[i].sd;
      if (!sd || (clipId && !sd.clips.some(c => c.id === clipId))) return;
      sd.chosen = clipId;
      fresh.updatedAt = new Date().toISOString();
    });
    if (saved) MIRROR.touch(saved.id, { project: saved });
    res.json({ success: true, project: _projFull(saved || proj) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The runner's side: wait for the task, download it ONCE into the project's clips/, make it play in the browser, its
// poster, its length - and file it as a take of its line, the line's clip from now on.
JOBS.register('sdclip', {
  timeoutMs: 45 * 60 * 1000,
  poll: async (rec) => {
    if (!rec.taskIds || !rec.taskIds[0]) {
      // Still being asked for, in this process: the stage says what is happening. A row made since this process started
      // is this process's - its asking writes the task into it or fails it (the runner polls a row the moment it is made,
      // before the asking has begun).
      if (_sdAsking.has(rec.id) || (Date.parse(rec.startedAt) || 0) >= SD_BOOT_AT) return { state: 'pending' };
      // Not being asked for and no task: the app was closed meanwhile. Asked - it may have been paid for.
      const asked = !!(((rec.job || {}).params || {}).asked);
      return { state: 'failed', error: asked
        ? 'the app closed while Seedance was being asked - it may have been paid for: look at kie.ai’s history before trying again'
        : 'the app closed before Seedance was asked - nothing was paid; try again' };
    }
    const r = await VTASK.poll(rec.taskIds[0]);
    if (r.state === 'pending') return { state: 'pending' };
    if (r.state === 'failed') return { state: 'failed', error: String(r.error || 'Seedance did not make it') };
    const p = _fileParams(rec);
    const dir = PROJECTS.dirOf(p.projectId, 'clips');
    if (!dir) return { state: 'failed', error: 'the project is gone' };
    const name = 'sd' + String(rec.taskIds[0]).replace(/[^a-z0-9]/gi, '').slice(-20) + '_' + Date.now() + '.mp4';
    const abs = path.join(dir, name);
    if (r.local) fs.copyFileSync(toDiskExisting(r.local) || r.local, abs);   // the fake aggregator's clip: a library address
    else await VTASK.fetchTo(r.url, abs);   // a download that fails throws: the next tick asks and fetches again
    try { await H.normalizeVideoForBrowser(abs); } catch (e) { console.warn('[scen3/sdclip] normalize failed:', e.message); }
    return { state: 'success', path: toUrl(abs), dur: await _audioDur(abs), thumb: await _clipPoster(abs, name), speechEnd: await SPEECH.speechEnd(abs) };
  },
  file: async (rec, landed) => {
    const p = _fileParams(rec);
    const clip = _normSdClip({
      path: landed.path, thumb: landed.thumb, dur: landed.dur, frameId: p.frameId, sound: p.sound,
      model: p.model, quality: p.quality, secs: p.secs, at: new Date().toISOString(),
      take: p.take, words: p.words, voice: p.voice, speechEnd: landed.speechEnd,
    });
    const i = Number(p.line);
    let filed = false;
    const saved = PROJECTS.apply(p.projectId, (fresh) => {
      fresh.lines = (fresh.lines || []).map(_normLine);
      const line = fresh.lines[i];
      if (!line) return;
      const sd = line.sd || _normSdLine(null);
      sd.clips = sd.clips.filter(c => c.id !== clip.id).concat([clip]);
      sd.chosen = '';                           // a new clip is the line's: it is what was just paid for
      line.sd = sd;
      fresh.updatedAt = clip.at;
      filed = true;
    });
    if (!saved) throw new Error('the project is gone');
    if (!filed) throw new Error('line ' + (i + 1) + ' is not in the project any more');
    MIRROR.touch(saved.id, { project: saved });
    try { require('./proxies').warmProxies([landed.path], 480); } catch (e) { /* cosmetic */ }
    return { path: landed.path, preview: landed.thumb || '', media: 'video', line: Number(p.line) + 1, dur: landed.dur };
  },
  // TRY AGAIN from Alerts: the row restarts at once and the asking goes on behind it - the place, the prompt and the
  // references take a while, and the person should see the row running from the press (lib/gen-jobs.js `later`).
  submit: async (request, rec) => ({
    stage: 'getting ready', params: { asked: false },
    later: () => _sdStartClip(ALERTS.get(rec.id) || rec, request),
  }),
  busy: (rec) => _sdAsking.has(rec.id),
});

// For the timeline mirror (lib/frag-mirror.js): a Seedance project's lines that HAVE a clip, in order - the line, its
// clip (whose own sound the timeline hears) and how long it lies. null for a project that is not filmed by Seedance.
// THE CELL ENDS WHERE THE SPEECH ENDS (the sixth round, the owner's answer (я6)), with a breath after it, never past the
// clip - no fade (answer (я12)). A take from before that was measured: voiced from the read, a breath past the read;
// by the voice sample, the clip's own length.
const SD_BREATH = 0.3;
function _sdCuts(proj) {
  const view = _sdView(proj);
  if (!view) return null;
  return view.filter(f => f.clip).map(f => {
    const c = f.clip;
    const len = c.speechEnd > 0 ? Math.min(c.dur || Infinity, c.speechEnd + SD_BREATH)
      : c.sound === 'read' && f.dur > 0 ? Math.min(c.dur || f.dur, f.dur + 0.6) : (c.dur || 0);
    return { line: f.line, clip: c, audio: f.audio, dur: f.dur, len: Math.round(len * 100) / 100 };
  });
}

/* ── A line's animation prompt, by hand ──────────────────────────────────────
   POST /api/scen3/fragments/shot  { projectId, line, patch: { motion?, useAgentMotion? } }
                                   -> { success, project }

   A prompt written by hand is marked so a new pass (the video stage, phase W3) leaves it alone, and
   useAgentMotion puts the agent's back. Written for the words as they are now and the mood as it is
   now, so it is fresh.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/fragments/shot', async (req, res) => {
  try {
    const b = req.body || {};
    // (phase V29) A motion written by hand in another language is kept - and sent - in English. First, then the project.
    let motion = null;
    if (b.patch && typeof b.patch === 'object' && !b.patch.useAgentMotion && 'motion' in b.patch) {
      const t = await _englishText(String(b.patch.motion || ''));
      if (t.fail) return res.status(502).json({ success: false, error: t.fail });
      motion = t.text;
    }
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(p, req.user)) return OWN.refuse(res, p);
    p.lines = (p.lines || []).map(_normLine);
    const i = parseInt(b.line, 10);
    if (!(i >= 0 && i < p.lines.length)) return res.status(400).json({ success: false, error: 'no such line' });
    const patch = (b.patch && typeof b.patch === 'object') ? b.patch : {};
    const was = p.lines[i].shot || {};
    const next = { ...was };
    if (patch.useAgentMotion) { next.motion = was.motionAgent || ''; next.motionEdited = false; }
    else if ('motion' in patch) {
      next.motion = motion != null ? motion : String(patch.motion || '');
      next.motionEdited = next.motion.trim() !== String(was.motionAgent || '').trim();
    }
    next.said = p.lines[i].text;
    next.mood = _normVideo(p.video).mood;
    next.at = new Date().toISOString();
    p.lines[i].shot = _normShot(next);
    p.updatedAt = next.at;
    _saveProjects(list);
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// THE FIRST FRAMES - a SET for the whole video (the setup step, docs/local-app/PLAN.md, phase W2)
//
// Not a frame per line (F3, gone with the directing agent of F2): ONE shot size, chosen by the
// person - selfie, half body, full body - and N variations of it, the same person in the same place
// and the same base pose with a different MOMENT in each: the head, the hands, the face. A vision
// agent writes the moments from the look, the place, the mannequin, the mood and whatever the person
// asked for; every moment is then one frame on kie - nano-banana-2 at 2K (the owner, after the A/B),
// in the timeline's shape, the references in a fixed order: the mannequin, the look, the place - a
// row in Alerts of its own, drawn side by side with the others, and the runner files it into the
// project's frames. That pool is what the lines take their frames from, in turn
// (js/merge-v3/wk-fragments.js, _frameFor); no line is written by a frame - which one a line opens
// on is a rule, until the person picks one by hand (pick-frame).
//
// NO GAZE RULE (the owner): in a frame the person does not have to look into the lens - they can be
// caught mid-thought. Where the eyes go is the moment's business, and the animation prompt brings
// them to the lens while the line is spoken.
// ════════════════════════════════════════════════════════════════════════════

const FRAG_FRAME_ENGINE = 'nano-banana-2';
const FRAG_FRAME_RES = '2K';
const FRAG_FORMATS = ['9:16', '16:9'];
const FRAME_SET_MAX = 5;
const FRAME_SHOW_MAX = 10;              // (phase V61) the frames one animation request may show its writer
// How generations of a project's own pictures leave here: five together, then a second's pause,
// then five more (the owner, 2026-09-21). The engine takes a burst well enough, but a set - and,
// when they come, the clips of a whole script - is a queue rather than a shout.
const SUBMIT_BATCH = 5;
const SUBMIT_GAP_MS = 1000;
const _wait = (ms) => new Promise(r => setTimeout(r, ms));

// The three shot sizes a set is made in (the owner, 2026-09-21). `poseId` is the mannequin that sets
// the base body and the camera angle (data/scen3-poses.json, its `group`); `camera` the lens from
// the frame options; `rule` is what the engine and the agent are told first; `about` the one line
// under the menu.
const FRAME_SETS = [
  { id: 'selfie', label: 'selfie', group: 'closeup', poseId: 'closeup-selfie-r', camera: 'phone-selfie',
    about: 'Filmed at arm’s length: the phone in one outstretched hand, the face and the shoulders close, straight to the viewer.',
    rule: 'A SELFIE, the head and the shoulders close to the camera: the person films themselves with the phone in one outstretched hand - that arm reaches toward the lens and runs out past the edge of the frame - talking straight to the viewer; a phone’s wide-angle look with slight distortion at the edges. Frame it exactly this way and do not pull back to fit more of the body in.',
    // Where the frame CUTS. A shot size said as a name is a suggestion; said as what is outside the
    // picture it is a rule (the owner, 2026-09-21: half-body sets kept coming out head to toe).
    cut: 'The bottom edge of the picture cuts across the middle of the chest. The waist, the hips, the legs, the feet and the floor are NOT in the picture at all.',
    // What a MOMENT may be about: only what this shot size actually shows. A moment that describes
    // the stance of a body the frame cuts off is a moment that pulls the picture wider (the owner,
    // 2026-09-21: a half-body set came out full height).
    visible: 'the head, the face, the eyes, the shoulders and the free hand when it comes up near the face - never the legs, the feet, the floor or the whole stance' },
  { id: 'half', label: 'half body', group: 'half-body', poseId: 'half-standing', camera: 'nat-50',
    about: 'From the waist up, somebody else holding the camera: room for the hands, the place behind.',
    rule: 'HALF BODY, from the waist up: filmed by somebody else at a natural distance, both hands free and inside the frame, the place visible behind and around the person. Frame it exactly this way - not closer, and not the whole figure.',
    cut: 'The bottom edge of the picture cuts at the waist, just below the belt. The hips, the legs, the knees, the feet and the floor are NOT in the picture at all.',
    visible: 'the head, the face, the eyes, the shoulders, the arms and both hands - never the legs, the feet, the floor, or how the weight sits on the feet' },
  { id: 'full', label: 'full body', group: 'full-height', poseId: 'full-straight', camera: 'phone-rear',
    about: 'Head to toe, standing in the place: the whole figure, the floor under their feet.',
    rule: 'FULL BODY, the whole figure from head to toe: standing on the floor of the place, filmed from a natural distance, the person in the middle of the frame with the place around them, the feet and the floor in the frame.',
    cut: 'The whole figure is inside the picture: the head with room above it, and the feet with the floor under them.',
    visible: 'the whole figure - the head, the face, the arms and hands, the stance, the weight on the feet and the floor under them' },
];
const _frameSet = (id) => FRAME_SETS.find(s => s.id === String(id || '')) || null;

router.get('/scen3/frame-sets', (_req, res) => {
  res.json({ success: true, max: FRAME_SET_MAX, sets: FRAME_SETS.map(s => ({ id: s.id, label: s.label, about: s.about, poseId: s.poseId })) });
});

// The references rule, for a frame of the set. Written from the old page's frame rule, with the one change the
// owner asked for: the eyes are the moment's, not a rule's.
// THIS IS AN EDIT, NOT A COMPOSITION (the owner, 2026-09-21, after two sets came out head to toe with
// a face that was not the character's).
//
// Asked to build a picture out of three references, the model composes freely and the shot size is
// one sentence against three pictures - it lost every time. Asked to EDIT the first picture, it
// keeps that picture's frame: what changes is what it is told to change. So the mannequin, which is
// the only reference photographed at the shot size we want, is the picture being edited; the person
// is painted onto it and the place behind it. The references are named by what they are as well as
// by their place, because we cannot see the order the model reads them in.
const FRAG_RULE_POSED =
  'EDIT THE FIRST PICTURE. It is a photograph of a blue artist mannequin, and it is already framed'
  + ' exactly as the result must be framed: keep its crop, its camera height, angle and distance, how'
  + ' much of the body is inside the picture, and where the figure stands in the frame. Do not zoom out,'
  + ' do not add space below, do not reframe it in any way.'
  + ' TURN THE MANNEQUIN INTO A REAL PERSON: the person on the reference sheet (the large portrait with'
  + ' several full-length views beside it) - exactly that face, those features and proportions, that'
  + ' hair, that skin, and the clothes they are wearing in it. Nothing of the mannequin may be left:'
  + ' no blue material, no ball joints, no seams, no faceless head. One person in the picture and no'
  + ' other. Take nothing else from the sheet: not its framing, not its full-length views, not its'
  + ' white backdrop.'
  + ' REPLACE THE GREY STUDIO BACKDROP with the empty place in the last picture: its architecture,'
  + ' furniture, colours and depth behind the person, and its light falling on them. Keep the camera'
  + ' where the mannequin\'s camera is; never take the distance of the place photograph.'
  + ' The body keeps the mannequin\'s pose. The head, the face, the eyes and the hands do what the'
  + ' MOMENT below says.'
  + ' Natural perspective and contact shadows. No text, no logos, no watermark.';

// For a pose whose mannequin is missing: two references, the body in words.
const FRAG_RULE_PLAIN =
  'Create ONE photorealistic photograph: the person from IMAGE 1, in the location from IMAGE 2.'
  + ' IMAGE 1 is a character reference sheet - take ONLY the person from it and keep the same face, hair,'
  + ' skin tone, body and clothing exactly. Never draw the sheet, its panels or its borders, and never show'
  + ' more than ONE person in the result.'
  + ' IMAGE 2 is the location - keep its architecture, furniture, colours and depth.'
  + ' Natural perspective and contact shadows. No text, no captions, no logos, no watermark.';

// The person belongs to the place: the light that falls on them is the place's light (the owner's
// realism marker for frames, beside the person one of S1).
const FRAG_LIGHT_MATCH =
  ' The light on the person is the light of the location: the same direction, softness, colour temperature'
  + ' and shadows, so the person is lit by that room and not by a studio.';

// IS THE FACE COVERED, and by what (phase N)? Read out of the sentence the agent already wrote
// about the look - it names a balaclava, a mask, a helmet or a scarf plainly when there is one.
// Only the clause that says so is taken: the rest of the look is the sheet's business, and putting
// it back into the prompt is what the diet was for.
const FACE_COVER = /\b(balaclava|ski mask|face mask|mask|respirator|bandana|scarf (?:over|across)|helmet|visor|hood(?:ie)? pulled|veil|niqab|burqa|face (?:is )?(?:covered|obscured|hidden|concealed))\b/i;
function _faceCovered(proj) {
  const said = String(((proj && proj.frameRef) || {}).character || '');
  const at = said.search(FACE_COVER);
  if (at < 0) return '';
  // The CLAUSE that says it - not the sentence, and not the whole reading. The agent writes one
  // long sentence about the look, and everything in it except the covering is what the sheet
  // already shows, which is exactly what the diet keeps out of this prompt.
  const from = Math.max(said.lastIndexOf(',', at), said.lastIndexOf(';', at), said.lastIndexOf('.', at)) + 1;
  // ...and it ends where the next clause plainly begins: the sentence usually runs on into the
  // clothes, which the sheet shows for itself.
  const stop = said.slice(at).search(/[.;]|,\s+and\b/);
  const clause = said.slice(from, stop < 0 ? said.length : at + stop).trim();
  return clause ? clause.slice(0, 300) + '.' : '';
}

// WHICH GARMENTS A SHOT SIZE SHOWS (N7): a selfie is the head and the top, a half body adds the
// hands, a full body is everything. Anything else would name a thing the frame must not contain.
const CLOTHES_BY_SHOT = { selfie: ['HEAD', 'TOP'], half: ['HEAD', 'TOP', 'HANDS'], full: CLOTHES_WHERE };
function _clothesShown(proj, setId) {
  const lines = String(((proj && proj.frameRef) || {}).clothes || '').split('\n').filter(Boolean);
  if (!lines.length) return '';
  const where = CLOTHES_BY_SHOT[setId] || CLOTHES_WHERE;
  const keep = lines.filter(l => where.some(w => new RegExp('^' + w + '\\b', 'i').test(l)));
  return keep.map(l => l.replace(/\s*$/, '').replace(/([^.!?])$/, '$1.')).join(' ');
}

// How the look and the place read - the person to keep, the place, its light - asked once for a look
// and a place and kept on the project, so every frame of the video describes them the same way.
const FRAME_READ_V = 2;                 // 2: the reading lists the clothes (N7)
async function _frameRef(projectId, cast) {
  const p = PROJECTS.get(projectId);
  const have = p && _normFrameRef(p.frameRef);
  // A reading made before the clothes were asked for (N7) is read again, once.
  if (have && have.look === cast.obrazImage && have.place === cast.locationImage && have.v >= FRAME_READ_V) return have;
  const [lookUrl, placeUrl] = await Promise.all([_hostLocal(cast.obrazImage), _hostLocal(cast.locationImage)]);
  const ask = 'IMAGE 1 is a character reference sheet, IMAGE 2 is an empty location.'
    + ' Answer in exactly the labelled blocks below, each on its own line, each one plain sentences'
    + ' with no lists and no extra headings.'
    + '\nCHARACTER: describe the person on the sheet - face, hair, build, skin tone and the clothing they'
    + ' are wearing, as the traits to preserve.'
    // THE CLOTHES, garment by garment (phase N7, the owner 2026-09-23). The frame prompt checks
    // them against the sheet, and picks the ones a shot size shows - so each line says where it is
    // worn, and the details that drift first (the colour of a logo, the words of a print) are asked
    // for exactly.
    + '\nCLOTHES: every garment and accessory the person wears, ONE PER LINE, each line starting with'
    + ' where it is worn - HEAD, TOP, BOTTOM, FEET or HANDS - then a colon, then the garment and its'
    + ' colours, and EXACTLY every logo, print, pattern or lettering on it: its colour, what it shows or'
    + ' what it says, and where on the garment it sits. Nothing else on these lines.'
    + '\nENVIRONMENT: describe the location - what kind of place it is, its architecture, surfaces, colours'
    + ' and depth, and in one clause where in the frame there is clear space for a person.'
    + '\nLIGHTING: describe the location\'s light precisely enough to composite a person into it convincingly -'
    + ' where the key light comes from, hard or soft, its colour temperature and any cast, how strong the'
    + ' ambient fill is, the character and direction of the shadows, and what time of day it reads as.';
  const raw = _cleanText(await _ask([{ role: 'user', content: [
    { type: 'text', text: ask },
    { type: 'image_url', image_url: { url: lookUrl } },
    { type: 'image_url', image_url: { url: placeUrl } },
  ] }]));
  const blocks = _splitBlocks(raw);
  const ref = _normFrameRef({
    look: cast.obrazImage, place: cast.locationImage,
    character: blocks.character, environment: blocks.environment, lighting: blocks.lighting,
    clothes: _clothesLines(raw),
    v: FRAME_READ_V,
    at: new Date().toISOString(),
  });
  // Kept on the project in one burst, touching nothing else.
  const list = _loadProjects();
  const q = list.find(x => String(x.id) === String(projectId));
  if (q) { q.frameRef = ref; _saveProjects(list); }
  console.log('[scen3/frames] read the look and the place: character ' + ref.character.length + 'ch, clothes '
    + (ref.clothes ? ref.clothes.split('\n').length : 0) + ' lines, environment '
    + ref.environment.length + 'ch, lighting ' + ref.lighting.length + 'ch');
  return ref;
}

// (phase V61) THE FRAMES CHAT READS THE LOOK AND THE PLACE ITSELF. What a frame must keep that a picture cannot say - a covered
// face, the clothes garment by garment - came from this reading, and only a set drawn in the first-frames field asked for it;
// that field is gone, so the chat asks the first time a message or its ideas need it (routes/scen3-fchat.js). The same reading
// and the same keeping: once per look and place, read again for another one. One at a time per project.
const _frameReading = new Map();
function _fchatRead(projectId) {
  const p = _loadProjects().find(x => String(x.id) === String(projectId || ''));
  if (!p) return Promise.resolve(null);
  const cast = _normCasting(p.casting);
  if (!cast.obrazImage || !cast.locationImage) return Promise.resolve(null);
  const key = String(projectId) + '|' + cast.obrazImage + '|' + cast.locationImage;
  if (_frameReading.has(key)) return _frameReading.get(key);
  const run = _frameRef(projectId, cast).finally(() => _frameReading.delete(key));
  _frameReading.set(key, run);
  return run;
}

// The moments: N variations of the one shot, written by the agent that sees the look, the place and
// the mannequin. Two or three sentences each about the body, the hands, the head and the face at
// the frozen instant - never about the camera, the place or the clothes, which are fixed.
async function _planFrames({ n, set, mood, wish, ref, pose, lookUrl, placeUrl, poseUrl }) {
  const m = MP.moodById(mood) || MP.moodById(MP.DEFAULT_MOOD);
  const text = [
    'You are the DIRECTOR OF PHOTOGRAPHY of a UGC talking-head video ad: one real person speaks to a camera in one real place. You are planning the FIRST FRAMES - the still pictures the clips of the video start from: one shot size, and ' + n + ' variations of it.',
    'IMAGE 1 is the person, in the look they wear for the whole video (a reference sheet). IMAGE 2 is the place, photographed empty.'
      + (poseUrl ? ' IMAGE 3 is a blue mannequin, photographed at exactly this shot size: the base body position, the camera angle, and how much of the body the frame holds.' : ''),
    'THE SHOT SIZE: ' + set.rule,
    // The mannequin in words as well as in the picture (the owner, 2026-09-21): the moments are
    // written FROM this pose, and an agent that has read it does not plan around a body the frame
    // does not show.
    (poseUrl && pose && pose.desc) ? 'THE BASE POSE, the one every variation keeps: the person is ' + pose.desc + '.' : '',
    'WHAT A MOMENT MAY DESCRIBE - only what this shot size actually shows: ' + set.visible + '.',
    'THE MOOD OF THE VIDEO is "' + m.label + '". The face: ' + m.face + ' The body: ' + m.gestures,
    // THE PERSON, AS READ (phase N, the owner 2026-09-23). The planner could see the look sheet
    // and still wrote "a wide grin, crinkling the corners of their eyes" for a face under a
    // balaclava: a picture does not assert an absence, and the sentence that was read from that
    // very sheet does. It was on the project all along and only the place's half of it was used.
    ref.character ? 'THE PERSON, as read from the sheet - plan only what this face and these clothes'
      + ' can actually do: ' + ref.character : '',
    ref.environment ? 'THE PLACE, as read: ' + ref.environment : '',
    wish ? 'WHAT THE PERSON MAKING THE VIDEO ASKS FOR - follow it in every variation: ' + wish : '',
    'Write ' + n + ' variations of this ONE shot: the same person, the same place, the same shot size and the same base pose, and in each a DIFFERENT moment - the tilt and the turn of the head, what the hands do'
      + (set.id === 'selfie' ? ' (the hand with the phone stays where it is; the other hand is free)' : '')
      + ', the expression, where the eyes go (into the lens, or caught mid-thought). Every moment physically possible in this place and true to the mood, and the variations clearly different from one another.',
    'A moment is two or three concrete sentences describing that frozen instant: the head, the face, the hands, the upper body. Nothing about the camera, the framing, the place or the clothes - those are fixed. Everything in English.',
    'Answer with JSON only: {"frames":[{"n":1,"moment":"..."},{"n":2,"moment":"..."}]} - exactly ' + n + ' entries.',
  ].filter(Boolean).join('\n');
  const content = [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: lookUrl } },
    { type: 'image_url', image_url: { url: placeUrl } },
  ];
  if (poseUrl) content.push({ type: 'image_url', image_url: { url: poseUrl } });
  const raw = await _ask([{ role: 'user', content }]);
  const mt = String(raw || '').match(/\{[\s\S]*\}/);
  if (!mt) throw new Error('the agent did not answer with the frames');
  let plan;
  try { plan = JSON.parse(mt[0]); } catch (e) { throw new Error('the agent answered with something unreadable'); }
  const moments = (Array.isArray(plan && plan.frames) ? plan.frames : [])
    .map(f => String((f && f.moment) || '').trim()).filter(Boolean);
  if (!moments.length) throw new Error('the agent planned no frames');
  // Fewer than asked is the set that came; more is the first n.
  return moments.slice(0, n);
}

// One frame of the set, on kie. What it is made of - the moment, the shot size, its number in the
// set - travels with the journal row, so "try again" makes the same frame again (lib/gen-jobs.js).
async function _submitSetFrame(b) {
  const id = String(b.projectId || '').trim();
  const proj = _loadProjects().find(p => String(p.id) === id);
  if (!proj) throw Object.assign(new Error('no such project'), { status: 404 });
  const cast = _normCasting(proj.casting);
  if (!cast.obrazImage || !cast.locationImage) {
    throw Object.assign(new Error('cast the character in a look and set the place first'), { status: 400 });
  }
  const set = _frameSet(b.set);
  if (!set) throw Object.assign(new Error('no such shot size'), { status: 400 });
  const moment = String(b.moment || '').trim();
  const n = Math.max(1, parseInt(b.n, 10) || 1);
  const aspect = FRAG_FORMATS.includes(b.format) ? b.format : '9:16';

  const pose = _poseFor(set.poseId, set.group);
  const cam = _loadFrameOpts().cameras.find(c => c.id === set.camera) || null;
  // What the look and the place LOOK like is not read here any more: the pictures are in the
  // references, and the words about them were what the model drew from (the diet below). The
  // reading itself stays - the agent that plans the moments still gets the place in words.
  // The references, hosted once for a whole set by the plan and handed in (`refs`); a frame made
  // again on its own hosts them itself.
  const refs = (b.refs && typeof b.refs === 'object') ? b.refs : {};
  const urls = [];
  if (pose) urls.push(refs.pose || await _hostLocal(pose.file));
  urls.push(refs.look || await _hostLocal(cast.obrazImage), refs.place || await _hostLocal(cast.locationImage));

  // THE DIET (the owner, 2026-09-21). What the pictures already say is not said again in words: the
  // face is the sheet's, the room is the photograph's. (The CLOTHES came back in 2026-09-23 as a
  // checklist - see N7 below - because their small details drifted without words to hold them.) Only the LIGHT is kept in
  // words - a compositing instruction, not a description - and only when there is one. What is left
  // is the shot size, the roles of the references, the pose, the moment, and the shot size again.
  // The shot size is named at the top and SPELLED OUT at the end: saying the whole rule twice was a
  // fifth of the prompt for one instruction.
  // The edit first, because the first line is the job; the shot size is the check at the end, said
  // as what is OUTSIDE the picture - a name is a suggestion, an edge is a rule.
  const parts = [pose ? FRAG_RULE_POSED : 'SHOT SIZE - obey it before anything else: ' + set.rule + ' ' + FRAG_RULE_PLAIN];
  // WHAT THE SHEET CANNOT SAY FOR ITSELF (phase N). The diet stands - the clothes and the face are
  // the sheet's and are not described again - but an ABSENCE is not something a picture asserts,
  // and "turn the mannequin into a real person, exactly that face, no faceless head" is read by the
  // engine as an instruction to invent one. So when the look covers the face, that one fact is said
  // in words and outranks those sentences. Nothing else of the look is quoted.
  const covered = _faceCovered(proj);
  if (covered) parts.push('THE FACE IS COVERED, and this outranks anything above about the face: ' + covered
    + ' Keep that covering exactly as it is on the reference sheet, over the whole face it covers.'
    + ' Do NOT invent a face, do not uncover it, do not show a mouth or a nose that the sheet does not show,'
    + ' and do not treat the covered head as the mannequin\'s faceless head to be replaced.');
  // THE CLOTHES, AS A CHECKLIST (phase N7, the owner 2026-09-23). The diet kept every word about the
  // look out of this prompt, and the small things drifted - three frames of three drew the red
  // lettering on a grey hoodie black, or not at all. The sheet is still the source; these words only
  // name what must survive it. And only what this shot size SHOWS: trainers named in a waist-up
  // frame pull the picture back to full height, which is what the framing check below exists to stop.
  const wear = _clothesShown(proj, set.id);
  if (wear) parts.push('THE CLOTHES - copy them from the reference sheet exactly as they are there;'
    + ' these words are only a checklist of what must survive: ' + wear
    + ' Every logo, print and lettering keeps its colour, its content and its place on the garment.');
  if (pose && pose.desc) parts.push('The pose being kept - the person is ' + pose.desc + '.');
  if (cam) parts.push('The lens of the shot: ' + cam.prompt + '.');
  if (moment) parts.push('THE MOMENT - this frozen instant: ' + moment);
  parts.push('FRAMING CHECK, the last word on it: ' + set.rule + ' ' + (set.cut || ''));
  const prompt = parts.join(' ') + FRAG_LIGHT_MATCH + PERSON_REAL;

  const taskId = await _i2i(FRAG_FRAME_ENGINE, prompt, urls, aspect, FRAG_FRAME_RES);
  if (!taskId) throw Object.assign(new Error('the engine did not accept the task'), { status: 502 });
  console.log('[scen3/frames] ' + set.id + ' ' + n + ' ' + FRAG_FRAME_ENGINE + ' ' + FRAG_FRAME_RES + ' ' + aspect
    + ' refs=' + urls.length + (pose ? ' +mannequin' : ''));
  return {
    taskId, engine: FRAG_FRAME_ENGINE, prompt,
    file: { projectId: id, set: String(b.setId || ''), framing: set.id, n, prompt, moment },
  };
}

/* ── The set: plan the moments, ask for every frame ─────────────────────────
   POST /api/scen3/frames/plan  { projectId, set, n, wish?, format?, where }
                                -> { success, setId, alerts: [{ alertId, taskId, n }] }

   One agent call for the moments, then a journal row per frame, asked for one after another - kie
   draws them side by side. The runner files each into the project's frames as it comes.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/frames/plan', async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const cast = _normCasting(proj.casting);
    if (!cast.obrazImage || !cast.locationImage) {
      return res.status(400).json({ success: false, error: 'cast the character in a look and set the place first' });
    }
    // A choice not made yet is said, never filled in (phase V24): the frames are drawn in the mood,
    // the shot size, the number and the spread the person chose.
    const video = _normVideo(proj.video);
    const missing = _unchosen(video, ['mood', 'framing', 'frames', 'spread']);
    if (missing) return res.status(400).json({ success: false, error: missing });
    const set = _frameSet(b.set);
    if (!set) return res.status(400).json({ success: false, error: 'no such shot size' });
    const n = Math.max(1, Math.min(FRAME_SET_MAX, parseInt(b.n, 10) || video.frames || 4));
    const wish = String(b.wish || '').trim().slice(0, 600);
    const mood = video.mood;

    const ref = await _frameRef(id, cast);
    const pose = _poseFor(set.poseId, set.group);
    const [lookUrl, placeUrl, poseUrl] = await Promise.all([
      _hostLocal(cast.obrazImage, { verify: true }),
      _hostLocal(cast.locationImage, { verify: true }),
      pose ? _hostLocal(pose.file) : Promise.resolve(''),
    ]);
    const moments = await _planFrames({ n, set, mood, wish, ref, pose, lookUrl, placeUrl, poseUrl });

    // FIVE AT A TIME, a second apart (the owner, 2026-09-21). Every frame of a batch goes together -
    // the references were hosted once above and ride along - and the next batch waits a second, so a
    // set larger than a handful does not arrive at the engine as one burst. The retry of a single
    // frame (the row's "try again") carries its own request without them.
    const setId = 's' + Date.now();
    const refs = { look: lookUrl, place: placeUrl, pose: poseUrl };
    const outs = [];
    for (let at = 0; at < moments.length; at += SUBMIT_BATCH) {
      if (at) await _wait(SUBMIT_GAP_MS);
      const batch = moments.slice(at, at + SUBMIT_BATCH);
      const done = await Promise.all(batch.map((moment, k) =>
        _submitSetFrame({ projectId: id, set: set.id, setId, n: at + k + 1, moment, format: b.format, refs })));
      outs.push(...done);
    }
    const alerts = outs.map((out, k) => {
      const request = { projectId: id, set: set.id, setId, n: k + 1, moment: moments[k], format: b.format };
      const rec = JOBS.submitted({
        kind: 'image', what: 'frame',
        title: 'Frame · ' + set.label + ' ' + (k + 1) + '/' + moments.length,
        where: b.where || null,
        engine: out.engine,
        taskIds: [out.taskId],
        job: { type: 'frame', params: { request, file: out.file } },
      });
      return { alertId: rec.id, taskId: out.taskId, n: k + 1 };
    });
    console.log('[scen3/frames/plan] ' + id + ' ' + set.id + ' x' + moments.length + ' mood=' + mood);
    res.json({ success: true, setId, alerts });
  } catch (e) {
    console.error('[scen3/frames/plan]', e.message);
    res.status(e.status || 502).json({ success: false, error: e.message });
  }
});

/* ── Which frame a line opens on ─────────────────────────────────────────────
   POST /api/scen3/fragments/pick-frame  { projectId, line, frameId } -> { success, project }

   A frame of the pool, picked by hand; '' hands the line back to the rule - the pool in turn
   (js/merge-v3/wk-fragments.js, _frameFor).
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/fragments/pick-frame', (req, res) => {
  try {
    const b = req.body || {};
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(p, req.user)) return OWN.refuse(res, p);
    p.lines = (p.lines || []).map(_normLine);
    const i = parseInt(b.line, 10);
    if (!(i >= 0 && i < p.lines.length)) return res.status(400).json({ success: false, error: 'no such line' });
    const want = String(b.frameId || '');
    if (want) {
      const v = _normMix(p.mix).variants.find(x => x.id === want);
      if (!v) return res.status(404).json({ success: false, error: 'no such frame' });
      p.lines[i].frameId = v.id;
    } else {
      p.lines[i].frameId = '';
    }
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    MIRROR.touch(p.id, { project: p });   // the timeline mirrors the lines (T'): a frame picked by hand
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── The animation of the person, line by line ───────────────────────────────
   POST /api/scen3/video/prompts  { projectId, only? } -> { success, project, report }

   What the person DOES while a line is spoken - the expression, the head, the hands, the gaze -
   written for every line at once by one agent that sees the set of first frames (phase W3b). It is
   what the clip of that line is made from (F4): Kling hears the frame, the read and this, and
   nothing else.

   ONE CALL FOR THE WHOLE SCRIPT, not one per line: the lines are an arc - the doubt at the top, the
   turn in the middle, the recommendation at the end - and an agent that sees them together writes
   movement that carries that arc instead of eight unrelated performances.

   A prompt EDITED BY HAND is not overwritten unless its line is named in `only`: the person fixed
   it on purpose (the same rule the frame's own prompt follows). A prompt written for words that
   have since changed is stale, and the page says so - it is rewritten the next time this runs.
   ──────────────────────────────────────────────────────────────────────────── */

// The pool, in the order the frames were asked for, and which frame a line opens on: the SAME rule
// the panel paints by (js/merge-v3/wk-fragments.js, _pool and _frameFor). Both sides need it - the
// panel to show it, the agent to write for it - so it is written here as the one rule and read
// there as the one picture.
function _framePool(p) {
  const mix = _normMix((p || {}).mix);
  // A frame the person switched OFF is out of the rotation (the owner, 2026-09-21): it stays in the
  // project, dimmed at the tail of the strip, and nothing takes it until it is switched back on.
  const off = new Set((mix.banned || []).map(String));
  const all = (mix.variants || []).filter(v => !off.has(String(v.id))).slice();
  const start = {};
  for (const v of all) {
    if (!v.set) continue;
    if (!start[v.set] || String(v.at || '') < start[v.set]) start[v.set] = String(v.at || '');
  }
  // A hand-made order wins over the order they were asked in: the person dragged them into it.
  const hand = (mix.order || []).map(String);
  const at = (v) => hand.indexOf(String(v.id));
  const key = (v) => (v.set ? start[v.set] : String(v.at || ''));
  return all.sort((a, b) => {
    const ia = at(a), ib = at(b);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
    return key(a).localeCompare(key(b)) || (a.n || 0) - (b.n || 0)
      || String(a.at || '').localeCompare(String(b.at || ''));
  });
}
// Which frame a line opens on. The same two rules the page paints by (js/merge-v3/wk-fragments.js,
// _frameFor): the pool IN TURN, or one DRAWN for the line - drawn from the line's number and the
// project's id, so it is the same frame every time it is asked and the video does not reshuffle
// itself between two looks at it.
// FNV-1a with a final avalanche. A plain rolling hash will not do here: the strings differ by one
// character at the end, so `h * 31 + code` moves the result by exactly one and every modulo of it
// comes out a shifted cycle - which is what the first version of this drew, to nobody's surprise
// but mine. The page draws with the same function (js/merge-v3/wk-fragments.js, _seed).
function _seed(s) {
  let h = 2166136261 >>> 0;
  for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}
function _frameOfLine(pool, line, i, spread, projectId) {
  if (!pool.length) return null;
  const picked = line && line.frameId ? pool.find(v => v.id === String(line.frameId)) : null;
  if (picked) return picked;
  // (phase V26.8) By the number the line KEEPS when it has one (a line was put in above it, /line/insert), else by
  // its place - the same rule on the page (js/merge-v3/wk-fragments.js, _frameFor).
  const n = line && Number.isInteger(line.slot) ? line.slot : i;
  if (spread === 'random') return pool[_seed(String(projectId || '') + ':' + n) % pool.length];
  return pool[n % pool.length];
}

// What every animation prompt must obey, whatever the line says. The person is already IN the
// frame: the clip continues that instant, it does not stage a new one.
const MOTION_RULES =
  'RULES for every prompt: the clip CONTINUES the frame the line opens on - the same person, the same'
  + ' clothes, the same place, the same shot size and camera position. Describe ONLY what the person'
  + ' does while speaking: the expression, the brows and the eyes, the head, the hands, the weight of'
  + ' the body. Present tense, plain sentences, 2 to 4 of them, no lists. Do NOT write the words they'
  + ' say, do not mention the script, the camera operator, cuts, zooms or any camera move, and do not'
  + ' add objects, people or light that are not already in the frame.'
  // WHERE THE EYES GO (the owner, 2026-09-22). This is somebody talking TO the person watching, and
  // a gaze that wanders reads as a person talking to somebody off to the side. The glance away is
  // allowed because a face that never blinks its attention reads as a recital - but it is a beat,
  // and the eyes come back.
  + ' THE GAZE: the person is speaking into the lens and holds it. Now and then, where a thought'
  + ' turns or a phrase lands, the eyes flick away for a beat and come straight back to the lens.'
  + ' They never settle anywhere else and never address anyone off camera.';
// THE TALKING IS VISIBLE (phase Y3, the owner 2026-09-22). This stands at the HEAD of every prompt,
// the way the place's own movement stands at its foot (X6): one sentence, the same for every mood,
// written by us and not by the agent, so it cannot be forgotten or reworded into nothing.
//
// Being honest about what it can do: Kling avatar drives the mouth from the AUDIO - the lipsync is
// the sound's, not the prompt's. What a sentence at the front can do is stop the model settling on a
// nearly-closed mouth and a still jaw, which is what "the lips barely move" looks like. If this is
// not enough on screen, the next thing to try is the model tier, not more words.
const MOTION_LIPS =
  'The mouth articulates the speech clearly: the lips shape every syllable and the jaw moves with the'
  + ' words, so the talking is plainly visible on the face.';

// The one shot size that has a hand in the shot: it is holding the phone, and it must not wander.
// (phase V26.6, the owner's (п7)) A product in the person's hand in the frame - Kling avatar moves the hands and may let it
// drift; the agent is told it stays as it is.
const MOTION_PRODUCT = ' THE PRODUCT in the lines that hold one: it stays exactly as it is in the frame - in the same hand, its'
  + ' label turned to the camera, never changing its shape or its letters, never disappearing, never doubling; the hand moves it'
  + ' only a little - a small tilt toward the lens on the words about it, never turned away or put down.';
const MOTION_SELFIE =
  ' THIS IS A SELFIE: the arm holding the phone stays where it is for the whole clip - it does not'
  + ' lower, change hands or leave the frame - so the free hand is the only one that gestures, and'
  + ' every gesture stays inside a selfie\'s narrow frame. End each prompt with: subtle handheld'
  + ' camera shake.';

// IS THIS LINE'S ANIMATION PROMPT STILL GOOD? Three ways it is not: it was never written, the words
// have changed since it was, or - phase X6 - the place's own movement is not in it. The last one is
// what makes a prompt written before the place was analysed, or before somebody changed how the
// place moves, get written again: what goes to the renderer is ONE text, and half of it being out
// of date is not a prompt.
function _motionStale(line, envMotion) {
  const shot = line && line.shot;
  if (!shot || !shot.motion) return true;
  if (String(shot.said || '') !== String((line && line.text) || '')) return true;
  // Written before the articulation sentence existed (Y3), or before the place had one (X6): either
  // half being out of date makes it a prompt that is no longer what we send.
  if (String(shot.motion).indexOf(MOTION_LIPS) < 0) return true;
  return !!envMotion && String(shot.motion).indexOf(envMotion) < 0;
}

/**
 * Write the animation prompts of a project's lines. The route below is one caller; a clip about
 * to be rendered is the other, asking for the one line it is about (phase U4). (phase V26.8) The
 * prompts land on the lines by number: a line put in meanwhile waits (_holdLines).
 */
async function _writePrompts(id, want) {
  const free = _holdLines(id);
  try { return await _writePromptsNow(id, want); } finally { free(); }
}
async function _writePromptsNow(id, want) {
  const list = _loadProjects();
  const proj = list.find(x => String(x.id) === id);
  if (!proj) throw Object.assign(new Error('no such project'), { status: 404 });
  {
    const lines = (proj.lines || []).map(_normLine);
    if (!lines.length) throw Object.assign(new Error('this project has no lines'), { status: 400 });
    const pool = _framePool(proj);
    if (!pool.length) throw Object.assign(new Error('make a frame in the frames chat first: a clip is made from one'), { status: 400 });
    const video = _normVideo(proj.video);
    // The person moves in the mood they chose (phase V24): not chosen yet is said, not assumed.
    const missing = _unchosen(video, ['mood']);
    if (missing) throw Object.assign(new Error(missing), { status: 400 });
    const mood = MP.moodById(video.mood) || MP.MOODS[0];
    // (phase V61) THE SHOT OF EACH LINE'S OWN FRAME: the frames come from the frames chat now, each with the edge it was asked
    // with (`framing`; none - half body); a set drawn before the phase has one for all of its frames, and the project's old
    // menu is what a frame without one falls back to.
    const setOf = (fr) => _frameSet((fr && fr.framing) || video.framing) || _frameSet('half');

    // The place's own movement. It is written once per PLACE and belongs to the place, not to this
    // project (phase W3a) - and since X6 it is also part of every line's prompt, which is why it is
    // read before the lines are chosen.
    const envMotion = _envMotionOf(_normCasting(proj.casting).locationImage);

    // Which lines this touches: the ones named, or every line whose prompt is stale - and never one
    // edited by hand unless named.
    const live = (i) => !lines[i].removed;               // a line taken off is not written for (Z)
    const only = Array.isArray(want)
      ? [...new Set(want.map(n => parseInt(n, 10)).filter(n => n >= 0 && n < lines.length))].filter(live).sort((a, c) => a - c)
      : lines.map((_, i) => i).filter(i => live(i) && _motionStale(lines[i], envMotion) && !(lines[i].shot && lines[i].shot.motionEdited));
    if (!only.length) return { project: proj, report: { written: 0, skipped: [] } };

    // The frames themselves, in the order the lines take them: the agent writes movement that starts
    // from a body it can see, not from a description of one.
    // For the whole script the agent sees the set; for ONE line it sees that line's frame and
    // nothing else - the other frames are not about it, and hosting them would be attention paid
    // to a picture the answer has to ignore.
    // (phase V61) The frames the lines open on, each once - the pool's first five were all it saw, and a line opening on the
    // sixth frame of the chat's was written for "frame unknown". At most FRAME_SHOW_MAX pictures in one request.
    const shown = (Array.isArray(want) && want.length === 1)
      ? [_frameOfLine(pool, lines[only[0]], only[0], _normVideo(proj.video).spread, id)].filter(Boolean)
      : [...new Map(only.map(i => _frameOfLine(pool, lines[i], i, video.spread, id)).filter(Boolean).map(f => [f.id, f])).values()]
        .slice(0, FRAME_SHOW_MAX);
    const urls = await Promise.all(shown.map(v => _hostLocal(v.preview || v.path)));
    const where = (i) => {
      const fr = _frameOfLine(pool, lines[i], i, video.spread, id);
      const at = shown.findIndex(v => v.id === (fr || {}).id);
      return { fr, at };
    };

    const sets = [...new Map(only.map(i => { const s = setOf(where(i).fr); return [s.id, s]; })).values()];
    const one = sets.length === 1;
    // (phase V26.6, the owner's (п7), (пр4)) The products the line's frame was drawn with: said in the line's row, and one rule.
    const prodsOf = (i) => _frameProds(where(i).fr);
    const anyProd = only.some(i => prodsOf(i).length);
    const ask = 'You are directing a talking-head video: one person, one place, spoken'
      + ' straight to camera. IMAGE 1' + (shown.length > 1 ? ' to ' + shown.length : '') + ' are the first'
      + ' frames of this video - the instants the lines open on.'
      + '\n\nTHE FEEL OF THE WHOLE VIDEO: ' + mood.label + '. ' + mood.brief
      + '\nTHE FACE: ' + mood.face
      + '\nTHE BODY: ' + mood.gestures
      + (one ? '\nTHE SHOT: ' + sets[0].rule
        : '\nTHE SHOTS - each line says which: ' + sets.map(s => s.label + ': ' + s.rule).join(' | '))
      + (envMotion ? '\nTHE PLACE MOVES BY ITSELF: ' + envMotion + ' - let it, but do not describe it again.' : '')
      + '\n\n' + MOTION_RULES
      + (!sets.some(s => s.id === 'selfie') ? '' : one ? MOTION_SELFIE : ' IN THE SELFIE LINES:' + MOTION_SELFIE.replace(' THIS IS A SELFIE:', ''))
      + (anyProd ? MOTION_PRODUCT : '')
      + '\n\nThe lines, in order. Each says which frame it opens on and what is happening in that frame.'
      + ' The script is one arc: write the movement of each line as its place in that arc, not as a'
      + ' performance of its own.\n'
      + only.map((i) => {
        const w = where(i);
        return '[' + (i + 1) + '] frame ' + (w.at >= 0 ? 'IMAGE ' + (w.at + 1) : 'unknown')
          + (one ? '' : ', ' + setOf(w.fr).label)
          + ((w.fr && w.fr.moment) ? ' (' + w.fr.moment + ')' : '')
          + prodsOf(i).map(p => ', holding the product "' + p.name + '"' + (p.label ? ' (its label: ' + p.label + ')' : '')
            + (p.held ? ' - ' + p.held : '')).join('')
          + ' | "' + String(lines[i].text || '').replace(/\s+/g, ' ').trim() + '"';
      }).join('\n')
      + '\n\nAnswer with JSON and nothing else: {"lines":[{"n":<the number in brackets>,"motion":"..."}]}'
      + ' - exactly ' + only.length + ' entr' + (only.length === 1 ? 'y' : 'ies') + ', one per line above.';

    const content = [{ type: 'text', text: ask }];
    for (const url of urls) content.push({ type: 'image_url', image_url: { url } });
    const raw = await _ask([{ role: 'user', content }]);
    const mt = String(raw || '').match(/\{[\s\S]*\}/);
    if (!mt) throw new Error('the agent did not answer with the prompts');
    let parsed;
    try { parsed = JSON.parse(mt[0]); } catch (e) { throw new Error('the agent answered with something unreadable'); }
    const got = (parsed && Array.isArray(parsed.lines)) ? parsed.lines : [];
    if (!got.length) throw new Error('the agent wrote nothing usable');

    const now = new Date().toISOString();
    const report = { written: 0, skipped: [] };
    const write = {};                     // line -> the shot to put on it
    for (const i of only) {
      const hit = got.find(x => (parseInt(x && x.n, 10) || 0) === i + 1);
      const said = _cleanText((hit && hit.motion) || '').slice(0, 900);
      if (!said) { report.skipped.push(i + 1); continue; }
      // ONE TEXT, THE PERSON AND THE PLACE (the owner, 2026-09-22). The agent is told how the place
      // moves and told not to describe it again, so what it writes is the person alone - and the
      // renderer was never hearing about the background at all. The place's own sentence is added
      // here, word for word as it stands on the place, so the field in the fragment shows exactly
      // what is sent and editing that field edits the whole of it.
      const body = envMotion && said.indexOf(envMotion) < 0 ? said + ' ' + envMotion : said;
      // The articulation goes FIRST, the place LAST, and what the agent wrote sits between them -
      // one text, which is what the fragment shows and what the renderer is sent.
      const motion = body.indexOf(MOTION_LIPS) < 0 ? MOTION_LIPS + ' ' + body : body;
      write[i] = _normShot({
        motion, motionAgent: motion, motionEdited: false,
        said: String(lines[i].text || ''), mood: mood.id, at: now,
      });
      report.written++;
    }
    // The agent took half a minute to answer, and other things write this project while it thinks
    // (phase X0: ten clips and ten reads go at once now). So the record is read AGAIN here and only
    // the lines this call is about are touched - the copy read before the agent was asked would
    // carry back whatever landed meanwhile and undo it.
    const saved = PROJECTS.apply(id, (fresh) => {
      fresh.lines = (fresh.lines || []).map(_normLine);
      for (const [k, shot] of Object.entries(write)) {
        if (fresh.lines[k]) fresh.lines[k].shot = shot;
      }
      fresh.updatedAt = now;
    });
    console.log('[scen3/video/prompts] ' + id + ' ' + mood.id + ' ' + sets.map(s => s.id).join('+') + ' frames=' + shown.length
      + ' written=' + report.written + ' skipped=' + report.skipped.length);
    return { project: saved || proj, report };
  }
}

router.post('/scen3/video/prompts', async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const proj = _loadProjects().find(x => String(x.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    const out = await _writePrompts(id, b.only);
    res.json({ success: true, project: _projFull(out.project), report: out.report });
  } catch (e) {
    console.error('[scen3/video/prompts]', e.message);
    res.status(e.status || 502).json({ success: false, error: e.message });
  }
});

/* ── The prompt a frame was drawn from ───────────────────────────────────────
   POST /api/scen3/frames/prompt  { projectId, frameId, prompt } -> { success, project }

   Every frame of a set keeps the prompt it was made from, and the open fragment shows it beside the
   picture (the owner, 2026-09-21). It is EDITABLE there: the picture on screen does not change - it
   is already drawn - but what is written here is what a later redraw of this frame will be asked
   for, so a wording somebody fixed by hand is not lost.
   ──────────────────────────────────────────────────────────────────────────── */
/* ── A frame switched off ────────────────────────────────────────────────────
   POST /api/scen3/frames/ban  { projectId, frameId, banned } -> { success, project }

   The ✕ on a frame in the general zone (the owner, 2026-09-21): the frame stays in the project and
   on the strip - dimmed, and first, so it is out of the way - but no line takes it any more. The ✓
   in the same corner brings it back. `mix.banned` is the list that already meant exactly this
   ("the user hid it in the project", _frameState), so it is the one used.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/frames/ban', (req, res) => {
  try {
    const b = req.body || {};
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(p, req.user)) return OWN.refuse(res, p);
    p.mix = _normMix(p.mix);
    const id = String(b.frameId || '');
    if (!p.mix.variants.some(v => v.id === id)) return res.status(404).json({ success: false, error: 'no such frame' });
    const off = new Set(p.mix.banned.map(String));
    if (b.banned === false) off.delete(id); else off.add(id);
    p.mix.banned = [...off];
    // A line holding this frame by hand is handed back to the rule: a switched-off frame standing in
    // a line would be the one thing the switch is for.
    if (off.has(id)) {
      p.lines = (p.lines || []).map(_normLine);
      for (const l of p.lines) if (String(l.frameId || '') === id) l.frameId = '';
    }
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    MIRROR.touch(p.id, { project: p });   // the timeline mirrors the lines (T'): a frame switched off
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── The order the frames stand in ───────────────────────────────────────────
   POST /api/scen3/frames/order  { projectId, order: [frameId, ...] } -> { success, project }

   The strip is dragged into the order the person wants (the owner, 2026-09-21), and that order is
   what "the pool in turn" then means. Ids that are not in the list - a frame made after the
   dragging - keep their natural place behind the arranged ones.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/frames/order', (req, res) => {
  try {
    const b = req.body || {};
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(p, req.user)) return OWN.refuse(res, p);
    p.mix = _normMix(p.mix);
    const have = new Set(p.mix.variants.map(v => String(v.id)));
    const want = [...new Set((Array.isArray(b.order) ? b.order : []).map(String))].filter(id => have.has(id));
    if (!want.length) return res.status(400).json({ success: false, error: 'no frames in that order' });
    p.mix.order = want;
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    MIRROR.touch(p.id, { project: p });   // the timeline mirrors the lines (T'): the order of the frames
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A frame cropped, and filed as a frame (phase V9) ────────────────────────
   POST /api/scen3/frames/crop  { projectId, frameId, rect: {x,y,w,h} } -> { success, project, frameId }

   The person reframes a first frame on the stage and the cut lands in the SET, beside the frames it
   was cut from, in the project's own folder (the owner, 2026-09-22). The page does not own the
   project, so it does not file anything: it sends the rectangle it drew and gets the project back.

   The rectangle arrives as FRACTIONS of the picture, so the page never has to know the real pixel
   size or how the stage letterboxes it - it is drawing on a canvas that is zoomed and pushed about.
   The selection is locked to the project's format on the page; the check here is only the honest
   minimum - a third of each side - because below that there are no pixels left to make a clip from.

   The cut keeps its source's PLACE in the set: the same set, shot size and number, and the same
   moment - it is the same instant of the video, framed closer - so the pool keeps its order and the
   agent that writes the animation still knows what this frame is of. `croppedFrom` is the source's
   file, which is also what stops a delete taking a file another frame is made of.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/frames/crop', async (req, res) => {
  try {
    const b = req.body || {};
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(p, req.user)) return OWN.refuse(res, p);
    p.mix = _normMix(p.mix);
    const src = p.mix.variants.find(x => x.id === String(b.frameId || ''));
    if (!src) return res.status(404).json({ success: false, error: 'no such frame' });
    const hit = _resolveMedia(src.path);
    if (!hit || !fs.existsSync(hit.abs)) {
      return res.status(400).json({ success: false, error: 'the frame is missing: ' + src.path });
    }
    const r = b.rect || {};
    const fx = Number(r.x), fy = Number(r.y), fw = Number(r.w), fh = Number(r.h);
    if (![fx, fy, fw, fh].every(Number.isFinite)) {
      return res.status(400).json({ success: false, error: 'rect must be {x,y,w,h} as fractions of the frame' });
    }
    if (fw < CROP_MIN - 1e-6 || fh < CROP_MIN - 1e-6) {
      return res.status(400).json({ success: false,
        error: 'the selection must cover at least a third of the frame - got '
          + Math.round(fw * 100) + '% x ' + Math.round(fh * 100) + '%' });
    }
    const meta = await sharp(hit.abs).metadata();
    if (!meta.width || !meta.height) return res.status(500).json({ success: false, error: 'could not measure the frame' });
    // Fractions -> pixels, then clamped so rounding can never ask for a pixel that is not there
    // (sharp throws on an extract that leaves the image).
    const left = Math.max(0, Math.min(Math.round(fx * meta.width), meta.width - 1));
    const top = Math.max(0, Math.min(Math.round(fy * meta.height), meta.height - 1));
    const w = Math.max(1, Math.min(Math.round(fw * meta.width), meta.width - left));
    const h = Math.max(1, Math.min(Math.round(fh * meta.height), meta.height - top));

    const dir = PROJECTS.dirOf(p.id, 'frames');
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(hit.abs).replace(/\.[^.]+$/, '');
    const dest = path.join(dir, 'crop_' + base + '_' + Date.now() + '.jpg');
    await sharp(hit.abs).extract({ left, top, width: w, height: h }).jpeg({ quality: 94 }).toFile(dest);
    const url = toUrl(dest);
    const preview = await _framePreview(url);

    const variant = {
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      path: url, preview, prompt: src.prompt || '',
      at: new Date().toISOString(), taskId: '',
      croppedFrom: src.path,
      crop: { x: fx, y: fy, w: fw, h: fh },
      size: { w, h },
      set: src.set || '', framing: src.framing || '', n: src.n || 0,
      moment: src.moment || '',
      // (phase V26.6) A frame cut from one with a product keeps it.
      props: _framePropsOf(src.props),
    };
    // Cutting the picture and making its preview took a moment, and other things write this project
    // (phase X0). Read it again and add the frame to the set AS IT IS NOW.
    const saved = PROJECTS.apply(p.id, (fresh) => {
      fresh.mix = _normMix(fresh.mix);
      fresh.mix.variants.push(variant);
      // A set that was dragged into an order keeps it, and the cut stands right behind what it was
      // cut from rather than at the tail: it is the same moment.
      if (Array.isArray(fresh.mix.order) && fresh.mix.order.length) {
        const at = fresh.mix.order.indexOf(String(src.id));
        fresh.mix.order.splice(at < 0 ? fresh.mix.order.length : at + 1, 0, variant.id);
      }
      fresh.updatedAt = variant.at;
    });
    MIRROR.touch(p.id, { project: saved || p });   // the timeline mirrors the lines (T'): a frame added
    console.log('[scen3/frames/crop] ' + base + ' ' + meta.width + 'x' + meta.height
      + ' -> ' + w + 'x' + h + ' at ' + left + ',' + top);
    res.json({ success: true, project: _projFull(saved || p), frameId: variant.id });
  } catch (e) {
    console.error('[scen3/frames/crop]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/scen3/frames/prompt', async (req, res) => {
  try {
    const b = req.body || {};
    // (phase V29) A frame's prompt written by hand in another language is kept - and drawn - in English.
    const t = await _englishText(String(b.prompt == null ? '' : b.prompt));
    if (t.fail) return res.status(502).json({ success: false, error: t.fail });
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(p, req.user)) return OWN.refuse(res, p);
    p.mix = _normMix(p.mix);
    const v = p.mix.variants.find(x => x.id === String(b.frameId || ''));
    if (!v) return res.status(404).json({ success: false, error: 'no such frame' });
    v.prompt = String(t.text || '').trim().slice(0, 4000);
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── The frames chat (phase V26.5, routes/scen3-fchat.js) ──────────────────────
// What the chat's writers are told about the project: the shape, the casting, where the frame's edge is (a shot size
// of the set, or none), the mood, how the look was read - a covered face, the clothes that shot shows - and the light
// and realism sentences every frame of the set ends with. Read from the project as it is; nothing is asked for.
function _fchatFacts(projectId, shot) {
  const p = _loadProjects().find(x => String(x.id) === String(projectId || ''));
  if (!p) return null;
  const set = _frameSet(shot);
  const video = _normVideo(p.video);
  const mood = video.mood ? MP.moodById(video.mood) : null;
  const fmt = _normMix(p.mix).settings.format;
  return {
    format: FRAG_FORMATS.includes(fmt) ? fmt : '9:16',
    casting: _normCasting(p.casting),
    edge: set ? { id: set.id, label: set.label, rule: set.rule, cut: set.cut || '', visible: set.visible } : null,
    mood: mood ? { label: mood.label, face: mood.face, gestures: mood.gestures } : null,
    covered: _faceCovered(p),
    clothes: _clothesShown(p, set ? set.id : 'full'),
    light: FRAG_LIGHT_MATCH.trim(),
    real: PERSON_REAL.trim(),
  };
}

// (phase V26.6) A frame's products as kept on it: { path, name, description }, at most two.
function _framePropsOf(list) {
  return (Array.isArray(list) ? list : []).filter(p => p && p.path).slice(0, 2)
    .map(p => ({ path: String(p.path), name: String(p.name || '').slice(0, 120), description: String(p.description || '').slice(0, 4000) }));
}

// (phase V26.6, the owner's (п7), (пр4)) The products of a line's frame as its clip's writers are told of them: the name and
// the description as kept in Props now (lib/props.js), else as the frame remembered them (a product deleted - (п8)); its
// LABEL and HOW IT IS HELD read out of the description; `have` - its picture is still in Props (Seedance is sent it).
const _descPart = (d, key) => {
  const m = new RegExp('^' + key + ':\\s*(.+)$', 'mi').exec(String(d || ''));
  return m ? m[1].trim().replace(/[.\s]+$/, '') : '';
};
function _frameProds(fr) {
  const P = require('../lib/props');
  return _framePropsOf(fr && fr.props).map((p) => {
    const n = P.facts(p.path, p);
    const abs = toDiskExisting(p.path);
    return { path: p.path, name: n.name, label: _descPart(n.description, 'LABEL'), held: _descPart(n.description, 'HOW IT IS HELD'),
      what: _descPart(n.description, 'WHAT IT IS'), have: !!(abs && fs.existsSync(abs)) };
  });
}

// A frame of the chat put into the set (`to frames`): it joins the pool like any frame - the lines take from it by the
// rule (the owner's answer (d): option 1) - marked as made to order, with the prompt it was drawn from. Once per file.
async function _addChatFrame(projectId, o) {
  const pathUrl = String((o && o.path) || '');
  const preview = await _framePreview(pathUrl);
  let variant = null;
  let already = false;
  const saved = PROJECTS.apply(projectId, (fresh) => {
    fresh.mix = _normMix(fresh.mix);
    const was = fresh.mix.variants.find(v => v.path === pathUrl);
    if (was) { variant = was; already = true; return; }
    variant = {
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      path: pathUrl, preview, prompt: String((o && o.prompt) || '').slice(0, 4000),
      at: new Date().toISOString(), taskId: '', set: '', framing: String((o && o.shot) || ''), n: 0, moment: '',
      made: 'chat', genId: String((o && o.genId) || ''), props: _framePropsOf(o && o.props),
    };
    fresh.mix.variants.push(variant);
    // A set dragged into an order keeps it: the new frame stands at its end.
    if (Array.isArray(fresh.mix.order) && fresh.mix.order.length) fresh.mix.order.push(variant.id);
    fresh.updatedAt = variant.at;
  });
  if (!saved) throw Object.assign(new Error('no such project'), { status: 404 });
  if (!already) MIRROR.touch(saved.id, { project: saved });   // the timeline mirrors the lines (T'): a frame added
  return { project: _projFull(saved), frameId: variant.id, already };
}

// The runner's side: wait for kie, land the picture in the project's frames/ once, make its preview
// and add it to the project's frames - in one burst against the project as it is by then. No line is
// touched: the lines take from the pool by the rule.
JOBS.register('frame', {
  timeoutMs: 15 * 60 * 1000,
  poll: (rec) => {
    const p = _fileParams(rec);
    return H.resolveTask(rec.taskIds[0], PROJECTS.dirOf(p.projectId, 'frames'), 'frame_' + (p.framing || 'set') + '_' + (Number(p.n) || 1));
  },
  file: async (rec, landed) => {
    const p = _fileParams(rec);
    const preview = await _framePreview(landed.imagePath);
    const list = _loadProjects();
    const proj = list.find(x => String(x.id) === String(p.projectId));
    if (!proj) throw new Error('the project is gone');
    proj.mix = _normMix(proj.mix);
    const variant = {
      // Several frames of one set are filed in the same tick, so the clock alone is not an id.
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      path: landed.imagePath, preview, prompt: p.prompt || '',
      at: new Date().toISOString(), taskId: rec.taskIds[0],
      set: String(p.set || ''), framing: String(p.framing || ''), n: Number(p.n) || 0,
      moment: String(p.moment || ''),
    };
    if (!proj.mix.variants.some(v => v.taskId === variant.taskId)) proj.mix.variants.unshift(variant);
    proj.updatedAt = variant.at;
    _saveProjects(list);
    MIRROR.touch(proj.id, { project: proj });   // the timeline mirrors the lines (T'): a frame filed
    return { path: landed.imagePath, preview, frameId: variant.id, set: variant.set, n: variant.n, media: 'image' };
  },
  submit: async (request) => {
    const out = await _submitSetFrame(request);
    return { taskId: out.taskId, engine: out.engine, file: out.file };
  },
});

/* ── Which take of a fragment is ITS clip ────────────────────────────────────
   POST /api/scen3/fragments/pick-clip  { projectId, line, clipId } -> { success, project }

   A fragment can have several clips - one per frame it has been tried on - and this says which of
   them is the fragment's. The same shape as pick-frame: '' hands it back to the newest of the
   current frame.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/fragments/pick-clip', (req, res) => {
  try {
    const b = req.body || {};
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(p, req.user)) return OWN.refuse(res, p);
    p.lines = (p.lines || []).map(_normLine);
    const i = parseInt(b.line, 10);
    if (!(i >= 0 && i < p.lines.length)) return res.status(400).json({ success: false, error: 'no such line' });
    const variant = _normVoice(p.voice).variant === 'tagged' ? 'tagged' : 'plain';
    const want = String(b.clipId || '');
    if (want && !(p.lines[i].video[variant] || []).some(c => c.id === want)) {
      return res.status(404).json({ success: false, error: 'no such clip on this fragment' });
    }
    p.lines[i].pick = { ...(p.lines[i].pick || {}), [variant]: want };
    // Chosen by hand (V23): the line's clip on the timeline whether or not it is fresh.
    p.lines[i].chosen = { ...(p.lines[i].chosen || {}), [variant]: want };
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    MIRROR.touch(p.id, { project: p });   // the timeline mirrors the lines (T'): a clip picked
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── THE CLIP OF A FRAGMENT (phase F4) ───────────────────────────────────────
   POST /api/scen3/fragments/clip  { projectId, line, where } -> { success, alertId, taskId }
                                                              -> { success, skipped: '<why>' }

   The frame of the line speaks its read: Kling avatar hears the picture, the take and the
   animation prompt (W3b), and nothing else. This is the journalled path - a row in Alerts from the
   moment it is asked for, and the SERVER sees it through (lib/gen-jobs.js): it polls kie, downloads
   the clip once into the project's clips/, makes a poster, normalises it for the browser, measures
   it and files it as a take of that line. Leaving the page loses nothing.

   EVERY REFUSAL IS BEFORE THE MONEY. What cannot be rendered is said plainly - no words, no frame,
   no read, a read that no longer matches the words, a read longer than the model takes - and
   answered as `skipped`, not as an error: a chain walking eight lines must be able to step over one.
   ──────────────────────────────────────────────────────────────────────────── */

// What a clip of this line would be made of, or why it cannot be. One reading, used by the route,
// by "try again" and by the price the page shows.
function _clipPlan(proj, i) {
  const lines = (proj.lines || []).map(_normLine);
  const line = lines[i];
  if (!line) return { skipped: 'no such fragment' };
  if (line.removed) return { skipped: 'this fragment is taken off the script' };
  const video = _normVideo(proj.video);
  const voice = _normVoice(proj.voice);
  const variant = voice.variant === 'tagged' ? 'tagged' : 'plain';
  // The clip is made by the model and in the quality the person chose (phase V24, V26.8) - before the money, a missing
  // one is a fragment skipped in words.
  const missing = _unchosen(video, ['model', 'quality']);
  if (missing) return { skipped: missing };
  // (phase V26.8) A project filmed by Seedance is clipped by its fragments (_sdClipPlan) - never by a Kling clip it did
  // not ask for.
  if (TH.isSeedance(video.model)) return { skipped: 'this project is filmed by Seedance - its fragments are clipped by it' };
  const quality = MP.qualityById(video.quality) || MP.qualityById(MP.DEFAULT_QUALITY);
  const said = variant === 'tagged' ? (line.tagged || '') : (line.text || '');
  if (!said.trim()) return { skipped: 'this fragment has no words' };
  const frame = _frameOfLine(_framePool(proj), line, i, video.spread, proj.id);
  if (!frame || !frame.path) return { skipped: 'no frame for this fragment - make one in the frames chat' };
  const take = (line.audio || {})[variant];
  if (!take || !take.path) return { skipped: 'this fragment is not read yet' };
  if (take.said !== said) return { skipped: 'the read is of other words - read it again' };
  if (take.dur > quality.maxAudioSec) {
    return { skipped: 'the read is ' + take.dur.toFixed(1) + 's and the model takes ' + quality.maxAudioSec + 's at most' };
  }
  return {
    variant, quality, said, frame, take, line,
    // The animation prompt of this line (W3b) is what Kling is told. A line that has none - a
    // project made before the video zone - falls back to the old motion preset rather than refusing
    // to render at all.
    prompt: String((line.shot || {}).motion || '').trim() || MP.promptFor(video.preset),
    motionFrom: (line.shot || {}).motion ? 'line' : 'preset',
  };
}

// WHAT A CLIP NEEDS WRITTEN FIRST (phase U4, the owner 2026-09-22). A clip is the frame moving as
// the animation prompt says, in a place that moves as its own prompt says - so before any money is
// committed, both are made sure of:
//
//   the place     one analysis per PLACE, ever. Written into the shelf beside the picture, so the
//                 second fragment here - and every other project in this place - finds it done.
//   the line      one analysis for this line, seeing the frame it opens on, its words, the mood,
//                 the shot size rule and the place's motion.
//
// In that ORDER and not in parallel: the line's prompt is written with the place's motion inside it,
// so a line analysed first would be written about a place nobody had looked at yet.
//
// `onStage` is how the journal row says what is happening while nothing has been sent to a renderer
// yet (the owner, 2026-09-22): the steps are counted first, so the row says "analysis 1/2 - the
// place" only when there really are two of them.
async function _readyForClip(id, i, onStage) {
  const say = typeof onStage === 'function' ? onStage : () => {};
  const proj = _loadProjects().find(p => String(p.id) === id);
  if (!proj) return;
  const place = _normCasting(proj.casting).locationImage;
  const line = (proj.lines || []).map(_normLine)[i];
  const wantPlace = !!(place && !_envMotionOf(place));
  // The same staleness rule the writer uses (X6), so a prompt written before the place was analysed
  // is written again before this clip is paid for. A place about to be analysed for the FIRST time
  // makes every prompt stale by definition: its sentence cannot be in any of them yet.
  const stale = !line || wantPlace || _motionStale(line, _envMotionOf(place));
  const wantLine = stale && !(line && line.shot && line.shot.motionEdited);
  const n = (wantPlace ? 1 : 0) + (wantLine ? 1 : 0);
  let at = 0;
  if (wantPlace) {
    say('analysis ' + (++at) + '/' + n + ' · the place');
    try { await _askEnvMotion(place); } catch (e) { console.warn('[scen3/clip] the place was not analysed:', e.message); }
  }
  if (wantLine) {
    say('analysis ' + (++at) + '/' + n + ' · this fragment');
    try { await _writePrompts(id, [i]); } catch (e) { console.warn('[scen3/clip] the animation was not written:', e.message); }
  }
}

// One clip on kie. The picture and the sound go up FRESH every time: kie fetches them itself, and a
// link that has been sitting around comes back as "fetch failed" long after the money is committed.
async function _submitClip(b, onStage) {
  const say = typeof onStage === 'function' ? onStage : () => {};
  const id = String(b.projectId || '').trim();
  {
    const first = _loadProjects().find(p => String(p.id) === id);
    const i0 = parseInt(b.line, 10);
    // Only when there is something to render at all: an analysis for a fragment that will be
    // refused anyway is a call nobody asked for.
    if (first && !_clipPlan(first, i0).skipped) await _readyForClip(id, i0, say);
  }
  say('rendering');
  const proj = _loadProjects().find(p => String(p.id) === id);
  if (!proj) throw Object.assign(new Error('no such project'), { status: 404 });
  const i = parseInt(b.line, 10);
  const plan = _clipPlan(proj, i);
  if (plan.skipped) throw Object.assign(new Error(plan.skipped), { status: 400 });

  const imageUrl = await _hostLocal(plan.frame.path, { forceFresh: true, verify: true });
  const audioUrl = await _hostLocal(plan.take.path,
    { forceFresh: true, verify: true, exts: /\.(mp3|wav|m4a|ogg)$/i });
  const taskId = await _kieTask(plan.quality.model, { image_url: imageUrl, audio_url: audioUrl, prompt: plan.prompt });
  if (!taskId) throw Object.assign(new Error('the renderer did not accept the task'), { status: 502 });
  console.log('[scen3/clip] line ' + (i + 1) + ' ' + plan.quality.id + ' ' + plan.take.dur.toFixed(1) + 's'
    + ' motion=' + plan.motionFrom + ' -> ' + String(taskId).slice(0, 24));
  return {
    taskId, engine: plan.quality.model,
    file: {
      projectId: id, line: i, variant: plan.variant, said: plan.said,
      fromFrame: plan.frame.id, fromAudio: plan.take.path,
      quality: plan.quality.id, preset: _normVideo(proj.video).preset,
      dur: plan.take.dur,
    },
  };
}

router.post('/scen3/fragments/clip', async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    // (phase V26.8, part 5) A project filmed by Seedance: the fragment's Seedance clip.
    if (TH.isSeedance(_normVideo(proj.video).model)) return _sdClipRoute(req, res, proj);
    const i = parseInt(b.line, 10);
    const plan = _clipPlan(proj, i);
    if (plan.skipped) return res.json({ success: true, skipped: plan.skipped });
    // One clip per fragment at a time: the journal is asked rather than a flag on the project, so a
    // reload or a second tab cannot start the same clip twice.
    const running = ALERTS.list().some(r => r.state === 'running' && r.what === 'clip'
      && r.job && r.job.params && r.job.params.file
      && String(r.job.params.file.projectId) === id && Number(r.job.params.file.line) === i);
    if (running) return res.json({ success: true, skipped: 'this fragment is already being made' });

    // THE ROW IS WRITTEN FIRST, before any agent is asked anything (the owner, 2026-09-22). A clip
    // begins with up to two analyses, and for the half-minute they take the person used to see
    // nothing but a spinner on the button. Now the journal has the row from the press, with no task
    // number yet and the stage saying what is being looked at; the row is also what stops a second
    // press starting the same fragment twice, and what puts the waiting back after a reload.
    const request = { projectId: id, line: i };
    const rec = JOBS.submitted({
      kind: 'video', what: 'clip',
      title: 'Clip · fragment ' + _lineNo((proj.lines || []).map(_normLine), i),
      where: b.where || null,
      stage: 'getting ready',
      taskIds: [],
      job: { type: 'clip', params: { request, file: { projectId: id, line: i } } },
    });
    res.json({ success: true, alertId: rec.id });

    // And the rest happens without the page: the analyses, the hosting and the task go on here, and
    // whatever comes of them is written into that row. The page follows the row, so a closed tab
    // loses nothing - and an answer that waited for all of this would be a minute of silence.
    _submitClip(request, (s) => ALERTS.update(rec.id, { stage: s }))
      .then((out) => {
        ALERTS.update(rec.id, {
          taskIds: [out.taskId], engine: out.engine, stage: 'rendering',
          job: { type: 'clip', params: { request, file: out.file } },
        });
        console.log('[scen3/clip] fragment ' + (i + 1) + ' -> ' + String(out.taskId).slice(0, 24));
      })
      .catch((e) => {
        console.error('[scen3/fragments/clip]', e.message);
        ALERTS.fail(rec.id, e.message, REFUSAL.isRefusal(e.message) ? { refused: true } : undefined);
      });
  } catch (e) {
    console.error('[scen3/fragments/clip]', e.message);
    if (!res.headersSent) res.status(e.status || 502).json({ success: false, error: e.message });
  }
});

/* ── EVERY CLIP OF A PROJECT, ASKED FOR BY THE SERVER (phase X1) ───────────────
   POST /api/scen3/fragments/clips  { projectId, key, again? }
       -> { success, queued: [{ line, alertId }], skipped: [{ line, why }] }

   WHY THIS EXISTS. The page used to walk the fragments itself: five at once, and the next five only
   after all five had LANDED - four or five minutes later. The owner pressed `generate all` on a
   script of ten, five clips were made, and the other four were never asked for, because by then the
   page that was holding the loop had gone (PLAN, phase X). A run that belongs to a page is lost
   with the page; that is the rule the journal was built on, and this is the clips obeying it.

   So: one call works out what can be made, writes a journal row for every one of them AT ONCE - so
   the whole list is visible from the press - answers, and then sends them one a second without
   waiting for any to finish. A fragment that refuses (no words, no frame, a stale read, a read
   longer than the model takes) is named in `skipped` and stepped over; one that is already being
   made is left alone; one that already has its clip is not paid for twice unless `again` says so.

   A FAILURE STOPS NOTHING (decided with the owner 2026-09-22). A render that fails is already paid
   for and says nothing about its neighbours, so it fails its own row and the rest go on. Nor does
   the queue lock anything: a fragment's own button stays live throughout, and the only bar is the
   old one - one clip per fragment at a time.
   ─────────────────────────────────────────────────────────────────────────── */

// Does this fragment already have its clip - a take made from the frame it opens on, of the words
// it says now? The same question the panel asks (js/merge-v3/wk-fragments.js, _clipState), asked
// here because the server is the one deciding what to pay for.
// (phase V23) A clip is fresh only when it was lipsynced to the read the line has NOW - a read again with the same
// words is another performance (a clip with no read recorded, made before that was kept, counts as fresh). A clip
// CHOSEN BY HAND counts too: the person decided what the line's clip is.
function _clipDone(proj, i) {
  const plan = _clipPlan(proj, i);
  if (plan.skipped) return false;
  const takes = (plan.line.video || {})[plan.variant] || [];
  const hand = String(((plan.line.chosen || {})[plan.variant]) || '');
  if (hand && takes.some(c => c && c.path && c.id === hand)) return true;
  return takes.some(c => c && c.path && c.fromFrame === plan.frame.id && c.said === plan.said
    && (!c.fromAudio || c.fromAudio === plan.take.path));
}

// Where a clip was asked from, for the Alerts list: this fragment of this project. The page sends
// the open timeline's key and the row is addressed from it, so every row of a queue points at its
// own fragment (js/merge-v3/wk-fragments.js, _whereLine says the same thing for one clip).
// `n` is what a person reads - the fragment's place in the VIDEO, which is not its index once a
// line has been taken off (phase Z). The address and `spot` keep the index: that is what opens it.
const _whereClip = (key, title, i, n) => ({
  page: 'merge',
  href: '/merge?p=' + encodeURIComponent(key) + '&step=setup&line=' + (i + 1),
  label: 'Merge \u00b7 ' + title + ' \u00b7 fragment ' + (n || i + 1),
  spot: { key, step: 'setup', line: i + 1 },
});
/** A line's place among the lines that are in the video, counted from one (phase Z). */
function _lineNo(lines, i) {
  let n = 0;
  for (let k = 0; k <= i && k < lines.length; k++) if (!lines[k].removed) n++;
  return n;
}

// The queue itself: a start a second, and nobody waits for anybody. What comes of each start is
// written into the row it belongs to - the task number and "rendering", or the failure.
async function _clipQueue(queued) {
  for (let k = 0; k < queued.length; k++) {
    if (k) await _wait(SUBMIT_GAP_MS);
    const q = queued[k];
    _submitClip(q.request, (st) => ALERTS.update(q.alertId, { stage: st }))
      .then((out) => {
        ALERTS.update(q.alertId, {
          taskIds: [out.taskId], engine: out.engine, stage: 'rendering',
          job: { type: 'clip', params: { request: q.request, file: out.file } },
        });
        console.log('[scen3/clips] fragment ' + q.line + ' -> ' + String(out.taskId).slice(0, 24));
      })
      .catch((e) => {
        console.error('[scen3/clips] fragment ' + q.line + ':', e.message);
        ALERTS.fail(q.alertId, e.message, REFUSAL.isRefusal(e.message) ? { refused: true } : undefined);
      });
  }
}

router.post('/scen3/fragments/clips', (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    // (phase V26.8, part 5) A project filmed by Seedance: its fragments' Seedance clips.
    if (TH.isSeedance(_normVideo(proj.video).model)) return _sdClipsRoute(req, res, proj);
    const key = String(b.key || '');
    const title = String(proj.name || proj.title || 'talking head');
    const lines = (proj.lines || []).map(_normLine);

    // The journal is what says a fragment is already being made - not a flag on the project - so a
    // second press, a reload or another tab cannot start the same one twice.
    const busy = new Set(ALERTS.list()
      .filter(r => r.state === 'running' && r.what === 'clip' && r.job && r.job.params && r.job.params.file
        && String(r.job.params.file.projectId) === id)
      .map(r => Number(r.job.params.file.line)));

    // Every line that needs a clip. (A list of lines, `only`, was `generate all`'s - gone in phase V61.)
    const queued = [], skipped = [];
    for (let i = 0; i < lines.length; i++) {
      if (busy.has(i)) { skipped.push({ line: i + 1, why: 'already being made' }); continue; }
      const plan = _clipPlan(proj, i);
      if (plan.skipped) { skipped.push({ line: i + 1, why: plan.skipped }); continue; }
      if (!b.again && _clipDone(proj, i)) { skipped.push({ line: i + 1, why: 'already clipped' }); continue; }
      const request = { projectId: id, line: i };
      const no = _lineNo(lines, i);
      const rec = JOBS.submitted({
        kind: 'video', what: 'clip',
        title: 'Clip \u00b7 fragment ' + no,
        where: _whereClip(key, title, i, no),
        stage: 'getting ready',
        taskIds: [],
        job: { type: 'clip', params: { request, file: { projectId: id, line: i } } },
      });
      queued.push({ line: i + 1, alertId: rec.id, request });
    }
    console.log('[scen3/clips] ' + id + ' queued=' + queued.length + ' skipped=' + skipped.length);
    res.json({ success: true, queued: queued.map(q => ({ line: q.line, alertId: q.alertId })), skipped });
    if (queued.length) _clipQueue(queued).catch(e => console.error('[scen3/clips]', e.message));
  } catch (e) {
    console.error('[scen3/fragments/clips]', e.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
});

// The runner's side. `poll` is the same reader the old watcher uses, so a clip lands the same way it
// always has: downloaded once, normalised, postered, measured. A "fetch failed" from kie means the
// task never started and nothing was charged - the files are re-hosted and the task asked again,
// once, exactly as the Scenarios path does.
JOBS.register('clip', {
  timeoutMs: 15 * 60 * 1000,
  poll: async (rec) => {
    // Nothing to poll yet: the row was written at the press and the analyses are still running
    // (the stage says which). The runner simply looks again next tick.
    if (!rec.taskIds || !rec.taskIds[0]) return { state: 'pending' };
    const p = _fileParams(rec);
    const s = await _fetchClip(rec.taskIds[0], p.projectId);
    if (s.state !== 'failed') return s;
    const tries = Number((rec.job.params || {}).refetch || 0);
    if (!_FETCH_FAIL_RE.test(String(s.error || '')) || tries >= 1) return s;
    // Nothing rendered, nothing charged: fresh links and one more ask.
    try {
      const again = await _submitClip(rec.job.params.request, (st) => ALERTS.update(rec.id, { stage: st }));
      ALERTS.update(rec.id, { job: { ...rec.job, params: { ...rec.job.params, refetch: tries + 1, file: again.file } } });
      console.log('[scen3/clip] re-asked with fresh links ->', String(again.taskId).slice(0, 24));
      return { state: 'pending', taskId: again.taskId };
    } catch (e) {
      return { state: 'failed', error: s.error + ' (and the retry failed: ' + e.message + ')' };
    }
  },
  file: async (rec, landed) => {
    const p = _fileParams(rec);
    const list = _loadProjects();
    const proj = list.find(x => String(x.id) === String(p.projectId));
    if (!proj) throw new Error('the project is gone');
    proj.lines = (proj.lines || []).map(_normLine);
    const line = proj.lines[Number(p.line)];
    if (!line) throw new Error('that fragment is gone');
    const clip = _normTake({
      path: landed.path, dur: landed.dur, thumb: landed.thumb, at: new Date().toISOString(),
      said: p.said, fromAudio: p.fromAudio, fromFrame: p.fromFrame,
      preset: p.preset, quality: p.quality,
    });
    // A new TAKE, not a replacement: earlier ones stay browsable, and the fresh one is what the
    // fragment is set to - it is what was just paid for.
    const variant = p.variant === 'tagged' ? 'tagged' : 'plain';
    const takes = Array.isArray(line.video[variant]) ? line.video[variant] : [];
    const at = takes.findIndex(x => x.id === clip.id);
    if (at >= 0) takes[at] = clip; else takes.push(clip);
    line.video[variant] = takes;
    line.pick = { ...(line.pick || {}), [variant]: clip.id };
    if (line.chosen) line.chosen = { ...line.chosen, [variant]: '' };
    proj.updatedAt = clip.at;
    _saveProjects(list);
    MIRROR.touch(proj.id, { project: proj });   // the timeline mirrors the lines (T'): a clip filed
    // The preview's proxy, made now rather than on the first play in Merge.
    try { require('./proxies').warmProxies([landed.path], 480); } catch (e) { /* cosmetic */ }
    return { path: landed.path, preview: landed.thumb || '', media: 'video', line: Number(p.line) + 1, dur: landed.dur };
  },
  submit: async (request, rec) => {
    const out = await _submitClip(request, rec ? (s) => ALERTS.update(rec.id, { stage: s }) : null);
    return { taskId: out.taskId, engine: out.engine, file: out.file };
  },
});

// ── the voice library ────────────────────────────────────────────────────────
// A proxy, for one reason above all: the ElevenLabs key stays on the server. It also trims
// the answer — a shared voice arrives with thirty-odd fields including social handles and a
// year of usage counters, and a picker shows about a dozen.
const EL_BASE = 'https://api.elevenlabs.io/v1';

router.get('/scen3/voices/filters', (_req, res) => {
  res.json({
    success: true,
    genders: VF.GENDERS, ages: VF.AGES, descriptives: VF.DESCRIPTIVES,
    useCases: VF.USE_CASES, accents: VF.ACCENTS, languages: VF.LANGUAGES,
    categories: VF.CATEGORIES,
  });
});

router.get('/scen3/voices/library', async (req, res) => {
  try {
    const key = _elKey();
    if (!key) return res.status(400).json({ success: false, error: 'no ElevenLabs key in settings' });

    // Only the keys the API knows, and only when they carry a value: an empty `accent=`
    // is not "any accent" to this endpoint, it is a filter that matches nothing.
    const qs = new URLSearchParams();
    VF.QUERY_KEYS.forEach(k => {
      const v = req.query[k];
      if (v !== undefined && String(v).trim() !== '') qs.set(k, String(v).trim());
    });
    if (!qs.get('page_size')) qs.set('page_size', '24');

    const r = await axios.get(`${EL_BASE}/shared-voices?${qs}`,
      { headers: { 'xi-api-key': key }, timeout: 20000 });
    const raw = (r.data && r.data.voices) || [];
    const voices = raw.map(v => {
      const out = {};
      VF.CARD_FIELDS.forEach(f => { out[f] = v[f]; });
      return out;
    });
    res.json({
      success: true, voices,
      hasMore: !!(r.data && r.data.has_more),
      // The page count comes from this: 10624 voices for "male", 22 once four filters are on.
      total: +((r.data && r.data.total_count) || 0),
    });
  } catch (e) {
    const msg = (e.response && e.response.data && (e.response.data.detail || {}).message) || e.message;
    console.error('[scen3/voices] library', msg);
    res.status(502).json({ success: false, error: String(msg) });
  }
});

// Take a library voice: ElevenLabs will not synthesise with an id that is not in the
// account — it answers `voice_not_found` — so choosing one means adding it. The account-side
// id that comes back is what gets written onto the character, by the page, through
// char-store's own endpoint: this route does not reach into another module's file.
router.post('/scen3/voices/take', async (req, res) => {
  try {
    const key = _elKey();
    if (!key) return res.status(400).json({ success: false, error: 'no ElevenLabs key in settings' });
    const b = req.body || {};
    const owner = String(b.ownerId || '').trim();
    const voice = String(b.voiceId || '').trim();
    const name  = String(b.name || '').trim() || 'Library voice';
    if (!owner || !voice) return res.status(400).json({ success: false, error: 'ownerId and voiceId are required' });

    const r = await axios.post(`${EL_BASE}/voices/add/${owner}/${voice}`,
      { new_name: name }, { headers: { 'xi-api-key': key }, timeout: 30000 });
    const id = (r.data && (r.data.voice_id || r.data.voiceId)) || '';
    if (!id) return res.status(502).json({ success: false, error: 'ElevenLabs added no voice id', detail: r.data });
    console.log('[scen3/voices] took', name, '->', id);

    // Do we already know this voice? Taking one we have is an ordinary thing to do - the
    // library search does not hide what is already ours, so the same voice can be found twice
    // and cast for a second character.
    //
    // The add above is idempotent - measured: adding a voice the account already holds returns
    // the SAME id and the account count does not move - so no slot is spent either way, and it
    // doubles as the way back in if the slot had been released. What WAS being spent is this:
    // every take recorded a fresh 30-second demo through TTS and then pointed the shelf at the
    // new file, leaving the old mp3 on disk with nothing referencing it. So when the shelf
    // already has a demo, keep it and read nothing.
    //
    // By the id the ADD returned, with the shared id as a fallback - that is the id the shelf
    // is keyed by, and it is the one the account will answer to from here on.
    const known = VSHELF.get(id) || VSHELF.read().find(e => String(e.sharedVoiceId || '') === voice) || null;
    const knownDemo = known && known.demo
      && fs.existsSync(path.join(CFG.ROOT_DIR, String(known.demo).replace(/^\/+/, '')))
      ? known.demo : '';

    let sample = '', dur = 0, sampleError = '', reused = false;
    if (knownDemo) {
      sample = knownDemo;
      dur = known.dur || 0;
      reused = true;
      console.log('[scen3/voices] already known:', id, '- keeping its demo', knownDemo.split('/').pop());
    } else try {
      const buf = await _speakLine(key, id, VD.DEMO_MODEL, VD.DEMO_TEXT, { stability: 0.5, speed: 1 });
      const dir = path.join(CFG.MEDIA.voice, 'demos');
      fs.mkdirSync(dir, { recursive: true });
      const file = `demo_${id}_${Date.now()}.mp3`;
      fs.writeFileSync(path.join(dir, file), buf);
      sample = `/media/voice/demos/${file}`;
      dur = await _audioDur(path.join(dir, file));
      console.log('[scen3/voices] demo for', id, dur.toFixed(1) + 's', VD.DEMO_WORDS + ' words');
    } catch (e) {
      // The voice IS taken at this point. Losing the demo is a nuisance, not a reason to
      // pretend the whole thing failed and have the user take it a second time.
      sampleError = (e.response && e.response.data && e.response.data.detail
        && (e.response.data.detail.message || e.response.data.detail)) || e.message;
      console.warn('[scen3/voices] demo failed for', id, sampleError);
    }
    // On the shelf the moment it is ours. Everything the account knows about the voice - its
    // tags, and the owner id that can add it back - is readable only while the slot exists, and
    // the slot is exactly what gets freed later to make room. Recording it now is what lets a
    // voice be archived rather than lost. Non-fatal: the voice is taken either way.
    try {
      await VSHELF.register({ voiceId: id, name, demo: sample, dur, publicOwnerId: owner, sharedVoiceId: voice });
    } catch (e2) { console.warn('[scen3/voices] shelf register failed for', id, e2.message); }

    // `reused` lets the page say what actually happened. Taking a voice we already had is not
    // the same event as taking a new one, and a message that claims otherwise is a message that
    // will have somebody hunting for a second copy.
    res.json({ success: true, voiceId: id, name: (known && known.name) || name,
      sample, dur: +dur.toFixed(2), sampleError, reused,
      labels: (known && known.labels) || null });
  } catch (e) {
    // The refusals worth naming: the voice is gated by the plan tier, or the account is out
    // of voice slots. The subscription endpoint is not readable with this key, so the limit
    // cannot be checked beforehand — the message is all there is to go on.
    const d = (e.response && e.response.data) || {};
    const msg = (d.detail && (d.detail.message || d.detail)) || d.message || e.message;
    console.error('[scen3/voices] take failed', msg);
    res.status(502).json({ success: false, error: String(msg) });
  }
});

router.FRAME_SETS = FRAME_SETS;
router.loadProjects = _loadProjects;
// The frame rule, for the timeline mirror (lib/frag-mirror.js): the pool in the order the frames
// stand in, and which of them a line opens on. One rule, read by the page, by the agent that writes
// the animation prompts and by the cut on the timeline.
router.framePool = _framePool;
// (phase V26.5) The frames chat (routes/scen3-fchat.js).
router.fchatFacts = _fchatFacts;
router.fchatRead = _fchatRead;
router.addChatFrame = _addChatFrame;
router.frameOfLine = _frameOfLine;
// (phase V26.8) A Seedance project's fragments with their clips, for the timeline mirror.
router.sdCuts = _sdCuts;
// (phase V30, block 1) Is the script being read now? Its captions are heard by themselves after the last read lands
// (lib/captions-auto.js).
router.readsRunning = (id) => !!((_reads.get(String(id)) || {}).running);
// The two makers' work and what the Library's chats need around it (routes/makechat.js, phase I): the
// same submit Merge and "try again" use, the media door, the kicks of the rows written at the press,
// and the retry request a row keeps.
router.makers = {
  submitEnv: _submitEnv, submitLookbook: _submitLookbook, resolveMedia: _resolveMedia,
  asking: _asking, retryRequest: _retryRequest, engine: IMG_ENGINE,
};

module.exports = router;
