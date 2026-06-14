'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO PROMPT LIBRARY LOADER
// Reads the on-disk prompt library at  prompts/<theme>/  and assembles the
// system prompt for scenario generation:
//
//   prompts/<theme>/
//     _bible.md            theme "bible" (commandments) — prepended to every type
//     _taboo.md            4-level taboo ladder, sections by "## key"
//     _naming.md           on/off product-naming blocks, sections by "## key"
//     _types.json          per-type config (roles, ranges, defaults, passes…)
//     _hooks_generator.md  hooks-generator system prompt (ugc_ad)
//     _analyzer.md         "techniques breakdown" system prompt
//     param-maps.json      per-type param maps for the ⚙ popup (RU, UI-facing)
//     hooks_archive.md     user-curated top hooks (style anchor for the gen)
//     <type>.md            the type spine (with {{TABOO_BLOCK}} / {{NAMING_BLOCK}}
//                          / {{HOOK_LINE}} placeholders)
//     <type>.kb.md         optional per-type knowledge base (from ingestion)
//     examples/<type>/*.txt  reference scripts for the type
//
// Everything is read fresh from disk per call (generation is low-frequency), so
// editing a prompt file takes effect immediately with no restart.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const THEMES_ROOT = path.join(__dirname, '..', 'prompts');

function _safeRead(p) {
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; }
}
function _safeJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function _themeDir(theme) { return path.join(THEMES_ROOT, String(theme || '').replace(/[^a-z0-9_\-]/gi, '')); }

// Parse a markdown file into { key: text } by "## key" headers. Text before the
// first header is ignored (it's the file's own doc preamble).
function _parseSections(md) {
  const out = {};
  const lines = String(md || '').split(/\r?\n/);
  let cur = null, buf = [];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (cur !== null) out[cur] = buf.join('\n').trim();
      cur = m[1].trim().toLowerCase();
      buf = [];
    } else if (cur !== null) {
      buf.push(line);
    }
  }
  if (cur !== null) out[cur] = buf.join('\n').trim();
  return out;
}

// ── Config ──────────────────────────────────────────────────────────────────
function listThemes() {
  try {
    return fs.readdirSync(THEMES_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory() && fs.existsSync(path.join(THEMES_ROOT, d.name, '_types.json')))
      .map(d => d.name);
  } catch { return []; }
}

function loadTypesConfig(theme) {
  return _safeJson(path.join(_themeDir(theme), '_types.json'), {});
}

function listTypes(theme) {
  const cfg = loadTypesConfig(theme);
  const order = Array.isArray(cfg._order) ? cfg._order : Object.keys(cfg).filter(k => k[0] !== '_');
  return order.filter(id => cfg[id]).map(id => ({ id, ...cfg[id] }));
}

function getTypeConfig(theme, type) {
  const cfg = loadTypesConfig(theme);
  return cfg[type] || null;
}

// ── Building blocks ─────────────────────────────────────────────────────────
function readBible(theme) {
  const dir = _themeDir(theme);
  let b = _safeRead(path.join(dir, '_bible.md')).trim();
  // Ingested general knowledge lives in a separate appendix so the curated
  // bible stays pristine. The ingestion endpoint appends only to _bible.kb.md.
  const kb = _safeRead(path.join(dir, '_bible.kb.md')).trim();
  if (kb) b += `\n\n---\n\nINGESTED GENERAL KNOWLEDGE (learned from user-supplied material — additional house rules):\n${kb}`;
  return b;
}

function tabooBlock(theme, level) {
  const sec = _parseSections(_safeRead(path.join(_themeDir(theme), '_taboo.md')));
  const key = String(level || 'soft').toLowerCase();
  return sec[key] || sec.soft || '';
}

function namingBlock(theme, on) {
  const sec = _parseSections(_safeRead(path.join(_themeDir(theme), '_naming.md')));
  return on ? (sec.on || '') : (sec.off || '');
}

