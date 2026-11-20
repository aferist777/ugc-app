'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SCENARIOS (scen3) — the scenario library store, and the server side of the talking
// head and voiceover projects: casting, voices and reads, frames, clips, and the
// New environment / New lookbook / dressing generators.
//
// The scenario store is standalone: its own JSON file and its own record shape.
//
// Scenario record (_norm) — nothing else is stored:
//   { id, title, lines:[{text}], type, archived, vertical, product, roles,
//     origin, narrator, createdAt, updatedAt }
//
// lineCount is DERIVED from lines.length on read, never stored, so it cannot
// drift away from the actual content. There is one text track per line.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const sharp   = require('sharp');
// A picture brought in, in a format the aggregators take.
const IMGIN   = require('../lib/image-in');
// The interface's words (lib/i18n.js): what is said to a person goes through it, every prompt stays English.
const I18N    = require('../lib/i18n');

const router = express.Router();

// The engine a new look's record names when its caller named none (_saveObraz).
const DEFAULT_ENGINE = 'nano-banana-2';

const { DATA_DIR } = require('../lib/config');
const FILE     = path.join(DATA_DIR, 'scen3-scenarios.json');
const OPT_FILE = path.join(DATA_DIR, 'scen3-options.json');
// Projects are folders (lib/projects-store.js): data/project-list.json names them, and
// projects/<folder>/project.json is each one, beside its voice/, frames/ and clips/.
const PROJECTS = require('../lib/projects-store');

// Minimum usable scenario length, enforced on both ends (the client greys out
// Save below this, the server refuses it). Three: fewer than that is a note, not an ad,
// and five would refuse short scenarios that are wanted.
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
    title:     String(src.title || '').trim() || I18N.t('untitled'),
    lines:     Array.isArray(src.lines)
      ? src.lines.map(l => ({ text: String((l && l.text) || '') }))   // single track: any legacy textColored is dropped
      : [],
    // What kind of scenario: a field and a filter, editable in the Library. Only
    // talking_head exists so far; whatever a record carries is kept.
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
    // Null for everything written by hand.
    origin:    _normOrigin(src.origin),
    // THE SCENARIO'S OWN LABEL: the narrator - the voice of the WRITING, not the reader's
    // gender, which lives on the role. `origin` says what the generator used and stays provenance; this
    // says what the scenario is, editable, and a generated one shows its origin's narrator until it is
    // set. null = never set (the origin shows through); an empty name = set to none on purpose. There is
    // no language: every scenario is English, and a `language` a record carries is
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
    at:         String(s.at || ''),
  };
  // An object of empty strings is not provenance.
  return Object.values(out).some(v => v && v !== false) ? out : null;
}

// The store; a missing file starts as an empty list.
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
// (/scen3/values/remove) takes it off the scenarios as well - the
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
  // No options file yet: derive the suggestions from whatever the stored scenarios
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

// REMOVING A VALUE - a wrong one typed once has to be able to go. A value
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
    return res.status(400).json({ success: false, error: I18N.t('only a type, role, vertical or product can be removed') });
  }
  if (!value) return res.status(400).json({ success: false, error: I18N.t('which value?') });
  const same = (v) => String(v || '').trim().toLowerCase() === value.toLowerCase();
  if (field === 'type' && same(DEFAULT_TYPE)) {
    return res.status(400).json({ success: false, error: I18N.t('{type} is the type every scenario falls back to - it stays', { type: DEFAULT_TYPE }) });
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

// THE SOURCE IS NAMED BY ITS CURRENT TITLE (renaming a source
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
  // The source it was written from, by id - the id the list's ?source= filter and its
  // source groups go by, not the title, which here is a snapshot.
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
// The full record carries the WHOLE provenance, not just the three fields a list row needs.
const _full = s => {
  const titles = _sourceTitles();
  return { ..._summary(s, titles), lines: s.lines || [], origin: _liveOrigin(s.origin, titles) };
};

// The generated scenarios by the source they came from, newest group first: its id, the
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
    .sort((a, b) => b.last.localeCompare(a.last))
    .map(g => ({ id: g.id, title: g.gone ? (g.title || I18N.t('deleted source')) : (titles.get(g.id) || g.title || I18N.t('untitled source')), n: g.n, gone: g.gone }));
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
    if (!s) return res.status(404).json({ success: false, error: I18N.t('not found') });
    res.json({ success: true, scenario: _full(s) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Lines typed in another language, made English before they
// are kept - the scenario window's save, the Library column's lines when they are left, a talking head made from a
// scenario, a line of one edited or put in, the generator's save. { texts, translated } or { fail } in words.
async function _englishLines(texts) {
  try { return await AGENT.toEnglishLines(texts); } catch (e) { return { fail: I18N.t('the lines could not be translated: {why}', { why: e.message }) }; }
}
// The same for ONE prompt typed in a field - a line's motion or OmniHuman prompt, a place's "how it moves", a
// dressing note: English goes as typed, another language is translated (quoted words too). { text } or { fail }.
async function _englishText(text) {
  const t = String(text || '').trim();
  if (!t || AGENT.english(t)) return { text: t };
  try { return await AGENT.toEnglish(t); } catch (e) { return { fail: I18N.t('it could not be translated: {why}', { why: e.message }) }; }
}

// ── Upsert by id: creates when the id is unknown, else saves edits in place ──
// This is what line edits and renames hit (autosaved, no Save button). `english`: the lines are made English
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
    if (edit && i < 0) return res.status(404).json({ success: false, error: I18N.t('this scenario no longer exists') });

    if (i >= 0) {
      // keep the original id + createdAt; the request may only carry changed fields
      const merged = _norm({ ...list[i], ...b, id: list[i].id, createdAt: list[i].createdAt }, now);
      // Going INTO the archive is not an edit and keeps the date; coming back is news and gets a new
      // one, so the scenario heads the list again.
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
      return res.status(400).json({ success: false, error: I18N.t('title is required') });
    }
    const filled = rec.lines.filter(l => l.text.trim()).length;
    if (filled < MIN_LINES) {
      return res.status(400).json({ success: false, error: I18N.tn(MIN_LINES, 'at least {n} line is required (got {got})', 'at least {n} lines are required (got {got})', { got: filled }) });
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
  if (!String(b.title || '').trim()) throw new Error(I18N.t('title is required'));
  const filled = rec.lines.filter(l => l.text.trim()).length;
  if (filled < MIN_LINES) throw new Error(I18N.tn(MIN_LINES, 'at least {n} line is required (got {got})', 'at least {n} lines are required (got {got})', { got: filled }));
  list.unshift(rec);
  _save(list);
  _harvest(rec);
  return _full(rec);
};
router.MIN_LINES = MIN_LINES;
router.effectiveLabels = effectiveLabels;
// One scenario as the page reads it - the generator makes a draft of it to rewrite in a narrator's voice.
router.getScenario = function getScenario(id) {
  const s = _load().find(x => String(x.id) === String(id));
  return s ? _full(s) : null;
};

// A source about to be deleted leaves its CURRENT name in the scenarios written from it:
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
// (routes/scriptgen.js, save). The mark goes with it: the topic would otherwise go on
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
    if (!gone) return res.status(404).json({ success: false, error: I18N.t('not found') });
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
//   preview/<name>.jpg  2048px — a picture shown large (lib/thumbs.js PREVIEW)
//   <name>.jpg          full 4K — only ever loaded on purpose
//
// A still no bigger than a preview is its own. A preview is written when a picture is
// filed - a look, a generated lookbook or environment, a frame (_framePreview).
// ════════════════════════════════════════════════════════════════════════════

const CFG = require('../lib/config');
const { toDiskWithin, toDiskExisting, toUrl } = require('../lib/media');

// Map a public URL to an absolute file, refusing anything outside the library's media and
// project folders (so a crafted ../ path cannot reach anything else).
// `exts` defaults to stills, which is what every caller but a Kling avatar clip wants —
// that one also has to hand over the read's sound, and widening the default would quietly let any
// file type through the other paths.
const MEDIA_IMG = /\.(jpg|jpeg|png|webp)$/i;
function _resolveMedia(urlPath, exts) {
  const roots = [CFG.MEDIA_DIR, CFG.PROJECTS_DIR];
  const abs = toDiskWithin(String(urlPath || '').split('?')[0], roots);
  if (!abs) return null;
  if (!(exts || MEDIA_IMG).test(abs)) return null;
  const root = roots.find(r => abs.startsWith(path.resolve(r) + path.sep));
  const rel = path.relative(root, abs).split(path.sep).join('/');
  return { abs, rel, root };
}

const { needsPreview, makePreview } = require('../lib/thumbs');

// Where the preview of a file is written, and the URL it answers at: beside its source, in
// a preview/ folder.
function _previewTarget(hit) {
  const base = path.basename(hit.rel).replace(/\.[^.]+$/, '') + '.jpg';
  const sub  = path.posix.dirname(hit.rel);
  const relOut = path.posix.join(sub === '.' ? '' : sub, 'preview', base);
  const abs = path.resolve(hit.root, relOut);
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

// THE REALISM MARKERS. What the research on prompting these models agrees on: say "photorealistic" and describe a PHOTOGRAPH
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
// BEHIND it, and at the size a sheet is rendered the mesh reads as grain all over the face.
// The person in this costume speaks to the camera.
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
// onto the person like a printed leotard.
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
  if (!m) throw new Error(I18N.t('the agent did not say how to dress this'));
  let plan;
  try { plan = JSON.parse(m[0]); } catch (e) { throw new Error(I18N.t('the agent answered with something unreadable')); }
  const prompt = String((plan && plan.prompt) || '').trim();
  if (!prompt) throw new Error(I18N.t('the agent wrote no prompt'));
  return { kind: plan.kind === 'costume' ? 'costume' : 'outfit', prompt };
}

// The agents' ladder (lib/agents.js, Admin -> AI settings) - the one New Character reads photos with and the
// chats' writers write with, instead of a cascade of this file's own. One place decides which models look at an image,
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
    // Everything in English, whatever the person typed in.
    // ...but "why" is said to the person, in the interface's language.
    I18N.lang() === 'en'
      ? 'Write everything in English - the prompt, the description and "why" - whatever language the person wrote in.'
      : 'Write the prompt and the description in English, whatever language the person wrote in; write "why" in ' + I18N.langName() + '.',
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
  if (!m) throw new Error(I18N.t('the agent did not answer with a plan'));
  let plan;
  try { plan = JSON.parse(m[0]); } catch (e) { throw new Error(I18N.t('the agent answered with something unreadable')); }
  if (!plan || plan.ok === false) {
    const why = String((plan && plan.why) || I18N.t('that does not describe an outfit')).trim();
    return { ok: false, why };
  }
  const prompt = String(plan.prompt || '').trim();
  if (!prompt) throw new Error(I18N.t('the agent wrote no prompt'));
  return {
    ok: true,
    kind: plan.kind === 'costume' ? 'costume' : 'outfit',
    prompt,
    description: String(plan.description || '').trim(),
  };
}

// ── The picture itself ──────────────────────────────────────────────────────
// NANO-BANANA-2 MAKES ALL THREE - the lookbook, the look and the environment - chosen by an A/B
// against gpt-image-2.5: its "4K" is an upscale in the pixels - halos, over-sharpened edges,
// surfaces that melt, textures that swim - and its honest 2K is too small, while nano-banana-2
// kept natural texture at both sizes.
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
  ? _i2i(prompt, urls, '1:1', LB_RES)
  : _t2i(prompt, '1:1', LB_RES));

// ── Lookbook gender ─────────────────────────────────────────────────────────
// Which gender an outfit suits, judged from the INPUT (the description and/or the
// uploaded photo) so the call can run while the image is still rendering. Kept in
// a side file keyed by public path. A lookbook with no gender recorded stays
// unknown on purpose and is always visible.
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
  if (!hit || !fs.existsSync(hit.abs)) throw new Error(I18N.t('reference not found: {path}', { path: urlPath }));
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
// Every picture made here is nano-banana-2 on kie.ai. Its input on kie (verified against
// docs.kie.ai/market/google/nanobanana2):
//
//   nano-banana-2       image_input (<=14 urls, 30MB total) | resolution 1K/2K/4K | output_format
//
// and aspect_ratio. A kie taskId has no 'repl:' prefix, so the shared resolveTask routes
// it by itself.
const axios = require('axios');

async function _kieTask(model, input) {
  const r = await axios.post(
    `${CFG.KIE_BASE}/api/v1/jobs/createTask`,
    { model, input },
    { headers: H.kieHeaders(), timeout: 30000 },
  );
  const id = r.data && r.data.data && r.data.data.taskId;
  if (!id) throw new Error(I18N.t('kie returned no taskId: {answer}', { answer: JSON.stringify(r.data).slice(0, 200) }));
  return id;
}

// `quality` maps onto nano-banana-2's resolution input.
const _resOf = (q) => (['1K', '2K', '4K'].includes(q) ? q : '2K');

async function _t2i(prompt, aspect, quality) {
  const ar = aspect || '1:1';
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
    return best[0];
  } catch (e) {
    console.warn('[scen3] ratio probe failed:', e.message);
    return '';
  }
}

