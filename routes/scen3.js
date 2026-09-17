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
    // One format, and it is called what the UI calls it. Forced rather than read: this
    // store has never held anything else, and the old `ugc_ad` id died with v2.
    type:      'talking_head',
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
    createdAt: src.createdAt || now,
    updatedAt: src.updatedAt || now,
  };
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
    // A narrator can be read more than once, and the readings do not write alike. Which one wrote
    // this is the difference between provenance and a name.
    narratorReadingId: String(s.narratorReadingId || ''),
    narratorReading: String(s.narratorReading || ''),
    // The hook is the one line the whole script had to deliver on, so it is worth keeping
    // beside the result: reading them together is how you tell a script that kept its promise
    // from one that wandered.
    hook:       String(s.hook       || ''),
    language:   String(s.language   || ''),
    tone:       String(s.tone       || ''),
    model:      String(s.model      || ''),
    humanized:  !!s.humanized,
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
// saved, and offered in that field's dropdown from then on. Deleting an option
// only removes the suggestion — scenarios already using the value keep it,
// because each record stores its own plain string.
// ════════════════════════════════════════════════════════════════════════════

const OPT_KINDS = ['verticals', 'products', 'roles'];

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

// Removes one suggestion from one list. Body: { kind, value }.
router.post('/scen3/options/delete', (req, res) => {
  try {
    const kind  = String((req.body || {}).kind  || '');
    const value = String((req.body || {}).value || '').trim();
    if (!OPT_KINDS.includes(kind)) return res.status(400).json({ success: false, error: 'bad kind' });
    if (!value) return res.status(400).json({ success: false, error: 'value required' });
    const o = _loadOptions();
    o[kind] = o[kind].filter(x => String(x).trim().toLowerCase() !== value.toLowerCase());
    _saveOptions(o);
    res.json({ success: true, options: _sorted(o) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The narrator's gender lives on the single role entry (one presenter).
const _genderOf = s => String(((s.roles || [])[0] || {}).gender || '').toLowerCase();

// WHICH LIBRARY A SCENARIO BELONGS TO is decided by one thing: whether it carries provenance.
// A scenario written by hand on this page has none; one generated in Library 2 records what it
// was written from and in whose voice. So the two libraries are not two stores - they are one
// store read two ways, which is why a generated scenario can still be edited here.
const _libOf = s => (s.origin ? 'library2' : 'library1');

const _summary = s => ({
  id: s.id, title: s.title, type: s.type,
  vertical: s.vertical, product: s.product, roles: s.roles, archived: !!s.archived,
  gender: _genderOf(s),
  lib: _libOf(s),
  // Enough of the provenance for a row to say where it came from, without the hook and the
  // model ids a list has no use for.
  origin: s.origin ? {
    narratorName: s.origin.narratorName || '',
    sourceTitle: s.origin.sourceTitle || '',
    topicTitle: s.origin.topicTitle || '',
  } : null,
  lineCount: (s.lines || []).length,
  createdAt: s.createdAt, updatedAt: s.updatedAt,
});
// The full record carries the WHOLE provenance, not the three fields a list row needs: opening
// one scenario is exactly when the hook, the language and the model become worth reading.
const _full = s => ({ ..._summary(s), lines: s.lines || [], origin: s.origin || null });

// ── List: summaries only, most recently edited first ────────────────────────
// ?lib=library1 | library2 narrows the list to hand-written or generated scenarios. Filtered
// HERE rather than in each page, so the two callers cannot disagree about what "generated"
// means - the answer is "it has provenance", and only this file knows that.
//
// The counts of both libraries come back either way: a picker that cannot say how many are on
// the other side is a picker you have to click to understand.
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
    const want = ['library1', 'library2', 'archive'].includes(asked) ? asked : '';
    const list = want === 'archive' ? all.filter(s => s.archived)
      : want ? live.filter(s => _libOf(s) === want) : live;
    res.json({
      success: true,
      scenarios: list.map(_summary),
      lib: want || 'all',
      counts: {
        library1: live.filter(s => _libOf(s) === 'library1').length,
        library2: live.filter(s => _libOf(s) === 'library2').length,
        all: live.length,
        archive: all.length - live.length,
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

// ── Upsert by id: creates when the id is unknown, else saves edits in place ──
// This is what line edits and renames hit (autosaved, no Save button).
router.post('/scen3/scenarios', (req, res) => {
  try {
    const b    = req.body || {};
    const now  = new Date().toISOString();
    const list = _load();
    const i    = b.id != null ? list.findIndex(x => String(x.id) === String(b.id)) : -1;

    if (i >= 0) {
      // keep the original id + createdAt; the request may only carry changed fields
      const merged = _norm({ ...list[i], ...b, id: list[i].id, createdAt: list[i].createdAt }, now);
      merged.updatedAt = now;
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
router.GENDERS = GENDERS;

// How many scenarios are in one library. Exported for Library 2's badge, which needs the number
// without the rows - and which must not decide for itself what "generated" means.
router.countByLib = function countByLib(lib) {
  return _load().filter(s => _libOf(s) === lib).length;
};

// ── Duplicate: same content, fresh id + dates, " copy" appended to the title ─
router.post('/scen3/scenarios/:id/duplicate', (req, res) => {
  try {
    const list = _load();
    const src  = list.find(x => String(x.id) === String(req.params.id));
    if (!src) return res.status(404).json({ success: false, error: 'not found' });
    const now  = new Date().toISOString();
    const copy = _norm({
      ...src, id: _newId(list), title: `${src.title} copy`, createdAt: now, updatedAt: now,
    }, now);
    list.unshift(copy);
    _save(list);
    res.json({ success: true, scenario: _full(copy) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Delete one scenario (single id only, never a bulk wipe) ─────────────────
router.delete('/scen3/scenarios/:id', (req, res) => {
  try {
    const list = _load();
    const next = list.filter(x => String(x.id) !== String(req.params.id));
    if (next.length === list.length) return res.status(404).json({ success: false, error: 'not found' });
    _save(next);
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
const { toDiskWithin, toUrl } = require('../lib/media');
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

// POST { path } -> { path: '/media/.../preview/<name>.jpg' }
// Returns the source path unchanged when it is already small enough to be its
// own preview, so the client never has to special-case that.
router.post('/scen3/preview1k', async (req, res) => {
  try {
    const src = String((req.body || {}).path || '');
    const hit = _resolveMedia(src);
    if (!hit) return res.status(400).json({ success: false, error: 'path outside the media folders' });
    if (!fs.existsSync(hit.abs)) return res.status(404).json({ success: false, error: 'source not found' });
    if (/(^|\/)(thumbs|preview)\//i.test(hit.rel)) return res.json({ success: true, path: src });

    const { abs: outAbs, url: outUrl } = _previewTarget(hit);

    if (!fs.existsSync(outAbs)) {
      if (!(await needsPreview(hit.abs))) return res.json({ success: true, path: src, note: 'source already small' });
      await makePreview(hit.abs, outAbs);
    }
    res.json({ success: true, path: outUrl });
  } catch (e) {
    console.error('[scen3/preview1k]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// GENERATION
//
// v3 owns its own prompts and endpoints on purpose: the shared
// EXTRACT_CLOTHING_PROMPT in lib/config.js is used by the Character tab, and
// tightening it for knolling here would change that tab's behaviour. Only the
// ENGINE layer is reused (lib/helpers task creators + the shared /api/status
// poller), never routes/lookbook.js or routes/char-store.js.
//
// Every reference image is re-hosted through uploadToPublicHost first: Replicate
// and kie cannot fetch localhost:3000.
// ════════════════════════════════════════════════════════════════════════════

const H = require('../lib/helpers');

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
  + ' Pure white seamless background (#FFFFFF), soft even lighting, no shadows on the background, sharp focus, high detail.'
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
  + ' Pure white seamless background (#FFFFFF), soft even lighting, sharp focus, high detail.'
  + ' No text, no labels, no watermark. 1:1 square.';

// Dressing keeps the sheet's composition; only what is worn may change.
const DRESS_LOCK =
  ' Keep the SAME person, the SAME face, the SAME body, the SAME pose, the SAME framing, crop and background exactly as in the source image.'
  + ' Change ONLY what the person is wearing. Nothing covers the face: no mesh, no net, no veil, no visor, no screen over it.'
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
    'For a costume, say plainly that the person is inside it, that it keeps its own bulk and proportions and does not follow the body underneath, and where the person face shows.',
    'The face always shows fully, uncovered, in an OPEN face opening - never behind mesh, a net, a screen, glass, a visor or a veil. If IMAGE 2 or its description puts one there, write that the opening is open instead.',
    'Never describe the background, the camera or the pose - those stay as they are in IMAGE 1.',
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

// The same ladder the Character page reads photos with, instead of a cascade of this
// popup's own. One place decides which models look at an image, and every step listed
// there answered a live call with a real photo. It also reports what went wrong per
// step - the old path could only say that four models had returned nothing.
//
// Required at call time, not at module scope: cv2-ladders reaches img-providers, which
// reaches helpers, which reaches back here, and that circle resolves to an empty object.
const _ask = (messages) => H.callAIVisionWithFallback(messages, {
  ladder: require('../lib/cv2-ladders').getLadder('vision'), timeout: 60000,
});

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
    'description: 200 words or more, English, written for whoever will later dress a character in this. Say what the look IS, then go through it part by part - head and headwear, shoulders and arms and sleeve length, torso and fastening, waist, hips, legs and hem, feet, hands, and any tail, wings, mask or props. Say how each part sits on a body, what it is made of and what colour it is. For a mascot or full-body costume, say what creature or object it is, how the wearer gets into it, where the wearer face sits and what the proportions are. Be concrete and plain; no marketing language.',
    'A costume ALWAYS leaves the wearer face uncovered in an open face opening, in the prompt and in the description alike: never mesh, a net, a screen, glass, a visor or a veil over it. Whoever wears it will speak to the camera, and the face has to be seen.',
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
// gpt-image-2.5 sunburst, chosen by the owner for lookbooks: 2K, square, opaque. White is
// asked for in the PROMPT - the model's own background setting only offers transparent or
// opaque, and "opaque" is not a colour.
const LB_MODEL_I2I = 'gpt-image-2-5-sunburst-image-to-image';
const LB_MODEL_T2I = 'gpt-image-2-5-sunburst-text-to-image';
// A dressed look is rendered at 4K (see /scen3/gen/dress). Lookbooks stay at 2K: a flat outfit
// on white is read for what it is, not looked into.
const DRESS_RES = '4K';

const _lbTask = (prompt, urls) => (urls && urls.length
  ? _kieTask(LB_MODEL_I2I, { prompt, input_urls: urls, aspect_ratio: '1:1', resolution: '2K', background: 'opaque' })
  : _kieTask(LB_MODEL_T2I, { prompt, aspect_ratio: '1:1', resolution: '2K', background: 'opaque' }));

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

const _engineOf = (b) => String((b || {}).engine || DEFAULT_ENGINE);

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
// does, so the shared /api/status poller routes either by itself.
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
// A frame task names its project, so /api/status and recovery file it into the project's
// frames/; every other result is a candidate and lands in media/work/.
const _track = (tid, tag, projectId) => {
  try {
    const meta = projectId != null && String(projectId).trim() ? { projectId: String(projectId).trim(), sub: 'frames' } : {};
    require('../lib/pending-tasks').addPendingTask(tid, 'work', tag, tag, meta);
  } catch (e) {}
};

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
  // A picture the library already holds - another lookbook, used as the base for this one.
  // Sent as a PATH rather than as bytes: it is on this disk, and pulling it through the
  // browser as base64 only to upload it again would be a round trip for nothing.
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
    if (!taskId) throw Object.assign(new Error('the engine did not accept the task'), { status: 502 });

    // The task is already submitted, so this ~2s call overlaps with the rendering.
    const gender = await _detectGender(note, photoUrl);
    console.log(`[scen3/gen/lookbook] mode=${mode} kind=${plan.kind} gender=${gender || 'unknown'}`);
    return {
      taskId, mode, kind: plan.kind, prompt, gender, refToken,
      description: plan.description,
      engine: LB_MODEL_I2I,
      // What filing it will need when it lands - the same fields the old page sends to finalize.
      file: {
        gender, prompt, description: plan.description, refToken,
        refName: String(b.refName || ''),
      },
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
    // FROM MERGE (`where` says which panel): it becomes a row in Alerts, the server sees it
    // through, and the page only follows the record. The old Scenarios page sends no `where` and
    // is answered exactly as before - it files its own results.
    if (b.where) return res.json({ success: true, alertId: _journal('lookbook', 'image', out, b).id, mode: out.mode, kind: out.kind, refToken: out.refToken });
    _track(out.taskId, 'lbcand');
    res.json({
      success: true, mode: out.mode, kind: out.kind, taskIds: [out.taskId], prompts: [out.prompt],
      gender: out.gender, description: out.description, refToken: out.refToken,
    });
  } catch (e) {
    console.error('[scen3/gen/lookbook]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message, ...(e.refused ? { refused: true } : {}) });
  }
});

// ── Frame parameter presets (global, editable from the popup) ───────────────
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

router.get('/scen3/frame-options', (_req, res) => {
  try { res.json({ success: true, options: _loadFrameOpts() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Whole-set write. An empty list is refused so a slip cannot leave the popup with
// no options at all. No editor UI points here yet — the Sources gear is still a
// stub — but the endpoint is what that editor will use.
router.post('/scen3/frame-options', (req, res) => {
  try {
    const b = req.body || {};
    const cameras  = _normOptList(b.cameras, []);
    const framings = _normOptList(b.framings, []);
    if (!cameras.length || !framings.length) {
      return res.status(400).json({ success: false, error: 'both lists must keep at least one option' });
    }
    const out = { cameras, framings };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    writeFileAtomic(FRAME_OPT_FILE, JSON.stringify(out, null, 2));
    res.json({ success: true, options: out });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

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

function _savePoses(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(POSE_FILE, JSON.stringify(list, null, 2));
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
router.post('/scen3/media-size', async (req, res) => {
  try {
    const p = String((req.body || {}).path || '').trim();
    const hit = _resolveMedia(p);
    if (!hit || !fs.existsSync(hit.abs)) return res.status(400).json({ success: false, error: 'not found: ' + p });
    const m = await sharp(hit.abs).metadata();
    res.json({ success: true, width: m.width || 0, height: m.height || 0 });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/scen3/frame/crop', async (req, res) => {
  try {
    const b   = req.body || {};
    const src = String(b.path || '').trim();
    const r   = b.rect || {};
    const hit = _resolveMedia(src);
    if (!hit || !fs.existsSync(hit.abs)) {
      return res.status(400).json({ success: false, error: `the frame is missing: ${src}` });
    }
    const fx = Number(r.x), fy = Number(r.y), fw = Number(r.w), fh = Number(r.h);
    if (![fx, fy, fw, fh].every(Number.isFinite)) {
      return res.status(400).json({ success: false, error: 'rect must be {x,y,w,h} as fractions of the frame' });
    }
    if (fw < CROP_MIN - 1e-6 || fh < CROP_MIN - 1e-6) {
      return res.status(400).json({ success: false,
        error: `the selection must cover at least a third of the frame — got ${Math.round(fw * 100)}% x ${Math.round(fh * 100)}%` });
    }

    const meta = await sharp(hit.abs).metadata();
    if (!meta.width || !meta.height) return res.status(500).json({ success: false, error: 'could not measure the frame' });

    // fractions -> pixels, then clamped so rounding can never ask for a pixel that
    // is not there (sharp throws on an extract that leaves the image)
    let left = Math.round(fx * meta.width);
    let top  = Math.round(fy * meta.height);
    let w    = Math.round(fw * meta.width);
    let h    = Math.round(fh * meta.height);
    left = Math.max(0, Math.min(left, meta.width  - 1));
    top  = Math.max(0, Math.min(top,  meta.height - 1));
    w    = Math.max(1, Math.min(w, meta.width  - left));
    h    = Math.max(1, Math.min(h, meta.height - top));

    const base = path.basename(hit.abs).replace(/\.[^.]+$/, '');
    const name = `crop_${base}_${Date.now()}.jpg`;
    // Beside its frame, which is a project's working file; a frame from anywhere else (a shelf
    // picture cropped for a one-off) has no project, and its crop is working material.
    const dest = path.join(hit.root === CFG.PROJECTS_DIR ? path.dirname(hit.abs) : CFG.MEDIA.work, name);
    await sharp(hit.abs).extract({ left, top, width: w, height: h }).jpeg({ quality: 94 }).toFile(dest);

    const finalUrl = toUrl(dest);
    const preview  = await _framePreview(finalUrl);
    console.log(`[scen3/frame/crop] ${base} ${meta.width}x${meta.height}`
      + ` -> ${w}x${h} at ${left},${top}`);
    res.json({ success: true, path: finalUrl, preview, width: w, height: h });
  } catch (e) {
    console.error('[scen3/frame/crop]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── First frames (Build mix) ────────────────────────────────────────────────
// The character reference is a 4K SHEET — a 16:9 layout with a portrait beside a
// full-body turnaround — not a photo of someone in a room. The prompt therefore
// has to say "take the person OUT of image 1", or the sheet itself gets dragged
// into the scene as an object, or the turnaround is reproduced as several people.
// With a mannequin the shot is BUILT ON IT: it owns the pose, the camera angle and
// the crop, and the person is grown onto it. The mannequin is blue, jointed and shot
// on a grey studio backdrop, and none of that may survive into the result — hence the
// explicit ban. The word "standing" is deliberately absent: it fought every pose
// where the subject films itself with an arm out past the frame edge.
const FRAME_RULE_POSED =
  'Create ONE photorealistic photograph of ONE real person.'
  + ' IMAGE 1 is a blue artist mannequin and it defines the BODY: reproduce its pose, the tilt and'
  + ' rotation of its head, its shoulder line, the direction and foreshortening of its arms, and the camera'
  + ' angle — exactly, including any arm that reaches toward the lens and runs out past the edge of the frame.'
  + ' The mannequin has no eyes and says nothing about where the person is looking: the GAZE rule decides that.'
  + ' Take the POSE from it, never the crop: the mannequin is photographed at its own shot size, and the'
  + ' SHOT SIZE stated above wins over it.'
  + ' Never render the mannequin itself: no blue material, no ball joints, no seams, no blank faceless head,'
  + ' no grey studio backdrop.'
  + ' IMAGE 2 is a character reference sheet — take ONLY the person from it and keep the same face, hair,'
  + ' skin tone, body and clothing exactly. Never draw the sheet, its panels or its borders, and never show'
  + ' more than ONE person in the result.'
  + ' IMAGE 3 is the location — keep its architecture, furniture, colours and depth, and put the person in it.'
  + ' Natural perspective and contact shadows. No text, no captions, no logos, no watermark.';

// Fallback for a pose that has no mannequin drawn yet: two references, and the
// pose carried by words alone.
const FRAME_RULE_PLAIN =
  'Create ONE photorealistic photograph: the person from IMAGE 1, in the location from IMAGE 2.'
  + ' IMAGE 1 is a character reference sheet — take ONLY the person from it and keep the same face, hair,'
  + ' skin tone, body and clothing exactly. Never draw the sheet, its panels or its borders, and never show'
  + ' more than ONE person in the result.'
  + ' IMAGE 2 is the location — keep its architecture, furniture, colours and depth.'
  + ' The person is centred in the frame. Natural perspective and contact shadows.'
  + ' No text, no captions, no logos, no watermark.';

// THE EYES ALWAYS COME BACK TO THE LENS.
//
// A first frame is the opening of an ad: the person is talking to whoever is holding the
// phone, and a subject looking off past the camera reads as a stock photo of somebody else's
// conversation. Nothing in this prompt used to ask for eye contact, and three things quietly
// argued against it - the mannequin rule copies the head's rotation, six of the sixteen poses
// either say the head is turned aside or say nothing about the gaze at all, and the reading
// pass is asked to describe the head's position.
//
// So the head is left alone and only the EYES are pinned. The pose survives intact - turned
// shoulders, a head in profile, a glance back over one shoulder - and the person still looks
// at the viewer, which is what a face turned three-quarters to camera does in every portrait
// ever taken. Stated as a ranked constraint next to the shot size, because a rule that has to
// beat both the pose description and the reference image has to say so.
const FRAME_GAZE_RULE =
  'GAZE — as important as the shot size, and it outranks the pose and every reference image:'
  + ' the person LOOKS STRAIGHT INTO THE CAMERA LENS, making direct eye contact with the viewer.'
  + ' The head may stay turned, tilted, in profile or looking back over a shoulder exactly as the'
  + ' pose requires — only the EYES turn back to the lens, with both irises and pupils clearly'
  + ' visible and centred on the camera. Never render averted eyes, eyes drifting off-frame, eyes'
  + ' following the direction the head is turned, closed eyes, or a downward glance.';

// Editing an existing frame: the frame already carries its own light, camera and
// framing, so those are NOT restated — repeating them would fight the edit.
//
// The gaze rule is deliberately NOT here. An edit is a sentence somebody typed about this
// picture; if it says "have her look away", the app arguing back would be the bug. To pull an
// old frame's eyes to the lens, ask for it - "look into the camera" - and it happens.
const FRAME_EDIT_RULE =
  'Edit the photograph in the reference image. Keep the same person — same face, hair, skin and clothing —'
  + ' the same location and the same framing, unless the instruction says otherwise. Change ONLY what the'
  + ' instruction asks for, and keep the result one photorealistic photograph of one person.'
  + ' No text, no captions, no logos, no watermark.';

const _cleanText = (s) => String(s || '').replace(/^["'`\s]+|["'`\s]+$/g, '').trim();

// Record the task on the project and start watching it. Without a projectId the
// caller is a one-off (a script, a probe) and there is nowhere to file a result,
// so the frame is simply left to the caller.
function _armWatcher(projectId, taskId, mode, prompt) {
  const id = String(projectId || '').trim();
  if (!id) return;
  const startedAt = new Date().toISOString();
  const ok = _patchMix(id, (mix) => { mix.pending = { taskId, mode, prompt, startedAt }; mix.lastError = ''; });
  if (!ok) { console.warn('[scen3/watch] no project', id, '- not watching', taskId.slice(0, 24)); return; }
  _watchFrame(id, taskId, { mode, prompt });
}

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
const _poseImageFor = (poseId, framingId) => (_poseFor(poseId, framingId) || {}).file || '';

// Pull the labelled blocks out of the analysis. Anything the model puts before the
// first label is kept as LIGHTING, which is what a label-less answer used to be.
const _BLOCK_KEYS = ['POSE', 'CHARACTER', 'ENVIRONMENT', 'LIGHTING', 'DIRECTION'];
function _splitBlocks(raw) {
  const text = String(raw || '');
  const out = { pose: '', character: '', environment: '', lighting: '', direction: '' };
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
router.post('/scen3/gen/frame/analyze', async (req, res) => {
  try {
    const b        = req.body || {};
    const note     = String(b.note || '').trim();
    const basePath = String(b.basePath || '').trim();

    if (basePath) {
      const hit = _resolveMedia(basePath);
      if (!hit || !fs.existsSync(hit.abs)) {
        return res.status(400).json({ success: false, error: `the frame is missing: ${basePath}` });
      }
      if (!note) return res.status(400).json({ success: false, error: 'describe what to change on this frame' });
      const url = await _hostLocal(basePath);
      const ask = 'Look at this photograph. The user wants this change: "' + note + '".'
        + ' Rewrite that request as one clear, specific instruction for an image editor —'
        + ' name what to change and how it should look afterwards, in the terms a photographer would use.'
        + ' Do not restate what stays the same. Reply with the instruction only, no preamble, no quotes.';
      const raw = await _ask([{
        role: 'user',
        content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url } }],
      }]);
      const intent = _cleanText(raw);
      console.log('[scen3/frame/analyze] edit:', intent.slice(0, 130).replace(/\s+/g, ' '));
      return res.json({ success: true, mode: 'edit', intent });
    }

    // ── COMPOSE: read the mannequin, the character and the location in ONE pass.
    // Every one of the three feeds a different part of the prompt, so each gets its
    // own labelled block instead of a single blob of prose.
    const charPath = String(b.characterPath || '').trim();
    const locPath  = String(b.locationPath  || '').trim();
    if (!charPath || !locPath) {
      return res.status(400).json({ success: false, error: 'both a character and a location are required' });
    }
    for (const [label, p] of [['character', charPath], ['location', locPath]]) {
      const hit = _resolveMedia(p);
      if (!hit || !fs.existsSync(hit.abs)) {
        return res.status(400).json({ success: false, error: `the ${label} image is missing: ${p}` });
      }
    }

    // the mannequin, when the chosen pose has one drawn and it fits the framing group
    const poseRec  = _poseFor(b.poseId, b.framing);
    const posePath = poseRec ? poseRec.file : '';
    const poseUrl  = posePath ? await _hostLocal(posePath) : '';
    const charUrl  = await _hostLocal(charPath);
    const locUrl   = await _hostLocal(locPath);

    const n = poseUrl ? { pose: 1, char: 2, loc: 3 } : { char: 1, loc: 2 };
    const ask = (poseUrl
      ? `IMAGE ${n.pose} is a blue artist mannequin used as a pose reference, `
      : '')
      + `IMAGE ${n.char} is a character reference sheet, IMAGE ${n.loc} is an empty location.`
      + ' Answer in exactly the labelled blocks below, each on its own line, each one plain sentences'
      + ' with no lists and no extra headings.'
      // The pose already knows what it is. Handing that over stops the reading pass
      // guessing at an ambiguous silhouette — folded forearms read as crossed arms
      // rather than as arms merely hanging in front of the body.
      + (poseUrl && poseRec && poseRec.desc
        ? `\nThe mannequin in IMAGE ${n.pose} is posed as: ${poseRec.desc}.`
          + ' Treat that as given and describe how it is actually done in the picture.'
        : '')
      + (poseUrl
        ? '\nPOSE: describe the mannequin\'s BODY precisely enough to reproduce with a real person — the'
          + ' position and tilt of the head, the shoulder line, where each arm goes and how strongly it is'
          + ' foreshortened, which limbs run out past the edge of the frame and at which edge, and the camera'
          + ' height and angle. Do NOT say how much of the body is in shot and do NOT name a shot size:'
          + ' the crop is decided separately and your description must not contradict it.'
          // The eyes are settled by the gaze rule and by nothing else. A mannequin has no eyes,
          // so anything said here about where it "looks" is invented - and it would land in the
          // prompt as a second opinion the generator has to choose between.
          + ' Say nothing about where it is looking or where its gaze is directed: the mannequin has no'
          + ' eyes, and the gaze is decided elsewhere. Describe the head as an angle, not as a direction'
          + ' of attention. Never mention the mannequin\'s material, colour, joints or background.'
        : '')
      + '\nCHARACTER: describe the person on the sheet — face, hair, build, skin tone and the clothing they'
      + ' are wearing, as the traits to preserve.'
      + '\nENVIRONMENT: describe the location — what kind of place it is, its architecture, surfaces, colours'
      + ' and depth, and in one clause where in the frame there is clear space for a person.'
      + '\nLIGHTING: describe the location\'s light precisely enough to composite a person into it convincingly —'
      + ' where the key light comes from, hard or soft, its colour temperature and any cast, how strong the'
      + ' ambient fill is, the character and direction of the shadows, and what time of day it reads as.'
      + (note ? '\nDIRECTION: rewrite this request from the user as clear photographic direction for the shot: "' + note + '".' : '');

    const content = [{ type: 'text', text: ask }];
    if (poseUrl) content.push({ type: 'image_url', image_url: { url: poseUrl } });
    content.push({ type: 'image_url', image_url: { url: charUrl } });
    content.push({ type: 'image_url', image_url: { url: locUrl } });

    const raw = _cleanText(await _ask([{ role: 'user', content }]));
    const blocks = _splitBlocks(raw);

    // `reading` stays in the response for anything still expecting the old shape
    console.log('[scen3/frame/analyze] compose:'
      + ` pose ${blocks.pose.length}ch, character ${blocks.character.length}ch,`
      + ` environment ${blocks.environment.length}ch, lighting ${blocks.lighting.length}ch,`
      + ` direction ${blocks.direction.length}ch` + (poseUrl ? ' | mannequin read' : ' | no mannequin'));
    res.json({
      success: true, mode: 'compose',
      pose: blocks.pose, character: blocks.character,
      environment: blocks.environment, lighting: blocks.lighting,
      reading: blocks.lighting, intent: blocks.direction,
    });
  } catch (e) {
    console.error('[scen3/frame/analyze]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/scen3/gen/frame', async (req, res) => {
  try {
    const b       = req.body || {};
    // The frame is filed onto a project by the watcher, so a project that is not the
    // caller's to change is not theirs to generate into either.
    if (b.projectId != null && String(b.projectId).trim()) {
      const host = _loadProjects().find(p => String(p.id) === String(b.projectId).trim());
      if (host && !OWN.canEdit(host, req.user)) return OWN.refuse(res, host);
    }
    const charPath = String(b.characterPath || '').trim();
    const locPath  = String(b.locationPath || '').trim();
    const note     = String(b.note || '').trim();
    const eng      = _engineOf(b);
    const agg      = MIX_AGGS.includes(b.aggregator) ? b.aggregator : 'kie';
    const aspect   = MIX_FORMATS.includes(b.format) ? b.format : '9:16';
    const quality  = MIX_QUALITIES.includes(b.quality) ? b.quality : '2K';

    const basePath = String(b.basePath || '').trim();
    const intent   = String(b.intent || '').trim();

    // ── EDIT: one reference, the frame itself. Camera, framing and pose are NOT
    // restated — the frame already carries them, and repeating them fights the edit.
    if (basePath) {
      const hit = _resolveMedia(basePath);
      if (!hit || !fs.existsSync(hit.abs)) {
        return res.status(400).json({ success: false, error: `the frame is missing: ${basePath}` });
      }
      const direction = intent || note;
      if (!direction) return res.status(400).json({ success: false, error: 'describe what to change on this frame' });
      const prompt = `${FRAME_EDIT_RULE} Instruction: ${direction}`;
      const taskId = await _i2i(eng, prompt, [await _hostLocal(basePath)], aspect, quality, agg);
      if (!taskId) return res.status(502).json({ success: false, error: 'the engine did not accept the task' });
      _track(taskId, 'frame', b.projectId);
      _armWatcher(b.projectId, taskId, 'edit', prompt);
      console.log(`[scen3/gen/frame] edit on=${agg} engine=${eng} aspect=${aspect} quality=${quality}`);
      return res.json({ success: true, mode: 'edit', taskId, prompt });
    }

    // ── COMPOSE: character + location (+ mannequin), with the structured parameters
    if (!charPath) return res.status(400).json({ success: false, error: 'pick a character first' });
    if (!locPath)  return res.status(400).json({ success: false, error: 'pick a location first' });

    // a missing reference is a bad request, not a server fault
    for (const [label, p] of [['character', charPath], ['location', locPath]]) {
      const hit = _resolveMedia(p);
      if (!hit || !fs.existsSync(hit.abs)) {
        return res.status(400).json({ success: false, error: `the ${label} image is missing: ${p}` });
      }
    }

    // The mannequin is the BASE, so it goes FIRST — the prompt calls it IMAGE 1 and
    // builds the person onto it. Without one the two-reference wording is used.
    const posePath = _poseImageFor(b.poseId, b.framing);
    const urls = [];
    if (posePath) urls.push(await _hostLocal(posePath));
    urls.push(await _hostLocal(charPath),
              await _hostLocal(locPath));

    // Camera optics stay in the prompt; FRAMING does not. Framing is only the
    // filter that decides which poses are offered, and the mannequin already
    // carries the crop — restating it in words just fights the reference.
    const opts = _loadFrameOpts();
    const cam  = opts.cameras.find(c => c.id === String(b.camera || '')) || null;
    const pose = _loadPoses().find(p => p.id === String(b.poseId || '')) || null;
    // The group is still only a filter over the pose list — its NAME never reaches
    // the prompt. What does reach it is its `crop`, as the opening directive.
    const framing = opts.framings.find(f => f.id === String(b.framing || '')) || null;

    // Every block comes from the analysis pass; the pose falls back to the stored
    // wording when there is no mannequin to read.
    const A = {
      pose:        String(b.pose        || '').trim(),
      character:   String(b.character   || '').trim(),
      environment: String(b.environment || '').trim(),
      lighting:    String(b.lighting || b.reading || '').trim(),
    };

    // The crop leads. Buried in the middle of the pose description it was ignored
    // and the shot came back full-length; the shot size has to be the first thing
    // read, stated as where the frame cuts rather than as a name for the shot.
    const parts = [];
    if (framing && framing.crop) {
      parts.push(`SHOT SIZE — the most important constraint, obey it before anything else:`
        + ` ${framing.crop}. Frame the person exactly this way and do not pull back to fit more of the body in.`);
    }
    // Beside the shot size, and before the pose it has to outrank.
    parts.push(FRAME_GAZE_RULE);
    parts.push(posePath ? FRAME_RULE_POSED : FRAME_RULE_PLAIN);
    if (cam) parts.push(`Camera: ${cam.prompt}.`);
    // The stored description leads and the reading fills in the detail. On its own the
    // reading can describe folded forearms without ever naming them as crossed arms.
    const poseDesc = (pose && pose.desc) ? pose.desc : '';
    const poseText = [poseDesc, A.pose].filter(Boolean).join('. ');
    if (poseText)      parts.push(`Body position to reproduce — the person is ${poseText}`);
    if (A.character)   parts.push(`The person to keep: ${A.character}`);
    if (A.environment) parts.push(`The location: ${A.environment}`);
    if (A.lighting)    parts.push(`Match the location lighting exactly — ${A.lighting}`);
    // the user's own steering, cleaned up by the reading pass
    if (intent)    parts.push(`Additional direction: ${intent}`);
    else if (note) parts.push(`Additional direction: ${note}`);
    const prompt = parts.join(' ');

    const tag = `on=${agg} engine=${eng} aspect=${aspect} quality=${quality} refs=${urls.length}`
      + ` cam=${cam ? cam.id : '-'} crop=${framing && framing.crop ? framing.id : '-'}`
      + ` pose=${pose ? pose.id + (posePath ? '+img(base)' : '(text)') : '-'}`
      + ` blocks=${Object.keys(A).filter(k => A[k]).join('+') || 'none'}`;

    // A dry run assembles everything and returns it WITHOUT creating a task, so the
    // prompt and the reference order can be read before any credits are spent.
    if (b.dryRun) {
      console.log(`[scen3/gen/frame] DRY RUN ${tag}\n  refs: ${urls.join('\n        ')}\n  prompt: ${prompt}`);
      return res.json({ success: true, mode: 'compose', dryRun: true, prompt, refs: urls });
    }

    const taskId = await _i2i(eng, prompt, urls, aspect, quality, agg);
    if (!taskId) return res.status(502).json({ success: false, error: 'the engine did not accept the task' });
    _track(taskId, 'frame', b.projectId);
    _armWatcher(b.projectId, taskId, 'compose', prompt);
    console.log(`[scen3/gen/frame] compose ${tag}`);
    res.json({ success: true, mode: 'compose', taskId, prompt });
  } catch (e) {
    console.error('[scen3/gen/frame]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Environments ────────────────────────────────────────────────────────────
// ONE place, photographed empty, that a person is later put into to speak to the camera. Made
// the way a lookbook is: the agent reads what it was given first, and only then is a picture
// paid for (docs/local-app/PLAN.md, "create environment").
//
// 3:2 AND 4K, on the owner's instruction (2026-09-17). An environment is not one frame but a set
// to take frames FROM: a wide room gives several different vertical 9:16 frames - by the window,
// in the middle, by the wall - with the same place and the same light, so the fragments of a
// video stop looking identical. 4K keeps a vertical slice of it sharp: "4K" is 4096 on the long
// side, so a full-height 9:16 cut of a 3:2 picture is still about 1536x2731.
const ENV_ASPECT = '3:2';
const ENV_RES = '4K';
const ENV_RATIO = 3 / 2;

// Said after whatever the agent wrote, so no rewrite of the words can lose it. The EMPTY rule is
// the one in capitals: a person left in the place is a second person in every frame made from it.
const ENV_TAIL =
  ' A real photograph of a real place, as taken on a modern smartphone: natural light, true colours, real materials with their wear'
  + ' and lived-in detail - not a 3D render, not an illustration, not a stock or showroom look.'
  + ' The place is EMPTY: NO people, no body parts, no reflections or silhouettes of people, no mannequins, no text, no logos, no watermark.'
  + ' Camera at chest height, natural perspective.'
  + ' 3:2 landscape, filling the whole frame edge to edge, no borders.';

// Changing an environment already made: the rest of it is the thing being kept.
const ENV_KEEP =
  ' Keep the SAME place as in the picture - the same architecture, furniture, materials, colours, light and camera -'
  + ' and change only what the prompt asks for.';

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
 */
async function _readEnvironmentIdea({ note, imageUrl, source, shape, choices, canChoose }) {
  const picked = (choices || []).filter(Boolean);
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
  rules.push('prompt: an image-generation prompt, 120-200 words, for a real photograph of the place: what it is, then the foreground, middle ground and background, left and right - objects, materials and colours - and the light: where it comes from, how soft, how warm, what time of day. The place is EMPTY: no people, no body parts, no mannequins, no text, logos or watermarks. Leave open floor space in several parts of the scene - left, centre and right - where a person could stand or sit facing the camera: the picture will be cut into several vertical frames.');
  if (shape && shape.extend && source !== '' && !picked.length) {
    rules.push('The picture is ' + shape.w + 'x' + shape.h + ' and the result is a 3:2 landscape, so it has to be continued to the ' + shape.extend + '. Say so in the prompt in ONE or TWO plain sentences: the place in the picture stays exactly as it is, and it continues to the ' + shape.extend + ' in the same style, light and perspective. Do not describe the added part at length.');
  }
  rules.push('description: 150 words or more, English, for whoever will later compose frames in this place: what the place is; how it is laid out from left to right and from front to back; surfaces, materials and colours; the light - where it comes from, how soft and how warm, what time of day it reads as; where a person can stand or sit and what is behind them there; the camera height. Plain and concrete, no marketing language.');

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
  ? _kieTask(LB_MODEL_I2I, { prompt, input_urls: urls, aspect_ratio: ENV_ASPECT, resolution: ENV_RES, background: 'opaque' })
  : _kieTask(LB_MODEL_T2I, { prompt, aspect_ratio: ENV_ASPECT, resolution: ENV_RES, background: 'opaque' }));

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

// A data URL from the page -> the bytes, what they are, and a token for them.
async function _takeUpload(dataUrl) {
  const raw = String(dataUrl || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw Object.assign(new Error('unreadable photo'), { status: 400 });
  let fmt = '';
  try { fmt = (await sharp(buf).metadata()).format || ''; } catch (e) {}
  if (!fmt) throw Object.assign(new Error('that file is not a picture'), { status: 400 });
  const ext = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', heif: 'heic', avif: 'avif', tiff: 'tif' }[fmt] || 'jpg';
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
  const buf = fs.readFileSync(file);
  let url = _refUrls.get(token);
  if (!url) {
    url = await H.uploadToPublicHost(buf, { ext: path.extname(file).slice(1) || 'jpg' });
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
// Scenarios popup) the agent picks a place itself.
async function _submitEnv(b) {
  let token = '';
  let fresh = false;                             // the photo came in THIS call
  const note = String(b.prompt || '').trim();
  const saved = String(b.imagePath || b.basePath || '').trim();
  const canChoose = Array.isArray(b.choices);
  const choices = canChoose ? b.choices.map(c => String(c || '').trim()).filter(Boolean).slice(0, 6) : [];
  if (!note && !b.imageBase64 && !b.refToken && !saved) {
    throw Object.assign(new Error('describe a place or add a photo'), { status: 400 });
  }
  if (saved && !note && !b.imageBase64 && !b.refToken) {
    throw Object.assign(new Error('say what to change in this environment'), { status: 400 });
  }

  try {
    // The picture, and where it came from: a photo brought now, the same photo again, or an
    // environment already on the shelf.
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
    if (plan.choose) {
      console.log(`[scen3/gen/env] choose: ${plan.options.length} places offered`);
      return { choose: true, why: plan.why, options: plan.options, refToken: token };
    }

    // A place picked for a picture that had none keeps the picture only for its atmosphere.
    const mode = choices.length ? 'picked' : source === 'saved' ? 'edit' : source === 'photo' ? 'photo' : 'draw';
    const prompt = plan.prompt
      + (mode === 'edit' ? ENV_KEEP : '')
      + (mode === 'picked' && url ? ENV_MOOD_ONLY : '')
      + ENV_TAIL;
    const taskId = await _envTask(prompt, url ? [url] : []);
    if (!taskId) throw Object.assign(new Error('the engine did not accept the task'), { status: 502 });
    console.log(`[scen3/gen/env] mode=${mode} aspect=${ENV_ASPECT} res=${ENV_RES}`
      + (shape && shape.extend && mode !== 'picked' ? ` extend=${shape.extend}` : '') + (choices.length ? ` picked=${choices.length}` : ''));
    return {
      taskId, mode, prompt, description: plan.description, refToken: token,
      engine: url ? LB_MODEL_I2I : LB_MODEL_T2I,
      file: { description: plan.description, prompt, refToken: token, refName: String(b.refName || '') },
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
    if (b.where) return res.json({ success: true, alertId: _journal('environment', 'image', out, b).id, mode: out.mode, refToken: out.refToken });
    _track(out.taskId, 'env');
    res.json({ success: true, mode: out.mode, taskId: out.taskId, prompt: out.prompt, description: out.description, refToken: out.refToken });
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

// ── Alerts: the server sees a generation through ────────────────────────────
// A generation started from Merge becomes a row in the journal (lib/alerts.js), and the runner
// (lib/gen-jobs.js) waits for it, files the result and writes the answer back into the row. The
// page that asked only follows the row, so leaving the page loses nothing - which is the whole
// point (docs/local-app/PLAN.md, "Alerts").
//
// `where` is what the panel says about itself - the project, the step, the level inside it - and
// its ABSENCE is what tells these routes they are talking to the old Scenarios page. That page
// files its own results and is not journalled: it is being removed whole (PLAN, phase G) and is
// not touched.
const JOBS = require('../lib/gen-jobs');

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
// lands the page that asked may be closed. Merged into whatever the casting says by then.
function _patchCasting(projectId, patch) {
  const list = _loadProjects();
  const i = list.findIndex(x => String(x.id) === String(projectId));
  if (i < 0) return null;
  const now = new Date().toISOString();
  list[i] = _normProject({ ...list[i], casting: { ...(list[i].casting || {}), ...patch }, updatedAt: now }, now);
  _saveProjects(list);
  return list[i];
}

// The three kinds Merge starts, and what finishing each one means. The waiting is the same for all
// three - ask kie about the task, and the answer lands in media/work.
const _pollTask = (rec) => H.resolveTask(rec.taskIds[0], CFG.MEDIA.work, 'generated');
const _fileParams = (rec) => ((rec.job || {}).params || {}).file || {};

JOBS.register('lookbook', {
  poll: _pollTask,
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
  poll: _pollTask,
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
    // Dressed for a project, so that project wears it - even with nobody looking.
    if (p.projectId) {
      try { _patchCasting(p.projectId, { obrazId: String(saved.obrazId), obrazImage: saved.path }); }
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
  const note = String(b.note || '').trim();           // optional clothing-only steering
  if (!base) throw Object.assign(new Error('basePath is required'), { status: 400 });
  if (!lb && !note) throw Object.assign(new Error('pick a lookbook or write a note'), { status: 400 });

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
  // The same model the lookbooks are made with, on the owner's instruction. 4K by default
  // (the owner, 2026-09-17): the result is a reference sheet that every frame of the ad is
  // built from, so it is the one picture in the chain that must not be soft - and the model's
  // "2K" is 2048 on the LONG side, which leaves a 16:9 sheet 2048x1152 and the portrait on it
  // a few hundred pixels wide.
  const taskId = await _kieTask(LB_MODEL_I2I, {
    prompt, input_urls: urls, aspect_ratio: aspect === 'match_input_image' ? 'auto' : aspect,
    resolution: DRESS_RES, background: 'opaque',
  });
  if (!taskId) throw Object.assign(new Error('the engine did not accept the task'), { status: 502 });
  console.log(`[scen3/gen/dress] ${lb ? 'apply' : 're-dress'} kind=${kind} refs=${urls.length} res=${DRESS_RES}`);
  return {
    taskId, kind, prompt, mode: lb ? 'apply' : 'redress',
    // WHICH ENGINE MADE IT, for the look's record. The pages still send their own engine setting
    // when they save the look, and that setting has not decided anything here since the dressing
    // moved to this model - a look recorded as nano-banana-2 was not made by it.
    engine: LB_MODEL_I2I,
    // A dressed picture is filed as a LOOK on the character, and when the dressing was asked for
    // by a project, that project wears it from then on.
    file: {
      charId: String(b.charId || ''), charName: String(b.charName || 'look'),
      gender: String(b.gender || ''), lookbookPath: lb, engine: LB_MODEL_I2I,
      projectId: String(b.projectId || ''),
    },
  };
}

router.post('/scen3/gen/dress', async (req, res) => {
  try {
    const b = req.body || {};
    const out = await _submitDress(b);
    if (b.where) return res.json({ success: true, alertId: _journal('look', 'image', out, b).id, mode: out.mode, kind: out.kind });
    _track(out.taskId, 'dressed');
    res.json({ success: true, mode: out.mode, kind: out.kind, taskId: out.taskId, prompt: out.prompt, engine: out.engine });
  } catch (e) {
    console.error('[scen3/gen/dress]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// ── Mix 2–5 lookbooks into one new lookbook ─────────────────────────────────
router.post('/scen3/gen/mix', async (req, res) => {
  try {
    const b = req.body || {};
    const paths = (Array.isArray(b.paths) ? b.paths : []).filter(Boolean).slice(0, 5);
    const note  = String(b.note || '').trim();
    const eng   = _engineOf(b);
    if (paths.length < 2) return res.status(400).json({ success: false, error: 'select 2 to 5 lookbooks to mix' });

    const urls = [];
    for (const p of paths) urls.push(await _hostLocal(p));
    const prompt = `Blend the ${urls.length} outfits shown in the reference images into ONE new cohesive outfit,`
      + ' taking the strongest pieces from each so they work together as a single styled look.'
      + (note ? ' Follow these instructions for the mix: ' + note + '.' : '') + KNOLL_TAIL;

    const tid = await _i2i(eng, prompt, urls, '1:1');
    if (!tid) return res.status(502).json({ success: false, error: 'the engine did not accept the task' });
    _track(tid, 'lbcand');
    console.log(`[scen3/gen/mix] ${urls.length} refs engine=${eng}`);
    res.json({ success: true, taskId: tid, prompt });
  } catch (e) {
    console.error('[scen3/gen/mix]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Save a dressed result as an obraz on the character ──────────────────────
// The user chose that dressed looks join the character's own library, so they
// show up on the Character tab too. Writes are APPEND-ONLY and done here rather
// than by shipping the whole array from the browser: /api/userdata/obrazy
// replaces the entire list, and a racing writer could drop entries.
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

router.post('/scen3/obraz-save', async (req, res) => {
  try {
    const out = await _saveObraz(req.body || {});
    res.json({ success: true, ...out });
  } catch (e) {
    console.error('[scen3/obraz-save]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// ── Delete one obraz ────────────────────────────────────────────────────────
// Removes exactly one record and its own folder. Guarded so it can only ever
// unlink inside obrazy/, and it refuses to write when the library will not parse.
router.post('/scen3/obraz-delete', (req, res) => {
  try {
    const id = String((req.body || {}).obrazId || '');
    if (!id) return res.status(400).json({ success: false, error: 'obrazId is required' });
    if (!fs.existsSync(OBRAZY_JSON)) return res.status(404).json({ success: false, error: 'no library' });

    const list = _read(OBRAZY_JSON);
    if (!Array.isArray(list)) {
      return res.status(500).json({ success: false, error: 'obrazy.json is unreadable — refusing to write' });
    }
    const victim = list.find(o => String(o.id) === id);
    if (!victim) return res.status(404).json({ success: false, error: 'not found' });

    const next = list.filter(o => String(o.id) !== id);
    if (next.length !== list.length - 1) {
      return res.status(500).json({ success: false, error: 'refusing to remove more than one record' });
    }
    writeFileAtomic(OBRAZY_JSON, JSON.stringify(next, null, 2));

    // its folder, only if it really sits under media/looks/
    let removedDir = null;
    try {
      const m = String(victim.char || '').match(/^\/media\/looks\/([^/]+)\//);
      if (m) {
        const abs = path.resolve(CFG.OBRAZY_DIR, m[1]);
        const rootAbs = path.resolve(CFG.OBRAZY_DIR);
        if (abs.startsWith(rootAbs + path.sep) && fs.existsSync(abs)) {
          fs.rmSync(abs, { recursive: true, force: true });
          removedDir = toUrl(abs);
        }
      }
    } catch (e) { console.warn('[scen3/obraz-delete] folder cleanup failed:', e.message); }

    console.log(`[scen3/obraz-delete] ${id} removed (library now ${next.length})${removedDir ? ' + ' + removedDir : ''}`);
    res.json({ success: true, removed: id, removedDir, remaining: next.length });
  } catch (e) {
    console.error('[scen3/obraz-delete]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Finalize a finished task ────────────────────────────────────────────────
// The shared /api/status poller drops the result into uploads/. This copies a
// lookbook candidate into the lookbook base, and builds the preview for
// whatever came out, so the popup never has to fetch a full-size file.
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

// The route is the old Scenarios page, which still files its own results.
router.post('/scen3/finalize', async (req, res) => {
  try {
    const body = req.body || {};
    const out = await _fileGenerated(String(body.kind || ''), String(body.path || ''), body);
    res.json({ success: true, ...out });
  } catch (e) {
    console.error('[scen3/finalize]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

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
const VF = require('../lib/voice-filters');
const VD = require('../lib/voice-demo');
const VSHELF = require('../lib/voice-shelf');
const MOOD_FILE = path.join(DATA_DIR, 'scen3-moods.json');

function _normMood(m) {
  const s = (m && typeof m === 'object') ? m : {};
  const tags = Array.isArray(s.tags) ? s.tags.map(t => String(t || '').trim()).filter(Boolean) : [];
  const safe = tags.filter(t => VT.TTS_SAFE_TAGS.includes(t));
  const dropped = tags.filter(t => !VT.TTS_SAFE_TAGS.includes(t));
  if (dropped.length) console.warn(`[scen3/moods] "${s.id}" drops unusable tags:`, dropped.join(', '));
  return {
    id:    String(s.id || '').trim(),
    label: String(s.label || '').trim(),
    note:  String(s.note || '').trim(),   // one line for the interface
    brief: String(s.brief || '').trim(),  // the direction the casting director reads
    tags:  safe,
    active: s.active !== false,
  };
}

function _loadMoods() {
  const cur = _read(MOOD_FILE);
  if (Array.isArray(cur)) {
    const list = cur.map(_normMood).filter(m => m.id && m.label && m.tags.length);
    if (list.length) return list;
  }
  const seeded = VT.AD_MOODS.map(_normMood);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    writeFileAtomic(MOOD_FILE, JSON.stringify(seeded, null, 2));
  } catch (e) {}
  console.log(`[scen3] seeded ${seeded.length} voice moods`);
  return seeded;
}

router.get('/scen3/moods', (_req, res) => {
  try { res.json({ success: true, moods: _loadMoods().filter(m => m.active), role: VT.CASTING_DIRECTOR_ROLE }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Everything the Video section needs to draw itself: how the character may move, which
// lipsync model is wired up, and what the two quality tiers cost. The prompts come with
// it so the page can show exactly what will be sent, without a second round trip.
router.get('/scen3/motion-presets', (_req, res) => {
  res.json({
    success: true,
    presets: MP.MOTION_PRESETS,
    defaultPreset: MP.DEFAULT_PRESET,
    models: MP.VIDEO_MODELS,
    qualities: MP.VIDEO_QUALITIES,
    defaultQuality: MP.DEFAULT_QUALITY,
  });
});

// The whole tag library, for the help panel. Read-only: it is reference material,
// and it carries which tags are delivery instructions, which are voice casting and
// which are body language for the video prompt rather than the spoken text.
router.get('/scen3/voice-tags', (_req, res) => {
  res.json({ success: true, library: VT.LIBRARY, safe: VT.TTS_SAFE_TAGS, motion: VT.MOTION_TAGS });
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
    + '\n- Most lines take one or two tags. Some take none: if a tag would not change how the'
    + ' line is delivered, leave that line untouched.'
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
    + '\n- One or two tags, or none at all if the line is better plain.'
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

router.post('/scen3/voice/tag', async (req, res) => {
  try {
    const id = String((req.body || {}).projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'projectId is required' });

    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: `no project "${id}"` });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);

    const lines = (proj.lines || []).map(_normLine);
    const texts = lines.map(l => l.text);
    if (!texts.some(t => t.trim())) return res.status(400).json({ success: false, error: 'this project has no lines' });

    const voice = _normVoice(proj.voice);
    const mood = _loadMoods().find(m => m.id === voice.mood);
    if (!mood) return res.status(400).json({ success: false, error: 'pick a mood first' });

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
      l.tagged = has ? kept.text : '';
      if (has) report.tagged++; else report.plain++;
    });

    proj.lines = lines;
    // The take on show follows the work: after a pass that produced tags, the tagged
    // read is what the user asked to see.
    proj.voice = voice;
    if (report.tagged > 0 && lines.some(l => l.tagged)) proj.voice.variant = 'tagged';
    proj.updatedAt = new Date().toISOString();
    _saveProjects(list);
    console.log(`[scen3/voice/tag] ${id} mood=${mood.id}`
      + (partial ? ` only=${only.map(i => i + 1).join(',')}` : ' full')
      + ` tagged=${report.tagged} plain=${report.plain}`
      + ` rejected=${report.rejected.length} droppedTags=${report.dropped.length}`);
    res.json({ success: true, project: _projFull(proj), report });
  } catch (e) {
    console.error('[scen3/voice/tag]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

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

async function _speakLine(key, voiceId, model, text, params) {
  const r = await axios.post(
    `${EL_TTS_BASE}/${encodeURIComponent(voiceId)}`,
    {
      text,
      model_id: model,
      voice_settings: {
        stability: typeof params.stability === 'number' ? params.stability : 0.5,
        similarity_boost: 0.75,
        speed: typeof params.speed === 'number' ? params.speed : 1,
      },
    },
    { headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      responseType: 'arraybuffer', timeout: 120000 },
  );
  return Buffer.from(r.data);
}

router.post('/scen3/voice/speak', async (req, res) => {
  try {
    const b  = req.body || {};
    const id = String(b.projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'projectId is required' });

    const key = _elKey();
    if (!key) return res.status(400).json({ success: false, error: 'no ElevenLabs key in settings' });

    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: `no project "${id}"` });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);

    const lines = (proj.lines || []).map(_normLine);
    const voice = _normVoice(proj.voice);
    const variant = voice.variant === 'tagged' ? 'tagged' : 'plain';
    const model = voice.tagsOn && variant === 'tagged' ? EL_MODEL_TAGGED : EL_MODEL_PLAIN;

    // The cast character's voice, and only that. There is no chooser and no override:
    // one ad, one voice. Saying so plainly beats a 404 from ElevenLabs.
    const chars = _read(path.join(DATA_DIR, 'characters.json'));
    const arr = Array.isArray(chars) ? chars : (chars && chars.characters) || [];
    const cast = _normCasting(proj.casting);
    const ch = arr.find(c => String(c.id) === cast.characterId)
            || arr.find(c => String(c.name) === cast.characterName);
    const voiceId = String((ch && ch.voice) || '').trim();
    if (!voiceId) {
      return res.status(400).json({ success: false,
        error: cast.characterName
          ? `"${cast.characterName}" has no voice saved — set one in the Character tab`
          : 'cast a character first: the read uses its voice' });
    }

    // A take is stale when the words it was made from are no longer the words on the
    // line. Without an explicit `only`, this endpoint voices exactly what needs it and
    // silently leaves the rest alone: nobody should pay twice for the same line.
    const textOf = (l) => (variant === 'tagged' ? (l.tagged || '') : (l.text || ''));
    const needs = (l) => {
      const t = (l.audio || {})[variant];
      return !t || !t.path || t.said !== textOf(l);
    };
    const only = Array.isArray(b.only)
      ? [...new Set(b.only.map(n => parseInt(n, 10)).filter(n => n >= 0 && n < lines.length))].sort((a, c) => a - c)
      : lines.map((_, i) => i).filter(i => needs(lines[i]));

    const dir = PROJECTS.dirOf(id, 'voice');

    const report = { variant, model, spoken: 0, skipped: [], failed: [] };
    for (const i of only) {
      const l = lines[i];
      // the take on show is what gets spoken; a tagged take that is not there falls
      // back to nothing rather than silently voicing the other variant
      const text = textOf(l);
      if (!text.trim()) { report.skipped.push(i + 1); continue; }
      try {
        const buf = await _speakLine(key, voiceId, model, text, voice.ttsParams);
        const name = `v${id}_${i + 1}_${variant}_${Date.now()}.mp3`;
        const abs = path.join(dir, name);
        fs.writeFileSync(abs, buf);
        const dur = await _audioDur(abs);
        l.audio = l.audio || { plain: null, tagged: null };
        l.audio[variant] = {
          path: toUrl(abs),
          dur: Math.round(dur * 100) / 100,
          at: new Date().toISOString(),
          said: text,          // what was actually spoken; the staleness check reads this
        };
        report.spoken++;
      } catch (e) {
        const body = e.response && e.response.data
          ? Buffer.from(e.response.data).toString('utf8').slice(0, 200) : (e.message || String(e));
        console.warn(`[scen3/voice/speak] line ${i + 1} failed:`, body);
        report.failed.push({ line: i + 1, error: body });
      }
    }

    proj.lines = lines;
    proj.updatedAt = new Date().toISOString();
    _saveProjects(list);
    console.log(`[scen3/voice/speak] ${id} ${model} ${variant} spoken=${report.spoken}`
      + ` skipped=${report.skipped.length} failed=${report.failed.length}`);
    res.json({ success: true, project: _projFull(proj), report });
  } catch (e) {
    console.error('[scen3/voice/speak]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── server-side frame watcher ───────────────────────────────────────────────
// A generation used to be driven entirely by the page: it polled the task, filed
// the result and appended the frame. Reloading or closing the tab mid-run left the
// image in uploads/ with nothing tying it to the project. The server now watches
// every frame task it starts, so the frame reaches the strip regardless.
//
// Both sides may finish: whoever gets there first appends, and the other sees the
// variant's taskId already present and does nothing. That makes a double commit a
// no-op rather than a duplicate frame.
const _watching = new Set();

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

// Read-modify-write in one synchronous burst, so the page's own save cannot
// interleave with the watcher's.
function _patchMix(projectId, fn) {
  const p = PROJECTS.get(projectId);
  if (!p) return false;
  p.mix = _normMix(p.mix);
  if (fn(p.mix) === false) return false;
  p.updatedAt = new Date().toISOString();
  PROJECTS.save(p);
  return true;
}

function _watchFrame(projectId, taskId, { mode, prompt }) {
  const key = `${projectId}:${taskId}`;
  if (_watching.has(key)) return;
  _watching.add(key);

  const started = Date.now();
  const MAX_MS = 15 * 60 * 1000;

  const tick = async () => {
    if (Date.now() - started > MAX_MS) {
      console.warn('[scen3/watch]', taskId.slice(0, 24), 'gave up after 15 min');
      _patchMix(projectId, (mix) => {
        if (!mix.pending || mix.pending.taskId !== taskId) return false;
        mix.pending = null;
        mix.lastError = 'the generator did not answer within 15 minutes';
      });
      _watching.delete(key);
      return;
    }
    // The project's frames/ - asked for on every tick, so a project renamed meanwhile is followed.
    const FRAMES = PROJECTS.dirOf(projectId, 'frames');
    if (!FRAMES) {
      console.warn('[scen3/watch]', taskId.slice(0, 24), 'the project is gone - not watching');
      _watching.delete(key);
      return;
    }
    let s = null;
    try { s = await H.resolveTask(taskId, FRAMES, 'generated'); } catch (e) { s = null; }

    if (s && s.state === 'success' && s.imagePath) {
      const finalUrl = s.imagePath;
      const preview  = await _framePreview(finalUrl);
      _patchMix(projectId, (mix) => {
        const already = mix.variants.some(v => v.taskId === taskId);
        if (!already) {
          mix.variants.unshift({
            id: 'f' + Date.now(), path: finalUrl, preview,
            prompt: prompt || '', at: new Date().toISOString(), taskId,
          });
          mix.activeId = mix.variants[0].id;
          mix.note = '';
          console.log('[scen3/watch]', taskId.slice(0, 24), '-> filed into project', projectId);
        } else {
          console.log('[scen3/watch]', taskId.slice(0, 24), '-> the page already filed it');
        }
        if (mix.pending && mix.pending.taskId === taskId) mix.pending = null;
        mix.lastError = '';
      });
      _watching.delete(key);
      return;
    }

    if (s && s.state === 'failed') {
      console.warn('[scen3/watch]', taskId.slice(0, 24), 'failed:', s.error || '');
      _patchMix(projectId, (mix) => {
        if (!mix.pending || mix.pending.taskId !== taskId) return false;
        mix.pending = null;
        mix.lastError = String(s.error || 'generation failed');
      });
      _watching.delete(key);
      return;
    }
    setTimeout(tick, 4000);
  };
  setTimeout(tick, 4000);
  console.log(`[scen3/watch] watching ${taskId.slice(0, 24)} for project ${projectId} (${mode})`);
}

// ── video: watching a clip ──────────────────────────────────────────────────
// Mutate one project and save. The line-level twin of _patchMix: a render finishes on
// its own schedule, so whoever files it has to write straight to the store rather than
// hand something back to a page that may be long gone.
function _patchProj(projectId, fn) {
  const p = PROJECTS.get(projectId);
  if (!p) return false;
  p.lines = Array.isArray(p.lines) ? p.lines.map(_normLine) : [];
  if (fn(p) === false) return false;
  p.updatedAt = new Date().toISOString();
  PROJECTS.save(p);
  return true;
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

// The render marker as it is STORED, for the moments a decision depends on what is on disk
// rather than on what this watcher was started with.
function _lineRenderOf(projectId, idx) {
  try {
    const p = _loadProjects().find(x => String(x.id) === String(projectId));
    const l = p && (p.lines || [])[idx];
    return l && l.render ? _normRender(l.render) : null;
  } catch (e) { return null; }
}

async function _retryClipFetch(projectId, idx, prev) {
  const proj = _loadProjects().find(p => String(p.id) === String(projectId));
  if (!proj) return null;
  const line = (proj.lines || []).map(_normLine)[idx];
  if (!line) return null;
  const frame = (_normMix(proj.mix).variants || []).find(v => v.id === prev.fromFrame);
  if (!frame || !frame.path || !prev.fromAudio) return null;

  // Both files again, under new keys: there is one host, so the retry that helps is a fresh
  // upload - a signature with its whole life ahead of it, and a link no cache can hand back cold.
  const imageUrl = await _hostLocal(frame.path, { forceFresh: true, verify: true });
  const audioUrl = await _hostLocal(prev.fromAudio,
    { forceFresh: true, verify: true, exts: /\.(mp3|wav|m4a|ogg)$/i });

  const quality = MP.qualityById(prev.quality) || MP.qualityById(MP.DEFAULT_QUALITY);
  const prompt = MP.promptFor(prev.preset);
  const taskId = await _kieTask(quality.model, { image_url: imageUrl, audio_url: audioUrl, prompt });
  const ok = _patchProj(projectId, (p) => {
    p.lines = p.lines.map(_normLine);
    const l = p.lines[idx];
    if (!l.render || String(l.render.taskId) !== String(prev.taskId)) return false;   // moved on
    l.render = _normRender({ ...prev, taskId, error: '', audioUrl,
      retry: prev.retry + 1, startedAt: new Date().toISOString() });
  });
  if (!ok) return null;
  console.log('[scen3/clip] resubmitted line', idx + 1, 'with fresh links ->', String(taskId).slice(0, 24));
  return taskId;
}

function _watchClip(projectId, idx, taskId) {
  const key = `clip:${projectId}:${taskId}`;
  if (_watching.has(key)) return;
  _watching.add(key);

  const started = Date.now();
  // Twelve minutes, not twenty. Twenty was cover for failures being misread as "pending"
  // (see H.readKieRecord) - a dead job was polled to the timeout and then reported as one
  // that never answered. With the answer read properly, kie is quick about both outcomes and
  // a job past twelve minutes is not one worth waiting on in silence.
  const MAX_MS = 12 * 60 * 1000;
  let lastState = '';
  // Only the line still waiting on THIS task may be written: by the time an answer
  // lands the user may have re-rendered, and the newer task owns the slot.
  const mine = (l) => l && l.render && l.render.taskId === taskId;
  // The same question asked of the stored project, for the top of each tick. A cancel clears
  // `render`, a re-render replaces its taskId; either way this watcher has nothing left it is
  // allowed to write, so it should stop rather than poll on to its timeout.
  const stillMine = () => {
    try {
      const p = PROJECTS.get(projectId);
      const l = p && (p.lines || [])[idx];
      return !!(l && l.render && String(l.render.taskId) === String(taskId));
    } catch (e) { return true; }        // unreadable store: keep watching rather than drop a job
  };

  const stop = (msg) => {
    _patchProj(projectId, (p) => {
      const l = p.lines[idx];
      if (!mine(l)) return false;
      l.render = { ...l.render, error: msg };
      if (!msg) l.render = null;
    });
    _watching.delete(key);
  };

  const tick = async () => {
    if (!stillMine()) {
      console.log('[scen3/clip]', taskId.slice(0, 24), 'no longer owns line', idx + 1, '- stopping');
      _watching.delete(key);
      return;
    }
    if (Date.now() - started > MAX_MS) {
      console.warn('[scen3/clip]', taskId.slice(0, 24), 'gave up after 12 min, last state:', lastState || '(none)');
      // Say what the renderer was actually doing. "Did not answer" was never true - it answered
      // every five seconds, and what it said is the only useful part of this message.
      return stop('the renderer was still on "' + (lastState || 'no state') + '" after 12 minutes');
    }
    let s = null;
    try { s = await _fetchClip(taskId, projectId); } catch (e) { s = null; }
    if (s && s.raw) lastState = s.raw;

    if (s && s.state === 'success') {
      _patchProj(projectId, (p) => {
        const l = p.lines[idx];
        if (!mine(l)) return false;
        const r = l.render;
        const clip = _normTake({
          path: s.path, dur: s.dur, thumb: s.thumb, at: new Date().toISOString(),
          said: r.said, fromAudio: r.fromAudio, fromFrame: r.fromFrame,
          preset: r.preset, quality: r.quality,
        });
        // A new VARIANT, not a replacement: earlier takes stay browsable, whichever frame
        // they came from. The fresh one is what the fragment is set to — it is the thing
        // the user just paid for and asked to see.
        const list = Array.isArray(l.video[r.variant]) ? l.video[r.variant] : [];
        const at = list.findIndex(x => x.id === clip.id);
        if (at >= 0) list[at] = clip; else list.push(clip);
        l.video[r.variant] = list;
        l.pick = { ...(l.pick || {}), [r.variant]: clip.id };
        l.render = null;
      });
      console.log('[scen3/clip]', taskId.slice(0, 24), '-> filed on line', idx + 1);
      // The preview's proxy, made now rather than on the first play in Merge.
      try { require('./proxies').warmProxies([s.path], 480); } catch (e) {}
      _watching.delete(key);
      return;
    }
    if (s && s.state === 'failed') {
      console.warn('[scen3/clip]', taskId.slice(0, 24), 'failed:', s.error || '');
      // The renderer could not READ our files: nothing was rendered and nothing was charged,
      // so upload them again and ask again rather than reporting a failure the user can do
      // nothing about. Once only.
      const now = _lineRenderOf(projectId, idx);
      if (_FETCH_FAIL_RE.test(String(s.error || '')) && now && now.retry < 1
          && String(now.taskId) === String(taskId)) {
        let next = null;
        try { next = await _retryClipFetch(projectId, idx, now); }
        catch (e) { console.warn('[scen3/clip] resubmit failed:', e.message); }
        _watching.delete(key);
        if (next) return _watchClip(projectId, idx, next);
        return stop(String(s.error || 'render failed') + ' - and uploading the files again did not help');
      }
      return stop(String(s.error || 'render failed'));
    }
    setTimeout(tick, 5000);
  };
  setTimeout(tick, 5000);
  console.log(`[scen3/clip] watching ${taskId.slice(0, 24)} for line ${idx + 1} of ${projectId}`);
}

// A server restart must not orphan a task either: pick up whatever was pending.
function _resumeWatchers() {
  try {
    const list = _loadProjects();
    let n = 0;
    let c = 0;
    list.forEach(p => {
      const pend = _normPending((p.mix || {}).pending);
      if (pend) { _watchFrame(p.id, pend.taskId, { mode: pend.mode, prompt: pend.prompt }); n++; }
      (p.lines || []).forEach((l, i) => {
        const r = _normRender(l && l.render);
        if (r && !r.error) { _watchClip(p.id, i, r.taskId); c++; }
      });
    });
    if (n) console.log(`[scen3/watch] resumed ${n} pending frame task(s) after boot`);
    if (c) console.log(`[scen3/clip] resumed ${c} pending clip task(s) after boot`);
  } catch (e) { console.warn('[scen3/watch] resume failed:', e.message); }
}
setTimeout(_resumeWatchers, 1500);

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

// ── Mix workspace ───────────────────────────────────────────────────────────
// The whole state of the Build-mix popup lives on the project, so closing it and
// coming back — even in another session — restores exactly what was there. Each
// project therefore has its own independent workspace.
const MIX_AGGS      = ['kie', 'replicate'];
const MIX_MODELS    = ['nano-banana-2', 'nano-banana-2-lite'];
const MIX_FORMATS   = ['9:16', '2:3', '3:4', '1:1', '16:9'];
const MIX_QUALITIES = ['1K', '2K', '4K'];
const MIX_MODES     = ['same', 'cycle', 'random', 'manual'];

function _normPending(p) {
  const s = (p && typeof p === 'object') ? p : null;
  if (!s || !s.taskId) return null;
  return {
    taskId:    String(s.taskId),
    mode:      s.mode === 'edit' ? 'edit' : 'compose',
    prompt:    String(s.prompt || ''),
    startedAt: String(s.startedAt || ''),
  };
}

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
    })).filter(v => v.id && v.path) : [],
    // A generation the server is watching on the project's behalf, so it lands even
    // if the page is reloaded or closed mid-run. Cleared once the frame is filed.
    pending: _normPending(s.pending),
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
    mix:        _normMix(src.mix),
    name:       String(src.name || '').trim() || 'untitled project',
    scenarioId: src.scenarioId != null ? String(src.scenarioId) : '',
    type:       'talking_head',
    gender:     String(src.gender || '').toLowerCase(),
    title:      String(src.title || ''),
    lines:      Array.isArray(src.lines) ? src.lines.map(_normLine) : [],
    voice:      _normVoice(src.voice),
    video:      _normVideo(src.video),
    // Which section of the Montage column the work has reached. Saved because moving on
    // is a decision, and a reload should not quietly send the user back a step.
    stage:      src.stage === 'video' ? 'video' : 'voice',
    reel:       _normReel(src.reel),
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
  };
}
// The reel as the user approved it in the preview: the clips, in order, with the total
// they add up to. This is the handoff to Merge — an ORDER, not a file. Concatenating is
// Merge's job, and doing it here would only have to be redone after the next re-render.
function _normReel(r) {
  const s = (r && typeof r === 'object') ? r : null;
  if (!s || !Array.isArray(s.clips) || !s.clips.length) return null;
  const clips = s.clips.map(c => ({
    n:    Math.max(0, parseInt((c || {}).n, 10) || 0),
    path: String((c || {}).path || ''),
    dur:  +(c || {}).dur || 0,
  })).filter(c => c.path);
  if (!clips.length) return null;
  return {
    clips,
    total: +(clips.reduce((a, c) => a + c.dur, 0)).toFixed(2),
    variant: s.variant === 'tagged' ? 'tagged' : 'plain',
    at: String(s.at || new Date().toISOString()),
    // Set once the cut reaches Merge, so the page can say it has been sent and where to.
    // Empty until then — not a flag for "ready", just a record of what happened.
    mergeKey: String(s.mergeKey || ''),
    mergedAt: String(s.mergedAt || ''),
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

// Which variant a fragment is SET to. The stored pick wins, but only while it still
// animates the frame the fragment uses — swap the frame from the picker and the pick
// stops applying, so the newest clip of the new frame stands in. One resolver, used by
// the state endpoint and by the reel, so the page and the server never disagree about
// which clip is "the" clip.
function _pickClip(line, variant) {
  const clips = (line.video || {})[variant] || [];
  if (!clips.length) return null;
  const frame = String(line.frameId || '');
  const picked = clips.find(c => c.id === String((line.pick || {})[variant] || ''));
  if (picked && picked.fromFrame === frame) return picked;
  const forFrame = clips.filter(c => c.fromFrame === frame);
  return forFrame.length ? forFrame[forFrame.length - 1] : null;
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
    // A clip being rendered right now. It cannot live in `video` above, which only
    // accepts a take that already has a file — and it has to be on the PROJECT rather
    // than in memory, so a render survives a reload and even a server restart.
    render:  _normRender(s.render),
  };
}

// One clip in flight for one line.
function _normRender(r) {
  const s = (r && typeof r === 'object') ? r : null;
  if (!s || !s.taskId) return null;
  return {
    taskId:  String(s.taskId),
    variant: s.variant === 'tagged' ? 'tagged' : 'plain',
    // Everything needed to file the answer without re-deriving it, and to know later
    // what the clip was made from.
    said:      String(s.said || ''),
    fromAudio: String(s.fromAudio || ''),
    fromFrame: String(s.fromFrame || ''),
    preset:    String(s.preset || ''),
    quality:   String(s.quality || ''),
    startedAt: String(s.startedAt || ''),
    error:     String(s.error || ''),
    // How many times this fragment has been resubmitted after the renderer said it could not
    // fetch our files. On the record rather than in memory so a restart cannot hand out a fresh
    // set of retries.
    retry:     Math.max(0, parseInt(s.retry, 10) || 0),
    audioUrl:  String(s.audioUrl || ''),
  };
}

// Voice settings live on the PROJECT: one read for the whole ad.
const VOICE_PROVIDERS = ['elevenlabs'];

// How the fragments are turned into clips. Three choices and no more: the lipsync model,
// how the character moves, and how sharp the result is. The kie model id is deliberately
// NOT stored — it is derived from the quality at render time, so a tier being renamed
// upstream does not leave old projects pointing at a model that no longer exists.
const _normVideo = (v) => {
  const s = (v && typeof v === 'object') ? v : {};
  return {
    model:   MP.VIDEO_MODELS.some(m => m.id === s.model) ? s.model : 'kling',
    preset:  MP.presetById(s.preset)  ? s.preset  : MP.DEFAULT_PRESET,
    quality: MP.qualityById(s.quality) ? s.quality : MP.DEFAULT_QUALITY,
  };
};
const _normVoice = (v) => {
  const s = (v && typeof v === 'object') ? v : {};
  const p = (s.ttsParams && typeof s.ttsParams === 'object') ? s.ttsParams : {};
  return {
    // Which service speaks the lines. Every field below belongs to it, so a second
    // provider brings its own set rather than borrowing these.
    provider:  VOICE_PROVIDERS.includes(s.provider) ? s.provider : 'elevenlabs',
    // No voice field: the read always uses the CAST CHARACTER's voice. With no way to
    // switch, a take can never have been made with a different voice, so nothing has
    // to be keyed by voice and no take can go stale for that reason.
    tagsOn:    !!s.tagsOn,                  // off -> v2, on -> v3 with tags
    mood:      String(s.mood || ''),        // which mood's tag set the tagger may use
    // The one switch. It decides what the cards show, what Voice all produces, and
    // which take the counters read. Locked to plain while there is nothing tagged.
    variant:   s.variant === 'tagged' ? 'tagged' : 'plain',
    ttsParams: { stability: +p.stability || 0.5, speed: +p.speed || 1 },
  };
};

const _projSummary = p => ({
  id: p.id, name: p.name, scenarioId: p.scenarioId, type: p.type,
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
  const cast = _normCasting((p || {}).casting);
  if (!cast.characterId && !cast.characterName) return { has: false, reason: 'no character cast yet' };
  const chars = _read(path.join(DATA_DIR, 'characters.json'));
  const arr = Array.isArray(chars) ? chars : (chars && chars.characters) || [];
  const ch = arr.find(c => String(c.id) === cast.characterId)
          || arr.find(c => String(c.name) === cast.characterName);
  if (!ch) return { has: false, reason: `"${cast.characterName}" is not in the character library any more` };
  const id = String(ch.voice || '').trim();
  if (!id) return { has: false, reason: `"${ch.name}" has no voice saved — set one in the Character tab` };
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
  stage: p.stage === 'video' ? 'video' : 'voice',
  reel:  _normReel(p.reel),
  mix:   _normMix(p.mix),
});

// Newest first — the dropdown lists the most recent project at the top.
router.get('/scen3/projects', (req, res) => {
  try {
    const list = _loadProjects().slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    // Everyone sees every owner. The picker groups by them; which entries the caller may
    // change is answered per project, from its `owner` against `me`.
    res.json({ success: true, projects: list.map(_projSummary),
               owners: OWN.ownersOf(list, req.user), me: OWN.meView(req.user) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/scen3/projects/:id', (req, res) => {
  try {
    const p = _loadProjects().find(x => String(x.id) === String(req.params.id));
    if (!p) return res.status(404).json({ success: false, error: 'not found' });
    res.json({ success: true, project: _projFull(p) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Create from a scenario ({ scenarioId }), or upsert an existing project by id
// so later phases can persist casting / montage onto it.
router.post('/scen3/projects', (req, res) => {
  try {
    const b    = req.body || {};
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
      // The owner is pinned like the id: a save cannot hand a project to somebody else.
      const merged = _normProject({
        ...list[i], ...b, ...(casting ? { casting } : {}),
        id: list[i].id, owner: list[i].owner || null, createdAt: list[i].createdAt,
      }, now);
      merged.updatedAt = now;
      list[i] = merged;
      _saveProjects(list);
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
      createdAt: now, updatedAt: now,
    }, now);
    list.unshift(rec);
    _saveProjects(list);
    res.json({ success: true, project: _projFull(rec) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Deletes the project only — the source scenario stays in the library.
router.delete('/scen3/projects/:id', (req, res) => {
  try {
    const list = _loadProjects();
    const rec = list.find(x => String(x.id) === String(req.params.id));
    if (!rec) return res.status(404).json({ success: false, error: 'not found' });
    if (!OWN.canEdit(rec, req.user)) return OWN.refuse(res, rec);
    // The project's folder goes with it - voice, frames, clips, timelines. What another project,
    // a timeline elsewhere or a shelf still points at is moved to media/work/ first.
    const { moved } = PROJECTS.remove(rec.id);
    res.json({ success: true, kept: moved });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

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
router.post('/scen3/projects/:id/line', (req, res) => {
  try {
    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === String(req.params.id));
    if (!proj) return res.status(404).json({ success: false, error: 'not found' });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);

    const lines = (proj.lines || []).map(_normLine);
    const i = parseInt((req.body || {}).index, 10);
    if (!(i >= 0 && i < lines.length)) return res.status(400).json({ success: false, error: 'no such line' });
    const text = String((req.body || {}).text == null ? '' : (req.body || {}).text).trim();
    if (!text) return res.status(400).json({ success: false, error: 'a line cannot be empty' });

    lines[i].text = text;
    proj.lines = lines;
    proj.updatedAt = new Date().toISOString();
    _saveProjects(list);
    res.json({ success: true, project: _projFull(proj) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ── A copy of somebody's project, owned by whoever asked ────────────────────
   POST /api/scen3/projects/:id/copy -> { success, project }

   The one way to work on a project that is not yours. The whole record comes across -
   lines with their reads and clips, casting, the mix workspace with every frame, the reel -
   and the copy is the caller's from the start. Media files are shared with the original:
   neither project writes to them, and look-frame deletion already counts every project
   that still points at a file before removing it.

   Work in flight does NOT come across. A pending frame generation and a rendering line are
   tasks bound to the original's id; carried over, the watcher would file one result into
   two projects. The copy starts with nothing pending.
   ──────────────────────────────────────────────────────────────────────────── */
router.post('/scen3/projects/:id/copy', (req, res) => {
  try {
    const list = _loadProjects();
    const src = list.find(x => String(x.id) === String(req.params.id));
    if (!src) return res.status(404).json({ success: false, error: 'not found' });

    const now = new Date().toISOString();
    const rec = _normProject(JSON.parse(JSON.stringify(src)), now);
    rec.id = _newId(list);
    rec.owner = OWN.uidOf(req);
    rec.createdAt = now;
    rec.updatedAt = now;
    // "(copy)", then "(copy 2)" and on, so two copies of one project can be told apart.
    const base = String(src.name || 'untitled project').replace(/\s*\(copy(?: \d+)?\)$/i, '');
    const taken = new Set(list.map(x => String(x.name || '').toLowerCase()));
    rec.name = base + ' (copy)';
    for (let n = 2; taken.has(rec.name.toLowerCase()); n++) rec.name = `${base} (copy ${n})`;
    rec.mix.pending = null;
    rec.mix.lastError = '';
    for (const l of rec.lines) if (l && l.render) l.render = null;

    list.unshift(rec);
    _saveProjects(list);
    res.json({ success: true, project: _projFull(rec) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── video: starting a render ────────────────────────────────────────────────
// One line per call. The page walks the list itself so a clip appears the moment it is
// ready, and so Stop means something; the server's job is to refuse what cannot work,
// start the task and remember it.
//
// The answer is NOT waited for here. A render outlives any request, so the task is
// handed to a watcher that files it even if the page is closed, and the page follows
// along through /scen3/video/state.
router.post('/scen3/video/render', async (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'projectId is required' });

    const list = _loadProjects();
    const proj = list.find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: `no project "${id}"` });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);

    const i = parseInt(b.line, 10);
    const lines = (proj.lines || []).map(_normLine);
    if (!(i >= 0 && i < lines.length)) {
      return res.status(400).json({ success: false, error: 'line is out of range' });
    }

    const video = _normVideo(proj.video);
    const voice = _normVoice(proj.voice);
    const variant = voice.variant === 'tagged' ? 'tagged' : 'plain';
    const quality = MP.qualityById(video.quality) || MP.qualityById(MP.DEFAULT_QUALITY);
    const line = lines[i];

    // Everything that makes a render impossible, said plainly instead of as a 400 from
    // kie ten seconds later.
    const said = variant === 'tagged' ? (line.tagged || '') : (line.text || '');
    if (!said.trim()) return res.json({ success: true, skipped: 'this fragment has no words' });
    if (line.render && !line.render.error) {
      return res.json({ success: true, taskId: line.render.taskId, already: true });
    }
    const frame = (_normMix(proj.mix).variants || []).find(v => v.id === line.frameId);
    if (!frame || !frame.path) return res.json({ success: true, skipped: 'no first frame on this fragment' });
    const take = line.audio[variant];
    if (!take || !take.path) return res.json({ success: true, skipped: `no ${variant} read yet` });
    if (take.said !== said) return res.json({ success: true, skipped: 'the read no longer matches the words' });
    if (take.dur > quality.maxAudioSec) {
      return res.json({ success: true,
        skipped: `the read is ${take.dur.toFixed(1)}s and the model takes ${quality.maxAudioSec}s at most` });
    }

    // Both files go up fresh every time. kie fetches them itself, and a URL that has
    // been sitting around comes back as "Image fetch failed" long after the money is
    // committed. The extension has to be honest too: an mp3 served as .jpg is rejected
    // by the audio decoder.
    // verify: read each URL back before spending anything on it. A host can answer 200 with a
    // link that serves a landing page, and the render then fails as "upload failed" after the
    // task is created and charged.
    const imageUrl = await _hostLocal(frame.path, { forceFresh: true, verify: true });
    const audioUrl = await _hostLocal(take.path,
      { forceFresh: true, verify: true, exts: /\.(mp3|wav|m4a|ogg)$/i });

    const prompt = MP.promptFor(video.preset);
    const taskId = await _kieTask(quality.model, { image_url: imageUrl, audio_url: audioUrl, prompt });
    // Deliberately NOT handed to the shared pending-task recovery: that one exists for
    // orphaned IMAGE tasks and downloads every result as a .jpg, which for a clip means
    // an mp4 saved under the wrong name and a thumbnail that cannot be made. Clips have
    // their own watcher, and _resumeWatchers picks them up after a restart.

    _patchProj(id, (p) => {
      p.lines = p.lines.map(_normLine);
      p.lines[i].render = _normRender({
        taskId, variant, said, fromAudio: take.path, fromFrame: line.frameId,
        preset: video.preset, quality: video.quality,
        startedAt: new Date().toISOString(),
        // Kept so a fetch failure can be retried somewhere else without guessing where the
        // file went the first time.
        audioUrl,
      });
    });
    _watchClip(id, i, taskId);

    res.json({ success: true, taskId, model: quality.model, prompt });
  } catch (e) {
    console.error('[scen3/video/render]', e.response ? (e.response.data || e.message) : e.message);
    res.status(502).json({ success: false, error: (e.response && e.response.data && e.response.data.msg) || e.message });
  }
});

// ── Stop waiting on one fragment's render ────────────────────────────────────
// What this does NOT do is stop the renderer. kie.ai exposes no cancel for a job in flight,
// so pretending otherwise would be a lie in a button: if the clip does finish it is already
// paid for. What this does is release the fragment - the marker goes, the watcher notices on
// its next tick that the line no longer points at its task and stops - so the card comes back
// and can be rendered again.
//
// The taskId must be sent and must match. A cancel that arrives after the user has already
// re-rendered would otherwise throw away the NEW job's marker and leave it running unwatched.
router.post('/scen3/video/cancel', (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const i = parseInt(b.line, 10);
    const taskId = String(b.taskId || '').trim();
    if (!id || !taskId) return res.status(400).json({ success: false, error: 'projectId and taskId are required' });

    const proj = _loadProjects().find(p => String(p.id) === id);
    if (!proj) return res.status(404).json({ success: false, error: `no project "${id}"` });
    if (!OWN.canEdit(proj, req.user)) return OWN.refuse(res, proj);
    if (!(i >= 0 && i < (proj.lines || []).length)) {
      return res.status(400).json({ success: false, error: 'line is out of range' });
    }
    const cur = _lineRenderOf(id, i);
    if (!cur) return res.json({ success: true, already: true, note: 'that fragment is not rendering' });
    if (String(cur.taskId) !== taskId) {
      return res.status(409).json({ success: false,
        error: 'that fragment is on a newer render now - nothing was cancelled' });
    }

    _patchProj(id, (p) => {
      p.lines = p.lines.map(_normLine);
      const l = p.lines[i];
      if (!l.render || String(l.render.taskId) !== taskId) return false;
      l.render = null;
    });
    console.log('[scen3/clip] cancelled the wait on line', i + 1, 'task', taskId.slice(0, 24));
    res.json({ success: true, taskId, line: i });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── the cast character's face ────────────────────────────────────────────────
// The 4K reference sheet is a close-up PORTRAIT on the left and three full-body views on
// the right. Looked at it to be sure rather than guessing: a slice of width = height * 2/3
// taken from x=0 lands on a clean head-and-shoulders on every character in the library.
//
// The sheet's own thumbnail is 600px wide, so that slice would be ~225px and the 360px face
// panel would show it blown up. This makes a face-sized picture instead - twice the panel, for a
// high-density screen - and caches it, since a sheet never changes without a new file name.
// One cut at the server's size (480x720) is made again.
const FACE_W = 960, FACE_H = 1440;

async function _castFace(sheetPath, charId) {
  const hit = _resolveMedia(sheetPath);
  if (!hit || !fs.existsSync(hit.abs)) return '';
  // Derived from the sheet and made again when missing, so it is cache, not media.
  const dir = path.join(CFG.CACHE_DIR, 'faces');
  fs.mkdirSync(dir, { recursive: true });
  const name = `f${charId}_${path.basename(hit.abs).replace(/\.[^.]+$/, '')}.jpg`;
  const abs = path.join(dir, name);
  const url = `/cache/faces/${name}`;
  if (fs.existsSync(abs) && ((await sharp(abs).metadata()).width || 0) >= FACE_W) return url;
  const meta = await sharp(hit.abs).metadata();
  const w = Math.min(meta.width, Math.round(meta.height * 2 / 3));
  await sharp(hit.abs)
    .extract({ left: 0, top: 0, width: w, height: meta.height })
    .resize(FACE_W, FACE_H, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toFile(abs);
  console.log('[scen3/face]', name, 'from', w + 'x' + meta.height);
  return url;
}

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

// Everything the voice studio needs about who it is casting a voice for. Built on demand
// rather than on every project read: cropping a sheet is work, and only this popup wants it.
router.get('/scen3/cast-face/:id', async (req, res) => {
  try {
    const proj = _loadProjects().find(p => String(p.id) === String(req.params.id));
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    const cast = _normCasting(proj.casting);
    const chars = _read(path.join(DATA_DIR, 'characters.json'));
    const arr = Array.isArray(chars) ? chars : (chars && chars.characters) || [];
    const ch = arr.find(c => String(c.id) === cast.characterId)
            || arr.find(c => String(c.name) === cast.characterName);
    if (!ch) return res.status(404).json({ success: false, error: 'the cast character is not in the library' });
    const face = ch.sheet ? await _castFace(ch.sheet, ch.id) : '';
    res.json({
      success: true,
      character: { id: String(ch.id), name: String(ch.name || ''), gender: String(ch.gender || '') },
      // Every voice ever taken for this character, and which of them is starred. The starred
      // one IS `voice` — the field every read uses — so the two can never disagree.
      voices: Array.isArray(ch.voices) ? ch.voices : [],
      active: String(ch.voice || ''),
      face,
      // the look this project actually shoots with, as a fallback picture
      obraz: String(cast.obrazImage || ''),
      voice: _castVoice(proj),
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The cut, re-read from the PROJECT rather than trusted from the page: the page may have
// been open a while, and what goes to Merge has to be what is on disk. The resolver is the
// one the cards and the reel preview use, so all three agree on which take is in the cut.
function _cutClips(p) {
  const variant = _normVoice(p.voice).variant === 'tagged' ? 'tagged' : 'plain';
  const cut = (p.lines || []).map(_normLine).map((l, i) => {
    const c = _pickClip(l, variant);
    // Same freshness rule the cards and the preview apply: a clip of words that have since
    // been edited is not this fragment's clip. Without this the page could show a cut of
    // nine and Merge receive ten — the reel is judged on what the preview played.
    const words = String((variant === 'tagged' ? l.tagged : l.text) || l.text || '');
    if (!c || c.said !== words) return null;
    return { n: i + 1, line: l, clip: c };
  }).filter(Boolean);
  return { variant, cut };
}

// The reel the user approved in the preview. Stored as an order of clips; the hand-off to
// Merge is the next call, so this deliberately does no stitching and touches nothing
// outside the project.
router.post('/scen3/reel/save', (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.projectId || '').trim();
    const list = _loadProjects();
    const p = list.find(x => String(x.id) === id);
    if (!p) return res.status(404).json({ success: false, error: `no project "${id}"` });
    if (!OWN.canEdit(p, req.user)) return OWN.refuse(res, p);

    const { variant, cut } = _cutClips(p);
    const clips = cut.map(c => ({ n: c.n, path: c.clip.path, dur: c.clip.dur }));
    if (!clips.length) return res.status(400).json({ success: false, error: 'no clips to save' });

    const reel = _normReel({ ...(p.reel || {}), clips, variant, at: new Date().toISOString() });
    p.reel = reel;
    p.updatedAt = new Date().toISOString();
    _saveProjects(list);
    res.json({ success: true, reel });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Hand the cut to Merge ────────────────────────────────────────────────────
// The page saves the reel, then hands the project to Merge through /api/mv3/import/scen3
// (routes/mergev3.js). Each fragment's audio used to be pulled out of its clip first, into
// <clip>_av.mp3; nothing ever read those files, and that step is gone.

// What the page polls while a batch runs. Deliberately tiny: the full project carries
// the whole mix workspace, and re-fetching that every few seconds to learn one boolean
// would be absurd.
router.get('/scen3/video/state/:id', (req, res) => {
  try {
    const proj = _loadProjects().find(p => String(p.id) === String(req.params.id));
    if (!proj) return res.status(404).json({ success: false, error: 'no such project' });
    const variant = _normVoice(proj.voice).variant === 'tagged' ? 'tagged' : 'plain';
    const lines = (proj.lines || []).map(_normLine).map((l, i) => {
      // the variant this fragment is set to; another frame's clip is not this fragment's
      // clip, however recently it was made
      const clip = _pickClip(l, variant);
      return {
        n: i,
        rendering: !!(l.render && !l.render.error),
        error: (l.render && l.render.error) || '',
        variants: (l.video[variant] || []).length,
        // EVERY field of the take, `at` included. The page mirrors this row into its own
        // copy and saves it, so anything missing here is quietly erased from a clip the
        // server had already recorded in full.
        clip: clip ? { id: clip.id, path: clip.path, thumb: clip.thumb, dur: clip.dur, at: clip.at,
                       said: clip.said, fromAudio: clip.fromAudio, fromFrame: clip.fromFrame,
                       preset: clip.preset, quality: clip.quality } : null,
      };
    });
    res.json({ success: true, variant, lines });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── The frames generated for one look ────────────────────────────────────────
//   GET    /api/scen3/look-frames/:obrazId          every frame made with that look
//   DELETE /api/scen3/look-frames/:obrazId/:frameId one of them, file and reference
//
// Character v2's view mode shows these beside the character, but reading them is not something
// it can do for itself: the frames live in project.mix.variants and the only thing tying them to
// a look is project.casting.obrazId - a casting is per project, one character and one look for
// the whole script. So the question is answered here, where the projects are owned, rather than
// by a second reader of this store.
//
// Deleting is the same argument with more at stake. It removes the variant, every reference to it
// on the project, and the files - and it belongs here for the same reason: two writers of
// scen3-projects.json is how a store starts drifting.

// Three states, and the page colours by them:
//
//   green   the project's active pick, or a frame standing in a script line. NOT deletable -
//           taking either away damages the script rather than tidying it.
//   grey    banned: the user hid it in the project. Deletable, it is already discarded.
//   yellow  everything else - generated, kept, used by nothing.
//
// `approved` travels too but does not decide the colour: it is the checkmark shown in the
// scenarios popup, a shortlist rather than a use.
function _frameState(p, v) {
  const mix = p.mix || {};
  const id = String(v.id || '');
  const onLine = (p.lines || []).some(l => l && String(l.frameId || '') === id);
  const active = String(mix.activeId || '') === id;
  if (active || onLine) return 'green';
  if ((mix.banned || []).map(String).includes(id)) return 'grey';
  return 'yellow';
}

const _STATE_ORDER = { green: 0, yellow: 1, grey: 2 };

function _lookFrames(obrazId) {
  const out = [];
  for (const p of _loadProjects()) {
    if (String((p.casting || {}).obrazId || '') !== obrazId) continue;
    const mix = p.mix || {};
    for (const v of (mix.variants || [])) {
      if (!v || !v.path) continue;
      const id = String(v.id || '');
      out.push({
        id, path: v.path, preview: v.preview || v.path,
        prompt: String(v.prompt || ''), at: v.at || null, size: v.size || null,
        projectId: String(p.id || ''), projectTitle: String(p.title || p.name || ''),
        state: _frameState(p, v),
        approved: (mix.approved || []).map(String).includes(id),
        active: String(mix.activeId || '') === id,
        onLine: (p.lines || []).some(l => l && String(l.frameId || '') === id),
      });
    }
  }
  // Green, then yellow, then grey - and newest first inside each, since the last thing generated
  // is the thing being looked at.
  out.sort((a, b) => (_STATE_ORDER[a.state] - _STATE_ORDER[b.state])
    || String(b.at || '').localeCompare(String(a.at || '')));
  return out;
}

router.get('/scen3/look-frames/:obrazId', (req, res) => {
  try {
    const obrazId = String(req.params.obrazId || '');
    if (!obrazId) return res.status(400).json({ success: false, error: 'obrazId is required' });
    const items = _lookFrames(obrazId);
    // The projects that actually have frames for this look, for the picker above the grid: a
    // list built from what is there beats one built from every project that ever existed.
    const seen = new Map();
    for (const it of items) {
      const e = seen.get(it.projectId) || { id: it.projectId, title: it.projectTitle, count: 0 };
      e.count++;
      seen.set(it.projectId, e);
    }
    res.json({ success: true, obrazId, items, total: items.length, projects: [...seen.values()] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/scen3/look-frames/:obrazId/:frameId', (req, res) => {
  try {
    const obrazId = String(req.params.obrazId || '');
    const frameId = String(req.params.frameId || '');
    if (!obrazId || !frameId) return res.status(400).json({ success: false, error: 'obrazId and frameId are required' });

    const list = _loadProjects();
    let gone = null, host = null;
    for (const p of list) {
      if (String((p.casting || {}).obrazId || '') !== obrazId) continue;
      const mix = p.mix || {};
      const v = (mix.variants || []).find(x => x && String(x.id) === frameId);
      if (!v) continue;
      // Refused HERE, not only by a hidden cross: a rule that lives in one client is a rule the
      // next client does not have. A green frame is the active pick or stands in a line, and
      // taking either away damages the script instead of tidying it.
      if (_frameState(p, v) === 'green') {
        return res.status(409).json({
          success: false, state: 'green',
          error: 'That frame is in use by the scenario - the active pick or a line uses it.',
        });
      }
      if (!OWN.canEdit(p, req.user)) return OWN.refuse(res, p);
      gone = v; host = p;

      // The variant, and then every place the project still points at it: the approved and
      // banned lists, the active pick, and any line whose frame it was. A dangling frameId on a
      // line is what makes a script render a hole later.
      mix.variants = (mix.variants || []).filter(x => !x || String(x.id) !== frameId);
      if (Array.isArray(mix.approved)) mix.approved = mix.approved.filter(id => String(id) !== frameId);
      if (Array.isArray(mix.banned)) mix.banned = mix.banned.filter(id => String(id) !== frameId);
      if (String(mix.activeId || '') === frameId) mix.activeId = '';
      for (const line of (p.lines || [])) {
        if (line && String(line.frameId || '') === frameId) line.frameId = '';
      }
      p.updatedAt = new Date().toISOString();
      break;
    }
    if (!gone) return res.status(404).json({ success: false, error: 'frame not found for that look' });

    _saveProjects(list);

    // Only files nothing SURVIVING points at. A crop chain means one variant's source can be
    // another variant's image, and a delete that takes a file still in use breaks a frame nobody
    // asked about.
    const inUse = new Set();
    for (const p of list) {
      for (const v of ((p.mix || {}).variants || [])) {
        if (!v) continue;
        if (v.path) inUse.add(v.path);
        if (v.preview) inUse.add(v.preview);
        if (v.croppedFrom) inUse.add(v.croppedFrom);
      }
      const c = p.casting || {};
      if (c.obrazImage) inUse.add(c.obrazImage);
      if (c.locationImage) inUse.add(c.locationImage);
    }
    const removed = [], kept = [];
    for (const rel of [gone.path, gone.preview]) {
      if (!rel || inUse.has(rel)) { if (rel) kept.push(rel); continue; }
      const abs = path.join(CFG.ROOT_DIR, String(rel).replace(/^\/+/, ''));
      try { if (fs.existsSync(abs)) { fs.unlinkSync(abs); removed.push(rel); } } catch (e) {}
    }
    console.log('[scen3/look-frames] deleted', frameId, 'from', host.id, '| files removed', removed.length,
      kept.length ? ('| kept ' + kept.length + ' still in use') : '');
    res.json({ success: true, frameId, projectId: String(host.id || ''), removed, kept });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Opened up for the Merge v3 import (routes/mergev3.js). The cut - which variant, and the
// freshness rule that drops a clip generated for words since edited - must have exactly one
// implementation: a second copy would let the editor receive a different cut than the one
// Scenarios played back.
// The cut as it stands BEFORE any lipsync: every fragment that has a read and a first
// frame, whether or not a clip was ever rendered for it. Same freshness rule as _cutClips
// - a read of words that have since been edited is not this fragment's read - so the two
// answer the same question about the same script, one in pictures and one in stills.
function _audioCut(p) {
  const variant = _normVoice(p.voice).variant === 'tagged' ? 'tagged' : 'plain';
  const frames = _normMix(p.mix).variants || [];
  const cut = (p.lines || []).map(_normLine).map((l, i) => {
    const said = String((variant === 'tagged' ? l.tagged : l.text) || l.text || '');
    const take = (l.audio || {})[variant];
    if (!said.trim() || !take || !take.path || take.said !== said) return null;
    const frame = frames.find(v => v && String(v.id) === String(l.frameId || ''));
    return { n: i + 1, line: l, audio: take, frame: (frame && frame.path) ? frame.path : null };
  }).filter(Boolean);
  return { variant, cut };
}

router.cutClips = _cutClips;
router.audioCut = _audioCut;
router.loadProjects = _loadProjects;

module.exports = router;