// ── Taboo ladder editing (read all levels / rewrite one section) ─────────────
const TABOO_ORDER = ['soft', 'spicy', 'hard', 'extreme'];
function listTaboo(theme) {
  const sec = _parseSections(_safeRead(path.join(_themeDir(theme), '_taboo.md')));
  return TABOO_ORDER.filter(k => sec[k] != null).map(k => ({ key: k, text: sec[k] || '' }));
}
function saveTaboo(theme, level, text) {
  const p = path.join(_themeDir(theme), '_taboo.md');
  const key = String(level || '').toLowerCase();
  if (!TABOO_ORDER.includes(key)) return false;
  const lines = _safeRead(p).split(/\r?\n/);
  const out = []; let i = 0, replaced = false;
  while (i < lines.length) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (m && m[1].trim().toLowerCase() === key) {
      out.push(lines[i]); i++;
      while (i < lines.length && !/^##\s+/.test(lines[i])) i++;   // drop old body
      out.push('', String(text || '').trim(), '');
      replaced = true; continue;
    }
    out.push(lines[i]); i++;
  }
  if (!replaced) out.push('', '## ' + key, '', String(text || '').trim(), '');
  try { fs.writeFileSync(p, out.join('\n'), 'utf8'); return true; } catch { return false; }
}

function readSpine(theme, type) {
  const dir = _themeDir(theme);
  const cfg = getTypeConfig(theme, type) || {};
  const spineFile = cfg.spine || `${type}.md`;
  let spine = _safeRead(path.join(dir, spineFile)).trim();
  // Append per-type knowledge base if it exists.
  const kb = _safeRead(path.join(dir, `${type}.kb.md`)).trim();
  if (kb) spine += `\n\nPER-TYPE KNOWLEDGE BASE (learned from user-supplied material — treat as additional house rules):\n${kb}`;
  return spine;
}

function getExamples(theme, type) {
  const exDir = path.join(_themeDir(theme), 'examples', type);
  let files = [];
  try { files = fs.readdirSync(exDir).filter(f => f.toLowerCase().endsWith('.txt')); } catch { return []; }
  const out = [];
  for (const f of files.slice(0, 6)) {
    const content = _safeRead(path.join(exDir, f)).trim();
    if (content) out.push({ name: f.replace(/\.txt$/i, ''), content });
  }
  return out;
}