// The model's image array is `image_input`: a wrong name is silently ignored and comes back
// as a text-to-image result.
async function _i2i(prompt, urls, aspect, quality) {
  const ar = aspect || '1:1';
  const imgs = (urls || []).filter(Boolean);
  if (imgs.length > 14) throw new Error(I18N.t('nano-banana-2 takes at most 14 reference images, got {n}', { n: imgs.length }));
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
async function _submitLookbook(b) {
  const note = String(b.prompt || '').trim();
  const b64  = String(b.imageBase64 || '');
  // A picture the library already holds - another lookbook as the base, or (an old row's "try again") any
  // picture on its shelves as the photo. Sent as a PATH rather than as bytes: it is on this disk, and
  // pulling it through the browser as base64 only to upload it again would be a round trip for nothing.
  const ref  = String(b.imagePath || '').trim();
  let refToken = String(b.refToken || '').trim();
  if (!note && !b64 && !ref && !refToken) {
    throw Object.assign(new Error(I18N.t('describe an outfit or add a photo')), { status: 400 });
  }

  // The engines fetch their references over the internet, so either way the picture goes to
  // R2 first - ours, the one host (lib/helpers.js, uploadToPublicHost). A photo brought from
  // this computer is also kept under a token until the lookbook exists, and then filed in the
  // library (_fileRef). The token instead of the bytes is that same photo again - which is what
  // a second attempt sends.
  let photoUrl = '';
  let fresh = false;
  try {
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
    const plan = await _readLookbookIdea(note, photoUrl);
    if (!plan.ok) throw Object.assign(new Error(plan.why), { status: 400, refused: true });

    const mode = photoUrl ? (note ? 'edit' : 'extract') : 'draw';
    const prompt = plan.prompt + (plan.kind === 'costume' ? MASCOT_TAIL : KNOLL_TAIL);
    const taskId = await _lbTask(prompt, photoUrl ? [photoUrl] : []);
    if (!taskId) throw Object.assign(new Error(I18N.t('the engine did not accept the task')), { status: 502 });
    // What filing it will need when it lands - the fields _fileGenerated reads. A
    // picture that came by its path is where it was made from; one that came as bytes is filed in
    // Images when the lookbook lands (_fileRef) and says so then.
    const file = {
      prompt, description: plan.description, refToken,
      refName: String(b.refName || ''), ...(ref && !refToken ? { from: ref } : {}),
    };
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

// Crop a generated frame into a NEW file. Generation is not always obedient — a
// half-body request can come back knees-up — and a crop fixes the shot for nothing
// and instantly, where a re-roll costs money and throws the dice again.
//
// The rect arrives as FRACTIONS of the source, so the client never has to know the
// real pixel size or worry about how the preview letterboxes it. The result keeps its
// own pixels: no upscale, no interpolation, and the honest size comes back with it.
const CROP_MIN = 1 / 3;    // at least a third of each side, or the crop is mush

const _cleanText = (s) => String(s || '').replace(/^["'`\s]+|["'`\s]+$/g, '').trim();

// Pull the labelled blocks out of the analysis. Anything the model puts before the
// first label is kept as LIGHTING.
const _BLOCK_KEYS = ['POSE', 'CHARACTER', 'CLOTHES', 'ENVIRONMENT', 'LIGHTING', 'DIRECTION'];
// The garments of the CLOTHES block, one per line, each with where it is worn in front of it
// Kept as lines because the frame prompt picks among them by where they are.
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

// ── Environments ────────────────────────────────────────────────────────────
// ONE place, photographed empty, that a person is later put into to speak to the camera. Made
// the way a lookbook is: the agent reads what it was given first, and only then is a picture
// paid for.
//
// 3:2. An environment is not one frame but a set to take
// frames FROM: a wide room gives several different vertical 9:16 frames - by the window, in the
// middle, by the wall - with the same place and the same light, so the fragments of a video stop
// looking identical.
//
// 2K: nano-banana-2's 2K is 2528x1696 and clean at 100%.
// A frame is DRAWN with the environment as its reference, not cut out of it,
// so the place has to be right more than it has to be enormous.
const ENV_ASPECT = '3:2';
const ENV_RES = '2K';
const ENV_RATIO = 3 / 2;

// Said after whatever the agent wrote, so no rewrite of the words can lose it. The EMPTY rule is
// the one in capitals: a person left in the place is a second person in every frame made from it.
//
// The reasons behind every clause: a PHOTOGRAPH being
// taken - where the camera stands and with what lens, verticals straight - because camera words
// steer realism better than quality words; the light of the place itself and no grading, because
// staged light is the showroom look; and SURFACES, because a wide scene is exactly where a model
// trades texture for mood unless it is told what each surface is made of. Nothing says "as taken
// on a smartphone": a phone's own processing smooths fine texture away, and the textures swim.
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

// THE TAIL OF A CHANGE. ENV_TAIL describes a photograph being TAKEN - a 28mm lens at
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
 * the agent would reach for is exactly the unpredictable part. So it names
 * a few; the person picks any number; this is called again with those, and only that call writes
 * a prompt. A caller that cannot show the choice does not offer it, and then the agent picks the
 * single best place itself.
 *
 * CONTINUING A PICTURE. The model has no mask, so "extend this" is said in words - and said
 * briefly: the part of the picture that exists is kept as it is, and it goes on in the same style,
 * light and perspective. The agent is not asked to describe the new part at length; the more it
 * invents there in words, the more the model redraws what was already right.
 *
 * CHANGING AN ENVIRONMENT is the same lesson: the prompt is a SHORT instruction -
 * what changes and where, and what stays - not the whole place described again, which the model takes as a picture to
 * draw anew, so every change would redraw everything and a chain of changes would be a copy of a copy. Google's guide for
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
  // Everything in English, whatever the person typed in.
  // ...but "why" and the places offered are said to the person, in the interface's language.
  rules.push(I18N.lang() === 'en'
    ? 'Write everything in English - the prompt, the description, "why" and any options - whatever language the person wrote in.'
    : 'Write the prompt and the description in English, whatever language the person wrote in; write "why" and any options in ' + I18N.langName() + '.');
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
  if (!m) throw new Error(I18N.t('the agent did not answer with a plan'));
  let plan;
  try { plan = JSON.parse(m[0]); } catch (e) { throw new Error(I18N.t('the agent answered with something unreadable')); }
  if (!plan || plan.ok === false) {
    return { ok: false, why: String((plan && plan.why) || I18N.t('that does not describe a place')).trim() };
  }
  if (plan.choose) {
    const options = (Array.isArray(plan.options) ? plan.options : [])
      .map(o => String(o || '').trim()).filter(Boolean).slice(0, 6);
    // Asked when it may not be - or asked with nothing to pick from. Either way there is no
    // place to make and no question the panel can put, so it is said as a failure.
    if (!canChoose || !options.length) throw new Error(I18N.t('the agent could not decide what place to make'));
    return { ok: true, choose: true, why: String(plan.why || '').trim(), options };
  }
  const prompt = String(plan.prompt || '').trim();
  if (!prompt) throw new Error(I18N.t('the agent wrote no prompt'));
  return { ok: true, prompt, description: String(plan.description || '').trim() };
}

const _envTask = (prompt, urls) => (urls.length
  ? _i2i(prompt, urls, ENV_ASPECT, ENV_RES)
  : _t2i(prompt, ENV_ASPECT, ENV_RES));

// ── The picture somebody brought ────────────────────────────────────────────
// A photo uploaded into a maker is kept for two reasons: a second pass must not send it again
// (the environment's choice of places), and once something has been MADE from it, it is filed in
// the library - Images, under uploads_lookbooks or uploads_environments.
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
// aggregators take (lib/image-in.js): an AVIF sent as it is, named .heic, is answered "File type
// not supported" by kie after the press.
async function _takeUpload(dataUrl) {
  const raw = String(dataUrl || '').replace(/^data:[^;,]*;base64,/i, '');
  const got = Buffer.from(raw, 'base64');
  if (!got.length) throw Object.assign(new Error(I18N.t('unreadable photo')), { status: 400 });
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
  if (!file) throw Object.assign(new Error(I18N.t('the photo is no longer here - add it again')), { status: 400, gone: true });
  const buf = fs.readFileSync(file);
  let url = _refUrls.get(token);
  if (!url) {
    // Stashed by _takeUpload, so already in a format the aggregators take.
    url = await H.uploadToPublicHost(buf, { ext: path.extname(file).slice(1) });
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
//     { prompt, imageBase64 | refToken | imagePath, choices? }
//   -> 400 { error, refused }                           the agent said there is nothing to make
//   -> 200 { choose:true, why, options, refToken }      pick places first; nothing was paid for
//   -> 200 { mode, taskId, prompt, description, refToken }
//
// `choices` present - even empty - says the page can show a choice of places. Absent, the agent
// picks a place itself.
//
// `imagePath` is an environment to CHANGE.
async function _submitEnv(b) {
  let token = '';
  let fresh = false;                             // the photo came in THIS call
  const note = String(b.prompt || '').trim();
  const saved = String(b.imagePath || '').trim();
  const canChoose = Array.isArray(b.choices);
  const choices = canChoose ? b.choices.map(c => String(c || '').trim()).filter(Boolean).slice(0, 6) : [];
  if (!note && !b.imageBase64 && !b.refToken && !saved) {
    throw Object.assign(new Error(I18N.t('describe a place or add a photo')), { status: 400 });
  }
  if (saved && !note && !b.imageBase64 && !b.refToken) {
    throw Object.assign(new Error(I18N.t('say what to change in this environment')), { status: 400 });
  }

  try {
    // The picture, and where it came from: a photo brought now, the same photo again, or an environment
    // already on the shelf.
    let url = '';
    let source = '';
    let shape = null;
    if (b.imageBase64 || b.refToken) {
      fresh = !!b.imageBase64;
      const up = fresh ? await _takeUpload(b.imageBase64) : await _reuseUpload(String(b.refToken));
      token = up.token;
      url = up.url;
      source = 'photo';
      const s = await _sizeOf(up.buf);
      shape = _envShape(s.w, s.h);
    } else if (saved) {
      url = await _hostLocal(saved, { verify: true });
      source = 'saved';
      const hit = _resolveMedia(saved);
      const s = hit ? await _sizeOf(hit.abs) : { w: 0, h: 0 };
      shape = _envShape(s.w, s.h);
    }

    const plan = await _readEnvironmentIdea({ note, imageUrl: url, source, shape, choices, canChoose });
    if (!plan.ok) {
      if (token) _unstash(token);
      throw Object.assign(new Error(plan.why), { status: 400, refused: true });
    }
    if (plan.choose) return { choose: true, why: plan.why, options: plan.options, refToken: token };

    // A place picked for a picture that had none keeps the picture only for its atmosphere.
    const mode = choices.length ? 'picked' : source === 'saved' ? 'edit' : source === 'photo' ? 'photo' : 'draw';
    // A change keeps the picture's own camera and light: its tail does not describe the photograph again.
    const prompt = plan.prompt
      + (mode === 'edit' ? ENV_KEEP + ENV_EDIT_TAIL + _envEditFrame(shape) : '')
      + (mode === 'picked' && url ? ENV_MOOD_ONLY : '')
      + (mode === 'edit' ? '' : ENV_TAIL);
    const taskId = await _envTask(prompt, url ? [url] : []);
    if (!taskId) throw Object.assign(new Error(I18N.t('the engine did not accept the task')), { status: 502 });
    console.log(`[scen3/gen/env] mode=${mode} aspect=${ENV_ASPECT} res=${ENV_RES}`
      + (shape && shape.extend && mode !== 'picked' ? ` extend=${shape.extend}` : '') + (choices.length ? ` picked=${choices.length}` : ''));
    // An environment changed by its path is where the place was made from (a photo as bytes is filed
    // in Images when the place lands, _fileRef, and says so then).
    const from = saved;
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
   PLACE and not to a project: every talking head set here animates the same
   way, so it lives beside the picture in scen3-env-meta.json and every project reads it.

   With `motion` in the body it is written as given - that is the Library's environment column, "how it
   moves", edited by hand. Without it the agent looks at
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
// route below, and by a clip about to be made in a place nobody has looked at yet -
// a fragment's own `make clip` must not render before that analysis exists.
function _keepEnvMotion(url, motion) {
  const meta = SHELF_META.read('environments');
  const entry = { ...(meta[url] || {}), motion: String(motion || ''), motionAt: new Date().toISOString() };
  meta[url] = entry;
  SHELF_META.write('environments', meta);
  return entry;
}
const _envMotionOf = (url) => String((SHELF_META.read('environments')[String(url || '')] || {}).motion || '');
// ONE ANALYSIS PER PLACE AT A TIME: several clips started together on a place with no
// motion yet all wait for the same answer, rather than each asking the agent for its own.
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
    if (!motion) throw new Error(I18N.t('the agent said nothing about this place'));
    return _keepEnvMotion(url, motion);
  })().finally(() => { _envMotionAsking.delete(key); });
  _envMotionAsking.set(key, p);
  return p;
}

router.post('/scen3/env/motion', async (req, res) => {
  try {
    const b = req.body || {};
    const url = String(b.path || '').trim();
    if (!url) return res.status(400).json({ success: false, error: I18N.t('path is required') });
    // The picture has to be one on the environments shelf: the store is keyed by address, and an
    // entry under an address that is not a place would never be read by anything.
    const hit = _resolveMedia(url);
    if (!hit || !fs.existsSync(hit.abs)) return res.status(404).json({ success: false, error: I18N.t('no such picture') });
    if (!hit.abs.startsWith(path.resolve(CFG.ENVIRONMENTS_DIR) + path.sep)) {
      return res.status(400).json({ success: false, error: I18N.t('that picture is not an environment') });
    }

    let given = typeof b.motion === 'string' ? _cleanText(b.motion).slice(0, 600) : null;
    // Typed in another language, it is kept in English - it goes into the clip's prompt.
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
// point.
//
// `where` is what the panel says about itself - the project, the step, the level inside it - so
// the row in the journal can take you back to where the work was started.
const JOBS = require('../lib/gen-jobs');
// The journal itself, for the two questions the routes ask of it directly: is a clip of this
// fragment already running, and - when a clip is re-asked with fresh links - which task the record
// is now following (lib/alerts.js).
const ALERTS = require('../lib/alerts');
const REFUSAL = require('../lib/gen-refusal');
// The project's own timeline is a mirror of its lines (lib/frag-mirror.js): every
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
    title: String(b.title || '').trim() || (WHAT_TITLE[type] ? I18N.t(WHAT_TITLE[type]) : type),
    where: b.where,
    engine: out.engine || '',
    taskIds: [out.taskId],
    job: { type, params: { request: _retryRequest(b, out), file: out.file || {} } },
  });
}

// The look a project asked for is written into that project's casting here, because by the time it
// lands the page that asked may be closed. Through the cast route's own move (_applyCast) - its character with
// it - and NOT when it would put work aside: that is asked of the person
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
  if (saved && !asked) _nameForCast(projectId);
  return saved;
}
// A character's name as the Characters shelf has it now.
function _charNameOf(id) {
  const chars = _read(path.join(DATA_DIR, 'characters.json'));
  const arr = Array.isArray(chars) ? chars : [];
  const ch = arr.find(c => String(c.id) === String(id || ''));
  return ch ? String(ch.name || '') : '';
}

// The three kinds Merge starts, and what finishing each one means. The waiting is the same for all
// three - ask kie about the task, and the answer lands in media/work.
const _pollTask = (rec) => H.resolveTask(rec.taskIds[0], CFG.MEDIA.work, 'generated');
const _fileParams = (rec) => ((rec.job || {}).params || {}).file || {};

// A maker's row has its task from the start (Merge, "try again"). One with none was written at the press before its
// task was asked for and left so when the app closed: it fails in words, never asked for again by itself.
function _pollMaker(rec) {
  if (rec.taskIds && rec.taskIds[0]) return _pollTask(rec);
  return { state: 'failed', error: I18N.t('the app was closed before the picture was asked for - try again') };
}

JOBS.register('lookbook', {
  poll: _pollMaker,
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
  file: async (rec, landed) => {
    const filed = await _fileGenerated('environment', landed.imagePath, _fileParams(rec));
    return { path: filed.path, preview: filed.preview, from: filed.from || '', media: 'image' };
  },
  submit: async (request) => {
    const out = await _submitEnv(request);
    // A picture with no place in it asks a question instead of making anything, and a question
    // cannot be answered without the person.
    if (out.choose) throw new Error(I18N.t('that picture has no place in it - pick one on the page'));
    return { taskId: out.taskId, engine: out.engine, file: out.file };
  },
});

JOBS.register('look', {
  poll: _pollTask,
  file: async (rec, landed) => {
    const p = _fileParams(rec);
    const saved = await _saveObraz({ ...p, imagePath: landed.imagePath });
    // Dressed for a project, so that project wears it - even with nobody looking. As the cast route casts it,
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
  if (!base) throw Object.assign(new Error(I18N.t('basePath is required')), { status: 400 });
  if (!lb && !note) throw Object.assign(new Error(I18N.t('pick a lookbook or write a note')), { status: 400 });
  // A note in another language goes into the picture's prompt in English.
  if (note) {
    const t = await _englishText(note);
    if (t.fail) throw Object.assign(new Error(I18N.t('the note {why}', { why: t.fail })), { status: 502 });
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

  // keep the output in the base image's shape (a 16:9 sheet must stay 16:9); kie calls "follow the input" `auto`
  const aspect = (await _ratioOf(base)) || 'auto';
  // 4K: the result is a reference sheet every frame of the ad is built from, so it is
  // the one picture in the chain that must not be soft.
  const taskId = await _i2i(prompt, urls, aspect, DRESS_RES);
  if (!taskId) throw Object.assign(new Error(I18N.t('the engine did not accept the task')), { status: 502 });
  console.log(`[scen3/gen/dress] ${lb ? 'apply' : 're-dress'} kind=${kind} refs=${urls.length} res=${DRESS_RES}`);
  return {
    taskId, kind, prompt, mode: lb ? 'apply' : 'redress',
    // WHICH ENGINE MADE IT, for the look's record - said by the route that made it, not by the
    // engine setting a page may still send when it saves the look.
    engine: IMG_ENGINE,
    // A dressed picture is filed as a LOOK on the character, and when the dressing was asked for
    // by a project, that project wears it from then on.
    file: {
      charId: String(b.charId || ''), charName: String(b.charName || I18N.t('look')),
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
// Dressed looks join the character's own library, so they show up on the Library's
// Characters shelf too. Writes are APPEND-ONLY and done here, on the server, so a racing writer cannot drop
// entries.
const OBRAZY_JSON = path.join(DATA_DIR, 'obrazy.json');
const OStore = require('../lib/obrazy-store');

// Filing a dressed picture as a look. A FUNCTION, not only a route: when the dressing is started
// from Merge the server finishes it itself (lib/gen-jobs.js), and that path must file it exactly
// the way the route does.
async function _saveObraz(b) {
  const charId   = String(b.charId || '');
  const charName = String(b.charName || I18N.t('look'));
  const src      = String(b.imagePath || '');
  if (!charId) throw Object.assign(new Error(I18N.t('charId is required')), { status: 400 });

  const hit = _resolveMedia(src);
  if (!hit || !fs.existsSync(hit.abs)) throw Object.assign(new Error(I18N.t('image not found')), { status: 400 });

    // Refuse to touch the library if it exists but cannot be parsed — appending
    // to a fresh array would silently wipe every obraz the user owns.
  let list = [];
  if (fs.existsSync(OBRAZY_JSON)) {
    const parsed = _read(OBRAZY_JSON);
    if (!Array.isArray(parsed)) {
      throw Object.assign(new Error(I18N.t('obrazy.json is unreadable - refusing to write')), { status: 500 });
    }
    list = parsed;
  }

  const id   = String(Date.now());
  const name = I18N.t('{name} - look {day}', { name: charName, day: new Date().toISOString().slice(0, 10) });
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
  console.log(`[scen3/look] char=${charId} obraz=${id} -> ${rel} (library now ${list.length})`);
  return { obrazId: id, path: rel, preview };
}


// ── Filing a finished picture ───────────────────────────────────────────────
// Filing a finished picture where it belongs: a lookbook or an environment onto its shelf, with its
// description, the photo it was made from and a preview for the centre column. A FUNCTION for the
// same reason _saveObraz is one - a generation started in Merge is finished by the server
// (lib/gen-jobs.js), and it has to be filed exactly as the route files it.
async function _fileGenerated(kind, src, b) {
  const hit = _resolveMedia(src);
  if (!hit || !fs.existsSync(hit.abs)) throw Object.assign(new Error(I18N.t('result not found')), { status: 400 });

  // A generated environment or lookbook is filed into its shared library folder.
  const LIB = kind === 'environment'
    ? { dir: CFG.ENVIRONMENTS_DIR, mount: toUrl(CFG.ENVIRONMENTS_DIR), prefix: 'env_' }
    : { dir: CFG.LOOKBOOKS_DIR, mount: toUrl(CFG.LOOKBOOKS_DIR), prefix: 'lb_' };

  const name = LIB.prefix + path.basename(hit.abs).replace(/\.[^.]+$/, '') + '.jpg';
  const dest = path.resolve(LIB.dir, name);
  fs.mkdirSync(LIB.dir, { recursive: true });
  if (!fs.existsSync(dest)) fs.copyFileSync(hit.abs, dest);
  const finalUrl = LIB.mount + '/' + name;
  try { await H.createThumbnail(dest, path.resolve(LIB.dir, 'thumbs', name)); } catch (e) {}

  // The photo it was made from, now that there is something made from it: into Images, and its
  // address beside the description, so the viewer can say what this came from.
  let from = '';
  if (b.refToken) {
    try { from = await _fileRef(String(b.refToken), kind, String(b.refName || '')); }
    catch (e) { console.warn('[scen3/file] could not file the reference:', e.message); }
  }
  // A picture that came by its path is in the library already.
  if (!from && b.from) from = String(b.from);

  if (kind === 'lookbook') {
    // The gender the caller resolved in parallel with the generation, and WHAT THIS IS: the
    // long description the agent wrote, filed here because this is where the picture gets
    // its final path - the key everything else refers to it by. A lookbook may have no
    // entry at all.
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
    // The same for a place: what the agent wrote about it is what its frames will be
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
  } catch (e) { console.warn('[scen3/file] preview failed:', e.message); }

  return { path: finalUrl, preview: previewUrl, ...(from ? { from } : {}) };
}

// ── voice moods ─────────────────────────────────────────────────────────────
// A mood (lib/motion-presets.js, MOODS) is what the person picks in setup's mood & voice;
// its `tags` are the ONLY ones the tagging pass may insert. The set is deliberately small:
// a short vocabulary is placed far more consistently than a menu of two hundred, and a tag
// the model does not know risks being SPOKEN instead of performed.
const MP = require('../lib/motion-presets');
const TH = require('../lib/th-video');
// The rules and the limit of an OmniHuman line's prompt.
const OMNI = require('../lib/omni-prompt');
// The English check and translation of typed lines and prompts (english, toEnglish, toEnglishLines).
const AGENT = require('../lib/mv3-agent');
const VF = require('../lib/voice-filters');
const VD = require('../lib/voice-demo');
const VSHELF = require('../lib/voice-shelf');


// What the menus of setup and Home's quick start offer: the models of the clips, each with its qualities and what a
// second of them costs (lib/th-video.js), and the moods. No defaults: a new project starts at none and the person
// chooses.
router.get('/scen3/motion-presets', (_req, res) => {
  res.json({
    success: true,
    models: TH.models(),
    moods: MP.MOODS.map(m => ({ id: m.id, label: I18N.t(m.label), about: I18N.t(m.about) })),
  });
});

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

// The role the tagging pass is given. A model told to "add tags" decorates; a model
// told it is casting a performance asks what each line is DOING first.
const CASTING_DIRECTOR_ROLE =
  'You are a casting director preparing a script for ElevenLabs v3 text-to-speech. '
  + 'You hear a performance in your head and you mark it up so a voice actor could hit it. '
  + 'You are not decorating the text: every tag you place must earn its place by changing '
  + 'how a specific phrase is delivered. Sentences that read fine plainly stay plain.';

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
  return CASTING_DIRECTOR_ROLE
    + `\n\nMOOD: ${mood.label}\n${mood.brief}`
    + `\n\nYou may use ONLY these tags, spelled exactly like this: ${tags}`
    + '\n\nRules:'
    + '\n- NEVER change, add, remove or reorder a single word. Punctuation stays exactly as it is.'
    + ' You are only inserting [tags] between the existing words.'
    + '\n- A tag goes immediately before the words it affects.'
    + (mood.voiceover
      // A voiceover is often ONE long line: tags go by its sentences, or the mood would be one tag deep.
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
    throw new Error(got
      ? I18N.tn(got.length, 'the model returned {n} lines for {m}', 'the model returned {n} lines for {m}', { m: texts.length })
      : I18N.t('the model returned no lines for {m}', { m: texts.length }));
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
  return CASTING_DIRECTOR_ROLE
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
  if (!arr) throw new Error(I18N.t('the model returned no lines'));
  const out = {};
  arr.forEach(e => {
    const n = parseInt((e && e.n), 10);
    if (Number.isInteger(n) && want.includes(n - 1)) out[n - 1] = String((e && e.text) || '');
  });
  const missing = want.filter(i => out[i] === undefined);
  if (missing.length) throw new Error(I18N.t('no answer for line(s) {list}', { list: missing.map(i => i + 1).join(', ') }));
  return out;
}

// The tags are written into the lines by their numbers when the tagger answers: a line put in meanwhile
// waits (_holdLines).
router.post('/scen3/voice/tag', async (req, res) => {
  const free = _holdLines((req.body || {}).projectId);
  try { await _tagRoute(req, res); } finally { free(); }
});
async function _tagRoute(req, res) {
  try {
    const id = String((req.body || {}).projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: I18N.t('projectId is required') });

    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('no project "{id}"', { id }) });

    // A line TAKEN OFF the script is tagged with the rest, and deliberately: tags belong
    // to the WORDS, not to the cut, so a line put back comes back already marked and needs no
    // second pass. It costs nothing - it is the same one call - and the zone that asks for the
    // tagging counts only the lines that are in the video when it decides it is done.
    const lines = (proj.lines || []).map(_normLine);
    const texts = lines.map(l => l.text);
    if (!texts.some(t => t.trim())) return res.status(400).json({ success: false, error: I18N.t('this project has no lines') });

    const voice = _normVoice(proj.voice);
    // The mood of the VIDEO, always: one vocabulary for the read, the frames and the animation
    // (lib/motion-presets.js). Every line touched gets its words
    // back as `tagged`, marked or not, so the tagged read IS the read and the project is switched
    // to it.
    const vm = req.body.mood ? MP.moodById(String(req.body.mood)) : null;
    if (!vm) return res.status(400).json({ success: false, error: req.body.mood ? I18N.t('no such mood') : I18N.t('a mood is needed') });
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
        lastErr = I18N.t('the wording changed on line(s) {list}', { list: changed.map(i => i + 1).join(', ') });
        console.warn(`[scen3/voice/tag] attempt ${attempt}: ${lastErr}`);
        if (attempt === 2) got = answer;      // keep it; the mismatched lines fall back below
      } catch (e) {
        lastErr = e.message;
        console.warn(`[scen3/voice/tag] attempt ${attempt} failed: ${e.message}`);
      }
    }
    if (!got) return res.status(502).json({ success: false, error: lastErr || I18N.t('the tagging pass failed') });

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
      l.tagged = kept.text;
      if (has) report.tagged++; else report.plain++;
    });

    // The tagger thought for a while, and reads and clips write this project meanwhile:
    // the record is read AGAIN and only the tags of the lines this pass touched are put on it.
    const saved = PROJECTS.apply(id, (fresh) => {
      fresh.lines = (fresh.lines || []).map(_normLine);
      for (const i of touch) if (fresh.lines[i]) fresh.lines[i].tagged = lines[i].tagged;
      fresh.voice = _normVoice({ ...(fresh.voice || {}), ...voice });
      // v3 from here on: the tagged read is what every line is spoken from.
      fresh.voice.tagsOn = true;
      fresh.voice.variant = 'tagged';
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
  return String(s.elevenLabsApiKey || '').trim();
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

// A voiceover is read in the language it is written in: Cyrillic - Russian, plain English letters only - English,
// anything else (Spanish with its ñ, German with its ü...) - nothing said, v3 decides by itself. A talking head's lines are
// always English.
const _langOfText = (t) => {
  const s = String(t || '').replace(/\[[^\]]*\]/g, ' ');           // the mood's [tags] are English whatever the line is
  if (/\p{Script=Cyrillic}/u.test(s)) return 'ru';
  return /\p{L}/u.test(s) && !/[^\x00-\x7F]/.test(s.replace(/[‘’“”–—… ]/g, '')) ? 'en' : null;
};
// A voiceover's line, at most: ElevenLabs v3 reads 5 000 characters at a time, tags included - 500 are
// left for the mood's tags. The page's fields stop at it too.
const VO_MAX = 4500;

async function _speakLine(key, voiceId, model, text, params, lang) {
  const code = lang === undefined ? 'en' : lang;
  const r = await axios.post(
    `${EL_TTS_BASE}/${encodeURIComponent(voiceId)}`,
    {
      text,
      model_id: model,
      // Every line is English, and v3 is told so - its accent does not drift with a name or a loan word.
      // multilingual_v2 does not take the code (ElevenLabs' reference) and is sent nothing. A voiceover's
      // line says its own (`lang`).
      ...(model === EL_MODEL_TAGGED && code ? { language_code: code } : {}),
      voice_settings: {
        stability: typeof params.stability === 'number' ? params.stability : 0.5,
        similarity_boost: 0.75,
        // Always 1: v3 takes no speed, so the project's speed is applied to the file afterwards (_tempo).
        speed: 1,
      },
    },
    // Two minutes for a line of a talking head; a voiceover's line of up to 4 500 characters (~5 minutes of speech)
    // is given longer by its length.
    { headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      responseType: 'arraybuffer', timeout: Math.max(120000, String(text || '').length * 80) },
  );
  return Buffer.from(r.data);
}

/* ── The read, and who drives it ─────────────────────────────
   POST /api/scen3/voice/speak      { projectId, only? }  -> { success, project, report }
   POST /api/scen3/voice/speak-all  { projectId }         -> { success, queued, state }
   GET  /api/scen3/voice/state      ?projectId=           -> { success, state }

   The SERVER reads the script, not the page: a page driving it a few lines per call would leave the
   rest unread when it is left mid-read. `speak-all` works out what needs reading, answers at once,
   and starts one line a second without waiting for the ones already going. The page follows `state`.

   Reads are NOT in the journal: a dozen quick rows would bury the things worth
   waiting for, and the wait shown is measured from that journal. The progress lives in memory and
   the truth lives in the project, so closing the app mid-read keeps every take already spoken and
   simply leaves the rest unread - one press finishes them.
   ─────────────────────────────────────────────────────────────────────────── */
const READ_GAP_MS = 1000;
// HOW MANY MAY BE SPEAKING AT ONCE: ElevenLabs refuses a run past its limit of five. The queue
// starts a line a second and waits for none of them, so a script of ten with a six-second read
// would have seven in the air. Four, not five: a line read by hand
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
    // cast, or for a character without a voice. One ad, one voice, and the same rule
    // the page shows (_castVoiceOf). Saying plainly what is missing beats a 404 from ElevenLabs.
    cast: _castVoiceOf(proj),
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
  // Through the gate: at most four of these are inside ElevenLabs at any moment. Everything
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
  // line's until a new one is made.
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
    stability, speed,                     // what it was spoken with
  };
  return { take: _fileTake(ctx, i, take, '', keep) };
}

// The take goes onto its line in one tick, and the timeline follows.
// `keep`: the read is redone only because the stability or the speed
// changed - the same words - so the clip the line has now (chosen by hand, else the last made from this
// frame and this read) is CHOSEN for it and stays on the timeline with its own sound until a new clip is
// made. Otherwise a new read is asked for a new performance and the choice goes.
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
    // A VOICEOVER DRAFT IS A PROJECT FROM ITS FIRST READ: the reads are its files. Its name - the
    // scenario's or the text's - and its folder were given when its script was chosen (/scen3/projects/:id/script).
    if (fresh.draft) delete fresh.draft;
    if (held) l.chosen = { ...(l.chosen || {}), [ctx.variant]: held };
    else if (l.chosen) l.chosen = { ...l.chosen, [ctx.variant]: '' };
    fresh.updatedAt = take.at;
  });
  // The timeline mirrors the lines - unless the caller re-lays it once itself, after several (`quiet`).
  if (saved && !quiet) MIRROR.touch(saved.id, { project: saved });
  return take;
}

// A READ AT ANOTHER SPEED: ffmpeg's atempo keeps the pitch of the voice. The copy is
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
      : reject(new Error(err ? I18N.t('the read could not be retimed: {why}', { why: err.trim().slice(0, 160) }) : I18N.t('the read could not be retimed')))));
  });
}

