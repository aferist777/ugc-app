'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SCENARIOS V3 — scenario library store (ugc_ad only).
//
// Deliberately standalone: the v3 page does NOT reuse routes/scenarios-v2.js.
// This module owns its own JSON store and its own record shape, so the old
// scenarios backend can be deleted later without touching v3.
//
// Record — nothing else is stored:
//   { id, title, lines:[{text}], type:'ugc_ad', vertical, product, roles,
//     createdAt, updatedAt }
//
// lineCount is DERIVED from lines.length on read, never stored, so it cannot
// drift away from the actual content. There is one text track per line (no
// clean/colored split — that was the v2 model).
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const sharp   = require('sharp');

const router = express.Router();

// One model does every text/vision pass in the popup: variant prompts, reading a
// photo against the user's note, and composing the final prompt. Confirmed on
// OpenRouter: text+image in, 1M context.
const ANALYZE_MODEL = 'google/gemini-3-flash-preview';

// Only engine offered for now. NOTE: lib/helpers' "…Pro…" helpers are legacy
// NAMES — they all post to Replicate 'google/nano-banana-2', so nothing here
// runs a pro model.
const DEFAULT_ENGINE = 'nano-banana-2';

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE     = path.join(DATA_DIR, 'scen3-scenarios.json');
const OPT_FILE = path.join(DATA_DIR, 'scen3-options.json');
const PROJ_FILE = path.join(DATA_DIR, 'scen3-projects.json');
const LEGACY    = path.join(DATA_DIR, 'scenarios-v2.json');   // read-only seed source

// Minimum usable scenario length, enforced on both ends (the client greys out
// Save below this, the server refuses it).
const MIN_LINES = 5;
// The narrator's gender is required: it is what the character picker filters on.
const GENDERS = ['male', 'female'];

function _read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function _save(list) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
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
    type:      'ugc_ad',
    vertical:  String(src.vertical || ''),
    product:   String(src.product  || ''),
    roles:     Array.isArray(src.roles) ? src.roles.map(x => ({
      id:     String((x && x.id)     || ''),
      name:   String((x && x.name)   || ''),
      gender: String((x && x.gender) || ''),
    })) : [],
    createdAt: src.createdAt || now,
    updatedAt: src.updatedAt || now,
  };
}