// ── Placeholder resolution + assembly ───────────────────────────────────────
function _resolvePlaceholders(spine, { theme, taboo, naming, hookLine }) {
  let s = spine;
  s = s.replace(/\{\{TABOO_BLOCK\}\}/g, tabooBlock(theme, taboo));
  s = s.replace(/\{\{NAMING_BLOCK\}\}/g, namingBlock(theme, naming === 'on' || naming === true));

  const hl = (hookLine || '').trim();
  const hookText = hl
    ? `MANDATORY OPENING LINE: use the following hook VERBATIM as scene 1 — do not rewrite it, continue the script from it:\n"${hl.replace(/"/g, "'")}"`
    : '';
  s = s.replace(/\{\{HOOK_LINE\}\}/g, hookText);

  // Tidy any blank runs left by removed placeholders.
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

// Voiceover note for types where [VO] is conditional.
function _voNote(cfg, voEnabled) {
  if (!cfg) return '';
  if (cfg.vo === 'always') return 'VOICEOVER: [VO] narrator is ENABLED and always available — use it to fill seams so there is no dead air.';
  if (cfg.vo === 'optional') {
    return voEnabled
      ? 'VOICEOVER: [VO] narrator is ENABLED for this script — use it sparingly, mainly for the intro and the CTA.'
      : 'VOICEOVER: [VO] is DISABLED — this is a pure two-person dialogue, do not use any [VO] lines.';
  }
  return '';
}

// Assemble the top of the prompt (bible + resolved spine + VO note). The caller
// appends CONTEXT / notes / output rules. Examples are returned separately so the
// caller can place them next to the brief.
function assembleSpine({ theme = 'marketing', type = 'ugc_ad', taboo = 'soft', naming = 'on', hookLine = '', voEnabled = false }) {
  const cfg   = getTypeConfig(theme, type) || {};
  const bible = readBible(theme);
  const spine = _resolvePlaceholders(readSpine(theme, type), { theme, taboo, naming, hookLine });
  const voNote = _voNote(cfg, voEnabled);
  const parts = [];
  if (bible) parts.push(bible);
  parts.push(spine);
  if (voNote) parts.push(voNote);
  return parts.join('\n\n---\n\n');
}

// ── Hooks generator / analyzer system prompts ───────────────────────────────
function hooksGeneratorPrompt(theme, { taboo = 'soft' } = {}) {
  let s = _safeRead(path.join(_themeDir(theme), '_hooks_generator.md')).trim();
  s = s.replace(/\{\{TABOO_BLOCK\}\}/g, tabooBlock(theme, taboo));
  const bible = readBible(theme);
  return bible ? `${bible}\n\n---\n\n${s}` : s;
}

function analyzerPrompt(theme) {
  const s = _safeRead(path.join(_themeDir(theme), '_analyzer.md')).trim();
  const bible = readBible(theme);
  return bible ? `${bible}\n\n---\n\n${s}` : s;
}

// ── Editable option stores (emotions / styles / verticals) ──────────────────
const DEFAULT_VERTICALS = [
  { id: 'male_enhancement', label: 'home office' },
  { id: 'memory',           label: 'Memory' },
  { id: 'weight_loss',      label: 'Weight loss' },
  { id: 'Travel gear',      label: 'Travel gear' },
];
function _slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }
function _optPath(theme, kind) { return path.join(_themeDir(theme), kind + '.json'); } // kind: emotions|styles|verticals

function listOptions(theme, kind) {
  let v = _safeJson(_optPath(theme, kind), null);
  if (!Array.isArray(v)) {
    v = (kind === 'verticals') ? DEFAULT_VERTICALS.slice() : [];
    if (v.length) try { fs.writeFileSync(_optPath(theme, kind), JSON.stringify(v, null, 2), 'utf8'); } catch {}
  }
  return v.filter(x => x && x.id).map(x => ({ id: x.id, label: x.label || x.id, desc: x.desc || '' }));
}
function upsertOption(theme, kind, p) {
  const list = listOptions(theme, kind);
  const id = p.id ? _slug(p.id) : _slug(p.label);
  if (!id) return null;
  let it = list.find(x => x.id === id);
  if (it) { if (p.label != null) it.label = String(p.label).trim() || it.label; if (p.desc != null) it.desc = String(p.desc); }
  else { it = { id, label: String(p.label || id).trim(), desc: String(p.desc || '') }; list.push(it); if (kind === 'verticals') writeHooksArchive(theme, id, []); }
  try { fs.writeFileSync(_optPath(theme, kind), JSON.stringify(list, null, 2), 'utf8'); } catch {}
  return it;
}
function deleteOption(theme, kind, id) {
  const list = listOptions(theme, kind).filter(x => x.id !== _slug(id));
  try { fs.writeFileSync(_optPath(theme, kind), JSON.stringify(list, null, 2), 'utf8'); } catch {}
  return true;
}
function optionLabel(theme, kind, id) { const o = listOptions(theme, kind).find(x => x.id === _slug(id)); return o ? o.label : (id || ''); }
function optionDesc(theme, kind, id)  { const o = listOptions(theme, kind).find(x => x.id === _slug(id)); return o ? o.desc : ''; }

// Verticals = the 'verticals' option store (+ empty hooks archive on create).
function listVerticals(theme) { return listOptions(theme, 'verticals'); }
function addVertical(theme, label) { return upsertOption(theme, 'verticals', { label }); }
function verticalLabel(theme, vid) { return optionLabel(theme, 'verticals', vid); }