// Was this line read with the settings the project has now? A take that records no settings was spoken at
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
  if (!rawAbs || !fs.existsSync(rawAbs)) throw new Error(I18N.t('the original read is gone - read the line again'));
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
// `settle` (the voice field's own `generate`) counts in the lines read with other settings
// too; the chain and every other caller read only what is not read.
function _readWanted(ctx, only, settle) {
  const live = (i) => !(ctx.lines[i] || {}).removed;      // a line taken off is not read
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
// button, or an explicit list. Each read lands on its line by number: a line put in meanwhile waits.
router.post('/scen3/voice/speak', async (req, res) => {
  const free = _holdLines((req.body || {}).projectId);
  try { await _speakRoute(req, res); } finally { free(); }
});
async function _speakRoute(req, res) {
  try {
    const b  = req.body || {};
    const id = String(b.projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: I18N.t('projectId is required') });
    const key = _elKey();
    if (!key) return res.status(400).json({ success: false, error: I18N.t('no ElevenLabs key in settings') });
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('no project "{id}"', { id }) });

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
    // without the gap, which is there for ElevenLabs.
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
    if (!id) return res.status(400).json({ success: false, error: I18N.t('projectId is required') });
    const key = _elKey();
    if (!key) return res.status(400).json({ success: false, error: I18N.t('no ElevenLabs key in settings') });
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('no project "{id}"', { id }) });
    const now = _reads.get(id);
    if (now && now.running) return res.json({ success: true, queued: 0, already: true, state: now });

    const ctx = _readCtx(proj);
    if (!ctx.cast.has) return res.status(400).json({ success: false, error: ctx.cast.reason });
    const only = _readWanted(ctx, b.only, !!b.settle);
    if (!only.length) return res.json({ success: true, queued: 0, state: null });

    const st = {
      total: only.length, done: 0, skipped: [], failed: [], running: true,
      startedAt: new Date().toISOString(), endedAt: null, variant: ctx.variant,
      only,                                  // which lines, so a line cannot be taken off mid-read
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

/* ── The speed of the read, applied at once ──────────────────
   POST /api/scen3/voice/speed  { projectId, speed }               the project's speed
                                { projectId, line, lineSpeed }     a line's own speed; null - back to the project's
   -> { success, project, retimed, failed }

   The speed is ours, not ElevenLabs' (_tempo), so a new one costs nothing and takes a moment: it is saved,
   and every read line whose take is at another speed is retimed from its original before the answer - the
   timeline follows (MIRROR in _fileTake), and a line with a clip keeps that clip until a new one is made.
   ───────────────────────────────────────────────────────────────────────────────────────────── */
// The retimed reads land on their lines by number: a line put in meanwhile waits.
router.post('/scen3/voice/speed', async (req, res) => {
  const free = _holdLines((req.body || {}).projectId);
  try { await _speedRoute(req, res); } finally { free(); }
});
async function _speedRoute(req, res) {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: I18N.t('projectId is required') });
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('no project "{id}"', { id }) });
    const hasLine = b.line !== undefined && b.line !== null;
    const li = parseInt(b.line, 10);
    if (hasLine && !(li >= 0 && li < (proj.lines || []).length)) return res.status(400).json({ success: false, error: I18N.t('no such line') });
    if (!hasLine && !(Number(b.speed) > 0)) return res.status(400).json({ success: false, error: I18N.t('speed is required') });
    const st = _reads.get(id);
    if (st && st.running) return res.status(409).json({ success: false, error: I18N.t('the script is being read - change the speed when it is done') });

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
    if (!saved) return res.status(404).json({ success: false, error: I18N.t('no project "{id}"', { id }) });

    const ctx = _readCtx(saved);
    const want = ctx.lines.map((_, i) => i).filter(i => !ctx.lines[i].removed && _unsettled(ctx.lines[i], ctx) === 'speed');
    const failed = [];
    let retimed = 0;
    await Promise.all(want.map(i => _retempoOne(ctx, i, true).then(() => { retimed++; }, (e) => {
      console.warn(`[scen3/voice/speed] line ${i + 1}:`, e.message);
      failed.push({ line: i + 1, error: e.message });
    })));
    // The timeline, re-laid ONCE and waited for (as taking a line off is): the page shows it the moment
    // the answer comes - a new speed is meant to be heard on the timeline at once.
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
// only the preview is made, exactly as _fileGenerated makes one for what it files.
async function _framePreview(finalUrl) {
  try {
    const fh = _resolveMedia(finalUrl);
    if (!fh || !fs.existsSync(fh.abs)) return finalUrl;
    if (!(await needsPreview(fh.abs))) return finalUrl;
    const out = _previewTarget(fh);
    if (!fs.existsSync(out.abs)) await makePreview(fh.abs, out.abs);
    return out.url;
  } catch (e) {
    console.warn('[scen3/frame] preview failed:', e.message);
    return finalUrl;
  }
}

