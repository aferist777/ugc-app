'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SCENARIOS V2 — saved-scenario store + the Pipeline Lab generation stack.
//
// CRUD on data/scenarios-v2.json:
//   GET    /api/scenarios-v2/list      list (lightweight)
//   GET    /api/scenarios-v2/:id       full record
//   POST   /api/scenarios-v2           upsert (by id)
//   DELETE /api/scenarios-v2/:id       remove
//
// Pipeline Lab (file-based prompt library in prompts/<theme>/steps/):
//   GET    /api/scenarios-v2/config        types + verticals + emotions
//   POST   /api/scenarios-v2/lab/steps     resolved combined prompts per step
//   POST   /api/scenarios-v2/lab/run       run one step (single user message)
//   POST   /api/scenarios-v2/lab/save-step persist edited step prompt (placeholder-safe)
//   POST   /api/scenarios-v2/lab/hooks     4 finalization hooks
//   GET/POST per-vertical hooks / comparisons, taboo levels, options, scene ranges
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const { DATA_DIR } = require('../lib/config');
const { callAI }   = require('../lib/helpers');
const SP           = require('../lib/scenario-prompts');

const FILE   = path.join(DATA_DIR, 'scenarios-v2.json');
const HERMES = 'nousresearch/hermes-4-70b';