// ── Type meta (label/desc) + spine editing ──────────────────────────────────
function patchType(theme, type, p) {
  const cfg = loadTypesConfig(theme);
  if (!cfg[type]) return null;
  if (p.label != null) cfg[type].label = String(p.label).trim() || cfg[type].label;
  if (p.desc != null)  cfg[type].desc  = String(p.desc);
  if (Array.isArray(p.sceneRanges)) {
    const r = p.sceneRanges.map(x => String(x).trim()).filter(x => /\d+\s*-\s*\d+/.test(x));
    if (r.length) cfg[type].sceneRanges = r;
  }
  if (p.defaultSceneRange != null && /\d+\s*-\s*\d+/.test(String(p.defaultSceneRange))) cfg[type].defaultSceneRange = String(p.defaultSceneRange).trim();
  try { fs.writeFileSync(path.join(_themeDir(theme), '_types.json'), JSON.stringify(cfg, null, 2), 'utf8'); } catch {}
  return cfg[type];
}
function saveSpine(theme, type, text) {
  const f = path.join(_themeDir(theme), (getTypeConfig(theme, type) || {}).spine || (type + '.md'));
  try { fs.writeFileSync(f, String(text || ''), 'utf8'); return true; } catch { return false; }
}

// ── Per-vertical hooks archive (read / write / append) ──────────────────────
const HOOKS_HEADER = '# TOP-HOOKS ARCHIVE\n# User-curated best hooks for this vertical. The hooks generator reads this file as a style anchor.\n# One hook per line, plain text. Lines starting with # are comments and ignored.\n\n';
function _hooksPath(theme, vid) { return path.join(_themeDir(theme), 'hooks', (_slug(vid) || 'default') + '.md'); }

function readHooksArchive(theme, vid) {
  const raw = _safeRead(_hooksPath(theme, vid));
  return raw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}
function writeHooksArchive(theme, vid, hooks) {
  const arr = (Array.isArray(hooks) ? hooks : []).map(h => String(h || '').trim()).filter(Boolean);
  const dir = path.join(_themeDir(theme), 'hooks');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  fs.writeFileSync(_hooksPath(theme, vid), HOOKS_HEADER + arr.join('\n') + (arr.length ? '\n' : ''), 'utf8');
  return arr.length;
}
function appendHookToArchive(theme, vid, hook) {
  const h = String(hook || '').trim();
  if (!h) return false;
  const existing = readHooksArchive(theme, vid);
  if (existing.some(e => e.toLowerCase() === h.toLowerCase())) return false;
  writeHooksArchive(theme, vid, existing.concat(h));
  return true;
}

// ── Per-vertical comparisons / phrase library (read / write) ─────────────────
const COMP_HEADER = '# COMPARISONS / PHRASE LIBRARY\n# Plain phrase -> punchy native analogues for this vertical.\n# One mapping per line. Lines starting with # are ignored.\n\n';
function _compPath(theme, vid) { return path.join(_themeDir(theme), 'comparisons', (_slug(vid) || 'default') + '.md'); }
function readComparisons(theme, vid) {
  return _safeRead(_compPath(theme, vid)).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}
function writeComparisons(theme, vid, lines) {
  const arr = (Array.isArray(lines) ? lines : []).map(l => String(l || '').trim()).filter(Boolean);
  const dir = path.join(_themeDir(theme), 'comparisons');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  fs.writeFileSync(_compPath(theme, vid), COMP_HEADER + arr.join('\n') + (arr.length ? '\n' : ''), 'utf8');
  return arr.length;
}