// resolveTask cannot be reused here: it names every download .jpg, compresses it as an
// image and builds a thumbnail. A clip needs its own extension and its real duration.
async function _fetchClip(taskId, projectId, cutTo) {
  const r = await axios.get(`${CFG.KIE_BASE}/api/v1/jobs/recordInfo`,
    { params: { taskId }, headers: H.kieHeaders(), timeout: 15000 });
  // One reader for every kie answer - see H.readKieRecord: kie says 'fail', not 'failed', and a
  // reader that compares against the wrong word polls a dead render as "pending" until a timeout
  // instead of reporting its actual reason. `failCode` comes back too: an upload/fetch failure is retryable and the
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
  if (!url) return { state: 'failed', error: I18N.t('the render came back without a video URL') };

  const dir = PROJECTS.dirOf(projectId, 'clips');
  if (!dir) return { state: 'failed', error: I18N.t('the project is gone') };
  const name = `c${taskId}_${Date.now()}.mp4`;
  const abs = path.join(dir, name);
  const dl = await axios({ url, method: 'GET', responseType: 'arraybuffer', timeout: 180000 });
  fs.writeFileSync(abs, Buffer.from(dl.data));
  // H.264 + yuv420p + faststart, so the browser plays it and the concat demuxer can
  // later join these clips without a re-encode. A failure here is not worth losing the
  // clip over — the file is already on disk and playable in most cases.
  // A clip of a read padded to the model's shortest sound (lib/th-video.js padSecs) is cut back to the read itself in
  // the same pass. Left whole when the cut fails: the timeline lays a clip only as long as its read anyway.
  let cut = false;
  if (+cutTo > 0) {
    try { await TH.cutTo(abs, +cutTo); cut = true; }
    catch (e) { console.warn('[scen3/clip] the cut to ' + cutTo + 's failed:', e.message); }
  }
  if (!cut) {
    try { await H.normalizeVideoForBrowser(abs); }
    catch (e) { console.warn('[scen3/clip] normalize failed:', e.message); }
  }
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
// sitting on our disk - so the useful answer is to put the files up again with fresh links
// and ask again. Free, and it fixes the common case without the user pressing anything.
//
// ONE retry, recorded on the Alerts row (`refetch`) so a restart cannot reset the count.
const _FETCH_FAIL_RE = /upload failed|fetch failed|download failed|cannot (?:be )?(?:fetch|download|access)|invalid url|url is not accessible/i;

// ════════════════════════════════════════════════════════════════════════════
// PROJECTS
//
// A project is created FROM a scenario and holds a SNAPSHOT of it: the lines are
// copied in, so later edits to the library scenario never reach a project that
// is already in production. `scenarioId` is kept purely as a back-reference to
// where it came from. Several projects may come from one scenario (same script,
// different characters) — creating one never reuses an existing one.
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

/* ── WHOSE WORK IS IN THE FIELDS ─────────────────────────────────────
   A talking head's reads are its character's VOICE; its frames and its clips show its LOOK. A look of ANOTHER character cast
   PUTS ASIDE what was made - the lines' reads (with their cut silence and merges) and the voice picked by hand under the
   character, the set's frames and the lines' clips (with their prompts and the frames picked by hand) under the look - IN
   THE PROJECT ITSELF (`shelf`): the files stay in its folder, nothing is deleted, and it all comes back as it was
   when that character in that look is cast again. Another look of the SAME character puts aside its frames and clips only
   - the voice is the same. The CHOICES stay: the mood and the [tags] it marked, stability and speed, the
   model, the quality, the shot size, the spread; the voice follows the character by itself
   (_castVoiceOf). `workOf` - the look the fields' work was made for (the cast look when it is missing); `cast0` - the first
   look cast. Asked before it moves anything (POST /scen3/projects/:id/cast, below).
   ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const SHELF_READ = ['audio', 'cuts', 'merge'];                              // a line's, kept by the character
const SHELF_LOOK = ['video', 'pick', 'chosen', 'shot', 'omni', 'frameId'];  // a line's, kept by the look
const SHELF_MIX = ['variants', 'order', 'banned'];                         // the set's, kept by the look
// What a line holds when that part of it is put aside - a missing key is the line's own default (_normLine).
const SHELF_EMPTY = {
  audio: () => ({ plain: null, tagged: null }), video: () => ({ plain: [], tagged: [] }),
  pick: () => ({ plain: '', tagged: '' }), chosen: () => ({ plain: '', tagged: '' }), shot: () => null, frameId: () => '',
};
const SHELF_MIX_EMPTY = { variants: () => [], order: () => [], banned: () => [] };

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

// What is in the fields now, counted the way the question says it: the lines read, the frames of the set, the clips.
function _workCount(p) {
  const lines = (Array.isArray(p.lines) ? p.lines : []).map(_normLine);
  return {
    reads: lines.filter(l => (l.audio.plain && l.audio.plain.path) || (l.audio.tagged && l.audio.tagged.path)).length,
    frames: _normMix(p.mix).variants.length,
    clips: lines.reduce((n, l) => n + l.video.plain.length + l.video.tagged.length, 0),
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
    const any = b.mix.variants.length || lines.some(l => l.video.plain.length || l.video.tagged.length
      || (l.shot && l.shot.motion) || (l.omni && l.omni.prompt) || l.frameId || l.pick.plain || l.pick.tagged || l.chosen.plain || l.chosen.tagged);
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
  // The first look cast - for a project with none recorded, the one there was when the first change came.
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
// The project's frames: every frame made for it, the order they were dragged into,
// the banned ones and the format they are drawn in. Kept on the project, so closing
// the app and coming back restores exactly what was there.
const MIX_FORMATS = ['9:16', '2:3', '3:4', '1:1', '16:9'];

function _normMix(m) {
  const s   = (m && typeof m === 'object') ? m : {};
  const set = (s.settings && typeof s.settings === 'object') ? s.settings : {};
  return {
    settings: {
      format: MIX_FORMATS.includes(set.format) ? set.format : '9:16',
    },
    // every frame ever generated here; banning one only tags it (`banned`)
    variants: Array.isArray(s.variants) ? s.variants.map(v => ({
      id:      String((v && v.id) || ''),
      path:    String((v && v.path) || ''),
      preview: String((v && v.preview) || ''),
      prompt:  String((v && v.prompt) || ''),
      at:      String((v && v.at) || ''),
      // Which generation produced it: the key that makes filing the same task a
      // second time a no-op instead of a duplicate.
      taskId:  String((v && v.taskId) || ''),
      // Where a cropped frame came from, and which part of it was taken. Without this
      // two near-identical frames in the strip are indistinguishable a day later.
      croppedFrom: String((v && v.croppedFrom) || ''),
      crop:    (v && v.crop && typeof v.crop === 'object')
        ? { x: +v.crop.x || 0, y: +v.crop.y || 0, w: +v.crop.w || 0, h: +v.crop.h || 0 } : null,
      size:    (v && v.size && typeof v.size === 'object')
        ? { w: +v.size.w || 0, h: +v.size.h || 0 } : null,
      // The shot size a frame was drawn to (`framing` - the frames chat's edge); a frame of a set an agent planned
      // also says which set and its number in it - so the pool keeps the order the frames were asked in.
      set:     String((v && v.set) || ''),
      framing: String((v && v.framing) || ''),
      n:       Number.isInteger(v && v.n) ? v.n : 0,
      // The one sentence that made a frame of such a set different from the others - the head, the hands, the gaze at
      // that instant - read by the writer of the animation prompts, which is what a clip made from this frame has
      // to continue. Every other frame carries none and is read from the picture.
      moment:  String((v && v.moment) || ''),
      // A frame made to order in the frames chat: 'chat', and the chat's record it came from.
      made:    (v && v.made === 'chat') ? 'chat' : '',
      genId:   String((v && v.genId) || ''),
      // The products it was drawn with in the frames chat - { path, name, description }, at most two: the
      // clips' writers of a line that opens on it know them (_writePromptsNow, _writeSdPromptsNow).
      props:   _framePropsOf(v && v.props),
    })).filter(v => v.id && v.path) : [],
    // The order the frames were dragged into, by id. A frame not named
    // here - a new one - keeps its natural place, after the ones that were arranged.
    order: Array.isArray(s.order) ? s.order.map(String).filter(Boolean) : [],
    // A frame generation's last error; a cast clears it.
    lastError: String(s.lastError || ''),
    banned: Array.isArray(s.banned) ? s.banned.map(String) : [],
  };
}

function _normProject(p, now) {
  const src = p || {};
  return {
    id:         String(src.id != null ? src.id : Date.now()),
    casting:    _normCasting(src.casting),
    // Whose work the fields hold, the first look cast, and the work of the others put aside (_applyCast).
    ...(_normLook(src.workOf) ? { workOf: _normLook(src.workOf) } : {}),
    ...(_normLook(src.cast0) ? { cast0: _normLook(src.cast0) } : {}),
    ...(_shelfAny(_normShelf(src.shelf)) ? { shelf: _normShelf(src.shelf) } : {}),
    mix:        _normMix(src.mix),
    // How the look and the place read, for the frames of the fragments step: the person to keep,
    // the place, its light. Read once for a look and a place, and again only when either changes.
    frameRef:   _normFrameRef(src.frameRef),
    name:       String(src.name || '').trim() || I18N.t('untitled project'),
    scenarioId: src.scenarioId != null ? String(src.scenarioId) : '',
    // A voiceover is the same record with no who / where, frames or clips; everything else is a talking head.
    type:       src.type === 'voiceover' ? 'voiceover' : 'talking_head',
    // THE VOICEOVER DRAFT - one; a project once its first line is read (_fileTake).
    ...(src.type === 'voiceover' && src.draft ? { draft: true } : {}),
    gender:     String(src.gender || '').toLowerCase(),
    title:      String(src.title || ''),
    lines:      Array.isArray(src.lines) ? src.lines.map(_normLine) : [],
    voice:      _normVoice(src.voice),
    video:      _normVideo(src.video),
    vertical:   String(src.vertical || ''),
    product:    String(src.product  || ''),
    roles:      Array.isArray(src.roles) ? src.roles : [],
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
    // timestamp — that way a clip stored with no id gets one without a
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
    // ...and the model that made it (lib/th-video.js) - absent on a clip made before a second model was offered:
    // Kling avatar's.
    ...(s.model ? { model: String(s.model) } : {}),
    // A clip's poster frame. The cards show stills only — the clip itself belongs to a
    // viewer, not to a list of ten of them all decoding at once.
    thumb:   String(s.thumb || ''),
    // For an audio take: what it was spoken with, and - when it was retimed - the
    // file ElevenLabs sent, so another speed is made from it again rather than from a copy.
    // A take that carries none was spoken at natural and 1.
    ...(s.raw ? { raw: String(s.raw) } : {}),
    ...(s.stability !== undefined && s.stability !== null && s.stability !== '' ? { stability: +s.stability } : {}),
    ...(s.speed ? { speed: +s.speed } : {}),
  };
}

// EVERY render is kept as a variant — a second take on the same frame, or a take on a
// different one. Nothing is silently replaced: these are paid seconds of video, and
// judging two of them side by side is the whole point of keeping both.
const CLIPS_PER_FRAGMENT = 10;
function _normClips(v, pickId) {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  const byId = new Map();
  arr.forEach(t => {
    const c = _normTake(t);
    if (!c) return;
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
    frameId: String(s.frameId || ''),       // the first frame picked by hand (/fragments/pick-frame)
    // THE NUMBER THE LINE TAKES ITS FRAME BY, kept: given to every line when one is put in above some of
    // them (/line/insert), so the lines that moved down a place stay on their frames. Absent - its place in the list.
    ...(Number.isInteger(s.slot) && s.slot >= 0 ? { slot: s.slot } : {}),
    // TAKEN OFF THE SCRIPT. A line is never deleted: it is taken
    // off, keeps its place in this list, and can be put back. Keeping its place is the whole point
    // - a line that is not picked by hand takes its first frame from the set BY ITS NUMBER, and a
    // clip is the take made from the frame its line opens on, so closing the gap would move every
    // line below onto another frame and their clips would vanish from the fragments and from the
    // timeline while the files sat there. Nothing reads a line that is off: not the reads, not the
    // clips, not the prompts, not the mirror. The TAGGER is the one exception - see /voice/tag.
    removed: !!s.removed,
    // How this line is filmed and how the person moves on it - the directing agent's reading,
    // or null until the script has been read.
    shot:    _normShot(s.shot),
    audio:   { plain: _normTake((s.audio || {}).plain), tagged: _normTake((s.audio || {}).tagged) },
    // Clips are a LIST per variant, one per first frame. A read has a single take because
    // the words have one right sounding of them, but a fragment can legitimately have a
    // clip for each frame it has been tried on, and paying twice to see one again would
    // be absurd.
    video:   {
      plain:  _normClips((s.video || {}).plain,  (s.pick || {}).plain),
      tagged: _normClips((s.video || {}).tagged, (s.pick || {}).tagged),
    },
    // Which variant this fragment is SET to, per take. An id and not an index: variants
    // come and go, and an index would quietly come to mean a different clip.
    pick:    {
      plain:  String((s.pick || {}).plain  || ''),
      tagged: String((s.pick || {}).tagged || ''),
    },
    // A clip CHOSEN BY HAND in the fragment's takes: it is the line's clip on the
    // timeline even when it is stale - made from another frame, other words or another read. Cleared by a new clip and
    // by a new read of the line.
    chosen:  {
      plain:  String((s.chosen || {}).plain  || ''),
      tagged: String((s.chosen || {}).tagged || ''),
    },
    // The line's OWN speed, set in its fragment: the project's speed does not
    // touch it. Absent - the line reads at the project's speed.
    ...(Number(s.speed) > 0 ? { speed: _ttsParams({ speed: s.speed }).speed } : {}),
    // THE LINE'S OMNIHUMAN PROMPT (_normOmni), kept apart from Kling's `shot.motion`. Absent until it is written.
    ...(_normOmni(s.omni) ? { omni: _normOmni(s.omni) } : {}),
    // WHAT CUT SILENCE TOOK OUT OF THE LINE'S SOUND - stretches of its file, bound to the take they were cut in
    // (lib/line-cuts.js): written by a save of its timeline, laid by the mirror. Absent - the line plays whole.
    ...(require('../lib/line-cuts').normalize(s.cuts) ? { cuts: require('../lib/line-cuts').normalize(s.cuts) } : {}),
    // THE LINES MERGED INTO ONE FILE FROM THIS ONE ON - the file, its length, and each line's take and pieces
    // (lib/line-cuts.js): written by a save of the timeline, laid by the mirror as one cell while those takes stand.
    ...(require('../lib/line-cuts').normalizeMerge(s.merge) ? { merge: require('../lib/line-cuts').normalizeMerge(s.merge) } : {}),
  };
}

function _normFrameRef(r) {
  if (!r || typeof r !== 'object' || !r.look || !r.place) return null;
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  return {
    look: String(r.look), place: String(r.place),
    character: str(r.character, 1500), environment: str(r.environment, 1500), lighting: str(r.lighting, 1200),
    // One garment a line, where it is worn in front.
    clothes: str(r.clothes, 3000),
    // Which questions the reading answered: 2 when the clothes were asked for too. A reading below 2 is
    // read again once; one at 2 that simply has no clothes lines is NOT, or a look the agent
    // cannot list would cost a vision call on every set for ever.
    v: Number(r.v) || 1,
    at: str(r.at, 40),
  };
}

// A line's animation: the prompt that goes to the video model (`motion`), the agent's own last text
// for it (`motionAgent`, so a prompt edited by hand survives a new pass and can be put back), and
// what it was written FROM - the words and the mood - so a line whose words or whose video's mood
// changed since is stale, which is worked out wherever it is shown rather than stored. The frames
// are a set for the whole video, and a line only says which one it opens on.
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

// A line's OMNIHUMAN prompt (lib/omni-prompt.js), the same way as Kling's above: the prompt that goes (`prompt`, at most
// 300 characters), the agent's own last text (`agent`), whether it was edited by hand, and what it was written FROM -
// the words (`said`) and how the place moves (`place`, a fingerprint of the place's sentence) - so another wording or
// another movement of the place makes it stale (_omniStale). null while nothing is written.
function _normOmni(o) {
  if (!o || typeof o !== 'object') return null;
  const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const prompt = OMNI.fit(o.prompt);
  const agent = OMNI.fit(o.agent);
  if (!prompt && !agent) return null;
  return { prompt, agent, edited: !!o.edited, said: String(o.said || ''), place: str(o.place, 40), mood: str(o.mood, 40), at: str(o.at, 40) };
}
// The fingerprint of a place's movement an OmniHuman prompt was written with ('' - none).
const _placeSig = (motion) => (motion ? require('crypto').createHash('sha1').update(String(motion)).digest('hex').slice(0, 12) : '');

// How the fragments are turned into clips: the model that films them, the mood, how the
// character moves and how sharp the result is. The kie model id is deliberately
// NOT stored — it is derived from the quality at render time, so a tier being renamed
// upstream does not leave old projects pointing at a model that no longer exists.
//
// CHOSEN, NOT ASSUMED. A new project carries `v: 2`, and its
// choices start at NONE - '' for the mood, the quality, the shot size and the spread - until the person makes them; the panel's fields are red while one is missing and nothing fills it
// in here. A project without `v: 2` keeps the defaults it was always read with: 70 of 80 such projects
// had no mood stored and were marked up in 'sincere'.
const _normVideo = (v) => {
  const s = (v && typeof v === 'object') ? v : {};
  const chosen = s.v === 2;
  // WHAT FILMS IT (lib/th-video.js): Kling avatar or OmniHuman 2.0 - a clip per line either way. Chosen like the rest:
  // a `v: 2` project starts at none - except one that already chose a quality with no model, which is Kling's quality,
  // so a project halfway through on Kling stays on it. An older project is Kling, and so is one that was filmed by a
  // Seedance model when the talking head offered it (sd2mini, sd2, sd25).
  const model = TH.byId(s.model) ? s.model
    : /^sd/.test(String(s.model || '')) ? 'kling'
      : (chosen && !s.quality ? '' : 'kling');
  return {
    ...(chosen ? { v: 2 } : {}),
    model,
    // The emotion of the whole video (lib/motion-presets.js, MOODS): what the directing agent reads
    // every shot and animation prompt from.
    mood:    MP.moodById(s.mood) ? s.mood : (chosen ? '' : MP.DEFAULT_MOOD),
    preset:  MP.presetById(s.preset)  ? s.preset  : MP.DEFAULT_PRESET,
    // A quality the model makes - another model's is no choice at all (1080p is Kling's alone).
    quality: TH.qualityOf(model, s.quality) ? s.quality
      : (chosen || model !== 'kling' ? '' : MP.DEFAULT_QUALITY),
    // The shot size (an id of FRAME_SETS below) of a frame that does not say its own - an older project's; the frames
    // chat's frames carry theirs (`framing`).
    framing: ['selfie', 'half', 'full'].includes(s.framing) ? s.framing : (chosen ? '' : 'half'),
    // How the lines take frames from the project's set: the pool in turn, or a
    // frame drawn for each line - drawn once and always the same one, so a repaint does not
    // reshuffle the video (_frameOfLine).
    spread:  (s.spread === 'random' || s.spread === 'cycle') ? s.spread : (chosen ? '' : 'cycle'),
  };
};

// What a project has not chosen yet, of the choices a step needs, in words -
// '' when nothing is missing (a project without `v: 2` never misses any: its defaults stand).
function _unchosen(video, which) {
  const v = video || {};
  const words = {
    mood: !v.mood && I18N.t('the mood (field 1)'),
    model: !v.model && I18N.t('the model of the clips (field 3)'),
    quality: !v.quality && I18N.t('the quality of the clips (field 3)'),
  };
  const miss = which.map(k => words[k]).filter(Boolean);
  return miss.length ? I18N.t('choose {what} first', { what: miss.join(', ') }) : '';
}
// Voice settings live on the PROJECT: one read for the whole ad.
const _normVoice = (v) => {
  const s = (v && typeof v === 'object') ? v : {};
  const p = (s.ttsParams && typeof s.ttsParams === 'object') ? s.ttsParams : {};
  return {
    // Which service speaks the lines. Every field below belongs to it, so a second
    // provider brings its own set rather than borrowing these.
    provider:  'elevenlabs',
    // The read uses the CAST CHARACTER's voice when there is one. Before a character is cast
    // the project may choose a voice of its own: `pick` is
    // that voice - the entry the picker took, as a character's voice list keeps it - and the
    // read falls back to it. A character with a saved voice wins the moment they are cast.
    pick:      (s.pick && typeof s.pick === 'object' && s.pick.voiceId) ? {
      voiceId: String(s.pick.voiceId), name: String(s.pick.name || ''), sample: String(s.pick.sample || ''),
      gender: String(s.pick.gender || ''), age: String(s.pick.age || ''), accent: String(s.pick.accent || ''),
      descriptive: String(s.pick.descriptive || ''), language: String(s.pick.language || ''),
    } : null,
    tagsOn:    !!s.tagsOn,                  // off -> v2, on -> v3 with tags
    mood:      String(s.mood || ''),        // which mood's tag set the tagger may use
    // The one switch. It decides which words are read, which take the fragments show
    // and which take a clip is made from. Locked to plain while there is nothing tagged.
    variant:   s.variant === 'tagged' ? 'tagged' : 'plain',
    ttsParams: _ttsParams(p),
  };
};
// HOW THE SCRIPT IS SPOKEN: one stability and one speed for the
// whole video. v3 knows three stabilities - creative 0, natural 0.5, robust 1 - so anything else is
// put on the nearest (`+p.stability || 0.5` would turn creative into natural). The speed is OURS,
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
  id: p.id, name: p.name, scenarioId: p.scenarioId, type: p.type, draft: !!p.draft,   // the voiceover draft
  gender: p.gender, title: p.title,
  vertical: p.vertical, product: p.product, roles: p.roles,
  casting: _normCasting(p.casting),
  lineCount: (p.lines || []).length,
  createdAt: p.createdAt, updatedAt: p.updatedAt,
});
// The mix workspace is heavy (every generated frame), so it rides on the full
// record only — the dropdown list stays light.
// Lines go through the normaliser on the way OUT too: a line stored as bare
// {text, frameId} would have the page read undefined for
// every audio and video pair.
// Whether the CAST CHARACTER has a voice, worked out at read time from the character
// record. Derived and never stored: a copy on the project would go stale the moment a
// voice is set on the Library's Characters shelf, and the page would keep refusing to read.
//
// The page needs this to say so BEFORE anything is pressed — without it every line's read
// would be refused for the same reason without ever naming the cause.
function _castVoiceOf(p) {
  const cast = _normCasting((p || {}).casting);
  // The project's own pick reads when there is no character to read for, or the character has
  // no voice of their own.
  const pick = _normVoice((p || {}).voice).pick;
  const own = pick ? { has: true, id: pick.voiceId, character: '', index: 1, count: 1, own: true, name: pick.name } : null;
  if (!cast.characterId && !cast.characterName) return own || { has: false, reason: I18N.t('no character cast yet') };
  const chars = _read(path.join(DATA_DIR, 'characters.json'));
  const arr = Array.isArray(chars) ? chars : [];
  const ch = arr.find(c => String(c.id) === cast.characterId)
          || arr.find(c => String(c.name) === cast.characterName);
  if (!ch) return own || { has: false, reason: I18N.t('"{name}" is not in the character library any more', { name: cast.characterName }) };
  const id = String(ch.voice || '').trim();
  if (!id) return own || { has: false, reason: I18N.t('"{name}" has no voice saved — give it one in its column on the Library\'s Characters shelf', { name: ch.name }) };
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
  // The first look cast - the stage's way back to it (js/merge-v3/wk-setup.js _stageBack).
  ...(_normLook(p.cast0) ? { cast0: _normLook(p.cast0) } : {}),
  castVoice: _castVoiceOf(p),
  lines: (p.lines || []).map(_normLine),
  voice: _normVoice(p.voice),
  video: _normVideo(p.video),
  mix:   _normMix(p.mix),
});

router.get('/scen3/projects/:id', (req, res) => {
  try {
    const p = _loadProjects().find(x => String(x.id) === String(req.params.id));
    if (!p) return res.status(404).json({ success: false, error: I18N.t('not found') });
    // Opening a project is when the timeline catches up with what was made
    // while this app was not running. It asks a cheap question first and
    // lays nothing unless the answer differs from what is there.
    MIRROR.catchUp(p.id, { project: p });
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Create from a scenario ({ scenarioId }), or upsert an existing project by id
// (the page's saves of its fields).
// Or a TALKING HEAD FROM ONE'S OWN TEXT ({ lines, name }) - Home's quick start:
// the lines as the window cut them (by paragraphs - every Enter a line), never put on the scenarios shelf; another language is
// made English first, as a scenario's is. Named after `name`, else its first words.
router.post('/scen3/projects', async (req, res) => {
  try {
    const b    = req.body || {};
    // Whose the work is and what is put aside are the cast route's alone - never a page's copy written back.
    delete b.workOf; delete b.cast0; delete b.shelf;
    // A talking head made from a scenario with lines in another language gets them in English, and so does the
    // scenario: what is spoken is English. (A voiceover is not made
    // here: it is THE voiceover draft, /scen3/voiceover/draft.)
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
      if (i < 0) return res.status(404).json({ success: false, error: I18N.t('not found') });
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
      // The id and the moment it was made are pinned: a save cannot change them.
      const merged = _normProject({
        ...list[i], ...b, ...(casting ? { casting } : {}), ...(video ? { video } : {}), ...(voice ? { voice } : {}),
        id: list[i].id, createdAt: list[i].createdAt,
      }, now);
      merged.updatedAt = now;
      list[i] = merged;
      _saveProjects(list);
      return res.json({ success: true, project: _projFull(merged) });
    }

    if (b.scenarioId == null && Array.isArray(b.lines)) {
      let texts = b.lines.map(l => String((l && typeof l === 'object' ? l.text : l) || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (!texts.length) return res.status(400).json({ success: false, error: I18N.t('the text is empty') });
      if (texts.length > 200) return res.status(400).json({ success: false, error: I18N.t('at most 200 lines') });
      if (texts.some(t => t.length > VO_MAX)) return res.status(400).json({ success: false, error: I18N.t('a line is longer than {n} characters', { n: VO_MAX }) });
      if (texts.some(t => !AGENT.english(t))) {
        const t = await _englishLines(texts);
        if (t.fail) return res.status(502).json({ success: false, error: t.fail });
        texts = t.texts;
      }
      const title = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 120)
        || texts[0].split(' ').slice(0, 6).join(' ').slice(0, 120) || I18N.t('talking head');
      const rec = _normProject({
        id: _newId(list), name: `${now.slice(0, 10)} — ${title}`,
        scenarioId: '', gender: '', title, lines: texts.map(text => ({ text })),
        // Its choices start at none and are made by the person (_normVideo).
        video: { v: 2 }, createdAt: now, updatedAt: now,
      }, now);
      list.unshift(rec);
      _saveProjects(list);
      console.log('[scen3/projects] ' + rec.id + ' - a talking head from its own text, ' + texts.length + ' line(s)');
      return res.json({ success: true, project: _projFull(rec) });
    }

    const scen = _load().find(x => String(x.id) === String(b.scenarioId || ''));
    if (!scen) return res.status(400).json({ success: false, error: I18N.t('scenarioId not found') });
    // '' when the scenario does not say, and that is allowed: the casting then offers
    // every character rather than none.
    const gender = GENDERS.includes(_genderOf(scen)) ? _genderOf(scen) : '';

    const day = now.slice(0, 10);
    const rec = _normProject({
      id: _newId(list),
      name: `${day} — ${scen.title}`,
      scenarioId: scen.id,
      gender,
      title: scen.title,
      lines: scen.lines,          // SNAPSHOT — later scenario edits do not reach here
      vertical: scen.vertical,
      product: scen.product,
      roles: scen.roles,
      // Its choices start at none and are made by the person (_normVideo).
      video: { v: 2 },
      createdAt: now, updatedAt: now,
    }, now);
    list.unshift(rec);
    _saveProjects(list);
    res.json({ success: true, project: _projFull(rec) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A LOOK CAST - asked before it changes, reset after a yes - the ONE way "who" is written, the stage's ✕ too
   (js/merge-v3/wk-setup.js _cast) ──────────
   POST /api/scen3/projects/:id/cast  { characterId, characterName, obrazId, obrazImage, sure? } | { clear: true }
        -> { success, project, moved, title? }   cast; `moved` - work was put aside or came back, and the timeline was
           re-laid; `title` - the timeline's new title, the character in it (_nameForCast)
        -> { success: false, ask: { reads, frames, clips, from, to, sameChar } }   it would put work aside: asked first,
           cast with `sure` after a yes
        -> 409 { success: false, error }  something of the project is being made - after it
   The ✕ (`clear`) takes the look off and puts nothing aside: the same look cast again finds everything as it was.
   ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
function _castBusy(id) {
  return _scriptBusy(id);
}

// WHO IS IN
// THE NAME: a talking head's name - and so its folder (lib/projects-store.js, lib/relocate.js) - and its timeline's title end
// in the character cast: "<day> — <title> · <character>", "<day> - <title> · <character>" for the title (the picker's), a
// " (N)" the app added kept. Only while each is still the one the app gave (a name typed by hand is left alone).
// Given when a look is cast; a project without it gets it at its next cast - nothing is renamed at start.
function _castName(name, sep, title, who) {
  const s = String(name || '');
  const t = String(title || '').trim();
  const day = /^\d{4}-\d{2}-\d{2}/.exec(s);
  if (!day || !t || !who) return '';
  const head = day[0] + sep + t;
  if (!s.startsWith(head)) return '';
  const tail = /^( \(\d+\))?(?: · .*)?$/.exec(s.slice(head.length));
  return tail ? head + (tail[1] || '') + ' · ' + who : '';
}
// After the cast is saved, and apart from it: a folder another program holds stays as it is (the name with it), the cast
// stands. Returns what changed - { name, title }.
function _nameForCast(id) {
  const p = PROJECTS.get(id);
  const who = p ? _normCasting(p.casting).characterName.trim() : '';
  const out = {};
  if (!p || !who || p.type === 'voiceover') return out;
  const name = _castName(p.name, ' — ', p.title, who);
  if (name && name !== p.name) {
    try { PROJECTS.apply(id, (fresh) => { fresh.name = name; }); out.name = name; }
    catch (e) { console.warn('[scen3/cast] ' + id + ' keeps its name - its folder could not be renamed now:', e.message); }
  }
  try {
    require('../lib/merge-store').update('sv3_' + id, (t) => {
      const want = _castName(t.title, ' - ', p.title, who);
      if (!want || want === t.title) return false;
      t.title = want;
      out.title = want;
      return true;
    });
  } catch (e) { console.warn('[scen3/cast] ' + id + ' - its timeline keeps its title:', e.message); }
  return out;
}

router.post('/scen3/projects/:id/cast', async (req, res) => {
  try {
    const id = String(req.params.id);
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('not found') });
    if (proj.type === 'voiceover') return res.status(400).json({ success: false, error: I18N.t('a voiceover has nobody to cast') });
    const b = req.body || {};
    const next = b.clear ? null : _normLook(b);
    if (!b.clear && !(next && next.obrazId)) return res.status(400).json({ success: false, error: I18N.t('a look is needed') });
    const plan = _castPlan(proj, next);
    // A question, not a refusal: answered 200, so the page's console stays clean at every ask.
    if (plan.ask && !b.sure) return res.json({ success: false, ask: plan.ask, error: 'asked' });
    if (next && (plan.look || plan.char)) {
      const busy = _castBusy(id);
      if (busy) return res.status(409).json({ success: false, error: I18N.t('{busy} - change the look when it is done', { busy }) });
    }
    const now = new Date().toISOString();
    let moved = false;
    const saved = PROJECTS.apply(id, (fresh) => { moved = _applyCast(fresh, next, _castPlan(fresh, next), now); });
    if (!saved) return res.status(404).json({ success: false, error: I18N.t('not found') });
    if (moved) {
      try { await MIRROR.rebuild(id, { project: saved }); }
      catch (e) { console.warn('[scen3/cast] the timeline was not re-laid:', e.message); }
    }
    // Who is in the name - the folder and the timeline's title follow.
    const named = next ? _nameForCast(id) : {};
    console.log('[scen3/cast] ' + id + (next ? ' cast ' + next.characterName + ' / ' + next.obrazId : ' cleared') + (moved ? ' - work moved' : '')
      + (named.name ? ' - named "' + named.name + '"' : ''));
    res.json({ success: true, project: _projFull(PROJECTS.get(id) || saved), moved, ...(named.title ? { title: named.title } : {}) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A NEW PROJECT FOR ANOTHER LOOK - the "new project" answer to the question a cast asks ──────────────────────────────────
   POST /api/scen3/projects/:id/fork  { characterId, characterName, obrazId, obrazImage }   -> { success, project }
   A new talking head of THIS project's script as it is now - the lines' words and their [tags], the lines taken off and put in,
   their numbers kept - with its place and its choices (the mood, stability and speed, the model, the quality, the shot size,
   the spread, the frames' settings), the look given cast; no reads, frames or clips. This project is not
   touched. Named "<day> — <title> · <character>"; the page makes its timeline (/mv3/timeline/new) and names it with the cast
   route (js/merge-v3/scen-api.js forkHead), then opens it.
   ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/projects/:id/fork', (req, res) => {
  try {
    const id = String(req.params.id);
    const list = _loadProjects();
    const src = list.find(p => String(p.id) === id);
    if (!src) return res.status(404).json({ success: false, error: I18N.t('not found') });
    if (src.type === 'voiceover') return res.status(400).json({ success: false, error: I18N.t('a voiceover has nobody to cast') });
    const look = _normLook(req.body || {});
    if (!(look && look.obrazId)) return res.status(400).json({ success: false, error: I18N.t('a look is needed') });
    const now = new Date().toISOString();
    const lines = (src.lines || []).map(_normLine).map(l => ({
      text: l.text, tagged: l.tagged, removed: l.removed,
      ...(Number.isInteger(l.slot) ? { slot: l.slot } : {}), ...(l.speed ? { speed: l.speed } : {}),
    }));
    const m = _normMix(src.mix);
    const place = _normCasting(src.casting);
    const rec = _normProject({
      id: _newId(list),
      name: `${now.slice(0, 10)} — ${String(src.title || '').trim() || I18N.t('talking head')} · ${look.characterName}`,
      scenarioId: src.scenarioId, gender: src.gender, title: src.title, lines,
      vertical: src.vertical, product: src.product, roles: src.roles,
      video: src.video,
      voice: { ...((src.voice && typeof src.voice === 'object') ? src.voice : {}), pick: null },
      mix: { settings: m.settings },
      casting: { ...look, locationId: place.locationId, locationImage: place.locationImage },
      workOf: look, cast0: look,
      createdAt: now, updatedAt: now,
    }, now);
    list.unshift(rec);
    _saveProjects(list);
    console.log('[scen3/fork] ' + id + ' -> ' + rec.id + ' with ' + look.characterName);
    res.json({ success: true, project: _projFull(rec) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── THE VOICEOVER DRAFT - one, as Merge's draft; a project only once its voices are read, and then its script stays; until
   then its scenario can be let go - back to the list, or to one's own text ─────────────────────────────────────────────────
   POST /api/scen3/voiceover/draft                               -> { success, project, key, timeline }
        THE draft - the one there is, or a new empty one ("voiceover draft"): what "+ new project -> voiceover" and Home's
        "+ voiceover" open. `timeline` says whether its timeline is made yet (the page makes it, /mv3/timeline/new).
   POST /api/scen3/projects/:id/script  { scenarioId } | { text, name } | { clear: true }   -> { success, project }
        Its script, while it is the draft: a scenario's lines (a snapshot, in their own language), one's own text as ONE line
        (at most VO_MAX), or none again - back to the list. The project takes the scenario's title or the text's name, and
        its folder that name; cleared, it is "voiceover draft" again. Its mood and voice stay. The first read files it as a
        project (_fileTake) - from then on its script is its own.
   ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
// The draft's name, written in the interface's language when the draft is made or emptied.
const _voDraftName = () => I18N.t('voiceover draft');
const _voDraftOf = (list) => list.find(p => p && p.type === 'voiceover' && p.draft) || null;

router.post('/scen3/voiceover/draft', (req, res) => {
  try {
    const now = new Date().toISOString();
    const list = _loadProjects();
    let rec = _voDraftOf(list);
    if (!rec) {
      rec = _normProject({
        id: _newId(list), type: 'voiceover', draft: true,
        name: _voDraftName(), title: '', lines: [], video: { v: 2 }, createdAt: now, updatedAt: now,
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
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('not found') });
    if (proj.type !== 'voiceover' || !proj.draft) {
      return res.status(409).json({ success: false, error: I18N.t('its voices are read - the script is this project\'s now; another one is a new voiceover') });
    }
    const busy = _scriptBusy(id);
    if (busy) return res.status(409).json({ success: false, error: I18N.t('{busy} - change the script when it is done', { busy }) });
    const b = req.body || {};
    let lines = [], title = '', scenarioId = '', extra = {};
    if (b.clear) { /* back to the list: no script */ }
    else if (b.scenarioId != null) {
      const scen = _load().find(x => String(x.id) === String(b.scenarioId));
      if (!scen) return res.status(400).json({ success: false, error: I18N.t('scenarioId not found') });
      lines = (scen.lines || []).map(l => String((l && l.text) || '').trim()).filter(Boolean);
      if (!lines.length) return res.status(400).json({ success: false, error: I18N.t('this scenario has no lines') });
      if (lines.some(t => t.length > VO_MAX)) return res.status(400).json({ success: false, error: I18N.t('a line of this scenario is longer than {n} characters', { n: VO_MAX }) });
      title = String(scen.title || '').trim() || I18N.t('untitled');
      scenarioId = String(scen.id);
      extra = { vertical: scen.vertical || '', product: scen.product || '', roles: scen.roles || [] };
    } else {
      const text = String(b.text == null ? '' : b.text).replace(/\s+/g, ' ').trim();
      if (!text) return res.status(400).json({ success: false, error: I18N.t('the text is empty') });
      if (text.length > VO_MAX) return res.status(400).json({ success: false, error: I18N.t('the text is longer than {n} characters', { n: VO_MAX }) });
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
      fresh.name = lines.length ? `${day} — ${title}` : _voDraftName();
      fresh.updatedAt = now;
    });
    if (!saved) return res.status(404).json({ success: false, error: I18N.t('not found') });
    // The timeline's name follows, as a new talking head's is made (routes/mergev3.js /mv3/timeline/new).
    try {
      require('../lib/merge-store').update('sv3_' + id, (t) => {
        t.title = lines.length ? `${day} - ${title}` : _voDraftName();
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

// A project is deleted from Merge: a talking head's folder goes with its last timeline (DELETE
// /mv3/timeline/:key?files=1, routes/mergev3.js); the source scenario stays in the library.

/* ── The words of ONE line ───────────────────────────────────────────────
   POST /api/scen3/projects/:id/line  { index, text } -> { success, project }

   The words are edited where the read is: a line is judged by
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
    if (!text) return res.status(400).json({ success: false, error: I18N.t('a line cannot be empty') });
    // A voiceover's line is kept in its own language, and no longer than VO_MAX.
    const vo = (_loadProjects().find(p => String(p.id) === String(req.params.id)) || {}).type === 'voiceover';
    if (vo && text.length > VO_MAX) return res.status(400).json({ success: false, error: I18N.t('a line is at most {n} characters', { n: VO_MAX }) });
    // Typed in another language, the words are made English before they are kept - the field shows the
    // English. Then the project is read and written in one go.
    if (!vo && !AGENT.english(text)) {
      const t = await _englishLines([text]);
      if (t.fail) return res.status(502).json({ success: false, error: t.fail });
      text = String(t.texts[0] || '').trim();
    }
    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === String(req.params.id));
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('not found') });

    const lines = (proj.lines || []).map(_normLine);
    const i = parseInt((req.body || {}).index, 10);
    if (!(i >= 0 && i < lines.length)) return res.status(400).json({ success: false, error: I18N.t('no such line') });

    // The words with their [tags], when the page edits those too (Merge). Kept only when
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
    MIRROR.touch(proj.id, { project: proj });   // the timeline mirrors the lines: the words of a line
    res.json({ success: true, project: _projFull(proj) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A line taken off the script, and put back ───────────────────────────────
   POST /api/scen3/projects/:id/line/state  { index, removed } -> { success, project }

   A line is never deleted. It is taken off - the panel dims it
   and moves it to the foot of the script with a `restore` on it - and its files stay in the project
   folder. It keeps its PLACE in the list (see `removed` in _normLine), so nothing below it moves
   onto another frame and no clip disappears; putting it back is simply the flag going away.

   The timeline is the one thing that has to change, and it changes by itself: the mirror lays only
   the lines that are in the video, so the cut closes over the line that went and opens again when
   it comes back (lib/frag-mirror.js). This route WAITS for that re-laying before it answers, unlike
   every other caller of the mirror: the person is looking straight at the timeline through the blur
   when they press this, and the page refreshes it the moment the answer arrives. Everywhere else
   the mirror is fire-and-forget, because nothing is watching.

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
  if (clip) return I18N.t('this fragment is being filmed right now');
  const run = _reads.get(String(id));
  if (run && run.running && Array.isArray(run.only) && run.only.includes(i)) return I18N.t('this fragment is being read right now');
  return '';
}

router.post('/scen3/projects/:id/line/state', async (req, res) => {
  try {
    const id = String(req.params.id);
    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('not found') });

    const lines = (proj.lines || []).map(_normLine);
    const i = parseInt((req.body || {}).index, 10);
    if (!(i >= 0 && i < lines.length)) return res.status(400).json({ success: false, error: I18N.t('no such line') });
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
    // The cut closes over it, or opens again - and this one is WAITED for, so the page can
    // show the new timeline the moment it gets the answer. A mirror that could not be built must
    // never fail the thing that prompted it, so a failure is logged and the answer goes anyway.
    try { await MIRROR.rebuild(proj.id, { project: proj }); }
    catch (e) { console.warn('[scen3/line/state] the timeline was not re-laid:', e.message); }
    console.log('[scen3/line/state] ' + id + ' line ' + (i + 1) + (off ? ' taken off' : ' restored'));
    res.json({ success: true, project: _projFull(proj) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A LINE PUT IN ───────────────────────
   POST /api/scen3/projects/:id/line/insert  { after, text } -> { success, project, index }

   The "+" on the border under a fragment: a new line below it, with the words typed for it. A line
   takes its first frame from the set BY ITS NUMBER: moving the lines below down a
   place would put each of them on another frame, and their clips would drop out of the fragments
   and off the timeline. So before anything moves, every line is given the number it has now to
   KEEP (`slot`, read by _frameOfLine instead of the index), and the new line takes a number of its
   own (below).

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
  if (_lineWork.get(key)) return I18N.t('a line is being marked up, read or written for');
  const run = _reads.get(key);
  if (run && run.running) return I18N.t('the script is being read');
  const clip = ALERTS.list().some(r => r.state === 'running' && r.what === 'clip'
    && r.job && r.job.params && r.job.params.file && String(r.job.params.file.projectId) === key);
  return clip ? I18N.t('a clip is being made') : '';
}

router.post('/scen3/projects/:id/line/insert', async (req, res) => {
  try {
    const id = String(req.params.id);
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('not found') });
    const b = req.body || {};
    let text = String(b.text == null ? '' : b.text).replace(/\s+/g, ' ').trim();
    if (!text) return res.status(400).json({ success: false, error: I18N.t('a line cannot be empty') });
    const after = parseInt(b.after, 10);
    if (!(after >= 0 && after < (proj.lines || []).length)) return res.status(400).json({ success: false, error: I18N.t('no such line') });
    const busy = _scriptBusy(id);
    if (busy) return res.status(409).json({ success: false, error: I18N.t('{busy} - put the line in when it is done', { busy }) });
    // A voiceover's line goes in as typed, in its own language, and no longer than VO_MAX.
    const vo = proj.type === 'voiceover';
    if (vo && text.length > VO_MAX) return res.status(400).json({ success: false, error: I18N.t('a line is at most {n} characters', { n: VO_MAX }) });
    // Typed in another language, it goes in English - and nothing may have started while it was translated.
    if (!vo && !AGENT.english(text)) {
      const t = await _englishLines([text]);
      if (t.fail) return res.status(502).json({ success: false, error: t.fail });
      text = String(t.texts[0] || '').replace(/\s+/g, ' ').trim();
      const busy2 = _scriptBusy(id);
      if (busy2) return res.status(409).json({ success: false, error: I18N.t('{busy} - put the line in when it is done', { busy: busy2 }) });
    }

    const saved = PROJECTS.apply(id, (fresh) => {
      fresh.lines = (fresh.lines || []).map(_normLine);
      fresh.lines.forEach((l, k) => { if (!Number.isInteger(l.slot)) l.slot = k; });
      // ITS OWN NUMBER: the one after the line above is the line below's too, so the new line would open on the same
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
      _shelfSplice(fresh, after + 1);        // the work put aside keeps its lines' numbers too
      fresh.updatedAt = new Date().toISOString();
    });
    if (!saved) return res.status(404).json({ success: false, error: I18N.t('not found') });
    try { await MIRROR.rebuild(id, { project: saved }); }
    catch (e) { console.warn('[scen3/line/insert] the timeline was not re-laid:', e.message); }
    console.log('[scen3/line/insert] ' + id + ' a line put in after line ' + (after + 1));
    res.json({ success: true, project: _projFull(saved), index: after + 1 });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A line's animation prompt, by hand ──────────────────────────────────────
   POST /api/scen3/fragments/shot  { projectId, line, patch: { motion?, useAgentMotion?, omni?, useAgentOmni? } }
                                   -> { success, project }

   A prompt written by hand is marked so a new pass leaves it alone, and
   useAgentMotion puts the agent's back. Written for the words as they are now and the mood as it is
   now, so it is fresh. `omni` / `useAgentOmni` are the same for the line's OmniHuman prompt (_normOmni) - cut to
   its 300 characters at the last whole sentence.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/fragments/shot', async (req, res) => {
  try {
    const b = req.body || {};
    // A prompt written by hand in another language is kept - and sent - in English. First, then the project.
    const english = async (key, back) => {
      if (!(b.patch && typeof b.patch === 'object' && !b.patch[back] && key in b.patch)) return { text: null };
      return _englishText(String(b.patch[key] || ''));
    };
    const tm = await english('motion', 'useAgentMotion');
    if (tm.fail) return res.status(502).json({ success: false, error: tm.fail });
    const to = await english('omni', 'useAgentOmni');
    if (to.fail) return res.status(502).json({ success: false, error: to.fail });
    const motion = tm.text;
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    p.lines = (p.lines || []).map(_normLine);
    const i = parseInt(b.line, 10);
    if (!(i >= 0 && i < p.lines.length)) return res.status(400).json({ success: false, error: I18N.t('no such line') });
    const patch = (b.patch && typeof b.patch === 'object') ? b.patch : {};
    const at = new Date().toISOString();
    const mood = _normVideo(p.video).mood;
    if (patch.useAgentMotion || 'motion' in patch) {
      const was = p.lines[i].shot || {};
      const next = { ...was };
      if (patch.useAgentMotion) { next.motion = was.motionAgent || ''; next.motionEdited = false; }
      else {
        next.motion = motion != null ? motion : String(patch.motion || '');
        next.motionEdited = next.motion.trim() !== String(was.motionAgent || '').trim();
      }
      next.said = p.lines[i].text;
      next.mood = mood;
      next.at = at;
      p.lines[i].shot = _normShot(next);
    }
    if (patch.useAgentOmni || 'omni' in patch) {
      const was = p.lines[i].omni || {};
      const text = patch.useAgentOmni ? String(was.agent || '') : OMNI.fit(to.text != null ? to.text : patch.omni);
      const place = _placeSig(_envMotionOf(_normCasting(p.casting).locationImage));
      p.lines[i].omni = _normOmni({ ...was, prompt: text, edited: !patch.useAgentOmni && text !== String(was.agent || ''),
        said: p.lines[i].text, place, mood, at });
      if (!p.lines[i].omni) delete p.lines[i].omni;
    }
    p.updatedAt = at;
    _saveProjects(list);
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// THE FRAMES - a SET for the whole video, the pool the lines take theirs from
//
// Not a frame per line: a pool of frames, each made in the frames chat (routes/scen3-fchat.js) and put into the set
// with "to frames" (_addChatFrame). That pool is what the lines take their frames from, in turn
// (js/merge-v3/wk-fragments.js, _frameFor); no line is written by a frame - which one a line opens on is a rule, until
// the person picks one by hand (pick-frame). Frames of an older project may carry `set`, `n` and `moment` - the set an
// agent planned for them, which the writer of the animation prompts reads.
//
// NO GAZE RULE: in a frame the person does not have to look into the lens - they can be
// caught mid-thought. Where the eyes go is the moment's business, and the animation prompt brings
// them to the lens while the line is spoken.
// ════════════════════════════════════════════════════════════════════════════

const FRAG_FORMATS = ['9:16', '16:9'];
const FRAME_SHOW_MAX = 10;              // the frames one animation request may show its writer
// How a script's clips leave here: one a second. The engine takes a burst well enough, but the
// clips of a whole script are a queue rather than a shout.
const SUBMIT_GAP_MS = 1000;
const _wait = (ms) => new Promise(r => setTimeout(r, ms));

// The three shot sizes - the EDGE a frame is drawn to in the frames chat. `rule` is what the
// engine and the writers are told first.
const FRAME_SETS = [
  { id: 'selfie', label: 'selfie',
    rule: 'A SELFIE, the head and the shoulders close to the camera: the person films themselves with the phone in one outstretched hand - that arm reaches toward the lens and runs out past the edge of the frame - talking straight to the viewer; a phone’s wide-angle look with slight distortion at the edges. Frame it exactly this way and do not pull back to fit more of the body in.',
    // Where the frame CUTS. A shot size said as a name is a suggestion; said as what is outside the
    // picture it is a rule (said as a name, half-body sets come out head to toe).
    cut: 'The bottom edge of the picture cuts across the middle of the chest. The waist, the hips, the legs, the feet and the floor are NOT in the picture at all.',
    // What a MOMENT may be about: only what this shot size actually shows. A moment that describes
    // the stance of a body the frame cuts off is a moment that pulls the picture wider (a half-body
    // set comes out full height).
    visible: 'the head, the face, the eyes, the shoulders and the free hand when it comes up near the face - never the legs, the feet, the floor or the whole stance' },
  { id: 'half', label: 'half body',
    rule: 'HALF BODY, from the waist up: filmed by somebody else at a natural distance, both hands free and inside the frame, the place visible behind and around the person. Frame it exactly this way - not closer, and not the whole figure.',
    cut: 'The bottom edge of the picture cuts at the waist, just below the belt. The hips, the legs, the knees, the feet and the floor are NOT in the picture at all.',
    visible: 'the head, the face, the eyes, the shoulders, the arms and both hands - never the legs, the feet, the floor, or how the weight sits on the feet' },
  { id: 'full', label: 'full body',
    rule: 'FULL BODY, the whole figure from head to toe: standing on the floor of the place, filmed from a natural distance, the person in the middle of the frame with the place around them, the feet and the floor in the frame.',
    cut: 'The whole figure is inside the picture: the head with room above it, and the feet with the floor under them.',
    visible: 'the whole figure - the head, the face, the arms and hands, the stance, the weight on the feet and the floor under them' },
];
const _frameSet = (id) => FRAME_SETS.find(s => s.id === String(id || '')) || null;

// The person belongs to the place: the light that falls on them is the place's light (the
// realism marker for frames, beside PERSON_REAL).
const FRAG_LIGHT_MATCH =
  ' The light on the person is the light of the location: the same direction, softness, colour temperature'
  + ' and shadows, so the person is lit by that room and not by a studio.';

// IS THE FACE COVERED, and by what? Read out of the sentence the agent already wrote
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

// WHICH GARMENTS A SHOT SIZE SHOWS: a selfie is the head and the top, a half body adds the
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
const FRAME_READ_V = 2;                 // 2: the reading lists the clothes
async function _frameRef(projectId, cast) {
  const p = PROJECTS.get(projectId);
  const have = p && _normFrameRef(p.frameRef);
  // A reading below FRAME_READ_V (no clothes in it) is read again, once.
  if (have && have.look === cast.obrazImage && have.place === cast.locationImage && have.v >= FRAME_READ_V) return have;
  const [lookUrl, placeUrl] = await Promise.all([_hostLocal(cast.obrazImage), _hostLocal(cast.locationImage)]);
  const ask = 'IMAGE 1 is a character reference sheet, IMAGE 2 is an empty location.'
    + ' Answer in exactly the labelled blocks below, each on its own line, each one plain sentences'
    + ' with no lists and no extra headings.'
    + '\nCHARACTER: describe the person on the sheet - face, hair, build, skin tone and the clothing they'
    + ' are wearing, as the traits to preserve.'
    // THE CLOTHES, garment by garment. The frame prompt checks
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
  return ref;
}

// THE FRAMES CHAT READS THE LOOK AND THE PLACE ITSELF. What a frame must keep that a picture cannot say - a covered
// face, the clothes garment by garment - comes from this reading, and the chat asks for it the first time a message or
// its ideas need it (routes/scen3-fchat.js). The same reading
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
    if (!p) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    p.lines = (p.lines || []).map(_normLine);
    const i = parseInt(b.line, 10);
    if (!(i >= 0 && i < p.lines.length)) return res.status(400).json({ success: false, error: I18N.t('no such line') });
    const want = String(b.frameId || '');
    if (want) {
      const v = _normMix(p.mix).variants.find(x => x.id === want);
      if (!v) return res.status(404).json({ success: false, error: I18N.t('no such frame') });
      p.lines[i].frameId = v.id;
    } else {
      p.lines[i].frameId = '';
    }
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    MIRROR.touch(p.id, { project: p });   // the timeline mirrors the lines: a frame picked by hand
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── The animation of the person, line by line ───────────────────────────────
   POST /api/scen3/video/prompts  { projectId, only? } -> { success, project, report }

   What the person DOES while a line is spoken - the expression, the head, the hands, the gaze -
   written for every line at once by one agent that sees the set of frames. It is
   what the clip of that line is made from: Kling hears the frame, the read and this, and
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
  // A frame the person switched OFF is out of the rotation: it stays in the
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
// comes out a shifted cycle. The page draws with the same function (js/merge-v3/wk-fragments.js, _seed).
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
  // By the number the line KEEPS when it has one (a line was put in above it, /line/insert), else by
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
  // WHERE THE EYES GO. This is somebody talking TO the person watching, and
  // a gaze that wanders reads as a person talking to somebody off to the side. The glance away is
  // allowed because a face that never blinks its attention reads as a recital - but it is a beat,
  // and the eyes come back.
  + ' THE GAZE: the person is speaking into the lens and holds it. Now and then, where a thought'
  + ' turns or a phrase lands, the eyes flick away for a beat and come straight back to the lens.'
  + ' They never settle anywhere else and never address anyone off camera.';
// THE TALKING IS VISIBLE. This stands at the HEAD of every prompt,
// the way the place's own movement stands at its foot: one sentence, the same for every mood,
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
// A product in the person's hand in the frame - Kling avatar moves the hands and may let it
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
// have changed since it was, or the place's own movement is not in it. The last one is
// what makes a prompt written before the place was analysed, or before somebody changed how the
// place moves, get written again: what goes to the renderer is ONE text, and half of it being out
// of date is not a prompt.
function _motionStale(line, envMotion) {
  const shot = line && line.shot;
  if (!shot || !shot.motion) return true;
  if (String(shot.said || '') !== String((line && line.text) || '')) return true;
  // Without the articulation sentence (MOTION_LIPS), or without the place's current movement: either
  // half being out of date makes it a prompt that is no longer what we send.
  if (String(shot.motion).indexOf(MOTION_LIPS) < 0) return true;
  return !!envMotion && String(shot.motion).indexOf(envMotion) < 0;
}
// The same question of a line's OmniHuman prompt: never written, written for other words, or for another movement of
// the place (its prompt holds no sentence of ours, so what it was written with is kept beside it - `place`).
function _omniStale(line, envMotion) {
  const o = line && line.omni;
  if (!o || !o.prompt) return true;
  if (String(o.said || '') !== String((line && line.text) || '')) return true;
  return !!envMotion && o.place !== _placeSig(envMotion);
}
// Is the line's prompt for this model written by hand - left alone by a new pass?
const _promptEdited = (line, omni) => (omni ? !!(line && line.omni && line.omni.edited) : !!(line && line.shot && line.shot.motionEdited));

/**
 * Write the animation prompts of a project's lines - Kling avatar's (`shot.motion`), or for a project filmed by
 * OmniHuman its own (`omni`, by lib/omni-prompt.js's rules). The route below is one caller; a clip about
 * to be rendered is the other, asking for the one line it is about. The
 * prompts land on the lines by number: a line put in meanwhile waits (_holdLines).
 */
async function _writePrompts(id, want) {
  const free = _holdLines(id);
  try { return await _writePromptsNow(id, want); } finally { free(); }
}
async function _writePromptsNow(id, want) {
  const list = _loadProjects();
  const proj = list.find(x => String(x.id) === id);
  if (!proj) throw Object.assign(new Error(I18N.t('no such project')), { status: 404 });
  {
    const lines = (proj.lines || []).map(_normLine);
    if (!lines.length) throw Object.assign(new Error(I18N.t('this project has no lines')), { status: 400 });
    const pool = _framePool(proj);
    if (!pool.length) throw Object.assign(new Error(I18N.t('make a frame in the frames chat first: a clip is made from one')), { status: 400 });
    const video = _normVideo(proj.video);
    const omni = video.model === 'omnihuman';
    // The person moves in the mood they chose: not chosen yet is said, not assumed.
    const missing = _unchosen(video, ['mood']);
    if (missing) throw Object.assign(new Error(missing), { status: 400 });
    const mood = MP.moodById(video.mood) || MP.MOODS[0];
    // THE SHOT OF EACH LINE'S OWN FRAME: the frames come from the frames chat, each with the edge it was asked
    // with (`framing`); a frame without one falls back to the project's shot size (`video.framing`), else half body.
    const setOf = (fr) => _frameSet((fr && fr.framing) || video.framing) || _frameSet('half');

    // The place's own movement. It is written once per PLACE and belongs to the place, not to this
    // project - and it is also part of every line's prompt, which is why it is
    // read before the lines are chosen.
    const envMotion = _envMotionOf(_normCasting(proj.casting).locationImage);

    // Which lines this touches: the ones named, or every line whose prompt is stale - and never one
    // edited by hand unless named.
    const live = (i) => !lines[i].removed;               // a line taken off is not written for
    const stale = (l) => (omni ? _omniStale(l, envMotion) : _motionStale(l, envMotion));
    const only = Array.isArray(want)
      ? [...new Set(want.map(n => parseInt(n, 10)).filter(n => n >= 0 && n < lines.length))].filter(live).sort((a, c) => a - c)
      : lines.map((_, i) => i).filter(i => live(i) && stale(lines[i]) && !_promptEdited(lines[i], omni));
    if (!only.length) return { project: proj, report: { written: 0, skipped: [] } };

    // The frames themselves, in the order the lines take them: the agent writes movement that starts
    // from a body it can see, not from a description of one.
    // For the whole script the agent sees the set; for ONE line it sees that line's frame and
    // nothing else - the other frames are not about it, and hosting them would be attention paid
    // to a picture the answer has to ignore.
    // The frames the lines open on, each once - not only the pool's first few, or a line opening on a later frame
    // would be written for "frame unknown". At most FRAME_SHOW_MAX pictures in one request.
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
    // The products the line's frame was drawn with: said in the line's row, and one rule.
    const prodsOf = (i) => _frameProds(where(i).fr);
    const anyProd = only.some(i => prodsOf(i).length);
    const ask = omni ? OMNI.ask({
      shown: shown.length, mood, sets, envMotion,
      lines: only.map((i) => {
        const w = where(i);
        return { n: i + 1, at: w.at + 1, shot: setOf(w.fr).label, moment: (w.fr && w.fr.moment) || '',
          products: prodsOf(i).map(p => ({ name: p.name, label: p.label })), words: lines[i].text };
      }),
    }) : 'You are directing a talking-head video: one person, one place, spoken'
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
    if (!String(raw || '').match(/\{[\s\S]*\}/)) throw new Error(I18N.t('the agent did not answer with the prompts'));
    // [{ n, prompt }] - Kling's writer answers `motion`, OmniHuman's `prompt`; both are read here.
    const got = OMNI.read(raw);
    if (!got.length) throw new Error(I18N.t('the agent wrote nothing usable'));

    const now = new Date().toISOString();
    const report = { written: 0, skipped: [] };
    const write = {};                     // line -> the shot (or the OmniHuman prompt) to put on it
    for (const i of only) {
      const hit = got.find(x => x.n === i + 1);
      // OMNIHUMAN: the agent's text alone, cut to its 300 characters at the last whole sentence - no sentence of ours
      // goes around it (the voice moves the mouth by itself; the place is said by the agent, if at all).
      if (omni) {
        const text = OMNI.fit(_cleanText((hit && hit.prompt) || ''));
        if (!text) { report.skipped.push(i + 1); continue; }
        write[i] = _normOmni({ prompt: text, agent: text, edited: false, said: String(lines[i].text || ''),
          place: _placeSig(envMotion), mood: mood.id, at: now });
        report.written++;
        continue;
      }
      const said = _cleanText((hit && hit.prompt) || '').slice(0, 900);
      if (!said) { report.skipped.push(i + 1); continue; }
      // ONE TEXT, THE PERSON AND THE PLACE. The agent is told how the place
      // moves and told not to describe it again, so what it writes is the person alone. The place's own sentence is added
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
    // (ten clips and ten reads may go at once). So the record is read AGAIN here and only
    // the lines this call is about are touched - the copy read before the agent was asked would
    // carry back whatever landed meanwhile and undo it.
    const saved = PROJECTS.apply(id, (fresh) => {
      fresh.lines = (fresh.lines || []).map(_normLine);
      for (const [k, w] of Object.entries(write)) {
        if (fresh.lines[k]) fresh.lines[k][omni ? 'omni' : 'shot'] = w;
      }
      fresh.updatedAt = now;
    });
    console.log('[scen3/video/prompts] ' + id + (omni ? ' omnihuman ' : ' ') + mood.id + ' ' + sets.map(s => s.id).join('+') + ' frames=' + shown.length
      + ' written=' + report.written + ' skipped=' + report.skipped.length);
    return { project: saved || proj, report };
  }
}

router.post('/scen3/video/prompts', async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const proj = _loadProjects().find(x => String(x.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    const out = await _writePrompts(id, b.only);
    res.json({ success: true, project: _projFull(out.project), report: out.report });
  } catch (e) {
    console.error('[scen3/video/prompts]', e.message);
    res.status(e.status || 502).json({ success: false, error: e.message });
  }
});

/* ── A frame switched off ────────────────────────────────────────────────────
   POST /api/scen3/frames/ban  { projectId, frameId, banned } -> { success, project }

   The ✕ on a frame of the frames shelf: the frame stays in the project and
   on the strip - dimmed, and last, so it is out of the way - but no line takes it any more. The ✓
   in the same corner brings it back. The list of them is `mix.banned`.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/frames/ban', (req, res) => {
  try {
    const b = req.body || {};
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    p.mix = _normMix(p.mix);
    const id = String(b.frameId || '');
    if (!p.mix.variants.some(v => v.id === id)) return res.status(404).json({ success: false, error: I18N.t('no such frame') });
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
    MIRROR.touch(p.id, { project: p });   // the timeline mirrors the lines: a frame switched off
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── The order the frames stand in ───────────────────────────────────────────
   POST /api/scen3/frames/order  { projectId, order: [frameId, ...] } -> { success, project }

   The strip is dragged into the order the person wants, and that order is
   what "the pool in turn" then means. Ids that are not in the list - a frame made after the
   dragging - keep their natural place behind the arranged ones.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/frames/order', (req, res) => {
  try {
    const b = req.body || {};
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    p.mix = _normMix(p.mix);
    const have = new Set(p.mix.variants.map(v => String(v.id)));
    const want = [...new Set((Array.isArray(b.order) ? b.order : []).map(String))].filter(id => have.has(id));
    if (!want.length) return res.status(400).json({ success: false, error: I18N.t('no frames in that order') });
    p.mix.order = want;
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    MIRROR.touch(p.id, { project: p });   // the timeline mirrors the lines: the order of the frames
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A frame cropped, and filed as a frame ────────────────────────
   POST /api/scen3/frames/crop  { projectId, frameId, rect: {x,y,w,h} } -> { success, project, frameId }

   The person reframes a first frame on the stage and the cut lands in the SET, beside the frames it
   was cut from, in the project's own folder. The page does not own the
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
    if (!p) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    p.mix = _normMix(p.mix);
    const src = p.mix.variants.find(x => x.id === String(b.frameId || ''));
    if (!src) return res.status(404).json({ success: false, error: I18N.t('no such frame') });
    const hit = _resolveMedia(src.path);
    if (!hit || !fs.existsSync(hit.abs)) {
      return res.status(400).json({ success: false, error: I18N.t('the frame is missing: {path}', { path: src.path }) });
    }
    const r = b.rect || {};
    const fx = Number(r.x), fy = Number(r.y), fw = Number(r.w), fh = Number(r.h);
    if (![fx, fy, fw, fh].every(Number.isFinite)) {
      return res.status(400).json({ success: false, error: I18N.t('rect must be {x,y,w,h} as fractions of the frame') });
    }
    if (fw < CROP_MIN - 1e-6 || fh < CROP_MIN - 1e-6) {
      return res.status(400).json({ success: false,
        error: I18N.t('the selection must cover at least a third of the frame - got {w}% x {h}%', { w: Math.round(fw * 100), h: Math.round(fh * 100) }) });
    }
    const meta = await sharp(hit.abs).metadata();
    if (!meta.width || !meta.height) return res.status(500).json({ success: false, error: I18N.t('could not measure the frame') });
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
      // A frame cut from one with a product keeps it.
      props: _framePropsOf(src.props),
    };
    // Cutting the picture and making its preview took a moment, and other things write this project
    // meanwhile. Read it again and add the frame to the set AS IT IS NOW.
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
    MIRROR.touch(p.id, { project: saved || p });   // the timeline mirrors the lines: a frame added
    res.json({ success: true, project: _projFull(saved || p), frameId: variant.id });
  } catch (e) {
    console.error('[scen3/frames/crop]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* ── The prompt a frame was drawn from ───────────────────────────────────────
   POST /api/scen3/frames/prompt  { projectId, frameId, prompt } -> { success, project }

   Every frame keeps the prompt it was made from, and the open fragment shows it beside the
   picture. It is EDITABLE there: the picture on screen does not change - it
   is already drawn - and the words written here are kept with the frame.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/frames/prompt', async (req, res) => {
  try {
    const b = req.body || {};
    // A frame's prompt written by hand in another language is kept - and drawn - in English.
    const t = await _englishText(String(b.prompt == null ? '' : b.prompt));
    if (t.fail) return res.status(502).json({ success: false, error: t.fail });
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === String(b.projectId || ''));
    if (!p) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    p.mix = _normMix(p.mix);
    const v = p.mix.variants.find(x => x.id === String(b.frameId || ''));
    if (!v) return res.status(404).json({ success: false, error: I18N.t('no such frame') });
    v.prompt = String(t.text || '').trim().slice(0, 4000);
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── The frames chat (routes/scen3-fchat.js) ──────────────────────
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

// A frame's products as kept on it: { path, name, description }, at most two.
function _framePropsOf(list) {
  return (Array.isArray(list) ? list : []).filter(p => p && p.path).slice(0, 2)
    .map(p => ({ path: String(p.path), name: String(p.name || '').slice(0, 120), description: String(p.description || '').slice(0, 4000) }));
}

// The products of a line's frame as its clip's writers are told of them: the name and
// the description as kept in Props now (lib/props.js), else as the frame remembered them (a product deleted); its
// LABEL and HOW IT IS HELD read out of the description.
const _descPart = (d, key) => {
  const m = new RegExp('^' + key + ':\\s*(.+)$', 'mi').exec(String(d || ''));
  return m ? m[1].trim().replace(/[.\s]+$/, '') : '';
};
function _frameProds(fr) {
  const P = require('../lib/props');
  return _framePropsOf(fr && fr.props).map((p) => {
    const n = P.facts(p.path, p);
    return { path: p.path, name: n.name, label: _descPart(n.description, 'LABEL'), held: _descPart(n.description, 'HOW IT IS HELD') };
  });
}

// A frame of the chat put into the set (`to frames`): it joins the pool like any frame - the lines take from it by the
// rule - marked as made to order, with the prompt it was drawn from. Once per file.
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
  if (!saved) throw Object.assign(new Error(I18N.t('no such project')), { status: 404 });
  if (!already) MIRROR.touch(saved.id, { project: saved });   // the timeline mirrors the lines: a frame added
  return { project: _projFull(saved), frameId: variant.id, already };
}

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
    if (!p) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    p.lines = (p.lines || []).map(_normLine);
    const i = parseInt(b.line, 10);
    if (!(i >= 0 && i < p.lines.length)) return res.status(400).json({ success: false, error: I18N.t('no such line') });
    const variant = _normVoice(p.voice).variant === 'tagged' ? 'tagged' : 'plain';
    const want = String(b.clipId || '');
    if (want && !(p.lines[i].video[variant] || []).some(c => c.id === want)) {
      return res.status(404).json({ success: false, error: I18N.t('no such clip on this fragment') });
    }
    p.lines[i].pick = { ...(p.lines[i].pick || {}), [variant]: want };
    // Chosen by hand: the line's clip on the timeline whether or not it is fresh.
    p.lines[i].chosen = { ...(p.lines[i].chosen || {}), [variant]: want };
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    MIRROR.touch(p.id, { project: p });   // the timeline mirrors the lines: a clip picked
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── THE CLIP OF A FRAGMENT ───────────────────────────────────────
   POST /api/scen3/fragments/clip  { projectId, line, where } -> { success, alertId, taskId }
                                                              -> { success, skipped: '<why>' }

   The frame of the line speaks its read: the model the project is filmed by (lib/th-video.js - Kling avatar or
   OmniHuman 2.0) hears the picture, the take and the line's prompt, and nothing else. This is the journalled path - a
   row in Alerts from the moment it is asked for, and the SERVER sees it through (lib/gen-jobs.js): it polls kie,
   downloads the clip once into the project's clips/, makes a poster, normalises it for the browser, measures it and
   files it as a take of that line, with the model that made it. Leaving the page loses nothing.

   EVERY REFUSAL IS BEFORE THE MONEY. What cannot be rendered is said plainly - no key, no words, no frame,
   no read, a read that no longer matches the words, a read longer than the model takes - and
   answered as `skipped`, not as an error: /fragments/clips, walking every line, must be able to step over one.
   PAID ONCE: `asked` is written on the row just before the paid create; a create that got no answer stops there
   (lib/task-started.js `unsure`), and a row found at start with `asked` and no task "may have been paid for" and is
   not asked again by itself.
   ──────────────────────────────────────────────────────────────────────────── */
const TS = require('../lib/task-started');

// What a clip of this line would be made of, or why it cannot be. One reading, used by the routes,
// by "try again" and by _clipDone.
function _clipPlan(proj, i) {
  const lines = (proj.lines || []).map(_normLine);
  const line = lines[i];
  if (!line) return { skipped: I18N.t('no such fragment') };
  if (line.removed) return { skipped: I18N.t('this fragment is taken off the script') };
  const video = _normVideo(proj.video);
  const voice = _normVoice(proj.voice);
  const variant = voice.variant === 'tagged' ? 'tagged' : 'plain';
  // The clip is made by the model and in the quality the person chose - before the money, a missing
  // one is a fragment skipped in words.
  const missing = _unchosen(video, ['model', 'quality']);
  if (missing) return { skipped: missing };
  const model = video.model;
  const quality = TH.qualityOf(model, video.quality);
  if (!quality) return { skipped: I18N.t('choose {what} first', { what: I18N.t('the quality of the clips (field 3)') }) };
  const said = variant === 'tagged' ? (line.tagged || '') : (line.text || '');
  if (!said.trim()) return { skipped: I18N.t('this fragment has no words') };
  const frame = _frameOfLine(_framePool(proj), line, i, video.spread, proj.id);
  if (!frame || !frame.path) return { skipped: I18N.t('no frame for this fragment - make one in the frames chat') };
  const take = (line.audio || {})[variant];
  if (!take || !take.path) return { skipped: I18N.t('this fragment is not read yet') };
  if (take.said !== said) return { skipped: I18N.t('the read is of other words - read it again') };
  if (take.dur > quality.maxAudioSec) {
    return { skipped: I18N.t('the read is {dur}s and {model} takes {max}s at most',
      { dur: take.dur.toFixed(1), model: (TH.byId(model) || {}).label || I18N.t('the model'), max: quality.maxAudioSec }) };
  }
  // The line's own prompt for this model - Kling's animation prompt, or OmniHuman's (_normOmni). A Kling line that has
  // none falls back to the project's motion preset rather than refusing to render at all; an OmniHuman clip is not asked
  // for without its own writer's prompt (_readyForClip) - the preset is only what a price or a dry request shows.
  const own = model === 'omnihuman' ? String((line.omni || {}).prompt || '').trim() : String((line.shot || {}).motion || '').trim();
  return {
    variant, model, quality, said, frame, take, line,
    prompt: model === 'omnihuman' ? OMNI.fit(own || MP.promptFor(video.preset)) : (own || MP.promptFor(video.preset)),
    motionFrom: own ? 'line' : 'preset',
    // A read shorter than the model takes is padded to this many seconds (lib/th-video.js padSecs) - 0: as it is.
    pad: TH.padSecs(model, take.dur),
  };
}

// WHAT A CLIP NEEDS WRITTEN FIRST. A clip is the frame moving as
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
// yet: the steps are counted first, so the row says "analysis 1/2 - the
// place" only when there really are two of them.
async function _readyForClip(id, i, onStage) {
  const say = typeof onStage === 'function' ? onStage : () => {};
  const proj = _loadProjects().find(p => String(p.id) === id);
  if (!proj) return;
  const place = _normCasting(proj.casting).locationImage;
  const line = (proj.lines || []).map(_normLine)[i];
  const omni = _normVideo(proj.video).model === 'omnihuman';
  const wantPlace = !!(place && !_envMotionOf(place));
  // The same staleness rule the writer uses, so a prompt written before the place was analysed
  // is written again before this clip is paid for. A place about to be analysed for the FIRST time
  // makes every prompt stale by definition: its movement cannot be in any of them yet.
  const stale = !line || wantPlace || (omni ? _omniStale(line, _envMotionOf(place)) : _motionStale(line, _envMotionOf(place)));
  const wantLine = stale && !_promptEdited(line, omni);
  const n = (wantPlace ? 1 : 0) + (wantLine ? 1 : 0);
  let at = 0;
  if (wantPlace) {
    say(I18N.t('analysis {at}/{n} · the place', { at: ++at, n }));
    try { await _askEnvMotion(place); } catch (e) { console.warn('[scen3/clip] the place was not analysed:', e.message); }
  }
  if (wantLine) {
    say(I18N.t('analysis {at}/{n} · this fragment', { at: ++at, n }));
    try { await _writePrompts(id, [i]); }
    catch (e) {
      // OmniHuman is told what its own writer wrote: no prompt, no clip - refused here, before the money.
      if (omni) throw new Error(I18N.t('the OmniHuman prompt was not written: {why} - try again', { why: e.message }));
      console.warn('[scen3/clip] the animation was not written:', e.message);
    }
  }
  if (omni) {
    const now = ((_loadProjects().find(p => String(p.id) === id) || {}).lines || []).map(_normLine)[i];
    if (!(now && String((now.omni || {}).prompt || '').trim())) throw new Error(I18N.t('the OmniHuman prompt was not written - try again'));
  }
}

// The keys a clip cannot be asked for without, said before any row is written: kie.ai's, and the public host the
// frame and the read go up to (R2, made from the Cloudflare key). '' when both are there.
function _clipKeysMissing() {
  const st = _read(path.join(DATA_DIR, 'settings.json')) || {};
  if (!String(st.kieApiKey || '').trim()) return I18N.t('no kie.ai key - add it on Admin -> API keys');
  if (!require('../lib/r2').isConfigured()) return I18N.t('nowhere to host the frame and the read for kie.ai - a checked Cloudflare key on Admin -> API keys');
  return '';
}

// THE PAID CREATE of a clip on kie.ai. An answer that says no started nothing; NO ANSWER - a timeout, a reset, a 5xx, a
// 200 without a task number - may have started a task nobody will hear of, and is thrown `unsure` (lib/task-started.js).
async function _kieClip(model, input) {
  let r;
  try {
    r = await axios.post(`${CFG.KIE_BASE}/api/v1/jobs/createTask`, { model, input }, { headers: H.kieHeaders(), timeout: 30000 });
  } catch (e) { throw TS.notStarted('kie.ai', e); }
  const d = (r && r.data) || {};
  const taskId = d.data && d.data.taskId;
  if (taskId) return String(taskId);
  // kie answers a refusal INSIDE a 200: { code, msg } - an answer, so nothing was started.
  if (d.code != null && Number(d.code) !== 200) throw Object.assign(new Error(I18N.t('kie.ai did not start it: {why}', { why: TS.said(d) || I18N.t('code {code}', { code: d.code }) })), { unsure: false });
  throw Object.assign(new Error(I18N.t('kie.ai answered without a task number - it may have started it all the same')), { unsure: true });
}

// The read as it goes up: as it is, or - shorter than the model takes - padded with silence (lib/th-video.js padTo) into
// a scratch file that is deleted once it is hosted.
async function _hostRead(plan) {
  const src = toDiskExisting(plan.take.path);
  if (!src || !fs.existsSync(src)) throw new Error(I18N.t('the read of this line is not in the library any more'));
  if (!plan.pad) {
    const why = TH.readRefusal(plan.model, fs.statSync(src).size);
    if (why) throw Object.assign(new Error(why), { status: 400 });
    return _hostLocal(plan.take.path, { forceFresh: true, verify: true, exts: /\.(mp3|wav|m4a|ogg)$/i });
  }
  fs.mkdirSync(CFG.TEMP_DIR, { recursive: true });
  const tmp = path.join(CFG.TEMP_DIR, 'pad_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.wav');
  try {
    await TH.padTo(src, tmp, plan.pad);
    const why = TH.readRefusal(plan.model, fs.statSync(tmp).size);
    if (why) throw Object.assign(new Error(why), { status: 400 });
    return await H.uploadToPublicHost({ path: tmp }, { ext: 'wav', forceFresh: true, verify: true });
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* already gone */ }
  }
}

/**
 * WHAT ONE CLIP OF A LINE SENDS - the model's request as it would go to kie.ai, built from the plan with the frame and
 * the read already hosted. Nothing is asked here.
 */
function _clipRequest(plan, imageUrl, audioUrl) {
  return { model: plan.quality.model, input: TH.input(plan.model, { image: imageUrl, audio: audioUrl, prompt: plan.prompt }) };
}

// One clip on kie. The picture and the sound go up FRESH every time: kie fetches them itself, and a
// link that has been sitting around comes back as "fetch failed" long after the money is committed.
// `onAsk(true|false)` marks the row's `asked` around the paid create.
async function _submitClip(b, onStage, onAsk) {
  const say = typeof onStage === 'function' ? onStage : () => {};
  const ask = typeof onAsk === 'function' ? onAsk : () => {};
  const keys = _clipKeysMissing();
  if (keys) throw Object.assign(new Error(keys), { status: 400 });
  const id = String(b.projectId || '').trim();
  {
    const first = _loadProjects().find(p => String(p.id) === id);
    const i0 = parseInt(b.line, 10);
    // Only when there is something to render at all: an analysis for a fragment that will be
    // refused anyway is a call nobody asked for.
    if (first && !_clipPlan(first, i0).skipped) await _readyForClip(id, i0, say);
  }
  const proj = _loadProjects().find(p => String(p.id) === id);
  if (!proj) throw Object.assign(new Error(I18N.t('no such project')), { status: 404 });
  const i = parseInt(b.line, 10);
  const plan = _clipPlan(proj, i);
  if (plan.skipped) throw Object.assign(new Error(plan.skipped), { status: 400 });

  // What the model takes of a picture, before anything is sent.
  if (plan.model === 'omnihuman') {
    const abs = toDiskExisting(plan.frame.path);
    if (!abs || !fs.existsSync(abs)) throw new Error(I18N.t('the frame of this line is not in the library any more'));
    let meta = {};
    try { meta = await sharp(abs).metadata(); } catch (e) { meta = {}; }
    const why = TH.frameRefusal(plan.model, { width: meta.width, height: meta.height, bytes: fs.statSync(abs).size });
    if (why) throw Object.assign(new Error(why), { status: 400 });
  }
  say(I18N.t('sending the frame and the read'));
  const imageUrl = await _hostLocal(plan.frame.path, { forceFresh: true, verify: true });
  const audioUrl = await _hostRead(plan);
  const req = _clipRequest(plan, imageUrl, audioUrl);
  say(I18N.t('asking kie.ai'));
  ask(true);                                    // THE PAID MOMENT
  let taskId;
  try {
    taskId = await _kieClip(req.model, req.input);
  } catch (e) {
    if (e.unsure) throw new Error(I18N.t('{why} - it may have been paid for and not followed; look at kie.ai’s own history before asking again', { why: e.message }));
    ask(false);
    throw e;
  }
  console.log('[scen3/clip] line ' + (i + 1) + ' ' + plan.model + ' ' + plan.quality.id + ' ' + plan.take.dur.toFixed(1) + 's'
    + (plan.pad ? ' padded to ' + plan.pad + 's' : '') + ' motion=' + plan.motionFrom + ' -> ' + String(taskId).slice(0, 24));
  return {
    taskId, engine: plan.quality.model,
    file: {
      projectId: id, line: i, variant: plan.variant, said: plan.said,
      fromFrame: plan.frame.id, fromAudio: plan.take.path,
      model: plan.model, quality: plan.quality.id, preset: _normVideo(proj.video).preset,
      dur: plan.take.dur,
      // OmniHuman's clip is cut to the read's own length when it is filed: a padded read's, and any other - kie gives
      // the clip in whole seconds (a 4.28 s read comes back 5.02 s long).
      ...(plan.pad || plan.model === 'omnihuman' ? { cutTo: plan.take.dur } : {}),
    },
  };
}

// The rows being asked for now, in this process - their poll waits; every row made since this process started is
// this process's.
const _clipAsking = new Set();
const CLIP_BOOT_AT = Date.now();
// The row is written first; the asking goes on without the page, and what comes of it is written into the row - the
// task number and "rendering", or the failure.
function _startClip(rec, request) {
  _clipAsking.add(rec.id);
  const mark = (asked) => {
    const row = ALERTS.get(rec.id);
    if (row && row.job) ALERTS.update(rec.id, { job: { ...row.job, params: { ...(row.job.params || {}), asked } } });
  };
  return _submitClip(request, (st) => ALERTS.update(rec.id, { stage: st }), mark)
    .then((out) => {
      ALERTS.update(rec.id, {
        taskIds: [out.taskId], engine: out.engine, stage: I18N.t('rendering'),
        job: { type: 'clip', params: { request, file: out.file, asked: true } },
      });
    })
    .catch((e) => {
      console.error('[scen3/clip] fragment ' + (Number(request.line) + 1) + ':', e.message);
      ALERTS.fail(rec.id, e.message, REFUSAL.isRefusal(e.message) ? { refused: true } : undefined);
    })
    .finally(() => _clipAsking.delete(rec.id));
}

router.post('/scen3/fragments/clip', async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    const i = parseInt(b.line, 10);
    const plan = _clipPlan(proj, i);
    if (plan.skipped) return res.json({ success: true, skipped: plan.skipped });
    const keys = _clipKeysMissing();
    if (keys) return res.json({ success: true, skipped: keys });
    // One clip per fragment at a time: the journal is asked rather than a flag on the project, so a
    // reload or a second tab cannot start the same clip twice.
    const running = ALERTS.list().some(r => r.state === 'running' && r.what === 'clip'
      && r.job && r.job.params && r.job.params.file
      && String(r.job.params.file.projectId) === id && Number(r.job.params.file.line) === i);
    if (running) return res.json({ success: true, skipped: I18N.t('this fragment is already being made'), code: 'already' });

    // THE ROW IS WRITTEN FIRST, before any agent is asked anything. A clip
    // begins with up to two analyses, and the half-minute they take would otherwise show the person
    // nothing but a spinner on the button. The journal has the row from the press, with no task
    // number yet and the stage saying what is being looked at; the row is also what stops a second
    // press starting the same fragment twice, and what puts the waiting back after a reload.
    const request = { projectId: id, line: i };
    const rec = JOBS.submitted({
      kind: 'video', what: 'clip',
      title: I18N.t('Clip · fragment {n}', { n: _lineNo((proj.lines || []).map(_normLine), i) }),
      where: b.where || null,
      stage: I18N.t('getting ready'),
      taskIds: [],
      job: { type: 'clip', params: { request, file: { projectId: id, line: i }, asked: false } },
    });
    res.json({ success: true, alertId: rec.id });

    // And the rest happens without the page: the analyses, the hosting and the task go on here, and
    // whatever comes of them is written into that row. The page follows the row, so a closed tab
    // loses nothing - and an answer that waited for all of this would be a minute of silence.
    _startClip(rec, request);
  } catch (e) {
    console.error('[scen3/fragments/clip]', e.message);
    if (!res.headersSent) res.status(e.status || 502).json({ success: false, error: e.message });
  }
});

/* ── EVERY CLIP OF A PROJECT, ASKED FOR BY THE SERVER ───────────────
   POST /api/scen3/fragments/clips  { projectId, key }
       -> { success, queued: [{ line, alertId }], skipped: [{ line, why }] }

   WHY THIS EXISTS. A page walking the fragments itself - a few at once, and the next only after
   those had LANDED, minutes later - leaves the rest never asked for once the page holding the loop
   is gone. A run that belongs to a page is lost
   with the page; that is the rule the journal was built on, and this is the clips obeying it.

   So: one call works out what can be made, writes a journal row for every one of them AT ONCE - so
   the whole list is visible from the press - answers, and then sends them one a second without
   waiting for any to finish. A fragment that refuses (no words, no frame, a stale read, a read
   longer than the model takes) is named in `skipped` and stepped over; one that is already being
   made is left alone; one that already has its clip is not paid for twice.

   A FAILURE STOPS NOTHING. A render that fails is already paid
   for and says nothing about its neighbours, so it fails its own row and the rest go on. Nor does
   the queue lock anything: a fragment's own button stays live throughout, and the only bar is the
   old one - one clip per fragment at a time.
   ─────────────────────────────────────────────────────────────────────────── */

// Does this fragment already have its clip - a take made from the frame it opens on, of the words
// it says now? The same question the panel asks (js/merge-v3/wk-fragments.js, _clipState), asked
// here because the server is the one deciding what to pay for.
// A clip is fresh only when it was lipsynced to the read the line has NOW - a read again with the same
// words is another performance (a clip with no read recorded counts as fresh). A clip
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
// line has been taken off. The address and `spot` keep the index: that is what opens it.
const _whereClip = (key, title, i, n) => ({
  page: 'merge',
  href: '/merge?p=' + encodeURIComponent(key) + '&step=setup&line=' + (i + 1),
  label: I18N.t('Merge · {project} · fragment {n}', { project: title, n: n || i + 1 }),
  spot: { key, step: 'setup', line: i + 1 },
});
/** A line's place among the lines that are in the video, counted from one. */
function _lineNo(lines, i) {
  let n = 0;
  for (let k = 0; k <= i && k < lines.length; k++) if (!lines[k].removed) n++;
  return n;
}

// The queue itself: a start a second, and nobody waits for anybody. What comes of each start is
// written into the row it belongs to - the task number and "rendering", or the failure (_startClip).
async function _clipQueue(queued) {
  for (let k = 0; k < queued.length; k++) {
    if (k) await _wait(SUBMIT_GAP_MS);
    _startClip(queued[k].rec, queued[k].request);
  }
}

router.post('/scen3/fragments/clips', (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: I18N.t('no such project') });
    const key = String(b.key || '');
    const title = String(proj.name || proj.title || I18N.t('talking head'));
    const lines = (proj.lines || []).map(_normLine);

    // The journal is what says a fragment is already being made - not a flag on the project - so a
    // second press, a reload or another tab cannot start the same one twice.
    const busy = new Set(ALERTS.list()
      .filter(r => r.state === 'running' && r.what === 'clip' && r.job && r.job.params && r.job.params.file
        && String(r.job.params.file.projectId) === id)
      .map(r => Number(r.job.params.file.line)));

    // No line without the keys - said once, before any row.
    const keys = _clipKeysMissing();
    if (keys) return res.status(400).json({ success: false, error: keys });
    // Every line that needs a clip.
    const queued = [], skipped = [];
    for (let i = 0; i < lines.length; i++) {
      if (busy.has(i)) { skipped.push({ line: i + 1, why: I18N.t('already being made'), code: 'already' }); continue; }
      const plan = _clipPlan(proj, i);
      if (plan.skipped) { skipped.push({ line: i + 1, why: plan.skipped }); continue; }
      if (_clipDone(proj, i)) { skipped.push({ line: i + 1, why: I18N.t('already clipped'), code: 'already' }); continue; }
      const request = { projectId: id, line: i };
      const no = _lineNo(lines, i);
      const rec = JOBS.submitted({
        kind: 'video', what: 'clip',
        title: I18N.t('Clip · fragment {n}', { n: no }),
        where: _whereClip(key, title, i, no),
        stage: I18N.t('getting ready'),
        taskIds: [],
        job: { type: 'clip', params: { request, file: { projectId: id, line: i }, asked: false } },
      });
      queued.push({ line: i + 1, alertId: rec.id, request, rec });
    }
    console.log('[scen3/clips] ' + id + ' queued=' + queued.length + ' skipped=' + skipped.length);
    res.json({ success: true, queued: queued.map(q => ({ line: q.line, alertId: q.alertId })), skipped });
    if (queued.length) _clipQueue(queued).catch(e => console.error('[scen3/clips]', e.message));
  } catch (e) {
    console.error('[scen3/fragments/clips]', e.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
});