function _load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function _save(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

// ── CRUD ────────────────────────────────────────────────────────────────────
router.get('/scenarios-v2/list', (_req, res) => {
  const list = _load();
  res.json({
    success: true,
    scenarios: list.map(s => ({
      id: s.id, title: s.title, type: s.type, mode: s.mode,
      roles: s.roles || [], sceneCount: (s.lines || []).length,
      product: s.product || '', vertical: s.vertical || null,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    })),
  });
});

// NOTE: /config, /hooks and other literal sub-paths are declared BEFORE the
// '/:id' wildcard so Express doesn't capture them as an id.
router.get('/scenarios-v2/config', (req, res) => {
  const theme = req.query.theme || 'marketing';
  const types = SP.listTypes(theme);
  const paramMaps = {}, rawSpines = {};
  types.forEach(t => { paramMaps[t.id] = SP.paramMap(theme, t.id); rawSpines[t.id] = SP.rawSpine(theme, t.id); });
  res.json({ success: true, theme, themes: SP.listThemes(), types, paramMaps, rawSpines,
    verticals: SP.listVerticals(theme), emotions: SP.listOptions(theme, 'emotions') });
});

router.get('/scenarios-v2/hooks', (req, res) => {
  res.json({ success: true, hooks: SP.readHooksArchive(req.query.theme || 'marketing', req.query.vertical) });
});

// ── Product verticals (persisted) ──
router.get('/scenarios-v2/verticals', (req, res) => {
  res.json({ success: true, verticals: SP.listVerticals(req.query.theme || 'marketing') });
});
router.post('/scenarios-v2/verticals', (req, res) => {
  const { theme = 'marketing', label } = req.body || {};
  const v = SP.addVertical(theme, label);
  if (!v) return res.status(400).json({ success: false, error: 'Invalid label' });
  res.json({ success: true, vertical: v, verticals: SP.listVerticals(theme) });
});

// ── Per-type example scripts (few-shot anchors, kept verbatim) ──
router.get('/scenarios-v2/examples', (req, res) => {
  res.json({ success: true, examples: SP.listExampleFiles(req.query.theme || 'marketing', req.query.type || 'ugc_ad') });
});
router.post('/scenarios-v2/examples', (req, res) => {
  const { theme = 'marketing', type, name, content } = req.body || {};
  if (!type || !name || !content) return res.status(400).json({ success: false, error: 'type, name, content required' });
  const saved = SP.saveExample(theme, type, name, content);
  if (!saved) return res.status(400).json({ success: false, error: 'invalid name/content' });
  res.json({ success: true, name: saved });
});
router.delete('/scenarios-v2/examples', (req, res) => {
  const { theme = 'marketing', type, name } = req.query;
  if (!type || !name) return res.status(400).json({ success: false, error: 'type, name required' });
  SP.deleteExample(theme, type, name);
  res.json({ success: true });
});

// ── Editable option stores (emotions / styles / verticals) + type meta/spine ──
router.get('/scenarios-v2/options', (req, res) => {
  res.json({ success: true, options: SP.listOptions(req.query.theme || 'marketing', req.query.kind) });
});
router.post('/scenarios-v2/options', (req, res) => {
  const { theme = 'marketing', kind, id, label, desc } = req.body || {};
  if (!['emotions', 'styles', 'verticals'].includes(kind)) return res.status(400).json({ success: false, error: 'bad kind' });
  const o = SP.upsertOption(theme, kind, { id, label, desc });
  if (!o) return res.status(400).json({ success: false, error: 'invalid label' });
  res.json({ success: true, option: o, options: SP.listOptions(theme, kind) });
});
router.delete('/scenarios-v2/options', (req, res) => {
  const { theme = 'marketing', kind, id } = req.query;
  if (!kind || !id) return res.status(400).json({ success: false, error: 'kind, id required' });
  SP.deleteOption(theme, kind, id);
  res.json({ success: true, options: SP.listOptions(theme, kind) });
});
router.post('/scenarios-v2/type', (req, res) => {
  const { theme = 'marketing', type, label, desc, sceneRanges, defaultSceneRange } = req.body || {};
  const t = SP.patchType(theme, type, { label, desc, sceneRanges, defaultSceneRange });
  if (!t) return res.status(400).json({ success: false, error: 'unknown type' });
  res.json({ success: true, type: t });
});

// ── Taboo ladder (read all levels / edit one) ──
router.get('/scenarios-v2/taboo', (req, res) => {
  res.json({ success: true, levels: SP.listTaboo(req.query.theme || 'marketing') });
});
router.post('/scenarios-v2/taboo', (req, res) => {
  const { theme = 'marketing', level, text } = req.body || {};
  if (!level) return res.status(400).json({ success: false, error: 'level required' });
  const ok = SP.saveTaboo(theme, level, text);
  res.json({ success: ok, levels: SP.listTaboo(theme) });
});

// ── Per-vertical comparisons / phrase library ──
router.get('/scenarios-v2/comparisons', (req, res) => {
  res.json({ success: true, comparisons: SP.readComparisons(req.query.theme || 'marketing', req.query.vertical) });
});
router.post('/scenarios-v2/comparisons/set', (req, res) => {
  const { theme = 'marketing', vertical, lines } = req.body || {};
  if (!Array.isArray(lines)) return res.status(400).json({ success: false, error: 'lines must be an array' });
  const count = SP.writeComparisons(theme, vertical, lines);
  res.json({ success: true, count });
});
router.post('/scenarios-v2/type/spine', (req, res) => {
  const { theme = 'marketing', type, content } = req.body || {};
  if (!type) return res.status(400).json({ success: false, error: 'type required' });
  SP.saveSpine(theme, type, content);
  res.json({ success: true });
});

// ── Per-vertical reference sources (VSL transcripts) ──
router.get('/scenarios-v2/sources', (req, res) => {
  const theme = req.query.theme || 'marketing', vid = req.query.vertical;
  res.json({ success: true, sources: SP.listSources(theme, vid) });
});
router.post('/scenarios-v2/sources/set', (req, res) => {
  const { theme = 'marketing', vertical, key, text } = req.body || {};
  if (!vertical || !key) return res.status(400).json({ success: false, error: 'vertical and key required' });
  const ok = SP.upsertSource(theme, vertical, key, text);
  res.json({ success: ok, sources: SP.listSources(theme, vertical) });
});
router.post('/scenarios-v2/sources/delete', (req, res) => {
  const { theme = 'marketing', vertical, key } = req.body || {};
  if (!vertical || !key) return res.status(400).json({ success: false, error: 'vertical and key required' });
  const ok = SP.removeSource(theme, vertical, key);
  res.json({ success: ok, sources: SP.listSources(theme, vertical) });
});

// ════════════════════════════════════════════════════════════════════════════
// PIPELINE LAB — staged generation sandbox (skeleton → enrich → taboo polish)
// Isolated: touches only the steps/<type>.step{n}.md prompt files, never the
// main generation path. Used by /pipeline-lab.html to test multi-pass quality.
// ════════════════════════════════════════════════════════════════════════════
const STEP_TITLES = ['', 'Full script (12 beats, single pass)', 'Voice & emotion', 'Finalization (hook + taboo + polish)'];
const UGC_STEP_TITLES = ['', 'Narrator portrait & tone', 'Script (12 beats + taboo + transcript)'];
const LAB_SOH = String.fromCharCode(1), LAB_STX = String.fromCharCode(2);   // regular params → yellow
const LAB_SOH2 = String.fromCharCode(3), LAB_STX2 = String.fromCharCode(4); // vertical libraries → teal

// Wrap each substituted value in sentinels so the lab can render those regions
// bold/coloured. Longest-first to avoid clobbering nested matches. soh/stx pick
// the sentinel pair (regular params vs vertical-library values).
function _wrapHighlights(text, vals, soh, stx) {
  soh = soh || LAB_SOH; stx = stx || LAB_STX;
  let out = text;
  vals.filter(v => v && v.length > 2).sort((a, c) => c.length - a.length).forEach(v => {
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { out = out.replace(new RegExp(esc, 'g'), m => soh + m + stx); } catch {}
  });
  return out;
}

function _rangeText(r) {
  const m = String(r || '').match(/(\d+)\s*-\s*(\d+)/);
  return m ? `${m[1]} to ${m[2]}` : (String(r || '').trim() || '15 to 18');
}

// Resolved step system-prompts for the current params (prefill the textareas).
// POST so the cast (roles + VO + genders) can drive the {{CAST}} placeholder.
function _voInfo(cfg, b) {
  if (cfg.vo === 'always') return { includeVO: (b.voEnabled === undefined ? true : !!b.voEnabled), voGender: b.voGender || 'any' };
  if (cfg.vo === 'optional') return { includeVO: !!b.voEnabled, voGender: b.voGender || 'any' };
  return { includeVO: false, voGender: 'any' };
}
// ── Single combined-prompt model (no system role; everything in one user msg) ──
const LAB_SEP  = '\n\n===== USER MESSAGE =====\n\n';
const LAB_PREV = '⟦ PREVIOUS DRAFT: auto-fills after you run the previous step ⟧';
const SCRIPT_MARK = '⟦ GENERATED SCRIPT: auto-fills from the script pass ⟧';   // hooks-prompt {{SCRIPT}} slot
// ugc_ad layout: user inputs on top, then a clean instructions marker (no "USER MESSAGE"
// divider). The marker doubles as the save-step boundary (only the spine after it is saved).
const LAB_INSTR = '\n\n----- INSTRUCTIONS -----\n\n';

async function _runUser(prompt, model, timeout, system) {
  const messages = (system && String(system).trim())
    ? [{ role: 'system', content: String(system).trim() }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];
  return callAI(messages, { useOpenRouter: true, openRouterModel: model, timeout: timeout || 90000 });
}

// Cast + gender block (concrete cast/pronoun guidance). Used in the combined prompt.
function _castBlock(cfg, roles, narratorGender, includeVO, voGender) {
  if ((cfg.characters || 0) === 0) {
    const ng = _gnorm(narratorGender);
    return ng !== 'any' ? `NARRATOR: the voiceover narrator is ${ng}. Voice the narration accordingly.` : '';
  }
  if (cfg.multi) {
    if (!roles.length) return '';
    const anyG = roles.some(r => _gnorm(r.gender) !== 'any');
    const voNote = includeVO
      ? ` Plus an off-screen [VO] narrator${_gnorm(voGender) !== 'any' ? ` (${_gnorm(voGender)})` : ''} for studies, stats and transitions.`
      : ' Do NOT use any [VO] lines.';
    return `CAST: ${roles.map(_roleLabel).join(', ')}. Use ONLY these speaker tags${includeVO ? ' and [VO]' : ''}, no others.${voNote} Each speaker must EMBODY their role name (a Skeptic doubts, an Expert gives authority, a Host drives the show) — let the role name shape their voice and function.${anyG ? ' Keep each speaker\'s voice, pronouns and self-reference consistent with their (male)/(female) gender; never contradict it.' : ''}`;
  }
  const r0 = roles[0] || {};
  const sg = _gnorm(r0.gender);
  const nm = String(r0.name || '').trim();
  const roleNote = (nm && !/^(presenter|narrator|speaker|role\s*\d*|character\s*\d*)$/i.test(nm)) ? ` The on-camera speaker is a ${nm}; let the role shape their voice and framing.` : '';
  const genNote = sg !== 'any' ? ` The speaker is ${sg}; keep perspective, pronouns and self-reference consistent, never contradicting the gender.` : '';
  return (roleNote || genNote) ? ('SPEAKER:' + roleNote + genNote).trim() : '';
}

// Strong, top-priority GENDER directive sent as a SYSTEM message so the model
// cannot lose it mid-prompt (the lab runs one long combined user message, where a
// single gender sentence is easy to ignore). Rebuilt server-side from the cast
// params the frontend sends (narratorGender / roles[].gender / voGender),
// independent of the editable lab prompt. Returns '' when every gender is "any".
function _genderLockSystem(cfg, b) {
  b = b || {};
  const includeVO = _voInfo(cfg, b).includeVO;
  const voG = _gnorm(b.voGender);
  const voClause = (includeVO && voG !== 'any')
    ? ` The off-screen [VO] narrator is ${voG.toUpperCase()} — voice the voiceover as a ${voG} too.`
    : '';

  // Voiceover-only formats: a single narrator gender.
  if ((cfg.characters || 0) === 0) {
    const ng = _gnorm(b.narratorGender);
    if (ng === 'any') return '';
    return `CRITICAL HARD CONSTRAINT - NARRATOR GENDER: the voiceover narrator is ${ng.toUpperCase()}. Write ALL narration in a ${ng}'s voice: pronouns, self-reference, personal anecdotes and any mention of the narrator's own body, role or relationships must be ${ng}. NEVER write the narration as the opposite gender. This rule overrides any ambiguous wording later in the prompt.`;
  }

  const roles = Array.isArray(b.roles) ? b.roles : [];

  // Multi-cast formats: lock each named role to its gender.
  if (cfg.multi) {
    const tagged = roles.filter(r => _gnorm(r && r.gender) !== 'any');
    if (!tagged.length) return voClause ? ('CAST GENDERS.' + voClause).trim() : '';
    const list = tagged.map(r => `${(r.name || 'Speaker')} = ${_gnorm(r.gender).toUpperCase()}`).join('; ');
    return (`CRITICAL HARD CONSTRAINT - CAST GENDERS: ${list}. Every line a speaker says must match THEIR gender: pronouns, self-reference and any mention of their own body or role. NEVER contradict a speaker's gender.` + voClause).trim();
  }

  // Single on-camera speaker (the typical UGC ad).
  const sg = _gnorm((roles[0] || {}).gender);
  if (sg === 'any') return voClause ? voClause.trim() : '';
  return (`CRITICAL HARD CONSTRAINT - SPEAKER GENDER: the single on-camera speaker is ${sg.toUpperCase()}. Write EVERY line in a ${sg}'s first-person voice: pronouns, self-reference, personal anecdotes and any mention of the speaker's own body, role or relationships must be ${sg}. NEVER write the script as the opposite gender. This rule overrides any ambiguous wording later in the prompt.` + voClause).trim();
}

// ugc_ad "inputs on top" header: the user's brief for THIS pass, placed at the very top of
// the combined prompt (no "USER MESSAGE" divider). Only the fields relevant to each pass are
// shown so the model is not distracted by inputs that pass does not act on.
function _inputsHeaderUgc(stepNo, v) {
  const g = _gnorm(v.roles && v.roles[0] && v.roles[0].gender);
  const L = [
    'INPUTS FOR THIS PASS (the brief, honor every field):',
    `- Narrator/speaker gender: ${g === 'any' ? 'unspecified (model may choose, but keep it consistent)' : g.toUpperCase()}`,
  ];
  if (stepNo === 1) {
    // Single-pass ugc_ad: ALL params live at the very top of the prompt (the
    // model reads the full brief before any instruction). Order = the params the
    // user wants prioritized: ingredients, taboo, scenes, emotion, presenter,
    // presenter-gender (gender is already the first line above).
    L.push(`- Active ingredients: ${v.ingredients ? v.ingredients : '(none specified)'}`);
    L.push(`- Taboo level: ${v.taboo || 'spicy'}`);
    L.push(`- Scene count: ${v.rangeText} lines (hard min and max)`);
    L.push(`- Emotional colour: ${v.emoText || '(natural, no specific emotion)'}`);
    const presenters = (v.roles || []).map(r => r && r.name).filter(Boolean).join(', ');
    L.push(`- Presenter(s): ${presenters || '(single first-person narrator)'}`);
    L.push(`- Product vertical: ${v.verticalCombined}`);
    L.push(`- Chosen hook (use as scene 1): ${v.hookMark}`);
    L.push(`- Freeform notes: ${v.notes ? v.notes : '(none)'}`);
  } else if (stepNo === 2) {
    L.push(`- Emotional colour: ${v.emoText || '(natural, no specific emotion)'}`);
  } else {
    L.push(`- Product vertical: ${v.verticalCombined}`);
    L.push(`- Scene count: ${v.rangeText} lines (hard min and max)`);
    L.push(`- Taboo level: ${v.taboo}`);
    L.push(`- Chosen hook (use as scene 1): ${v.hookMark}`);
  }
  return L.join('\n');
}

// Context for the BASE pass (vertical lives in the spine; emotion is applied in the
// VOICE pass, not here). Ingredients are framed plausibly — radicalism comes later.
function _ctxNoVertical(theme, type, s) {
  const ctx = [];
  if (s.ingredients) ctx.push(
    `- ACTIVE INGREDIENTS (the CORE of the method the narrator used — build a believable home method around them with a realistic timing and steps): ${s.ingredients}`);
  return ctx.length ? 'CONTEXT FOR THE NEW SCRIPT (use whatever is relevant; ignore empty fields):\n' + ctx.join('\n') : '';
}

// The user-message portion appended after the spine for a given step.
function _labUserBlock(step, { theme, type, scenesRange, structured, notes }) {
  const usr = [];
  if (step <= 1) {
    const ctx = _ctxNoVertical(theme, type, structured || {});
    if (ctx) usr.push(ctx);
    if (notes) usr.push('Additional freeform notes from user — HARD requirements, honor them (translate to English if non-English):\n' + notes);
    const mx = (String(scenesRange).match(/(\d+)\s*-\s*(\d+)/) || [])[2] || '';
    usr.push(`Write the full base script now (first-person, honest, believable, selling the link). Output a total strictly within ${_rangeText(scenesRange)} lines${mx ? ` — never more than ${mx}` : ''}. Count them before you stop.`);
  } else {
    usr.push(`DRAFT FROM THE PREVIOUS PASS — apply THIS pass's instructions above, keeping every [n] marker, the same line count and the same order. Output the FULL rewritten draft, nothing else:\n\n${LAB_PREV}`);
  }
  return usr.join('\n\n');
}

router.post('/scenarios-v2/lab/steps', (req, res) => {
  const b = req.body || {};
  const theme = b.theme || 'marketing';
  const type  = SP.getTypeConfig(theme, b.type) ? b.type : 'ugc_ad';
  const cfg   = SP.getTypeConfig(theme, type) || {};
  const taboo = b.taboo || cfg.tabooDefault || 'spicy';
  const naming = (b.naming === 'off' || b.naming === 'on') ? b.naming : (cfg.namingDefault || 'on');
  const vid = b.vertical || '';
  const scenesRange = b.scenesRange || cfg.defaultSceneRange || '15-18';
  const roles = Array.isArray(b.roles) ? b.roles : [];
  const { includeVO, voGender } = _voInfo(cfg, b);
  const structured = b.structured || {};
  const notes = (b.notes || '').trim();
  const castBlock = _castBlock(cfg, roles, b.narratorGender, includeVO, voGender);

  // Resolved user-input values (shared by the ugc_ad inputs-on-top header and the lab
  // highlight pass below).
  const vlabel = SP.optionLabel(theme, 'verticals', vid), vdesc = SP.optionDesc(theme, 'verticals', vid);
  const verticalCombined = (vlabel || '(unspecified)') + (vdesc ? ` — ${vdesc}` : '');
  const emoLabel = SP.optionLabel(theme, 'emotions', structured.emotion);
  const emoDesc  = SP.optionDesc(theme, 'emotions', structured.emotion);
  const emoText  = emoLabel ? (_stripEmoji(emoLabel) + (emoDesc ? ' - ' + emoDesc : '')) : '';
  const rangeText = _rangeText(scenesRange);
  // Narrator descriptor (mirrors SP.resolveStep) — highlighted as an auto-injected value.
  const _rs = Array.isArray(roles) ? roles.filter(r => r && r.name) : [];
  let narratorStr;
  if (_rs.length > 1) narratorStr = _rs.map(r => `${r.name}${_gnorm(r.gender) !== 'any' ? ` (${_gnorm(r.gender)})` : ''}`).join(', ');
  else if (_rs.length === 1) { const g = _gnorm(_rs[0].gender) !== 'any' ? _gnorm(_rs[0].gender) : _gnorm(b.narratorGender); narratorStr = `${g !== 'any' ? g + ' ' : ''}${_rs[0].name}`.trim(); }
  else { const g = _gnorm(b.narratorGender); narratorStr = g !== 'any' ? `${g} narrator` : ''; }

  // Build the FULL combined prompt per step. For ugc_ad the user inputs sit at the very TOP
  // (no "USER MESSAGE" divider); every other type keeps the legacy spine + user-message layout.
  const n = SP.stepCount(theme, type) || 0;
  const steps = [];
  for (let i = 1; i <= (n || 3); i++) {
    const sysR = SP.resolveStep(theme, type, i, { taboo, naming, vid, scenesRange, roles, includeVO, voGender, emotion: structured.emotion, ingredients: structured.ingredients, narratorGender: b.narratorGender, notes });
    let prompt = '';
    if (sysR) {
      if (type === 'ugc_ad') {
        // Two passes, both self-contained via resolved placeholders (no inputs
        // header). Pass 1 = narrator portrait & tone. Pass 2 = the script, which
        // consumes that portrait: its {{PERSONA}} slot becomes the previous-draft
        // marker, filled with pass-1 output at run time.
        prompt = (i > 1) ? sysR.split('{{PERSONA}}').join(LAB_PREV) : sysR;
      } else {
        const userB = [castBlock, _labUserBlock(i, { theme, type, scenesRange, structured, notes })].filter(Boolean).join('\n\n');
        prompt = sysR + LAB_SEP + userB;
      }
    }
    const _titles = (type === 'ugc_ad') ? UGC_STEP_TITLES : STEP_TITLES;
    steps.push({ n: i, title: _titles[i] || `Step ${i}`, prompt });
  }

  // Highlight every user-substituted value across the whole combined prompt.
  const vals = [
    SP.tabooBlock(theme, taboo),
    verticalCombined,
    rangeText,
    SP.castText(roles, includeVO, voGender),
    castBlock,
    structured.audience,
    structured.ingredients,
    emoDesc,
    emoLabel ? _stripEmoji(emoLabel) : '',
    narratorStr,
  ];
  // Vertical-library values (comparisons + hooks) get a SEPARATE colour. Rebuild the
  // exact blocks resolveStep injected so the sentinels land on the same text.
  const comps = SP.readComparisons(theme, vid);
  const compBlock = comps.length ? 'PHRASE LIBRARY for this vertical (plain -> punchy native analogues; weave in naturally, never list them):\n' + comps.map(c => '- ' + c).join('\n') : '';
  const hk = SP.readHooksArchive(theme, vid);
  const hookBlock = hk.length ? 'TOP HOOKS for this vertical (style anchors — match their angle and shameless energy):\n' + hk.map(h => '- ' + h).join('\n') : '';
  const libVals = [compBlock, hookBlock];
  // Library blocks first (teal), then the regular params (yellow). Order matters so the
  // big library blocks are wrapped before short param values can nest inside them.
  steps.forEach(s => {
    if (!s.prompt) return;
    s.prompt = _wrapHighlights(s.prompt, libVals, LAB_SOH2, LAB_STX2);
    s.prompt = _wrapHighlights(s.prompt, vals, LAB_SOH, LAB_STX);
  });
  // Hooks prompt (the separate 3rd pass) — resolved, with {{SCRIPT}} turned into
  // the script marker (filled with the generated scenario at run time) and the
  // same param/library highlighting as the steps.
  let hooksPrompt = '';
  if (SP.hooksPromptExists(theme, type)) {
    hooksPrompt = SP.resolveHooksPrompt(theme, type, { taboo, naming, vid, scenesRange, roles, includeVO, voGender, emotion: structured.emotion, ingredients: structured.ingredients, narratorGender: b.narratorGender, notes });
    hooksPrompt = hooksPrompt.split('{{SCRIPT}}').join(SCRIPT_MARK);
    if (hooksPrompt) { hooksPrompt = _wrapHighlights(hooksPrompt, libVals, LAB_SOH2, LAB_STX2); hooksPrompt = _wrapHighlights(hooksPrompt, vals, LAB_SOH, LAB_STX); }
  }
  res.json({ success: true, theme, type, taboo, naming, scenesRange, hasSteps: steps.every(s => s.prompt), steps, hooksPrompt, scriptMark: SCRIPT_MARK, soh: LAB_SOH, stx: LAB_STX, soh2: LAB_SOH2, stx2: LAB_STX2, prevMark: LAB_PREV, hookMark: SP.HOOK_MARK, sep: LAB_SEP.trim() });
});

// Save an edited step prompt back to its file. The lab field holds the COMBINED
// prompt (spine + user message); persist only the spine part (before the SEP) and
// RE-INSERT placeholders for the resolved values so templating survives editing.
router.post('/scenarios-v2/lab/save-step', (req, res) => {
  const b = req.body || {};
  const { theme = 'marketing', type, n } = b;
  if (!type || !n) return res.status(400).json({ success: false, error: 'type, n required' });
  // Extract the editable spine. ugc_ad keeps inputs on top + an "----- INSTRUCTIONS -----"
  // marker, so the spine is everything AFTER it; legacy types keep the spine BEFORE the
  // "===== USER MESSAGE =====" divider.
  let spine;
  if (type === 'ugc_ad') {
    const parts = String(b.content || '').split('----- INSTRUCTIONS -----');
    spine = (parts.length > 1 ? parts.slice(1).join('----- INSTRUCTIONS -----') : parts[0]).trim();
  } else {
    spine = String(b.content || '').split('===== USER MESSAGE =====')[0].trim();
  }
  // drop any highlight sentinels (yellow params + teal vertical-library blocks)
  spine = spine.split(LAB_SOH).join('').split(LAB_STX).join('').split(LAB_SOH2).join('').split(LAB_STX2).join('');

  // Reverse-resolve: turn the current resolved values back into {{PLACEHOLDERS}}.
  const cfg = SP.getTypeConfig(theme, type) || {};
  const taboo = b.taboo || cfg.tabooDefault || 'spicy';
  const vid = b.vertical || '';
  const scenesRange = b.scenesRange || cfg.defaultSceneRange || '15-18';
  const roles = Array.isArray(b.roles) ? b.roles : [];
  const { includeVO, voGender } = _voInfo(cfg, b);
  const vlabel = SP.optionLabel(theme, 'verticals', vid), vdesc = SP.optionDesc(theme, 'verticals', vid);
  const verticalCombined = (vlabel || '(unspecified)') + (vdesc ? ` — ${vdesc}` : '');
  const comps = SP.readComparisons(theme, vid);
  const compBlock = comps.length ? 'PHRASE LIBRARY for this vertical (plain -> punchy native analogues; weave in naturally, never list them):\n' + comps.map(c => '- ' + c).join('\n') : '';
  const hk = SP.readHooksArchive(theme, vid);
  const hookBlock = hk.length ? 'TOP HOOKS for this vertical (style anchors — match their angle and shameless energy):\n' + hk.map(h => '- ' + h).join('\n') : '';
  const emoLab = SP.optionLabel(theme, 'emotions', b.emotion), emoDesc = SP.optionDesc(theme, 'emotions', b.emotion);
  const emoBlock = (b.emotion && emoLab) ? 'EMOTIONAL COLOUR (apply this tone throughout; it must NOT change the structure or beats): ' + String(emoLab).replace(/^\S+\s/, '') + (emoDesc ? ' — ' + emoDesc : '') : '';
  const naming = (b.naming === 'off' || b.naming === 'on') ? b.naming : (cfg.namingDefault || 'on');
  // Narrator descriptor (mirrors SP.resolveStep) for reverse-resolution.
  const _rs2 = roles.filter(r => r && r.name);
  let narratorStr2;
  if (_rs2.length > 1) narratorStr2 = _rs2.map(r => `${r.name}${_gnorm(r.gender) !== 'any' ? ` (${_gnorm(r.gender)})` : ''}`).join(', ');
  else if (_rs2.length === 1) { const g = _gnorm(_rs2[0].gender) !== 'any' ? _gnorm(_rs2[0].gender) : _gnorm(b.narratorGender); narratorStr2 = `${g !== 'any' ? g + ' ' : ''}${_rs2[0].name}`.trim(); }
  else { const g = _gnorm(b.narratorGender); narratorStr2 = g !== 'any' ? `${g} narrator` : ''; }
  // The transcript is huge and dynamic — reverse it FIRST (longest match) so a
  // resolved transcript never gets baked into the saved prompt file.
  const transcript = SP.readSourcesText(theme, vid, { maxChars: 12000 });
  const pairs = [
    [transcript, '{{TRANSCRIPT}}'],
    [LAB_PREV, '{{PERSONA}}'],
    [narratorStr2, '{{NARRATOR}}'],
    [SP.LINK_RULE, '{{LINK_RULE}}'],
    [SP.readBible(theme), '{{BIBLE}}'],
    [SP.tabooBlock(theme, taboo), '{{TABOO_BLOCK}}'],
    [SP.namingBlock(theme, naming), '{{NAMING_BLOCK}}'],
    [SP.castText(roles, includeVO, voGender), '{{CAST}}'],
    [compBlock, '{{COMPARISONS}}'],
    [hookBlock, '{{HOOKS}}'],
    [emoBlock, '{{EMOTION}}'],
    [verticalCombined, '{{VERTICAL}}'],
    [_rangeText(scenesRange), '{{COUNT_RANGE}}'],
    [SP.HOOK_MARK, '{{HOOK_LINE}}'],
  ].filter(p => p[0] && p[0].length > 2).sort((a, c) => c[0].length - a[0].length);
  pairs.forEach(([val, ph]) => { spine = spine.split(val).join(ph); });

  const ok = SP.saveStep(theme, type, n, spine);
  res.json({ success: ok });
});

// Save the edited HOOKS prompt back to steps/<type>.hooks.md, re-inserting the
// placeholders for the resolved values (so templating survives editing).
router.post('/scenarios-v2/lab/save-hooks-prompt', (req, res) => {
  const b = req.body || {};
  const { theme = 'marketing', type } = b;
  if (!type) return res.status(400).json({ success: false, error: 'type required' });
  let spine = String(b.content || '');
  spine = spine.split(LAB_SOH).join('').split(LAB_STX).join('').split(LAB_SOH2).join('').split(LAB_STX2).join('');
  const taboo = b.taboo || 'extreme';
  const vid = b.vertical || '';
  const roles = Array.isArray(b.roles) ? b.roles : [];
  const vlabel = SP.optionLabel(theme, 'verticals', vid), vdesc = SP.optionDesc(theme, 'verticals', vid);
  const verticalCombined = (vlabel || '(unspecified)') + (vdesc ? ` — ${vdesc}` : '');
  const hk = SP.readHooksArchive(theme, vid);
  const hookBlock = hk.length ? 'TOP HOOKS for this vertical (style anchors — match their angle and shameless energy):\n' + hk.map(h => '- ' + h).join('\n') : '';
  const _rs = roles.filter(r => r && r.name);
  let narratorStr;
  if (_rs.length > 1) narratorStr = _rs.map(r => `${r.name}${_gnorm(r.gender) !== 'any' ? ` (${_gnorm(r.gender)})` : ''}`).join(', ');
  else if (_rs.length === 1) { const g = _gnorm(_rs[0].gender) !== 'any' ? _gnorm(_rs[0].gender) : _gnorm(b.narratorGender); narratorStr = `${g !== 'any' ? g + ' ' : ''}${_rs[0].name}`.trim(); }
  else { const g = _gnorm(b.narratorGender); narratorStr = g !== 'any' ? `${g} narrator` : ''; }
  const pairs = [
    [SCRIPT_MARK, '{{SCRIPT}}'],
    [SP.tabooBlock(theme, taboo), '{{TABOO_BLOCK}}'],
    [hookBlock, '{{HOOKS}}'],
    [verticalCombined, '{{VERTICAL}}'],
    [narratorStr, '{{NARRATOR}}'],
  ].filter(p => p[0] && p[0].length > 2).sort((a, c) => c[0].length - a[0].length);
  pairs.forEach(([val, ph]) => { spine = spine.split(val).join(ph); });
  const ok = SP.saveHooksPrompt(theme, type, spine.trim());
  res.json({ success: ok });
});

// Run a single step: send the full combined prompt as ONE user message (no system
// role), substituting the previous-draft placeholder. Returns clean + raw.
router.post('/scenarios-v2/lab/run', async (req, res) => {
  try {
    const b = req.body || {};
    const theme = b.theme || 'marketing';
    const type  = b.type || 'ugc_ad';
    const step  = parseInt(b.step, 10) || 1;
    let prompt = String(b.prompt || '').trim();
    if (!prompt) return res.status(400).json({ success: false, error: 'Empty prompt' });
    const model = b.model || HERMES;
    const scenesRange = b.scenesRange || (SP.getTypeConfig(theme, type) || {}).defaultSceneRange || '15-18';
    const cfg = SP.getTypeConfig(theme, type) || {};
    const roles = Array.isArray(b.roles) ? b.roles : [];
    const prevText = String(b.prevText || '').trim();

    // If the previous-draft placeholder is still in the prompt, fill it now.
    if (prompt.includes(LAB_PREV)) {
      if (step > 1 && !prevText) return res.status(400).json({ success: false, error: `Step ${step} needs the previous pass output (run step ${step - 1} first).` });
      prompt = prompt.split(LAB_PREV).join(prevText);
    }
    // Finalization hook: substitute the chosen hook into the {{HOOK_LINE}} slot.
    if (prompt.includes(SP.HOOK_MARK)) {
      const hook = String(b.hook || '').trim();
      prompt = prompt.split(SP.HOOK_MARK).join(hook || '(no hook chosen — open with your own strong scroll-stopping first line)');
    }

    // GENDER LOCK: rebuild the cast-gender directive server-side and send it as a
    // SYSTEM message so it sits at the very top in the highest-priority role and
    // the model cannot lose it inside the long combined user prompt.
    const genderSys = _genderLockSystem(cfg, b);

    let text = _postprocess(await _runUser(prompt, model, 90000, genderSys));

    // Deterministic length top-up on the base pass (step 1): if the script came
    // back SHORT, ask the model (a second pass) to extend it up to the minimum.
    // Overshoot is fine and never trimmed. Format-aware so the new single-pass
    // ugc_ad (clean lines, no [n] markers) is expanded in its own format; never
    // accept a result that did not grow, and stop early if a pass makes no
    // progress so we don't burn calls.
    let toppedUp = 0;
    // Enforce the scene count on the SCRIPT step (the LAST pass), never on the
    // narrator-portrait pass. Fall back to step<=1 when isLast is not sent (the
    // standalone pipeline-lab page).
    const _enforceCount = (b.isLast === true) || (b.isLast === undefined && step <= 1);
    if (_enforceCount && text) {
      const [mn] = _parseRange(scenesRange);
      const isUgc = (type === 'ugc_ad');
      const fmtNote = isUgc
        ? 'CRITICAL: put EACH scene on its OWN separate line with a real line break between every scene; never run scenes together in one paragraph. Keep the clean format: first person, periods and commas only, no numbering, no brackets, no notes, no preamble, no exclamation marks.'
        : 'Keep every [n] marker and " // " note, one line per scene, in the same order.';
      let count = text.split('\n').filter(Boolean).length;
      // Retry up to 4 passes even if a pass fails to grow (the model is
      // stochastic, so a retry often succeeds). Always keep the LONGEST result
      // (never shorten); escalate the push on later attempts.
      for (let attempt = 1; attempt <= 4 && count < mn; attempt++) {
        const need = mn - count;
        const push = attempt > 1 ? ` This is attempt ${attempt}: you MUST add at least ${need} genuinely NEW scene lines and return MORE lines than before; do not repeat the same length.` : '';
        const topPrompt = `This script has ${count} lines but it must have at least ${mn} lines (one scene = one line). Expand it to at least ${mn} lines: KEEP every existing line word-for-word and in the same order, and ADD ${need} more scene lines by deepening the middle beats (agitation, backstory, the turning point, the routine, the result, handling doubt). Do NOT shorten, drop or merge any existing line.${push} ${fmtNote} Output ONLY the full expanded script lines, nothing else, no commentary.\n\nCURRENT SCRIPT:\n${text}`;
        const more = _postprocess(await _runUser(topPrompt, model, 90000, genderSys));
        const newCount = more ? more.split('\n').filter(Boolean).length : 0;
        if (more && newCount > count) { text = more; count = newCount; toppedUp++; }  // accept only growth
      }
    }

    if (!text) return res.status(502).json({ success: false, error: 'Empty response from model' });
    // Build a CLEAN version for display/save (strip [n] ordinals always; for
    // single-actor also strip any [Tag] / "Name:" label; kill stray dashes).
    // `text` (raw, with markers) is kept for chaining into the next pass.
    const single = !cfg.multi;
    let labelRe = null;
    if (single) {
      const nm = String((roles[0] && roles[0].name) || '').trim();
      const labels = ['speaker', 'narrator', 'presenter', 'host', 'me', 'voiceover', 'vo'];
      if (nm) labels.push(nm);
      labelRe = new RegExp('^\\s*(?:' + labels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*:\\s*', 'i');
    }
    const clean = text.split('\n').map(l => {
      l = l.replace(/^\s*\[\d+\]\s*/, '').replace(/^\s*\d+[.)]\s+/, '');
      l = l.replace(/\s*\/\/.*$/, '');                      // strip " // beat note" annotations
      if (single) {
        l = l.replace(/^\s*\[[^\]]{1,40}\]\s*/, '');
        if (labelRe) l = l.replace(labelRe, '');
      }
      return l.replace(/\s*[—–]\s*/g, ', ')          // dashes -> comma
              .replace(/\s*(?:\.{2,}|…)\s*/g, '. ')    // ellipses -> single stop
              .replace(/[’‘]/g, "'").replace(/[“”]/g, '"')  // curly -> straight quotes
              .replace(/\s{2,}/g, ' ').trim();
    }).filter(Boolean).join('\n');
    res.json({ success: true, step, text, raw: text, clean, lineCount: clean.split('\n').filter(Boolean).length, toppedUp });
  } catch (err) {
    console.error('[v2 lab/run]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Generate 4 wild opening hooks for the finalization pass, from the vertical library.
router.post('/scenarios-v2/lab/hooks', async (req, res) => {
  try {
    const b = req.body || {};
    const theme = b.theme || 'marketing';
    const vid = b.vertical || '';
    const taboo = b.taboo || 'spicy';
    const model = b.model || HERMES;
    // Editable-prompt path: the frontend sends the resolved+edited hooks prompt
    // (with the generated script already substituted in). Run it as one user
    // message and parse 4 hooks. The legacy builder below is the fallback.
    const customPrompt = String(b.prompt || '').trim();
    if (customPrompt) {
      const raw0 = await callAI([{ role: 'user', content: customPrompt }], { useOpenRouter: true, openRouterModel: model, timeout: 45000 });
      const hooks0 = String(raw0 || '').split(/\r?\n/)
        .map(l => l.replace(/^\s*\d+[.)]\s*/, '').replace(/^\s*[-*]\s*/, '').replace(/^["'`]+|["'`]+$/g, '').trim())
        .filter(Boolean).slice(0, 4);
      if (!hooks0.length) return res.status(502).json({ success: false, error: 'No hooks returned' });
      return res.json({ success: true, hooks: hooks0 });
    }
    const gender = _gnorm((Array.isArray(b.roles) && b.roles[0] && b.roles[0].gender) || b.narratorGender);
    const script = String(b.script || '').trim();
    const vlabel = SP.optionLabel(theme, 'verticals', vid), vdesc = SP.optionDesc(theme, 'verticals', vid);
    const archive = SP.readHooksArchive(theme, vid);
    const comps = SP.readComparisons(theme, vid);
    const tb = SP.tabooBlock(theme, taboo);
    const sys = 'You are an uncensored UGC ad hook writer for an aggressive-marketing teaching tool (parody/debunking). Write SHORT, MEGA-HARD, scroll-stopping, taboo confessional FIRST-PERSON opening hooks (scene 1) for short video ads. Each hook is ONE line and MUST be UNDER 120 characters WITH spaces — count them, stay short and punchy. Front-load the single most shocking, shameless word; one brutal taboo idea per hook (a caught moment, an age gap, a humiliation, a leaked secret). Personal story angle (the narrator, their wife/husband, or a lover). When a script is provided, the hook MUST fit that exact story as its opening scene 1 — same narrator, characters and angle. ENGLISH ONLY — no other scripts or characters. Output ONLY the hooks, one per line, no numbering, no quotes.';
    const user = `VERTICAL: ${vlabel}${vdesc ? ' — ' + vdesc : ''}\n` +
      (gender !== 'any' ? `SPEAKER GENDER: ${gender} (write the hook in this voice)\n` : '') +
      `\n${tb}\n\n` +
      (script ? `THE FINAL SCRIPT (the hook is scene 1 of THIS exact script — match its story, characters, details and tone; it must lead naturally into line 2):\n${script}\n\n` : '') +
      (archive.length ? `EXISTING TOP HOOKS (match their angle and energy, do not copy):\n${archive.map(h => '- ' + h).join('\n')}\n\n` : '') +
      (comps.length ? `NATIVE PHRASING to draw from:\n${comps.map(c => '- ' + c).join('\n')}\n\n` : '') +
      `Write 4 fresh hooks now, one per line, each UNDER 120 characters with spaces — short, brutal, shameless, English only${script ? ', each a perfect scene-1 opener for the script above' : ''}.`;
    const raw = await callAI([{ role: 'system', content: sys }, { role: 'user', content: user }], { useOpenRouter: true, openRouterModel: model, timeout: 45000 });
    const hooks = String(raw || '').split(/\r?\n/)
      .map(l => l.replace(/^\s*\d+[.)]\s*/, '').replace(/^\s*[-*]\s*/, '').replace(/^["'`]+|["'`]+$/g, '').trim())
      .filter(Boolean).slice(0, 4);
    if (!hooks.length) return res.status(502).json({ success: false, error: 'No hooks returned' });
    res.json({ success: true, hooks });
  } catch (err) {
    console.error('[v2 lab/hooks]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

router.get('/scenarios-v2/:id', (req, res) => {
  const s = _load().find(x => String(x.id) === String(req.params.id));
  if (!s) return res.status(404).json({ success: false, error: 'not found' });
  res.json({ success: true, scenario: s });
});

router.post('/scenarios-v2', (req, res) => {
  try {
    const b = req.body || {};
    const list = _load();
    const now = new Date().toISOString();
    const id = b.id || Date.now();
    let rec = list.find(x => String(x.id) === String(id));
    if (rec) { Object.assign(rec, b, { id, updatedAt: now }); }
    else { rec = { ...b, id, createdAt: now, updatedAt: now }; list.unshift(rec); }
    _save(list);
    res.json({ success: true, scenario: rec });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.delete('/scenarios-v2/:id', (req, res) => {
  const list = _load().filter(x => String(x.id) !== String(req.params.id));
  _save(list);
  res.json({ success: true });
});


// ════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS (used by the pipeline-lab routes above)
// ════════════════════════════════════════════════════════════════════════════

function _postprocess(raw) {
  let txt = String(raw || '').trim();
  txt = txt.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
  if (/^["']/.test(txt) && /["']$/.test(txt)) txt = txt.slice(1, -1).trim();
  txt = txt.replace(/\n\s*\n+/g, '\n');
  let lines = txt.split('\n').map(l => l.trim()).filter(Boolean);
  // Drop up to 3 leading meta/preamble lines an LLM sometimes prepends despite
  // "output only the script" (e.g. "Here's the expanded script:", "[Prompter ...]").
  // Single-pass generation is more prone to this than the old staged passes.
  const metaRe = /^(here\s*['’]?s|here\s+is|below\s+is|sure\b|okay\b|ok[,:]|i['’]?ll\b|i\s+will\b|the\s+(expanded|final|full|rewritten|complete|revised)\b|certainly\b|of\s+course\b)/i;
  let drop = 0;
  while (drop < lines.length && drop < 3) {
    const l = lines[drop];
    if (/^\[.*\]$/.test(l) || (metaRe.test(l) && (/:\s*$/.test(l) || /\b(script|lines|version|ad|beats)\b/i.test(l)))) { drop++; continue; }
    break;
  }
  if (drop) lines = lines.slice(drop);
  return lines.join('\n');
}

function _parseRange(s) {
  const m = String(s || '').match(/(\d+)\s*-\s*(\d+)/);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  return [15, 18];
}

const _stripEmoji = (label) => String(label || '').replace(/^\S+\s/, '');
const _gnorm = (g) => { const s = String(g || '').toLowerCase(); return (s === 'male' || s === 'female') ? s : 'any'; };
function _roleLabel(r) { const g = _gnorm(r && r.gender); return `${(r && r.name) || 'Role'}${g !== 'any' ? ` (${g})` : ''}`; }

// ── Hooks archive (⭐ save one / overwrite all for a vertical) ────────────────
router.post('/scenarios-v2/hooks/save', (req, res) => {
  const { theme = 'marketing', vertical, hook } = req.body || {};
  if (!hook || !String(hook).trim()) return res.status(400).json({ success: false, error: 'Empty hook' });
  const added = SP.appendHookToArchive(theme, vertical, hook);
  res.json({ success: true, added });
});

// Overwrite the whole archive for a vertical (per-vertical hooks library editor).
router.post('/scenarios-v2/hooks/set', (req, res) => {
  const { theme = 'marketing', vertical, hooks } = req.body || {};
  if (!Array.isArray(hooks)) return res.status(400).json({ success: false, error: 'hooks must be an array' });
  const count = SP.writeHooksArchive(theme, vertical, hooks);
  res.json({ success: true, count });
});

// ════════════════════════════════════════════════════════════════════════════
// EMOTIONAL TAGS (ElevenLabs v3) — ONE Hermes-4 pass: analyse the scenario's
// lines + its saved EMOTION, decide which v3 inline "audio tags" fit, and place
// them in the lines WITHOUT changing the spoken words. Returns the marked-up
// lines AND the distinct tag list (for the Edit² v3 settings field).
// ════════════════════════════════════════════════════════════════════════════

// Distinct inline audio tags ([excited], [whispers]…) across the marked-up lines,
// in first-seen order, de-duped case-insensitively.
function _distinctTags(arr) {
  const seen = new Set(), out = [];
  (arr || []).forEach(s => {
    const re = /\[[^\]]+\]/g; let m;
    while ((m = re.exec(String(s || '')))) { const k = m[0].toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(m[0]); } }
  });
  return out;
}

//   Body: { id?, scenFile?, lines:[string], emotion?, gender? }
//   (emotion/gender/theme fall back to the saved scenario; scenFile = sv2_<id>)
//   Returns { success, tagged:[string], tags:[string] } — tagged is index-aligned
//   with `lines`; words are never altered, only [tags] inserted.
router.post('/scenarios-v2/emotional-tags', async (req, res) => {
  try {
    const b = req.body || {};
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (!lines.length) return res.status(400).json({ success: false, error: 'No lines' });

    // Resolve the saved scenario for its emotion + theme + narrator gender.
    let id = b.id;
    if (!id && b.scenFile) id = String(b.scenFile).replace(/^sv2_/, '');
    const scen = id ? _load().find(x => String(x.id) === String(id)) : null;
    const theme = (scen && scen.theme) || b.theme || 'marketing';
    const emotionId = b.emotion || (scen && scen.emotion) || '';
    const gender = _gnorm(b.gender || (scen && scen.narratorGender) ||
      (scen && Array.isArray(scen.roles) && scen.roles[0] && scen.roles[0].gender));

    const emoLabel = emotionId ? SP.optionLabel(theme, 'emotions', emotionId) : '';
    const emoDesc  = emotionId ? SP.optionDesc(theme, 'emotions', emotionId)  : '';
    const emoText  = emoLabel
      ? (_stripEmoji(emoLabel) + (emoDesc ? ' — ' + emoDesc : ''))
      : '(none specified — infer a natural, believable delivery from the words)';

    const systemMsg =
      'You are an audio-direction engine for ElevenLabs v3 TTS.\n' +
      'You receive short UGC ad voice-over lines plus the scenario\'s overall EMOTION.\n' +
      'In ONE pass you:\n' +
      '  1. ANALYSE each phrase together with the scenario emotion and decide which v3\n' +
      '     "audio tags" fit the delivery. Audio tags are bracketed cues the engine reads, e.g.\n' +
      '     [excited] [happy] [curious] [warmly] [confident] [sarcastic] [whispers] [sighs]\n' +
      '     [laughs] [nervous] [serious] [disappointed] [hesitant] [shouts] [crying] [sad].\n' +
      '  2. PLACE the chosen tags INLINE in the lines.\n' +
      'ABSOLUTE RULES:\n' +
      '  • NEVER change, add, remove, reorder or translate the spoken WORDS — only INSERT [tags].\n' +
      '  • 0 to 2 tags per line, only where they genuinely help. Most lines need 0 or 1.\n' +
      '  • Put a tag immediately before the words it colours (mid-line is fine).\n' +
      '  • The scenario EMOTION is the baseline mood — match it.\n' +
      '  • Return STRICT JSON ONLY: { "tagged": string[] } — exactly one output string per\n' +
      '    input line, SAME ORDER. No markdown, no code fences, no commentary.';
    const userMsg =
      `SCENARIO EMOTION: ${emoText}\n` +
      `NARRATOR: ${gender === 'male' ? 'male' : (gender === 'female' ? 'female' : 'unspecified')}\n\n` +
      'LINES (JSON array — keep every word identical, only insert [tags]):\n' +
      JSON.stringify(lines) + '\n\nReturn the JSON now.';

    const raw = await callAI(
      [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
      { useOpenRouter: true, openRouterModel: HERMES, timeout: 60000 }
    );
    const cleaned = String(raw || '').replace(/```(?:json)?\s*|\s*```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    let tagged = null;
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        if (Array.isArray(obj.tagged)) tagged = obj.tagged.map(s => String(s == null ? '' : s));
      } catch (e) { console.warn('[scenarios-v2/emotional-tags] JSON parse failed:', e.message); }
    }
    if (!tagged) tagged = [];
    // Never desync indexes: fall back to the original line for any missing/blank slot.
    const out = lines.map((ln, i) => (tagged[i] && String(tagged[i]).trim()) ? String(tagged[i]) : ln);
    res.json({ success: true, tagged: out, tags: _distinctTags(out) });
  } catch (err) {
    console.error('[scenarios-v2/emotional-tags]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// MOTION CLAUSES — restrained, emotion-led motion for the talking-head avatar.
// Built once per scenario (right after a project is created) and cached in
// scenarios-meta.json under scenFile `sv2_<id>`, reused as the base motionHint
// for every per-scene avatar prompt.
//
// DESIGN: motion must be SUBTLE — neat, controlled movements that quietly reflect
// the scenario's chosen emotion, never theatrical. The emotion colours the
// delivery, it does NOT turn into big gestures.
// ════════════════════════════════════════════════════════════════════════════
async function buildRestrainedMotion({ gender, emotionText }) {
  const g = gender === 'male' ? 'male' : (gender === 'female' ? 'female' : 'neutral');
  const systemMsg =
    'You craft TWO restrained motion clauses for an AI talking-head avatar — a narrator\n' +
    'delivering a short UGC ad voice-over straight to camera.\n' +
    'Return STRICT JSON only — no markdown, no preamble, no code fences.\n' +
    'Schema: { "motionPrompt": string, "minimalistMotionPrompt": string }\n\n' +
    'GUIDING PRINCIPLE: motion must be SUBTLE and TASTEFUL — neat, controlled movements\n' +
    'that quietly REFLECT the scenario emotion, never exaggerated or theatrical. The\n' +
    'emotion colours the delivery; it does NOT become big gestures. Picture a composed\n' +
    'person on camera, not an actor performing.\n\n' +
    '1) motionPrompt — ~15-22 words, one English sentence. Calm facial expression, steady\n' +
    '   eye contact, gentle head movement and natural micro-expressions that match the\n' +
    '   emotion. At most ONE small, restrained hand gesture, and only if it truly fits.\n\n' +
    '2) minimalistMotionPrompt — ~12-18 words, one English sentence. EVEN MORE restrained:\n' +
    '   steady eye contact, only micro head sway during speech, hands out of frame, no\n' +
    '   gestures, calm shoulders, subtle facial micro-expressions only; photo-realistic.\n\n' +
    'RULES: both strings in English regardless of input language; gender-consistent body\n' +
    'language; never use the generic placeholder "Natural speaking motion with subtle head movement".';
  const userMsg =
    `NARRATOR GENDER: ${g}\n` +
    `SCENARIO EMOTION (reflect it subtly, never over-express): ${emotionText || '(none specified — keep a calm, believable neutral delivery)'}\n\n` +
    'Write the JSON now.';
  let motionPrompt = '', minimalistMotionPrompt = '';
  try {
    const raw = await callAI(
      [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
      { useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash', timeout: 30000 }
    );
    const cleaned = String(raw || '').replace(/```(?:json)?\s*|\s*```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      const o = JSON.parse(m[0]);
      if (typeof o.motionPrompt === 'string') motionPrompt = o.motionPrompt.trim();
      if (typeof o.minimalistMotionPrompt === 'string') minimalistMotionPrompt = o.minimalistMotionPrompt.trim();
    }
  } catch (e) { console.warn('[scenarios-v2/motion] LLM failed:', e.message); }
  if (!motionPrompt) motionPrompt = 'Calm, composed delivery to camera with steady eye contact and gentle, natural head movement that quietly matches the mood.';
  if (!minimalistMotionPrompt) minimalistMotionPrompt = 'Steady eye contact with the camera, only micro head sway during speech, hands out of frame, calm relaxed posture, subtle facial micro-expressions only.';
  return { motionPrompt, minimalistMotionPrompt };
}

// POST /api/scenarios-v2/:id/ensure-motion   body: { force? }
// Generate-once the per-scenario motion clauses from the scenario's chosen emotion
// and cache them under scenFile `sv2_<id>`. Called by the Edit2 "new project from
// scenario" builder immediately after a project is created.
router.post('/scenarios-v2/:id/ensure-motion', async (req, res) => {
  try {
    const id = req.params.id;
    const scen = _load().find(x => String(x.id) === String(id));
    if (!scen) return res.json({ success: false, error: 'scenario not found' });
    const scenFile = 'sv2_' + id;
    const force = !!(req.body && req.body.force);

    const SCEN = require('./scenarios');                 // module-cached; no cycle
    const all = SCEN.loadScenariosMeta();
    const cur = all[scenFile] || {};
    if (!force && cur.motionPrompt && cur.minimalistMotionPrompt) {
      return res.json({ success: true, cached: true, motionPrompt: cur.motionPrompt, minimalistMotionPrompt: cur.minimalistMotionPrompt });
    }

    const theme     = scen.theme || 'marketing';
    const emotionId = scen.emotion || '';
    const emoLabel  = emotionId ? SP.optionLabel(theme, 'emotions', emotionId) : '';
    const emoDesc   = emotionId ? SP.optionDesc(theme, 'emotions', emotionId)  : '';
    const emotionText = emoLabel ? (_stripEmoji(emoLabel) + (emoDesc ? ' — ' + emoDesc : '')) : '';
    const gender = _gnorm(scen.narratorGender || (Array.isArray(scen.roles) && scen.roles[0] && scen.roles[0].gender));

    const built = await buildRestrainedMotion({ gender, emotionText });
    all[scenFile] = {
      ...cur,
      gender:  cur.gender  || (gender === 'any' ? '' : gender),
      emotion: cur.emotion || emotionId,
      motionPrompt:           built.motionPrompt,
      minimalistMotionPrompt: built.minimalistMotionPrompt,
      generatedAt:      cur.generatedAt || new Date().toISOString(),
      motionGeneratedAt: new Date().toISOString(),
    };
    SCEN.saveScenariosMeta(all);
    res.json({ success: true, cached: false, motionPrompt: built.motionPrompt, minimalistMotionPrompt: built.minimalistMotionPrompt });
  } catch (err) {
    console.error('[scenarios-v2/ensure-motion]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// EMBED A THOUGHT — weave a free-form author idea into the FINAL script via ONE
// Hermes-4 pass, preserving the script's flow, voice, language, scene count and
// one-line-per-row format. Returns { scenario } (the full updated script). Used
// by the "Вплести" button under the finalization step in Scenarios v2.
// ════════════════════════════════════════════════════════════════════════════
router.post('/scenarios-v2/embed-thought', async (req, res) => {
  try {
    const b = req.body || {};
    const scenario = String(b.scenario || '').trim();
    const thought  = String(b.thought  || '').trim();
    if (!scenario) return res.status(400).json({ success: false, error: 'scenario required' });
    if (!thought)  return res.status(400).json({ success: false, error: 'thought required' });

    const systemMsg =
      'You are a short-video UGC script editor. You receive an EXISTING finished script ' +
      '(one spoken line per row) and an IDEA the author wants woven into it.\n' +
      'In ONE pass, integrate the idea so it reads as a natural, native part of the narrative — ' +
      'placed where it fits best and phrased in the same voice, tone and LANGUAGE as the script.\n' +
      'ABSOLUTE RULES:\n' +
      '  • Keep the SAME language as the script.\n' +
      '  • Keep the SAME structure and line count (one line per row). You may reword 1-3 nearby\n' +
      '    lines so the idea blends in, but do NOT add or drop scenes/lines.\n' +
      '  • Make it feel organic — never a tacked-on disclaimer or ad-break.\n' +
      '  • Output ONLY the full updated script. No commentary, headers, quotes or code fences.';
    const userMsg =
      'IDEA TO WEAVE IN:\n' + thought + '\n\n' +
      '===== CURRENT SCRIPT =====\n' + scenario + '\n\n' +
      'Return the full updated script now (same line count, same language).';

    const raw = await callAI(
      [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
      { useOpenRouter: true, openRouterModel: HERMES, timeout: 90000 }
    );
    const out = String(raw || '').replace(/```(?:[a-z]*)?\s*|\s*```/g, '').trim();
    if (!out) return res.json({ success: false, error: 'empty result' });
    res.json({ success: true, scenario: out });
  } catch (err) {
    console.error('[scenarios-v2/embed-thought]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PROPS FROM SCENARIO — extract a short prop/shopping list from a SAVED v2
// scenario's spoken lines (for the Edit² product manager's "AI from scenario").
// Returns { items:[{name,hint}] }; the Edit² UI then generates each via the
// existing /api/details/ai/generate + /api/details/ai/commit endpoints.
// ════════════════════════════════════════════════════════════════════════════

function _scenText(scen) {
  if (!scen) return '';
  const parts = [];
  if (scen.hook) parts.push(String(scen.hook));
  (scen.lines || []).forEach(l => { const t = (l && (l.text != null ? l.text : l)) || ''; if (String(t).trim()) parts.push(String(t)); });
  if (scen.ingredients) parts.push('INGREDIENTS: ' + scen.ingredients);
  return parts.join('\n').trim();
}

router.post('/scenarios-v2/extract-items', async (req, res) => {
  try {
    const b = req.body || {};
    let id = b.id;
    if (!id && b.scenFile) id = String(b.scenFile).replace(/^sv2_/, '');
    const scen = id ? _load().find(x => String(x.id) === String(id)) : null;
    const text = _scenText(scen);
    if (!text) return res.status(404).json({ success: false, error: 'Scenario has no text' });

    const systemMsg =
      'You extract a prop/shopping list from a UGC video scenario.\n' +
      'Return STRICT JSON only — no markdown, no commentary, no preamble.\n' +
      'Schema: a JSON array of 3 to 5 objects (NEVER more than 5, NEVER fewer than 3) with this exact shape:\n' +
      '  { "name": string, "hint": string }\n' +
      '- `name` MUST be ENGLISH, STRICTLY ONE WORD, nominative singular, no articles, no punctuation, no hyphens.\n' +
      '   Good: "cream", "jar", "oil", "cucumber", "honey", "spoon", "bottle". Bad: "hand cream", "the jar", "linseed-oil".\n' +
      '   If a prop has no good single-word name, pick the most specific single noun (e.g. "linseed oil" -> "oil").\n' +
      '- `hint` MUST be ENGLISH, max ~6 words, describing a qualifier (material, color, container, type) the user might edit.\n' +
      'Extract ONLY items plausibly shown on camera in this scenario. Do NOT invent. Pick the 3-5 most visually prominent props.';
    const userMsg = `SCENARIO TEXT:\n${text}\n\nReturn the JSON array now.`;

    const raw = await callAI(
      [{ role: 'system', content: systemMsg }, { role: 'user', content: userMsg }],
      { useOpenRouter: true, openRouterModel: HERMES, timeout: 45000 }
    );
    const cleaned = String(raw || '').replace(/```(?:json)?\s*|\s*```/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    let items = [];
    if (match) { try { items = JSON.parse(match[0]); } catch (e) { console.warn('[scenarios-v2/extract-items] parse:', e.message); } }
    const _trimName = (s) => String(s).replace(/[«»"„""''!.,;:?\-_/\\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().split(' ')[0] || '';
    items = (Array.isArray(items) ? items : [])
      .filter(it => it && typeof it.name === 'string' && it.name.trim())
      .slice(0, 5)
      .map(it => ({ name: _trimName(it.name), hint: String(it.hint || '').trim() }))
      .filter(it => it.name);
    if (!items.length) return res.status(502).json({ success: false, error: 'No items extracted' });
    res.json({ success: true, items });
  } catch (err) {
    console.error('[scenarios-v2/extract-items]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