// ── Per-vertical reference sources (VSL transcripts etc.) ────────────────────
// Long-form reference material for a vertical, accumulated across VSLs. Stored as
// a section-based markdown file keyed by "## <source-id>" (e.g. a VSL file id) so
// re-binding the same VSL replaces its section instead of duplicating. The
// scenario generator reads these as reference context (the creative is a teaser
// that drives viewers to watch the VSL).
const SOURCES_HEADER = '# REFERENCE SOURCES\n# Long-form reference material for this vertical (e.g. VSL transcripts).\n# Sections are keyed by "## <source-id>". The scenario generator reads these as reference context.\n\n';
function _sourcesPath(theme, vid) { return path.join(_themeDir(theme), 'sources', (_slug(vid) || 'default') + '.md'); }
function _srcKey(k) { return String(k || '').replace(/[\r\n]+/g, ' ').trim().toLowerCase().slice(0, 80); }
function _writeSources(theme, vid, sec) {
  const dir = path.join(_themeDir(theme), 'sources');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  const body = Object.keys(sec).map(k => `## ${k}\n\n${sec[k]}`).join('\n\n');
  fs.writeFileSync(_sourcesPath(theme, vid), SOURCES_HEADER + body + (body ? '\n' : ''), 'utf8');
}
function listSources(theme, vid) {
  const sec = _parseSections(_safeRead(_sourcesPath(theme, vid)));
  return Object.keys(sec).map(k => ({ key: k, chars: (sec[k] || '').length }));
}
function upsertSource(theme, vid, key, text) {
  const k = _srcKey(key);
  if (!k) return false;
  const sec = _parseSections(_safeRead(_sourcesPath(theme, vid)));
  sec[k] = String(text || '').trim();
  _writeSources(theme, vid, sec);
  return true;
}
function removeSource(theme, vid, key) {
  const k = _srcKey(key);
  const sec = _parseSections(_safeRead(_sourcesPath(theme, vid)));
  if (!(k in sec)) return false;
  delete sec[k];
  _writeSources(theme, vid, sec);
  return true;
}
// Joined source text for prompt injection, newest-style cap so a single huge
// transcript can't blow the context window.
function readSourcesText(theme, vid, { maxChars = 60000 } = {}) {
  const sec = _parseSections(_safeRead(_sourcesPath(theme, vid)));
  const texts = Object.keys(sec).map(k => (sec[k] || '').trim()).filter(Boolean);
  if (!texts.length) return '';
  let out = texts.join('\n\n---\n\n');
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, '') + '\n[...transcript truncated...]';
  return out;
}

// ── Universal LINK POSTULATE (woven into every pass) ─────────────────────────
const LINK_RULE = [
  'LINK POSTULATE (applies to THIS and every pass — never break it):',
  '- The script SELLS THE LINK and nothing else. The narrator simply shares how they (or their wife, husband, or a lover) actually did it — a personal, intriguing story.',
  '- Do NOT frame it as advice, a cure, or a panacea. Do NOT tell the viewer to do, try, mix, rub or repeat anything. Do NOT add disclaimers like "do not repeat this" either — just tell the story.',
  '- The only thing waiting for the viewer is something interesting behind the link. The single call to action is to go look at the link below.',
].join('\n');

// ── Staged "pipeline lab" step prompts (steps/<type>.step{1,2,3}.md) ─────────
// Each type can be split into N focused step prompts. Placeholders resolved per
// step: {{BIBLE}} (techniques, step 2), {{TABOO_BLOCK}}+{{NAMING_BLOCK}}+
// {{VERTICAL}} (step 3), {{COUNT_RANGE}} (every step, "min to max").
function _stepPath(theme, type, n) {
  return path.join(_themeDir(theme), 'steps', `${String(type || '').replace(/[^a-z0-9_]/gi, '')}.step${parseInt(n, 10) || 1}.md`);
}
function readStep(theme, type, n) { return _safeRead(_stepPath(theme, type, n)).trim(); }
function stepCount(theme, type) {
  let n = 0;
  for (let i = 1; i <= 6; i++) { if (fs.existsSync(_stepPath(theme, type, i))) n = i; else break; }
  return n;
}
function _rangeText(r) {
  const m = String(r || '').match(/(\d+)\s*-\s*(\d+)/);
  return m ? `${m[1]} to ${m[2]}` : (String(r || '').trim() || '15 to 18');
}
function _gtag(g) { const s = String(g || '').toLowerCase(); return (s === 'male' || s === 'female') ? ` (${s})` : ''; }
function castText(roles, includeVO, voGender) {
  const lines = [];
  (Array.isArray(roles) ? roles : []).forEach(r => {
    if (!r || !r.name) return;
    lines.push(`- ${r.name}${_gtag(r.gender)} — a cast member; tag every line they speak [${r.name}].`);
  });
  if (!lines.length) lines.push('- (no on-camera cast)');
  if (includeVO) lines.push(`- [VO] = off-screen narrator${_gtag(voGender)} for studies, stats, transitions and social-proof montages. Tag these lines [VO]. Not a cast member.`);
  else lines.push('- NO voiceover: do NOT use any [VO] lines.');
  return 'CAST (use EXACTLY these speakers — no more, no fewer):\n' + lines.join('\n');
}