// The runner's side. `poll` reads the task with _fetchClip, so a clip lands downloaded once,
// normalised, postered, measured. A "fetch failed" from kie means the task never started and
// nothing was charged - the files are re-hosted and the task asked again, once.
JOBS.register('clip', {
  timeoutMs: 15 * 60 * 1000,
  poll: async (rec) => {
    if (!rec.taskIds || !rec.taskIds[0]) {
      // Nothing to poll yet: the row was written at the press and the analyses, the hosting or the asking are still
      // going on in this process (the stage says which) - a row made since this process started is this process's.
      if (_clipAsking.has(rec.id) || (Date.parse(rec.startedAt) || 0) >= CLIP_BOOT_AT) return { state: 'pending' };
      // Nobody is asking and there is no task: the app was closed meanwhile. Asked - it may have been paid for.
      const asked = !!(((rec.job || {}).params || {}).asked);
      return { state: 'failed', error: asked
        ? I18N.t('the app closed while kie.ai was being asked - it may have been paid for: look at kie.ai’s history before trying again')
        : I18N.t('the app closed before kie.ai was asked - nothing was paid; try again') };
    }
    const p = _fileParams(rec);
    const s = await _fetchClip(rec.taskIds[0], p.projectId, p.cutTo);
    if (s.state !== 'failed') return s;
    const tries = Number((rec.job.params || {}).refetch || 0);
    if (!_FETCH_FAIL_RE.test(String(s.error || '')) || tries >= 1) return s;
    // Nothing rendered, nothing charged: fresh links and one more ask.
    try {
      const mark = (asked) => {
        const row = ALERTS.get(rec.id);
        if (row && row.job) ALERTS.update(rec.id, { job: { ...row.job, params: { ...(row.job.params || {}), asked } } });
      };
      const again = await _submitClip(rec.job.params.request, (st) => ALERTS.update(rec.id, { stage: st }), mark);
      ALERTS.update(rec.id, { job: { ...rec.job, params: { ...rec.job.params, refetch: tries + 1, file: again.file } } });
      console.log('[scen3/clip] re-asked with fresh links ->', String(again.taskId).slice(0, 24));
      return { state: 'pending', taskId: again.taskId };
    } catch (e) {
      return { state: 'failed', error: I18N.t('{error} (and the retry failed: {why})', { error: s.error, why: e.message }) };
    }
  },
  file: async (rec, landed) => {
    const p = _fileParams(rec);
    const list = _loadProjects();
    const proj = list.find(x => String(x.id) === String(p.projectId));
    if (!proj) throw new Error(I18N.t('the project is gone'));
    proj.lines = (proj.lines || []).map(_normLine);
    const line = proj.lines[Number(p.line)];
    if (!line) throw new Error(I18N.t('that fragment is gone'));
    const clip = _normTake({
      path: landed.path, dur: landed.dur, thumb: landed.thumb, at: new Date().toISOString(),
      said: p.said, fromAudio: p.fromAudio, fromFrame: p.fromFrame,
      preset: p.preset, quality: p.quality, model: p.model || 'kling',
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
    MIRROR.touch(proj.id, { project: proj });   // the timeline mirrors the lines: a clip filed
    // The preview's proxy, made now rather than on the first play in Merge.
    try { require('./proxies').warmProxies([landed.path], 480); } catch (e) { /* cosmetic */ }
    return { path: landed.path, preview: landed.thumb || '', media: 'video', line: Number(p.line) + 1, dur: landed.dur };
  },
  // TRY AGAIN from Alerts: the row restarts at once and the asking goes on behind it - the analyses and the hosting take
  // a while, and the person should see the row running from the press (lib/gen-jobs.js `later`).
  submit: async (request, rec) => {
    const keys = _clipKeysMissing();
    if (keys) throw new Error(keys);
    return {
      stage: I18N.t('getting ready'), params: { asked: false, refetch: 0 },
      later: () => _startClip(ALERTS.get(rec.id) || rec, request),
    };
  },
  busy: (rec) => _clipAsking.has(rec.id),
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
    if (!key) return res.status(400).json({ success: false, error: I18N.t('no ElevenLabs key in settings') });

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
    if (!key) return res.status(400).json({ success: false, error: I18N.t('no ElevenLabs key in settings') });
    const b = req.body || {};
    const owner = String(b.ownerId || '').trim();
    const voice = String(b.voiceId || '').trim();
    const name  = String(b.name || '').trim() || 'Library voice';
    if (!owner || !voice) return res.status(400).json({ success: false, error: I18N.t('ownerId and voiceId are required') });

    const r = await axios.post(`${EL_BASE}/voices/add/${owner}/${voice}`,
      { new_name: name }, { headers: { 'xi-api-key': key }, timeout: 30000 });
    const id = (r.data && (r.data.voice_id || r.data.voiceId)) || '';
    if (!id) return res.status(502).json({ success: false, error: I18N.t('ElevenLabs added no voice id'), detail: r.data });
    console.log('[scen3/voices] took', name, '->', id);

    // Do we already know this voice? Taking one we have is an ordinary thing to do - the
    // library search does not hide what is already ours, so the same voice can be found twice
    // and cast for a second character.
    //
    // The add above is idempotent - measured: adding a voice the account already holds returns
    // the SAME id and the account count does not move - so no slot is spent either way, and it
    // doubles as the way back in if the slot had been released. What a take WOULD spend is a
    // fresh 30-second demo through TTS every time, the shelf pointed at the new file and the
    // old mp3 left on disk with nothing referencing it. So when the shelf
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
    // tags, and the public owner id that can add it back - is readable only while the slot exists, and
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

router.loadProjects = _loadProjects;
// The frame rule, for the timeline mirror (lib/frag-mirror.js): the pool in the order the frames
// stand in, and which of them a line opens on. One rule, read by the page, by the agent that writes
// the animation prompts and by the cut on the timeline.
router.framePool = _framePool;
// The frames chat (routes/scen3-fchat.js).
router.fchatFacts = _fchatFacts;
router.fchatRead = _fchatRead;
router.addChatFrame = _addChatFrame;
router.frameOfLine = _frameOfLine;
// THE REQUEST one clip of line `i` would send to kie.ai, with the frame and the read as already hosted at `urls`
// ({ image, audio }) - for the stands: nothing is hosted, padded or asked. { skipped } when the line cannot be clipped.
router.clipRequest = (proj, i, urls) => {
  const plan = _clipPlan(proj, i);
  if (plan.skipped) return { skipped: plan.skipped };
  const u = urls || {};
  return { ..._clipRequest(plan, u.image, u.audio), pad: plan.pad, cutTo: plan.pad || plan.model === 'omnihuman' ? plan.take.dur : 0 };
};
// Is the script being read now? Its captions are heard by themselves after the last read lands
// (lib/captions-auto.js).
router.readsRunning = (id) => !!((_reads.get(String(id)) || {}).running);
module.exports = router;