// First boot seeds the store from the old v2 file (ugc_ad only), mapped to the
// v3 shape. Idempotent: once FILE exists the legacy store is never consulted
// again. The legacy file is only ever READ here — deleting it is a separate,
// explicit step the user asked to defer until v3 is signed off.
function _load() {
  const cur = _read(FILE);
  if (Array.isArray(cur)) return cur;

  const now    = new Date().toISOString();
  const legacy = _read(LEGACY);
  const src    = Array.isArray(legacy) ? legacy
    : (legacy && Array.isArray(legacy.scenarios) ? legacy.scenarios : []);
  const seeded = src
    .filter(r => r && String(r.type || '') === 'ugc_ad')
    .map(r => _norm(r, now));
  _save(seeded);
  console.log(`[scen3] seeded store from scenarios-v2.json: ${seeded.length} ugc_ad scenario(s)`);
  return seeded;
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
  fs.writeFileSync(OPT_FILE, JSON.stringify(o, null, 2), 'utf8');
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

// The narrator's gender lives on the single role entry (ugc_ad = one presenter).
const _genderOf = s => String(((s.roles || [])[0] || {}).gender || '').toLowerCase();

const _summary = s => ({
  id: s.id, title: s.title, type: s.type,
  vertical: s.vertical, product: s.product, roles: s.roles,
  gender: _genderOf(s),
  lineCount: (s.lines || []).length,
  createdAt: s.createdAt, updatedAt: s.updatedAt,
});
const _full = s => ({ ..._summary(s), lines: s.lines || [] });

// ── List: summaries only, most recently edited first ────────────────────────
router.get('/scen3/scenarios', (_req, res) => {
  try {
    const list = _load().slice()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    res.json({ success: true, scenarios: list.map(_summary) });
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
    if (!GENDERS.includes(_genderOf(rec))) {
      return res.status(400).json({ success: false, error: 'narrator gender is required' });
    }
    list.unshift(rec);
    _save(list);
    _harvest(rec);
    res.json({ success: true, scenario: _full(rec) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

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
// 1K PREVIEW TIER
//
// Three sizes now exist per asset:
//   thumbs/<name>.jpg   ~300px  — grids and cards
//   preview/<name>.jpg  ~1024px — the popup's centre image
//   <name>.jpg          full 4K — only ever downloaded on purpose
//
// A 4K sheet is ~320 KB; its 1K derivative is a fraction of that and is all the
// centre column needs. Built on demand and cached on disk, so assets that
// existed before this tier get one the first time they are viewed. Dressing
// results will have theirs written right after generation.
// ════════════════════════════════════════════════════════════════════════════

const CFG = require('../lib/config');
const MOUNTS = {
  uploads:      CFG.UPLOADS_DIR,
  characters:   CFG.CHARACTERS_DIR,
  lookbooks:    CFG.LOOKBOOKS_DIR,
  environments: CFG.ENVIRONMENTS_DIR,
  obrazy:       CFG.OBRAZY_DIR,
  details:      CFG.DETAILS_DIR,
  refs:         CFG.REFS_DIR,
  archive:      CFG.ARCHIVE_DIR,
  scenes:       CFG.SCENES_DIR,
  finals:       CFG.FINALS_DIR,
  // mannequins live under the static root, so the served path drops `public/`
  poses:        path.join(__dirname, '..', 'public', 'poses'),
};

// Map a public /mount/... URL to an absolute file, refusing anything that escapes
// its mount (so a crafted ../ path cannot reach outside the media folders).
function _resolveMedia(urlPath) {
  const s = String(urlPath || '').split('?')[0];
  const m = s.match(/^\/([a-z_]+)\/(.+)$/i);
  if (!m) return null;
  const root = MOUNTS[m[1].toLowerCase()];
  if (!root) return null;
  const abs = path.resolve(root, m[2]);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  if (!/\.(jpg|jpeg|png|webp)$/i.test(abs)) return null;
  return { abs, mount: m[1].toLowerCase(), rel: m[2] };
}

const PREVIEW_MAX_PX = 1024;
const PREVIEW_MAX_KB = 220;

async function _makePreview(srcAbs, outAbs) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  let quality = 82;
  while (quality >= 40) {
    const buf = await sharp(srcAbs)
      .resize(PREVIEW_MAX_PX, PREVIEW_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (buf.length <= PREVIEW_MAX_KB * 1024 || quality <= 40) {
      fs.writeFileSync(outAbs, buf);
      return;
    }
    quality -= 10;
  }
}

// POST { path } -> { path: '/<mount>/.../preview/<name>.jpg' }
// Returns the source path unchanged when it is already small enough to be its
// own preview, so the client never has to special-case that.
router.post('/scen3/preview1k', async (req, res) => {
  try {
    const src = String((req.body || {}).path || '');
    const hit = _resolveMedia(src);
    if (!hit) return res.status(400).json({ success: false, error: 'path outside the media folders' });
    if (!fs.existsSync(hit.abs)) return res.status(404).json({ success: false, error: 'source not found' });
    if (/(^|\/)(thumbs|preview)\//i.test(hit.rel)) return res.json({ success: true, path: src });

    const dir  = path.dirname(hit.rel);
    const base = path.basename(hit.rel).replace(/\.[^.]+$/, '') + '.jpg';
    const relOut = path.posix.join(dir === '.' ? '' : dir.split(path.sep).join('/'), 'preview', base);
    const outAbs = path.resolve(MOUNTS[hit.mount], relOut);
    const outUrl = `/${hit.mount}/${relOut}`;

    if (!fs.existsSync(outAbs)) {
      const srcKb = fs.statSync(hit.abs).size / 1024;
      if (srcKb <= PREVIEW_MAX_KB) return res.json({ success: true, path: src, note: 'source already small' });
      await _makePreview(hit.abs, outAbs);
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
const KNOLL_TAIL =
  ' Top-down orthographic view, camera directly overhead. Knolling layout: every garment and accessory laid out completely flat,'
  + ' grouped by type, edges parallel or at right angles, evenly spaced, NOTHING overlapping or tucked behind another item —'
  + ' each piece fully visible and uncropped, both shoes and both socks shown as a pair.'
  + ' Plain neutral light-grey studio background, soft even lighting, sharp focus, high detail.'
  + ' No person, no body parts, no mannequin, no hanger, no text, no labels, no watermark. 1:1 square.';

const EXTRACT_HEAD =
  'Faithfully reproduce every clothing item and accessory worn by the person in the reference photo —'
  + ' exact same colours, patterns, prints, fabrics, cuts and designs. Nothing invented, nothing omitted.';

// Dressing keeps the sheet's composition; only the clothes may change.
const DRESS_LOCK =
  ' Keep the SAME person, the SAME face, the SAME body, the SAME pose, the SAME framing, crop and background exactly as in the source image.'
  + ' Change ONLY the clothing. Do not add text, logos or watermarks.';

const _ask = (messages) => H.callAIVisionWithFallback(messages, {
  useOpenRouter: true, openRouterModel: ANALYZE_MODEL, timeout: 60000,
});

// N DISTINCT prompts, all inside what the user actually asked for.
async function _variantPrompts(userPrompt, n) {
  if (n <= 1) return [userPrompt];
  const ask = `You are a fashion prompt writer. The user described an outfit to generate: "${userPrompt}". `
    + `Produce ${n} DISTINCT prompts, each describing ONE complete cohesive outfit that stays inside the user's idea `
    + `but varies the pieces, colours and styling so the ${n} options feel clearly different. `
    + `Reply as strict JSON only: {"prompts":["..."]} with exactly ${n} strings, each <= 60 words, no numbering.`;
  try {
    const raw = await _ask([{ role: 'user', content: ask }]);
    const j = H.parseLooseJson(raw);
    if (j && Array.isArray(j.prompts) && j.prompts.length) {
      return j.prompts.slice(0, n).map(String);
    }
  } catch (e) { console.warn('[scen3/gen] variant prompts failed:', e.message); }
  return Array.from({ length: n }, () => userPrompt);   // fallback: engine seed varies the output
}

// Photo + the user's note -> read the photo, apply the note, return ONE ready
// generation prompt. The same model does both steps.
async function _composeFromPhoto(note, imageUrl) {
  const ask = 'Look at the photo and describe the outfit the person is wearing, then apply these changes: "'
    + note + '". Reply with ONE image-generation prompt (<= 90 words) describing the RESULTING outfit garment by garment '
    + '(each item, its colour, fabric and cut). Describe only clothing and accessories — no person, no pose, no background. '
    + 'Reply with the prompt text only, no preamble, no quotes.';
  const raw = await _ask([{
    role: 'user',
    content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: imageUrl } }],
  }]);
  return String(raw || '').replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
}

// ── Lookbook gender ─────────────────────────────────────────────────────────
// Which gender an outfit suits, judged from the INPUT (the description and/or the
// uploaded photo) so the call can run while the image is still rendering. Kept in
// a v3-owned side file keyed by public path — the shared lookbook backend has no
// metadata of its own and is not touched. Lookbooks that predate this stay
// unknown on purpose and are always visible.
const LBMETA_FILE = path.join(DATA_DIR, 'scen3-lookbook-meta.json');
const GENDER_VALUES = ['male', 'female', 'unisex'];

function _lbMeta() {
  const d = _read(LBMETA_FILE);
  return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
}
function _lbMetaSave(m) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  fs.writeFileSync(LBMETA_FILE, JSON.stringify(m, null, 2), 'utf8');
}

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
async function _hostLocal(urlPath) {
  const hit = _resolveMedia(urlPath);
  if (!hit || !fs.existsSync(hit.abs)) throw new Error('reference not found: ' + urlPath);
  const buf = fs.readFileSync(hit.abs);
  const ext = path.extname(hit.abs).replace('.', '') || 'jpg';
  const t0 = Date.now();
  const url = await H.uploadToPublicHost(buf, { ext, skipOwnHost: true });
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
const _track = (tid, tag) => { try { require('../lib/pending-tasks').addPendingTask(tid, 'uploads', tag, tag); } catch (e) {} };

// ── Lookbook generator: three modes, decided by what came in ────────────────
//   prompt only        -> N distinct prompts -> N text-to-image runs
//   photo only         -> extract the outfit as it is
//   photo + prompt     -> read the photo against the note, then generate
router.post('/scen3/gen/lookbook', async (req, res) => {
  try {
    const b = req.body || {};
    const note = String(b.prompt || '').trim();
    const b64  = String(b.imageBase64 || '');
    const n    = Math.max(1, Math.min(5, parseInt(b.count, 10) || 1));
    const eng  = _engineOf(b);
    if (!note && !b64) return res.status(400).json({ success: false, error: 'describe an outfit or add a photo' });

    // photo paths need a public URL first
    let photoUrl = '';
    if (b64) {
      const raw = b64.replace(/^data:image\/[a-z+]+;base64,/i, '');
      const buf = Buffer.from(raw, 'base64');
      if (!buf.length) return res.status(400).json({ success: false, error: 'unreadable photo' });
      photoUrl = await H.uploadToPublicHost(buf, { ext: 'jpg', skipOwnHost: true });
    }

    const taskIds = [];
    let mode, prompts;

    if (photoUrl && note) {
      mode = 'edit';
      const composed = await _composeFromPhoto(note, photoUrl);
      prompts = [composed + KNOLL_TAIL];
      taskIds.push(await _i2i(eng, prompts[0], [photoUrl], '1:1'));
    } else if (photoUrl) {
      mode = 'extract';
      prompts = [EXTRACT_HEAD + KNOLL_TAIL];
      taskIds.push(await _i2i(eng, prompts[0], [photoUrl], '1:1'));
    } else {
      mode = 'scratch';
      const variants = await _variantPrompts(note, n);
      prompts = variants.map(p => 'Create a clothing lookbook: ' + p + KNOLL_TAIL);
      for (const p of prompts) taskIds.push(await _t2i(eng, p));
    }

    const ids = taskIds.filter(Boolean);
    if (!ids.length) return res.status(502).json({ success: false, error: 'the engine did not accept the task' });
    ids.forEach(t => _track(t, 'lbcand'));

    // Tasks are already submitted, so this ~2s call overlaps with rendering and
    // the client gets the gender back long before the first image lands.
    const gender = await _detectGender(note, photoUrl);

    console.log(`[scen3/gen/lookbook] mode=${mode} engine=${eng} tasks=${ids.length} gender=${gender || 'unknown'}`);
    res.json({ success: true, mode, taskIds: ids, prompts, gender });
  } catch (e) {
    console.error('[scen3/gen/lookbook]', e.message);
    res.status(500).json({ success: false, error: e.message });
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
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FRAME_OPT_FILE, JSON.stringify(out, null, 2), 'utf8'); } catch (e) {}
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
    fs.writeFileSync(FRAME_OPT_FILE, JSON.stringify(out, null, 2), 'utf8');
    res.json({ success: true, options: out });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Mannequin poses (v3's own store) ────────────────────────────────────────
// Deliberately separate from data/ugc-poses.json: that one is read by the old
// /scenarios page and the Character tab's pose library, so v3 starts clean rather
// than clearing someone else's shelf.
//
// Each pose belongs to exactly ONE framing group. Records are seeded with their
// wording only — `file` fills in later, when the grey mannequin for that pose is
// authored. Until then the pose contributes its description and nothing else,
// which on its own is the reliable half: static pose wording steers a model far
// better than motion verbs do.
const POSE_FILE = path.join(DATA_DIR, 'scen3-poses.json');

// `desc` is what the compose prompt reads. `mprompt` is what DRAWS the grey
// mannequin for that pose — a mannequin has no face, so anything facial stays in
// `desc` only and `mprompt` carries head and shoulder attitude instead.
const POSE_SEED = [
  // Close-up — self-filming: the arm reaches TOWARD the lens, heavily foreshortened,
  // and is cut by the frame edge so the hand and phone stay outside the picture.
  //
  // Both came from ONE real selfie photo redrawn as a mannequin, then the left-arm
  // one was mirrored off the right. That source photo is no longer in the app, so
  // these are FIXED 2:3 assets the seed points straight at.
  //
  // A 9:16 re-shoot was tried, on the theory that matching the mannequin's shape to
  // the output frame would stop the generator re-cropping. It did not: the composed
  // frame still came back full-length AND the mannequin's blue surface leaked into
  // the subject's arm. Reverted deliberately — do not redo it without a new idea.
  { id: 'closeup-selfie-r', group: 'closeup', label: 'Selfie, right arm',
    desc: 'filming themselves with the right arm, the arm reaching toward the lens across the lower left of frame, hand and phone outside the picture',
    file:  '/poses/scen3/closeup-selfie-r_replw5r98en2m4_1786200891960.jpg',
    thumb: '/poses/scen3/thumbs/closeup-selfie-r_replw5r98en2m4_1786200891960.jpg' },
  { id: 'closeup-selfie-l', group: 'closeup', label: 'Selfie, left arm',
    desc: 'filming themselves with the left arm, the arm reaching toward the lens across the lower right of frame, hand and phone outside the picture',
    file:  '/poses/scen3/closeup-selfie-l_replw5r98en2m4_1786200891960.jpg',
    thumb: '/poses/scen3/thumbs/closeup-selfie-l_replw5r98en2m4_1786200891960.jpg' },

  // Half body — three poses, each REDRAWN from a real photograph.
  //
  // Text-to-image was tried for this group on the full nano-banana-2 at 2K with the
  // hardest wording available ("featureless genderless torso, NO breasts, no chest
  // contours, no garment edges", "visible from the head down to just below the waist")
  // and failed on both counts every time: full-length figures with a clearly female
  // chest and an implied bra line. A photograph settles the body and the pose in a
  // way words do not, so this group is reference-driven like the selfies.
  { id: 'half-standing', group: 'half-body', label: 'Standing, facing camera',
    desc: 'standing squarely, shoulders level, arms relaxed at the sides, looking into the lens',
    ref: '/poses/scen3/src/half-standing.png', aspect: '2:3' },
  { id: 'half-arms-crossed', group: 'half-body', label: 'Standing, arms crossed',
    desc: 'standing with the forearms folded across the chest, shoulders square to the lens',
    ref: '/poses/scen3/src/half-arms-crossed.png', aspect: '2:3' },
  { id: 'half-hands-pockets', group: 'half-body', label: 'Hands in pockets',
    desc: 'standing at a slight angle with both hands in the pockets, shoulders loose, weight on one leg',
    ref: '/poses/scen3/src/half-hands-pockets.png', aspect: '2:3' },

  // Knees up
  { id: 'knees-seated-table', group: 'knees-up', label: 'Seated at a table',
    desc: 'seated with both forearms resting on a tabletop, torso leaning in slightly',
    mprompt: 'An artist mannequin seated at a plain neutral grey table, both forearms resting flat on the tabletop, torso leaning in slightly, facing the camera. Visible from the head down to the knees.' },
  { id: 'knees-sofa-back', group: 'knees-up', label: 'Sofa, leaning back',
    desc: 'seated on a sofa, reclined against the backrest, one arm along the armrest',
    mprompt: 'An artist mannequin seated on a plain grey sofa, reclined against the backrest, one arm laid along the armrest. Visible from the head down to the knees.' },
  { id: 'knees-stool', group: 'knees-up', label: 'Perched on a stool',
    desc: 'seated on a stool, feet on the footrail, back straight',
    mprompt: 'An artist mannequin perched on a plain grey stool, both feet on the footrail, back straight, facing the camera. Visible from the head down to the knees.' },
  { id: 'knees-wall-shoulder', group: 'knees-up', label: 'Shoulder against a wall',
    desc: 'standing with one shoulder resting against a wall, ankles crossed',
    mprompt: 'An artist mannequin standing with one shoulder resting against a plain grey wall, ankles crossed, head turned toward the camera. Visible from the head down to the knees.' },
  { id: 'knees-elbows-knees', group: 'knees-up', label: 'Elbows on knees',
    desc: 'seated on a chair, elbows on the knees, torso tipped forward',
    mprompt: 'An artist mannequin seated on a plain grey chair, elbows resting on the knees, torso tipped forward toward the camera. Visible from the head down to the knees.' },
  { id: 'knees-weight-hip', group: 'knees-up', label: 'Weight on one hip',
    desc: 'standing with the weight on one leg, the other knee slightly bent, hip shifted',
    mprompt: 'An artist mannequin standing with its weight on one leg, the other knee slightly bent, hip shifted to one side, arms relaxed. Visible from the head down to the knees.' },
  { id: 'knees-desk-edge', group: 'knees-up', label: 'Half-seated on a desk',
    desc: 'half-seated on the edge of a desk, one foot on the floor, hands resting on the surface',
    mprompt: 'An artist mannequin half-seated on the edge of a plain grey desk, one foot on the floor, both hands resting on the desk surface beside the hips. Visible from the head down to the knees.' },

  // Full height — five poses, each REDRAWN from a real photograph and re-framed to
  // 9:16 so every mannequin in the library is the same shape as the frame it composes.
  // `desc` is not decoration: it is handed to the reading pass and leads the body
  // block of the frame prompt, which is how an ambiguous silhouette gets named.
  { id: 'full-hands-clasped', group: 'full-height', label: 'Hands clasped in front',
    desc: 'standing upright facing the lens with both hands clasped together low in front of the body, elbows relaxed and close to the sides, feet apart',
    ref: '/poses/scen3/src/full-hands-clasped.png', aspect: '9:16' },
  { id: 'full-straight', group: 'full-height', label: 'Standing straight',
    desc: 'standing upright and squarely facing the lens, both arms hanging relaxed at the sides, shoulders level, feet a little apart',
    ref: '/poses/scen3/src/full-straight.png', aspect: '9:16' },
  { id: 'full-contrapposto', group: 'full-height', label: 'Contrapposto',
    desc: 'standing in contrapposto with the weight on one leg and the other knee bent and relaxed, that hip pushed out and the shoulders tilted the opposite way, head turned slightly aside',
    ref: '/poses/scen3/src/full-contrapposto.png', aspect: '9:16' },
  { id: 'full-turned-back', group: 'full-height', label: 'Looking over the shoulder',
    desc: 'standing with the back to the lens, the torso turned away, the head turned back over one shoulder to look into the camera, arms hanging at the sides',
    ref: '/poses/scen3/src/full-turned-back.png', aspect: '9:16' },
  { id: 'full-mirror-selfie', group: 'full-height', label: 'Mirror selfie', prop: true,
    desc: 'standing at a slight angle filming itself in a mirror, one arm raised holding a phone at chest to head height toward the lens, the other arm relaxed, weight on one leg',
    ref: '/poses/scen3/src/full-mirror-selfie.png', aspect: '9:16' },
];

function _normPose(p) {
  const s = p || {};
  return {
    id:      String(s.id || '').trim(),
    group:   String(s.group || '').trim(),
    label:   String(s.label || '').trim(),
    desc:    String(s.desc || '').trim(),
    mprompt: String(s.mprompt || '').trim(),   // text-to-image path; extra framing note on the ref path
    ref:      String(s.ref || ''),             // an image to redraw the pose FROM
    aspect:   String(s.aspect || ''),          // forced output ratio; else measured off the ref
    flip:     !!s.flip,                        // mirror this pose's own result
    prop:     !!s.prop,                        // holds an object on purpose; lifts the "nothing in frame" ban
    // Derive from another pose by mirroring it — costs no generation, and keeps a
    // left/right pair from ever drifting apart.
    mirrorOf: String(s.mirrorOf || ''),
    file:    String(s.file || ''),             // the mannequin, once drawn
    thumb:   String(s.thumb || ''),
    active:  s.active !== false,
  };
}

function _savePoses(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(POSE_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// The look of the mannequins. The first lite pass came back as smooth shop-window
// torsos with a feminine silhouette and an implied garment, so the articulation and
// the genderless surface are now stated outright rather than implied.
// The colour, the material and the joints live HERE and nowhere else — a pose that
// also names a colour fights this and the result comes out mixed.
const MANNEQUIN_STYLE_BASE =
  " Subject: ONE single articulated artist's mannequin with clearly VISIBLE BALL JOINTS at the neck,"
  + ' shoulders and elbows, moulded from smooth matte MEDIUM-BLUE material.'
  + ' No face, no facial features, no hair. No clothing of any kind.'
  + " Its torso is that of a MALE artist's dummy: a FLAT, broad, square chest with NO breasts, no bust,"
  + ' no cleavage and no rounded chest curves, straight hips, and no crop-top, bra-like band or garment'
  + ' seam anywhere across the chest — one continuous blank blue surface throughout.'
  + ' Plain seamless light-grey studio background, soft even lighting, subtle soft shadow.'
  + ' Exactly one figure. This is a clean POSE REFERENCE.';
const MANNEQUIN_STYLE_TAIL =
  ' No text, no words, no watermark, no logos, no extra people, no extra limbs. Vertical 2:3 framing.';
// Poses that deliberately hold something opt out of the "nothing in frame" ban;
// without this the prop pose contradicts its own style line and loses the object.
const MANNEQUIN_NO_PROP = ' No phone or object visible anywhere in frame.';
const _mannequinStyle = (pose) =>
  MANNEQUIN_STYLE_BASE + (pose && pose.prop ? '' : MANNEQUIN_NO_PROP) + MANNEQUIN_STYLE_TAIL;

// Redraw path: the subject of the reference is replaced by a mannequin and nothing
// else changes. The BODY is pinned hard, because text-only attempts kept losing the
// outstretched arm. The CROP is pinned too — unless the pose carries a framing note,
// which is how a pose gets re-shot into a different aspect ratio.
// `targetAr` is the ratio to RE-FRAME into, or '' to keep the reference's own crop.
// It is stated in the prompt rather than hardcoded — the library moved from 2:3 to
// 9:16 once already, and a stale number here would quietly fight the real output.
function _redrawPrompt(pose, targetAr) {
  const note = (pose && pose.mprompt) ? pose.mprompt : '';
  const reframing = !!note || !!targetAr;
  const ar = targetAr || '2:3';
  return 'Redraw this image as a clean POSE REFERENCE.'
    + " Replace the subject with ONE articulated artist's mannequin moulded from smooth matte MEDIUM-BLUE"
    + ' material, with clearly visible ball joints at the neck, shoulders and elbows.'
    // Nothing here may presuppose a particular pose. An earlier version described a
    // selfie — an arm reaching toward the lens, cut by the frame edge — and every
    // reference was bent to match it: a man standing with his arms down came back
    // waving. The photograph is the only source of the pose.
    + ' COPY THE POSE FROM THE PHOTOGRAPH EXACTLY and invent nothing:'
    + ' the same tilt and rotation of the head, the same shoulder line, the same twist of the torso,'
    + ' the same weight distribution, and each arm and hand exactly where the photograph has it —'
    + ' if the arms hang at the sides they hang at the sides, if they are folded they stay folded,'
    + ' if the hands are in the pockets they stay there. Do not raise, extend or re-pose any limb.'
    + ' A limb leaves the frame here only where it leaves the frame in the photograph.'
    + ' Keep the same camera angle.'
    + (reframing
      ? ` Only the FRAMING changes, never the body: present that same unchanged pose in an upright`
        + ` VERTICAL ${ar} portrait frame, the figure centred and filling the height with a little room`
        + ' above the head and below the feet, seen from the same camera angle.'
        + (note ? ' ' + note : '')
      : ' Keep the SAME CROP too — do not re-frame, do not zoom out, do not move the figure.')
    + ' The mannequin has no face, no facial features, no hair and no clothing of any kind.'
    // "Genderless" reliably produced the female figurine this model knows best,
    // complete with a bust and a bra-like seam. Naming the masculine build is what
    // actually holds.
    + " Its torso is that of a MALE artist's dummy: a FLAT, broad, square chest with NO breasts,"
    + ' no bust, no cleavage and no rounded chest curves, straight hips, and no crop-top,'
    + ' bra-like band or garment seam anywhere across the chest — one continuous blank blue surface.'
    + ' The background is a plain seamless light-grey studio backdrop, soft even lighting, subtle soft shadow.'
    + ' No text, no words, no watermark, no logos, no extra people, no extra limbs.'
    + (pose && pose.prop ? '' : ' No phone or object visible in frame.');
}

// Draw the mannequins for one framing group and attach them to their pose records.
// Runs the cheap lite model on kie by default. Poses that already have a file are
// skipped unless `force` is set, so a re-run costs nothing. Poses that are a
// `mirrorOf` another one are derived afterwards and never generated.
router.post('/scen3/poses/generate', async (req, res) => {
  try {
    const b     = req.body || {};
    const group = String(b.group || '').trim();
    const eng     = String(b.engine || 'nano-banana-2-lite');
    const agg     = MIX_AGGS.includes(b.aggregator) ? b.aggregator : 'kie';
    const quality = MIX_QUALITIES.includes(b.quality) ? b.quality : '2K';
    const force   = !!b.force;
    if (!group) return res.status(400).json({ success: false, error: 'group is required' });

    const list  = _loadPoses();
    const inGrp = list.filter(p => p.group === group);
    const want  = inGrp.filter(p => !p.mirrorOf && (p.ref || p.mprompt) && (force || !p.file));
    const mirrors = inGrp.filter(p => p.mirrorOf && (force || !p.file));
    if (!want.length && !mirrors.length) {
      return res.status(400).json({ success: false, error: `nothing to draw for group "${group}"` });
    }

    const outDir = path.join(__dirname, '..', 'public', 'poses', 'scen3');
    fs.mkdirSync(outDir, { recursive: true });

    const done = [], failed = [];
    for (const pose of want) {
      try {
        let taskId;
        if (pose.ref) {
          // The generator fetches the reference itself, so it needs a public URL.
          // `aspect` forces the output ratio when the pose has to be RE-FRAMED into a
          // different shape than its source; otherwise the source's own ratio holds.
          const url = await _hostLocal(pose.ref);
          if (!url) throw new Error('could not publish the reference image');
          const natural = (await _ratioOf(pose.ref)) || '2:3';
          const ar = pose.aspect || natural;
          // Re-framing is only asked for when the target shape differs from the
          // source's; otherwise the prompt would fight a crop that already fits.
          const prompt = _redrawPrompt(pose, ar !== natural ? ar : '');
          console.log(`[scen3/poses] redraw ${pose.id} from ${pose.ref}`
            + ` ${natural} -> ${ar}${ar !== natural ? ' (reframe)' : ''} on ${agg}`);
          taskId = await _i2i(eng, prompt, [url], ar, '2K', agg);
        } else {
          taskId = await _t2i(eng, pose.mprompt + _mannequinStyle(pose), pose.aspect || '2:3', quality, agg);
        }
        if (!taskId) throw new Error('engine returned no taskId');
        const r = await _pollInto(taskId, outDir, pose.id);
        if (!r || !r.imagePath) throw new Error((r && r.error) || 'no image came back');
        // resolveTask already wrote a thumbnail beside the file
        const file = r.imagePath;                       // /poses/scen3/<name>.jpg
        const name = path.basename(file);
        if (pose.flip) await _mirrorInPlace(path.join(outDir, name));
        pose.file  = file;
        pose.thumb = `/poses/scen3/thumbs/${name}`;
        done.push({ id: pose.id, file });
      } catch (e) {
        console.warn('[scen3/poses/generate]', pose.id, 'failed:', e.message);
        failed.push({ id: pose.id, error: e.message });
      }
    }

    // Derived poses: copy the source's render and flip it. No task, no credits.
    const mirrored = [];
    for (const pose of mirrors) {
      try {
        const src = list.find(p => p.id === pose.mirrorOf);
        if (!src || !src.file) throw new Error(`mirrorOf "${pose.mirrorOf}" has no image yet`);
        const from = _resolveMedia(src.file);
        if (!from || !fs.existsSync(from.abs)) throw new Error('source mannequin is missing: ' + src.file);
        // everything is derived from ONE read buffer, so no path is ever open for
        // reading and writing at the same time
        const name = `${pose.id}_${path.basename(src.file).replace(/^[^_]*_/, '')}`;
        const abs  = path.join(outDir, name);
        const buf  = fs.readFileSync(from.abs);
        const flipped = await sharp(buf).flop().jpeg({ quality: 92 }).toBuffer();
        fs.writeFileSync(abs, flipped);
        fs.mkdirSync(path.join(outDir, 'thumbs'), { recursive: true });
        await sharp(flipped).resize({ width: 300 }).jpeg({ quality: 82 })
          .toFile(path.join(outDir, 'thumbs', name));
        pose.file  = `/poses/scen3/${name}`;
        pose.thumb = `/poses/scen3/thumbs/${name}`;
        mirrored.push({ id: pose.id, file: pose.file, from: src.id });
        console.log(`[scen3/poses] mirrored ${pose.id} from ${src.id} (no generation)`);
      } catch (e) {
        console.warn('[scen3/poses/generate] mirror', pose.id, 'failed:', e.message);
        failed.push({ id: pose.id, error: e.message });
      }
    }

    _savePoses(list);
    console.log(`[scen3/poses/generate] group=${group} on=${agg} engine=${eng}`
      + ` drawn=${done.length} mirrored=${mirrored.length} failed=${failed.length}`);
    res.json({ success: true, group, engine: eng, aggregator: agg, drawn: done, mirrored, failed });
  } catch (e) {
    console.error('[scen3/poses/generate]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// Mirror a mannequin and its thumbnail horizontally, in place. Left/right selfie
// pairs are one render flipped, so the two never drift apart.
//
// sharp is handed a BUFFER, never the path it is about to overwrite: on Windows
// reading and rewriting the same file leaves libvips holding the descriptor and the
// write fails with a bare "UNKNOWN: unknown error, open".
async function _mirrorInPlace(abs) {
  const flip = async (p) => {
    if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p);
    const out = await sharp(src).flop().jpeg({ quality: 92 }).toBuffer();
    fs.writeFileSync(p, out);
  };
  await flip(abs);
  await flip(path.join(path.dirname(abs), 'thumbs', path.basename(abs)));
}

// Poll a task to completion, landing the file in `dir` under the app's public tree.
async function _pollInto(taskId, dir, prefix) {
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 3000));
    let s = null;
    try { s = await H.resolveTask(taskId, dir, prefix); } catch (e) { continue; }
    if (!s) continue;
    if (s.state === 'success') {
      // resolveTask returns a path relative to the dir it saved into
      const name = path.basename(s.imagePath || '');
      return { imagePath: `/poses/scen3/${name}` };
    }
    if (s.state === 'failed') return { error: s.error || 'generation failed' };
  }
  return { error: 'timed out' };
}

function _loadPoses() {
  const cur = _read(POSE_FILE);
  if (Array.isArray(cur)) return cur.map(_normPose).filter(p => p.id && p.group);
  const seeded = POSE_SEED.map(_normPose);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(POSE_FILE, JSON.stringify(seeded, null, 2), 'utf8'); } catch (e) {}
  console.log(`[scen3] seeded ${seeded.length} mannequin poses across 4 framing groups`);
  return seeded;
}

router.get('/scen3/poses', (_req, res) => {
  try { res.json({ success: true, poses: _loadPoses().filter(p => p.active) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
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

// Editing an existing frame: the frame already carries its own light, camera and
// framing, so those are NOT restated — repeating them would fight the edit.
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
          + ' the crop is decided separately and your description must not contradict it. Never mention the'
          + ' mannequin\'s material, colour, joints or background.'
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
      _track(taskId, 'frame');
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
    urls.push(await _hostLocal(charPath), await _hostLocal(locPath));

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
    _track(taskId, 'frame');
    _armWatcher(b.projectId, taskId, 'compose', prompt);
    console.log(`[scen3/gen/frame] compose ${tag}`);
    res.json({ success: true, mode: 'compose', taskId, prompt });
  } catch (e) {
    console.error('[scen3/gen/frame]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Environments ────────────────────────────────────────────────────────────
// Four modes, decided by what came in:
//   prompt only            -> draw a new location from the description
//   basePath + prompt      -> refine that saved location (original untouched)
//   photo only             -> pull the location out of the photo, emptied of people
//   photo + prompt         -> read the photo against the note first, then generate
// Everything renders 2:3 and lands in the shared environments/ folder. v3 keeps its
// own prompts so routes/lookbook.js — and the tabs using it — stay as they are.
const ENV_ASPECT = '2:3';

const ENV_EMPTY_RULE =
  ' Render it as an EMPTY location background: a photorealistic real-world environment with NO people,'
  + ' no characters, no text, no watermark. Natural coherent lighting and depth, and leave clear foreground'
  + ' space where a person could later stand.'
  + ' 2:3 VERTICAL full-frame composition — fill the entire frame edge to edge, no borders, no letterboxing.'
  + ' High detail, sharp focus.';

const ENV_REFINE_RULE =
  ' Apply that change to THIS environment image while keeping it an EMPTY location background: photorealistic,'
  + ' NO people, no characters, no text, no watermark. Preserve the overall place unless the instruction says'
  + ' otherwise, keep the lighting coherent and leave clear foreground space.'
  + ' 2:3 VERTICAL full-frame composition — fill the entire frame, no borders, no letterboxing.';

const ENV_EXTRACT_HEAD =
  'Extract and faithfully reconstruct the background environment from the reference photo — same location,'
  + ' same architecture, furniture and decor, same colours, same lighting, same atmosphere.'
  + ' Remove every person and every foreground subject so the place is left empty.';

// Photo + note: read the photo, apply the note, return one ready prompt.
async function _composeEnvFromPhoto(note, imageUrl) {
  const ask = 'Look at the photo and describe the LOCATION shown in it, then apply these changes: "'
    + note + '". Reply with ONE image-generation prompt (<= 90 words) describing the resulting place — '
    + 'architecture, furniture, materials, colours, light, time of day, mood. Describe only the empty location, '
    + 'never any person. Reply with the prompt text only, no preamble, no quotes.';
  const raw = await _ask([{
    role: 'user',
    content: [{ type: 'text', text: ask }, { type: 'image_url', image_url: { url: imageUrl } }],
  }]);
  return String(raw || '').replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
}

router.post('/scen3/gen/env', async (req, res) => {
  try {
    const b    = req.body || {};
    const note = String(b.prompt || '').trim();
    const b64  = String(b.imageBase64 || '');
    const base = String(b.basePath || '').trim();
    const eng  = _engineOf(b);
    if (!note && !b64) return res.status(400).json({ success: false, error: 'describe a location or add a photo' });

    let photoUrl = '';
    if (b64) {
      const raw = b64.replace(/^data:image\/[a-z+]+;base64,/i, '');
      const buf = Buffer.from(raw, 'base64');
      if (!buf.length) return res.status(400).json({ success: false, error: 'unreadable photo' });
      photoUrl = await H.uploadToPublicHost(buf, { ext: 'jpg', skipOwnHost: true });
    }

    let mode, prompt, taskId;

    if (photoUrl && note) {
      mode = 'extract-edit';
      prompt = (await _composeEnvFromPhoto(note, photoUrl)) + ENV_EMPTY_RULE;
      taskId = await _i2i(eng, prompt, [photoUrl], ENV_ASPECT);
    } else if (photoUrl) {
      mode = 'extract';
      prompt = ENV_EXTRACT_HEAD + ENV_EMPTY_RULE;
      taskId = await _i2i(eng, prompt, [photoUrl], ENV_ASPECT);
    } else if (base) {
      mode = 'refine';
      const url = await _hostLocal(base);
      prompt = note + ENV_REFINE_RULE;
      taskId = await _i2i(eng, prompt, [url], ENV_ASPECT);
    } else {
      mode = 'scratch';
      prompt = note + ENV_EMPTY_RULE;
      taskId = await _t2i(eng, prompt, ENV_ASPECT);
    }

    if (!taskId) return res.status(502).json({ success: false, error: 'the engine did not accept the task' });
    _track(taskId, 'env');
    console.log(`[scen3/gen/env] mode=${mode} engine=${eng} aspect=${ENV_ASPECT}`);
    res.json({ success: true, mode, taskId, prompt });
  } catch (e) {
    console.error('[scen3/gen/env]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Dressing: Apply one lookbook onto the sheet, or Re-dress the shown image ──
router.post('/scen3/gen/dress', async (req, res) => {
  try {
    const b = req.body || {};
    const base = String(b.basePath || '').trim();       // the image being dressed
    const lb   = String(b.lookbookPath || '').trim();   // optional lookbook reference
    const note = String(b.note || '').trim();           // optional clothing-only steering
    const eng  = _engineOf(b);
    if (!base) return res.status(400).json({ success: false, error: 'basePath is required' });
    if (!lb && !note) return res.status(400).json({ success: false, error: 'pick a lookbook or write a note' });

    const urls = [await _hostLocal(base)];
    let prompt;
    if (lb) {
      urls.push(await _hostLocal(lb));
      prompt = 'Dress the person from IMAGE 1 in the outfit shown in IMAGE 2. Reproduce that outfit faithfully — same garments, colours, patterns, fabrics and cuts.'
        + (note ? ' Also apply these clothing-only adjustments: ' + note + '.' : '') + DRESS_LOCK;
    } else {
      prompt = 'Re-dress the person in the image according to this note: ' + note + '.' + DRESS_LOCK;
    }

    // keep the output in the base image's shape (a 16:9 sheet must stay 16:9)
    const aspect = (await _ratioOf(base)) || 'match_input_image';
    const tid = await _i2i(eng, prompt, urls, aspect);
    if (!tid) return res.status(502).json({ success: false, error: 'the engine did not accept the task' });
    _track(tid, 'dressed');
    console.log(`[scen3/gen/dress] ${lb ? 'apply' : 're-dress'} engine=${eng} refs=${urls.length}`);
    res.json({ success: true, mode: lb ? 'apply' : 'redress', taskId: tid, prompt });
  } catch (e) {
    console.error('[scen3/gen/dress]', e.message);
    res.status(500).json({ success: false, error: e.message });
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

router.post('/scen3/obraz-save', async (req, res) => {
  try {
    const b        = req.body || {};
    const charId   = String(b.charId || '');
    const charName = String(b.charName || 'look');
    const src      = String(b.imagePath || '');
    if (!charId) return res.status(400).json({ success: false, error: 'charId is required' });

    const hit = _resolveMedia(src);
    if (!hit || !fs.existsSync(hit.abs)) return res.status(400).json({ success: false, error: 'image not found' });

    // Refuse to touch the library if it exists but cannot be parsed — appending
    // to a fresh array would silently wipe every obraz the user owns.
    let list = [];
    if (fs.existsSync(OBRAZY_JSON)) {
      const parsed = _read(OBRAZY_JSON);
      if (!Array.isArray(parsed)) {
        return res.status(500).json({ success: false, error: 'obrazy.json is unreadable — refusing to write' });
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
    const rel = `/obrazy/${path.basename(folder)}/${file}`;

    // both derived tiers, so the gallery and the centre column are instant
    try { await H.createThumbnail(destAbs, path.join(folder, 'thumbs', file.replace(/\.[^.]+$/, '') + '.jpg')); } catch (e) {}
    let preview = rel;
    try {
      if (fs.statSync(destAbs).size / 1024 > PREVIEW_MAX_KB) {
        const outAbs = path.join(folder, 'preview', file.replace(/\.[^.]+$/, '') + '.jpg');
        if (!fs.existsSync(outAbs)) await _makePreview(destAbs, outAbs);
        preview = `/obrazy/${path.basename(folder)}/preview/${file.replace(/\.[^.]+$/, '')}.jpg`;
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
    fs.writeFileSync(OBRAZY_JSON, JSON.stringify(list, null, 2), 'utf8');
    console.log(`[scen3/obraz-save] char=${charId} obraz=${id} -> ${rel} (library now ${list.length})`);

    res.json({ success: true, obrazId: id, path: rel, preview });
  } catch (e) {
    console.error('[scen3/obraz-save]', e.message);
    res.status(500).json({ success: false, error: e.message });
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
    fs.writeFileSync(OBRAZY_JSON, JSON.stringify(next, null, 2), 'utf8');

    // its folder, only if it really sits under obrazy/
    let removedDir = null;
    try {
      const m = String(victim.char || '').match(/^\/obrazy\/([^/]+)\//);
      if (m) {
        const abs = path.resolve(CFG.OBRAZY_DIR, m[1]);
        const rootAbs = path.resolve(CFG.OBRAZY_DIR);
        if (abs.startsWith(rootAbs + path.sep) && fs.existsSync(abs)) {
          fs.rmSync(abs, { recursive: true, force: true });
          removedDir = '/obrazy/' + m[1];
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
// lookbook candidate into the lookbook base, and builds the 1K derivative for
// whatever came out, so the popup never has to fetch a full-size file.
router.post('/scen3/finalize', async (req, res) => {
  try {
    const b    = req.body || {};
    const src  = String(b.path || '');
    const kind = String(b.kind || '');
    const hit  = _resolveMedia(src);
    if (!hit || !fs.existsSync(hit.abs)) return res.status(400).json({ success: false, error: 'result not found' });

    let finalUrl = src;

    // A generated environment or lookbook is filed into its shared library folder.
    const LIB = kind === 'environment'
      ? { dir: CFG.ENVIRONMENTS_DIR, mount: '/environments', prefix: 'env_' }
      : kind === 'lookbook'
        ? { dir: CFG.LOOKBOOKS_DIR, mount: '/lookbooks', prefix: 'lb_' }
        : null;

    if (LIB) {
      const name = LIB.prefix + path.basename(hit.abs).replace(/\.[^.]+$/, '') + '.jpg';
      const dest = path.resolve(LIB.dir, name);
      fs.mkdirSync(LIB.dir, { recursive: true });
      if (!fs.existsSync(dest)) fs.copyFileSync(hit.abs, dest);
      finalUrl = LIB.mount + '/' + name;
      try { await H.createThumbnail(dest, path.resolve(LIB.dir, 'thumbs', name)); } catch (e) {}
    }

    if (kind === 'lookbook') {
      // record the gender the caller resolved in parallel with the generation
      const gender = String(b.gender || '').toLowerCase();
      if (GENDER_VALUES.includes(gender)) {
        const m = _lbMeta();
        m[finalUrl] = { gender, at: new Date().toISOString() };
        _lbMetaSave(m);
      }
    }

    // 1K derivative for the centre column
    let previewUrl = finalUrl;
    try {
      const fh = _resolveMedia(finalUrl);
      if (fh && fs.statSync(fh.abs).size / 1024 > PREVIEW_MAX_KB) {
        const base = path.basename(fh.rel).replace(/\.[^.]+$/, '') + '.jpg';
        const dir  = path.dirname(fh.rel);
        const relOut = path.posix.join(dir === '.' ? '' : dir.split(path.sep).join('/'), 'preview', base);
        const outAbs = path.resolve(MOUNTS[fh.mount], relOut);
        if (!fs.existsSync(outAbs)) await _makePreview(fh.abs, outAbs);
        previewUrl = `/${fh.mount}/${relOut}`;
      }
    } catch (e) { console.warn('[scen3/finalize] preview failed:', e.message); }

    res.json({ success: true, path: finalUrl, preview: previewUrl });
  } catch (e) {
    console.error('[scen3/finalize]', e.message);
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

// Build the 1K derivative for a freshly generated frame. Frames stay in uploads/;
// only the preview is made, exactly as POST /scen3/finalize does for the page.
async function _framePreview(finalUrl) {
  try {
    const fh = _resolveMedia(finalUrl);
    if (!fh || !fs.existsSync(fh.abs)) return finalUrl;
    if (fs.statSync(fh.abs).size / 1024 <= PREVIEW_MAX_KB) return finalUrl;
    const base = path.basename(fh.rel).replace(/\.[^.]+$/, '') + '.jpg';
    const dir  = path.dirname(fh.rel);
    const relOut = path.posix.join(dir === '.' ? '' : dir.split(path.sep).join('/'), 'preview', base);
    const outAbs = path.resolve(MOUNTS[fh.mount], relOut);
    if (!fs.existsSync(outAbs)) await _makePreview(fh.abs, outAbs);
    return `/${fh.mount}/${relOut}`;
  } catch (e) {
    console.warn('[scen3/watch] preview failed:', e.message);
    return finalUrl;
  }
}

// Read-modify-write in one synchronous burst, so the page's own save cannot
// interleave with the watcher's.
function _patchMix(projectId, fn) {
  const list = _loadProjects();
  const p = list.find(x => String(x.id) === String(projectId));
  if (!p) return false;
  p.mix = _normMix(p.mix);
  if (fn(p.mix) === false) return false;
  p.updatedAt = new Date().toISOString();
  _saveProjects(list);
  return true;
}

function _watchFrame(projectId, taskId, { mode, prompt }) {
  const key = `${projectId}:${taskId}`;
  if (_watching.has(key)) return;
  _watching.add(key);

  const UPLOADS = path.join(__dirname, '..', 'uploads');
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
    let s = null;
    try { s = await H.resolveTask(taskId, UPLOADS, 'generated'); } catch (e) { s = null; }

    if (s && s.state === 'success' && s.imagePath) {
      const finalUrl = '/uploads/' + path.basename(s.imagePath);
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

// A server restart must not orphan a task either: pick up whatever was pending.
function _resumeWatchers() {
  try {
    const list = _loadProjects();
    let n = 0;
    list.forEach(p => {
      const pend = _normPending((p.mix || {}).pending);
      if (!pend) return;
      _watchFrame(p.id, pend.taskId, { mode: pend.mode, prompt: pend.prompt });
      n++;
    });
    if (n) console.log(`[scen3/watch] resumed ${n} pending frame task(s) after boot`);
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

function _saveProjects(list) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
  fs.writeFileSync(PROJ_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function _loadProjects() {
  const cur = _read(PROJ_FILE);
  if (Array.isArray(cur)) return cur;
  _saveProjects([]);
  return [];
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
    casting:    _normCasting(src.casting),
    mix:        _normMix(src.mix),
    name:       String(src.name || '').trim() || 'untitled project',
    scenarioId: src.scenarioId != null ? String(src.scenarioId) : '',
    type:       'ugc_ad',
    gender:     String(src.gender || '').toLowerCase(),
    title:      String(src.title || ''),
    // frameId ties a fragment to the first frame chosen for it in the mix popup
    lines:      Array.isArray(src.lines) ? src.lines.map(l => ({
      text:    String((l && l.text) || ''),
      frameId: String((l && l.frameId) || ''),
    })) : [],
    vertical:   String(src.vertical || ''),
    product:    String(src.product  || ''),
    roles:      Array.isArray(src.roles) ? src.roles : [],
    createdAt:  src.createdAt || now,
    updatedAt:  src.updatedAt || now,
  };
}

const _projSummary = p => ({
  id: p.id, name: p.name, scenarioId: p.scenarioId, type: p.type,
  gender: p.gender, title: p.title,
  vertical: p.vertical, product: p.product, roles: p.roles,
  casting: _normCasting(p.casting),
  lineCount: (p.lines || []).length,
  createdAt: p.createdAt, updatedAt: p.updatedAt,
});
// The mix workspace is heavy (every generated frame), so it rides on the full
// record only — the dropdown list stays light.
const _projFull = p => ({ ..._projSummary(p), lines: p.lines || [], mix: _normMix(p.mix) });

// Newest first — the dropdown lists the most recent project at the top.
router.get('/scen3/projects', (_req, res) => {
  try {
    const list = _loadProjects().slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json({ success: true, projects: list.map(_projSummary) });
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
      const merged = _normProject({ ...list[i], ...b, id: list[i].id, createdAt: list[i].createdAt }, now);
      merged.updatedAt = now;
      list[i] = merged;
      _saveProjects(list);
      return res.json({ success: true, project: _projFull(merged) });
    }

    const scen = _load().find(x => String(x.id) === String(b.scenarioId || ''));
    if (!scen) return res.status(400).json({ success: false, error: 'scenarioId not found' });
    const gender = _genderOf(scen);
    if (!GENDERS.includes(gender)) {
      return res.status(400).json({ success: false, error: 'the scenario has no narrator gender — set it on the scenario first' });
    }

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
    const next = list.filter(x => String(x.id) !== String(req.params.id));
    if (next.length === list.length) return res.status(404).json({ success: false, error: 'not found' });
    _saveProjects(next);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