const HOOK_MARK = '⟦ CHOSEN HOOK — fills from the Hook field above ⟧';
function resolveStep(theme, type, n, { taboo = 'spicy', naming = 'on', vid = '', scenesRange = '', roles = [], includeVO = false, voGender = 'any', emotion = '' } = {}) {
  let s = readStep(theme, type, n);
  if (!s) return '';
  s = s.replace(/\{\{BIBLE\}\}/g, readBible(theme));
  s = s.replace(/\{\{TABOO_BLOCK\}\}/g, tabooBlock(theme, taboo));
  s = s.replace(/\{\{NAMING_BLOCK\}\}/g, namingBlock(theme, naming === 'on' || naming === true));
  s = s.replace(/\{\{CAST\}\}/g, castText(roles, includeVO, voGender));
  s = s.replace(/\{\{LINK_RULE\}\}/g, LINK_RULE);
  s = s.replace(/\{\{HOOK_LINE\}\}/g, HOOK_MARK);
  const emoLab = optionLabel(theme, 'emotions', emotion), emoDesc = optionDesc(theme, 'emotions', emotion);
  s = s.replace(/\{\{EMOTION\}\}/g, (emotion && emoLab)
    ? 'EMOTIONAL COLOUR (apply this tone throughout; it must NOT change the structure or beats): ' + String(emoLab).replace(/^\S+\s/, '') + (emoDesc ? ' — ' + emoDesc : '')
    : '(no specific emotion selected — keep the tone natural)');
  const vlabel = optionLabel(theme, 'verticals', vid), vdesc = optionDesc(theme, 'verticals', vid);
  s = s.replace(/\{\{VERTICAL\}\}/g, (vlabel || '(unspecified)') + (vdesc ? ` — ${vdesc}` : ''));
  s = s.replace(/\{\{COUNT_RANGE\}\}/g, _rangeText(scenesRange));
  // Per-vertical libraries (comparisons / hooks) for voice & finalization passes.
  const comps = readComparisons(theme, vid);
  s = s.replace(/\{\{COMPARISONS\}\}/g, comps.length
    ? 'PHRASE LIBRARY for this vertical (plain -> punchy native analogues; weave in naturally, never list them):\n' + comps.map(c => '- ' + c).join('\n')
    : '(no phrase library yet for this vertical)');
  const hk = readHooksArchive(theme, vid);
  s = s.replace(/\{\{HOOKS\}\}/g, hk.length
    ? 'TOP HOOKS for this vertical (style anchors — match their angle and shameless energy):\n' + hk.map(h => '- ' + h).join('\n')
    : '(no saved hooks yet for this vertical)');
  // Reference sources (VSL transcripts) — when present, the creative becomes a
  // teaser whose only job is to drive the viewer to watch the VSL behind the
  // link. Capped so a long transcript can't blow the context (the VSL's opening
  // carries the hook / promise / curiosity, which is what a teaser needs).
  const srcText = readSourcesText(theme, vid, { maxChars: 12000 });
  s = s.replace(/\{\{SOURCES\}\}/g, srcText
    ? 'REFERENCE — THE VSL THIS CREATIVE MUST TEASE (the long sales video that plays behind the link; do NOT copy it, mine it for angle and curiosity):\n"""\n' + srcText + '\n"""\n\n'
      + 'TEASER FRAMING (this overrides any instinct to tell the whole story): this short creative is ONLY a warm-up. Its single job is to make the viewer crave the full video behind the link. Borrow the VSL\'s angle, promise and open loops, but DELIVER NOTHING — withhold the mechanism, the proof and the payoff; those live in the VSL. Every beat should raise curiosity and push the viewer to watch / click the link to get the rest.'
    : '');
  const ex = getExamples(theme, type);
  s = s.replace(/\{\{EXAMPLES\}\}/g, ex.length
    ? 'REFERENCE SCRIPTS (the CANON — match their tone, structure, sales aggression and shameless energy; keep the funnel identical; do not copy verbatim):\n' + ex.map((e, i) => `--- REFERENCE ${i + 1} (${e.name}) ---\n${e.content}`).join('\n\n')
    : '(no reference scripts for this type)');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}
function saveStep(theme, type, n, text) {
  const dir = path.join(_themeDir(theme), 'steps');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  try { fs.writeFileSync(_stepPath(theme, type, n), String(text || ''), 'utf8'); return true; } catch { return false; }
}

// ── Param maps (⚙ popup) ────────────────────────────────────────────────────
function paramMap(theme, type) {
  const all = _safeJson(path.join(_themeDir(theme), 'param-maps.json'), {});
  return all[type] || [];
}

// Raw spine text (with placeholders left intact) for the ⚙ "system instruction"
// viewer — shows the user the canonical instruction for this type.
function rawSpine(theme, type) {
  return _safeRead(path.join(_themeDir(theme), (getTypeConfig(theme, type) || {}).spine || `${type}.md`)).trim();
}

// ── Per-type example scripts (few-shot anchors, kept verbatim) ──────────────
function _examplesDir(theme, type) { return path.join(_themeDir(theme), 'examples', String(type || '').replace(/[^a-z0-9_]/gi, '')); }
function listExampleFiles(theme, type) {
  const dir = _examplesDir(theme, type);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.txt')); } catch { return []; }
  return files.map(f => ({ name: f.replace(/\.txt$/i, ''), content: _safeRead(path.join(dir, f)).trim() }));
}
function saveExample(theme, type, name, content) {
  const safe = String(name || '').replace(/[^a-zA-Z0-9 _\-]/g, '').trim().slice(0, 60);
  if (!safe || !String(content || '').trim()) return null;
  const dir = _examplesDir(theme, type);
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch {}
  fs.writeFileSync(path.join(dir, safe + '.txt'), String(content).trim() + '\n', 'utf8');
  return safe;
}
function deleteExample(theme, type, name) {
  const safe = String(name || '').replace(/[^a-zA-Z0-9 _\-]/g, '').trim();
  if (!safe) return false;
  try { fs.unlinkSync(path.join(_examplesDir(theme, type), safe + '.txt')); return true; } catch { return false; }
}

module.exports = {
  THEMES_ROOT,
  listThemes, loadTypesConfig, listTypes, getTypeConfig,
  readBible, tabooBlock, namingBlock, listTaboo, saveTaboo, readSpine, getExamples,
  listExampleFiles, saveExample, deleteExample,
  assembleSpine,
  hooksGeneratorPrompt, analyzerPrompt,
  listVerticals, addVertical, verticalLabel,
  listOptions, upsertOption, deleteOption, optionLabel, optionDesc,
  patchType, saveSpine,
  readStep, stepCount, resolveStep, saveStep, castText,
  readHooksArchive, appendHookToArchive, writeHooksArchive,
  readComparisons, writeComparisons, LINK_RULE, HOOK_MARK,
  listSources, upsertSource, removeSource, readSourcesText,
  paramMap, rawSpine,
};
