'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE COOKBOOK'S PURE FUNCTIONS (phase V4, docs/local-app/PLAN.md "V-D") - no disk, no network.
//
// Ported from LearnPrompt/awesome-seedance at the pinned commit (lib/cookbook-pin.js), MIT, Copyright (c) 2026
// LearnPrompt: applyTemplateOverride / mergeLibrary / buildTemplateIndex (scripts/lib/library.mjs), copyPromptOf /
// defaultCopyPrompt / renderTemplateBody (scripts/lib/templates.mjs - "Copy this", the block the repository itself
// offers to "send to any AI chat together with your reference images": our writer's recipe), pickLang and the
// Seedance version buckets (scripts/lib/render.mjs). The templates themselves are the repository's CC BY 4.0
// curation, credited on Admin -> Thanks.
//
// Ours: what a case implies it needs (parseRefs - numbered and named references in every spelling the 670 prompts
// use, platform handles and model names left out), and the facts the catalog filters by (shape, length, speech,
// the retests on Grok and MiniMax).
// ════════════════════════════════════════════════════════════════════════════

// ── Ported (MIT) ────────────────────────────────────────────────────────────
const LANG_KEYED = ['title', 'description', 'useWhen', 'structure', 'guidance', 'pitfalls', 'copyPrompt'];
const isPlain = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

function applyTemplateOverride(template, override) {
  const out = { ...template };
  for (const [key, value] of Object.entries(override || {})) {
    if (LANG_KEYED.includes(key) && isPlain(value) && isPlain(out[key])) out[key] = { ...out[key], ...value };
    else out[key] = value;
  }
  return out;
}

function mergeLibrary(styleData, local) {
  const loc = local || {};
  const categories = (styleData.categories || []).map((c) => ({ ...c }));
  for (const cat of loc.categories || []) {
    const i = categories.findIndex((c) => c.id === cat.id);
    if (i >= 0) categories[i] = applyTemplateOverride(categories[i], cat);
    else categories.push({ ...cat });
  }
  const categoryIds = new Set(categories.map((c) => c.id));
  const upstreamIds = new Set((styleData.templates || []).map((tp) => tp.id));
  const overrides = loc.overrides || {};
  for (const id of Object.keys(overrides)) {
    if (!upstreamIds.has(id)) throw new Error('templates-local.json: override for unknown template "' + id + '"');
  }
  const templates = (styleData.templates || []).map((tp) => applyTemplateOverride(tp, overrides[tp.id]));
  for (const tp of loc.templates || []) {
    if (upstreamIds.has(tp.id) || templates.some((x) => x.id === tp.id)) throw new Error('templates-local.json: template id "' + tp.id + '" already exists');
    const exampleCases = tp.exampleCases || [];
    const exampleCaseUrls = tp.exampleCaseUrls || exampleCases.map((slug) => 'https://goodcase.ai/cases/' + slug);
    templates.push({ ...tp, exampleCases, exampleCaseUrls, local: true });
  }
  for (const tp of templates) {
    if (!categoryIds.has(tp.category)) throw new Error('Template "' + tp.id + '" points at unknown category "' + tp.category + '"');
  }
  return { ...styleData, categories, templates };
}

/** Each template's cases, hottest first: the taxonomy's filing, plus the template's own examples (the taxonomy wins). */
function buildTemplateIndex(templates, taxonomy, cases) {
  const templateIds = new Set(templates.map((tp) => tp.id));
  const assignments = (taxonomy && taxonomy.assignments) || {};
  const bySlug = new Map(cases.map((c) => [c.slug, c]));
  const slugsBy = new Map(templates.map((tp) => [tp.id, new Set()]));
  for (const [slug, id] of Object.entries(assignments)) {
    if (id == null) continue;
    if (!templateIds.has(id)) throw new Error('case-taxonomy.json: "' + slug + '" is assigned to unknown template "' + id + '"');
    if (bySlug.has(slug)) slugsBy.get(id).add(slug);
  }
  for (const tp of templates) {
    for (const slug of tp.exampleCases || []) {
      const assigned = assignments[slug];
      if (assigned && assigned !== tp.id) continue;
      if (bySlug.has(slug)) slugsBy.get(tp.id).add(slug);
    }
  }
  const byHeat = (a, b) => (b.heatScore || 0) - (a.heatScore || 0);
  const byTemplate = new Map();
  const seen = new Set();
  for (const tp of templates) {
    const list = Array.from(slugsBy.get(tp.id)).map((s) => bySlug.get(s)).sort(byHeat);
    for (const c of list) seen.add(c.slug);
    byTemplate.set(tp.id, list);
  }
  return { byTemplate, unassigned: cases.filter((c) => !seen.has(c.slug)).sort(byHeat) };
}

function pickLang(obj, lang) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] ?? obj.en ?? obj.zh ?? '';
}

function defaultCopyPrompt(template, lang) {
  const title = pickLang(template.title, lang);
  return lang === 'zh'
    ? '我要做一个' + title + '类型的视频，【在这里写你的主体、场景和想要的效果，有参考图就一起发给你】。请根据下面这个提示语模板，帮我改写成一条可以直接用的 Seedance 视频提示语：'
    : 'I want to make a "' + title + '" video. [Describe your subject, setting and the effect you want here; attach reference images if you have them.] Using the prompt template below, rewrite it into one ready-to-use Seedance video prompt for me:';
}

function copyPromptOf(template, lang) {
  const own = template.copyPrompt && template.copyPrompt[lang];
  return own && own.trim() ? own.trim() : defaultCopyPrompt(template, lang);
}

function _listOf(value, lang) {
  const v = value && (value[lang] ?? value.en);
  return Array.isArray(v) ? v : v ? [v] : [];
}

/** The template's body: title, description, when to use, guidance, structure, pitfalls - no example links. */
function renderTemplateBody(template, lang) {
  const L = lang === 'zh'
    ? { use: '适用场景:', guide: '要点:', st: '结构:', pit: '常见坑:' }
    : { use: 'Use when:', guide: 'Guidance:', st: 'Structure:', pit: 'Pitfalls:' };
  const lines = ['#### ' + pickLang(template.title, lang), '', pickLang(template.description, lang) || '', ''];
  const useWhen = pickLang(template.useWhen, lang);
  if (useWhen) lines.push('**' + L.use + '** ' + useWhen, '');
  const guidance = _listOf(template.guidance, lang);
  if (guidance.length) lines.push('**' + L.guide + '**', '', ...guidance.map((g) => '- ' + g), '');
  const structure = _listOf(template.structure, lang);
  if (structure.length) lines.push('**' + L.st + '**', '', ...structure.map((s, i) => (i + 1) + '. ' + s), '');
  const pitfalls = _listOf(template.pitfalls, lang);
  if (pitfalls.length) lines.push('**' + L.pit + '**', '', ...pitfalls.map((p) => '- ' + p), '');
  while (lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** The "Copy this" block without its fence - the skill (master prompt) the writer follows. */
const masterOf = (template, lang) => copyPromptOf(template, lang) + '\n\n' + renderTemplateBody(template, lang);

const SEEDANCE_MODEL_RE = /^\s*seedance(?:[\s_-]*(\d+(?:\.\d+)?))?\s*(.*)$/i;
const BUCKET_RANK = { '2.5': 2, '2.0': 1, unspecified: 0 };
function seedanceVersionOf(model) {
  if (typeof model !== 'string') return null;
  const m = model.match(SEEDANCE_MODEL_RE);
  if (!m) return null;
  if (!m[1]) return 'unspecified';
  return Number.parseFloat(m[1]) >= 2.5 ? '2.5' : '2.0';
}
function seedanceVersionInText(text) {
  if (typeof text !== 'string' || !text) return null;
  let best = null;
  for (const m of text.matchAll(/seedance[\s_-]*(\d+(?:\.\d+)?)/gi)) {
    const v = Number.parseFloat(m[1]) >= 2.5 ? '2.5' : '2.0';
    if (best == null || BUCKET_RANK[v] > BUCKET_RANK[best]) best = v;
  }
  return best;
}
/** '2.5' | '2.0' - the case's Seedance line: the highest version among its models, else its title and summary, else 2.0. */
function classifySeedance(c) {
  let best = null;
  for (const model of (c && c.models) || []) {
    const v = seedanceVersionOf(model);
    if (v == null || v === 'unspecified') continue;
    if (best == null || BUCKET_RANK[v] > BUCKET_RANK[best]) best = v;
  }
  if (best) return best;
  return seedanceVersionInText(((c && c.title) || '') + '\n' + ((c && c.summary) || '')) ?? '2.0';
}

// ── Ours: what a case implies it needs ──────────────────────────────────────
const MODEL_IMG = /\b(?:gpt|nano\s*banana|seedream|imagen|flux|midjourney|dall[- ]?e|qwen)[\s-]*image\s*\d+(?:\.\d+)?/gi;
const MODEL_NAMES = /\b(?:gpt[- ]?image[- ]?\d(?:\.\d)?|nano[ -]?banana(?:[ -]?(?:pro|2))?|seedance[ -]?\d(?:\.\d)?|kling[ -]?\d(?:\.\d)?|veo[ -]?\d(?:\.\d)?)\b/gi;
const NONE = /\bno reference (?:image|photo|picture)s?\b|\bwithout (?:any )?reference (?:image|photo)s?|\btext[- ]only\b|无参考图|不使用参考图|无需参考图/i;
const STEMS = [
  ['image', '(?:image|img|pic|photo|图片|图|参考图)'],
  ['video', '(?:video|vid|视频|原视频|参考视频)'],
  ['audio', '(?:audio|music|song|音频|音乐)'],
  ['outfit', '(?:衣服|outfit)'],
];
const _esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN_RES = STEMS.map(([kind, stem]) => [kind, [
  new RegExp('@\\s?\\[?\\s?<?\\s?' + stem + '\\s?[_#-]?\\s?(\\d{1,2})', 'gi'),
  new RegExp('<{1,3}\\s?' + stem + '[_ ]?(\\d{1,2})\\s?>{1,3}', 'gi'),
  new RegExp('\\[\\s?' + stem + '\\s?[_ ]?(\\d{1,2})\\s?\\]', 'gi'),
  new RegExp('(?:reference|ref\\.?)\\s*' + stem + '\\s?#?(\\d{1,2})', 'gi'),
  new RegExp('(?<![\\w@\\[<])' + stem + '\\s?[_ ]?(\\d{1,2})(?![\\d.:x]|\\s?(?:s|sec|seconds|k)\\b)', 'gi'),
]]);
const NAMED = /@(\[[^\]\n]{2,30}\]|[A-Za-z][A-Za-z0-9_]{1,30}|[一-鿿]{1,6}?图)/g;
const NAMED_PREFIX = /^(?:char|loc|prop|ref|location|hands|sheet|material|character|product|outfit|style|scene|bg|subject|talent|person|hero|heroine)(?:_|\d|$| )/i;
const PLATFORM = /(?:_ai|ai|app|hq|agent|_x|studio|labs?|japan|official|_)$|^(?:domoai|pixverse|higgsfield|flovaai|tapnow|openart|fishcreativehq|itspolloai|wavespeed|sjinn|lumalabsai|socialsight|budgetpixel|lovart|capcut|dreamina|kling|seedance|bytedance|grok|xai|elonmusk|youmind|rajinikanth)/i;

function _roleOf(ctx) {
  const c = ctx.toLowerCase();
  if (/storyboard|grid|panel|分镜|宫格/.test(c)) return 'storyboard';
  if (/(?:first|start|starting|opening) frame|首帧/.test(c)) return 'frame-first';
  if (/(?:last|end|ending|final) frame|尾帧/.test(c)) return 'frame-last';
  if (/lip[- ]?sync|vocal|voice|song|music|beat|对口型|人声|节奏/.test(c)) return 'music';
  if (/motion|dance|choreograph|movement|动作/.test(c)) return 'motion';
  if (/outfit|cloth|costume|wardrobe|dress|衣服|服装/.test(c)) return 'outfit';
  if (/product|bottle|package|packaging|\bcan\b|\bbox\b|logo|brand|商品|产品/.test(c)) return 'product';
  if (/style|aesthetic|art direction|画风|风格/.test(c)) return 'style';
  if (/face|identity|character|person|woman|\bman\b|girl|boy|hero|actor|talent|主角|人物|角色|长相/.test(c)) return 'person';
  if (/location|environment|background|room|interior|scene|place|city|street|场景|背景/.test(c)) return 'location';
  return null;
}

/**
 * What a prompt implies is attached: { images, exact, videos, audios, none, roles, named }. `exact` false means
 * the count was read from prose ("the attached reference images") - the catalog says "unsure".
 * Roles are a guess (about half right on a spot check); the catalog shows them as hints only.
 */
function parseRefs(prompt) {
  const text = String(prompt || '').replace(MODEL_IMG, ' ').replace(MODEL_NAMES, ' ');
  const sets = { image: new Set(), video: new Set(), audio: new Set(), outfit: new Set() };
  const named = new Set();
  const roles = {};
  for (const [kind, res] of TOKEN_RES) {
    for (const re of res) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const i = +m[1];
        if (!(i >= 1 && i <= 12)) continue;
        sets[kind].add(i);
        const key = kind + i;
        if (!roles[key]) roles[key] = _roleOf(text.slice(m.index, m.index + m[0].length + 100)) || _roleOf(text.slice(Math.max(0, m.index - 60), m.index));
      }
    }
  }
  for (const m of text.matchAll(NAMED)) {
    const name = m[1].replace(/[[\]]/g, '').trim();
    if (STEMS.some(([, s]) => new RegExp('^<?' + s + '\\s?_?\\d*$', 'i').test(name))) continue;
    if (/^image generation$/i.test(name)) continue;
    const defined = new RegExp('@\\[?' + _esc(name) + '\\]?\\s*(?:[:=—–(-]|is\\b|=)', 'i').test(text);
    if ((NAMED_PREFIX.test(name) || /图$/.test(name) || /ref\b|reference/i.test(name) || defined) && !PLATFORM.test(name)) {
      const k = name.toLowerCase();
      named.add(k);
      if (!roles['@' + k]) roles['@' + k] = /video|视频/.test(name) ? 'video' : (_roleOf(text.slice(m.index, m.index + 140)) || _roleOf(name));
    }
  }
  const none = NONE.test(text);
  for (const m of text.matchAll(/\bREFERENCE\s?#?(\d)\b|\bREF\s?(\d)\b/g)) sets.image.add(+(m[1] || m[2]));
  const prose = !none && /(?:attached|provided|uploaded|given|input|this|the) (?:\w+ ){0,2}(?:character |identity |face )?reference\b|(?:face|outfit|identity|appearance)[^.\n]{0,20}(?:per|from|matching|of) (?:the )?reference|using this (?:image|photo|picture)|@\[?referance|@\[image\]|reference characters?|(?:uploaded|attached|provided|given|input)\s+(?:reference\s+)?(?:image|photo|picture|portrait|selfie|character sheet|storyboard)s?\b|reference (?:image|photo|picture)s?\b|character (?:reference )?sheet|master character set|as the (?:exact )?(?:first|start|opening) frame|参考图|上传的(?:图片|照片)|垫图/i.test(text);
  const plural = /(?:uploaded|attached|provided|reference) (?:images|photos|pictures)\b/i.test(text);
  const vprose = /(?:reference|source|input|uploaded|attached|original) (?:video|clip|footage)\b|motion reference|参考视频|原视频/i.test(text);
  const aprose = /(?:reference|uploaded|attached|input) (?:audio|song|track)\b|参考音频|音频参考/i.test(text);
  const namedImgs = [...named].filter((n) => !/video|视频/.test(n));
  const namedVids = [...named].filter((n) => /video|视频/.test(n));
  const maxOf = (s) => (s.size ? Math.max(...s) : 0);
  const nImg = maxOf(sets.image) + namedImgs.length + sets.outfit.size;
  return {
    images: Math.min(12, nImg || (prose ? (plural ? 2 : 1) : 0)),
    exact: !!nImg,
    videos: Math.min(12, (maxOf(sets.video) + namedVids.length) || (vprose ? 1 : 0)),
    audios: Math.min(12, maxOf(sets.audio) || (aprose ? 1 : 0)),
    none, roles, named: [...named],
  };
}

// ── Ours: the facts the catalog filters by ──────────────────────────────────
// A ratio written out (the full-width colon too), or the words for one - "vertical UGC video", "横屏". Words alone
// are not enough: "vertical bob" and "horizontal stripes" are no shape.
const ASPECT_RE = /(?<![\d.:])(16\s?[:：]\s?9|9\s?[:：]\s?16|4\s?[:：]\s?3|3\s?[:：]\s?4|1\s?[:：]\s?1|21\s?[:：]\s?9|2\s?[:：]\s?3|3\s?[:：]\s?2)(?!\d)/;
const VERTICAL = /\bvertical (?:social[- ]media |smartphone |phone |mobile |ugc[- ]style |ugc )?(?:video|format|frame|ad|ugc|reel|short|clip|shot|composition|orientation|screen)s?\b|\bportrait (?:orientation|format|mode|aspect)\b|竖屏|竖版/i;
const HORIZONTAL = /\b(?:horizontal|landscape|widescreen) (?:video|format|frame|orientation|composition|aspect|shot|clip)s?\b|横屏|横版/i;
const SQUARE = /\bsquare (?:format|frame|video|aspect)\b/i;
/** The shape a prompt asks for, or null. */
function aspectOf(prompt) {
  const s = String(prompt || '');
  const m = s.match(ASPECT_RE);
  if (m) return m[1].replace(/\s/g, '').replace('：', ':');
  if (VERTICAL.test(s)) return '9:16';
  if (HORIZONTAL.test(s)) return '16:9';
  if (SQUARE.test(s)) return '1:1';
  return null;
}

/** The longest length a prompt names - "15 seconds", "12-second", "0-5s", "15秒", "00:12" - in seconds, or null. */
function secondsOf(prompt) {
  const s = String(prompt || '');
  let best = 0;
  for (const m of s.matchAll(/(?<![\d.])(\d{1,3})(?:\.\d+)?[\s-]?(?:sec|secs|second|seconds)\b/gi)) best = Math.max(best, +m[1]);
  // A bare "s" ("15s", "0-3s"), but never a decade ("the 90s", "80s film look").
  for (const m of s.matchAll(/(?<![\d.'’])(\d{1,3})(?:\.\d+)?s(?![a-z])/gi)) {
    const n = +m[1];
    if (n >= 40 && n % 10 === 0) continue;
    best = Math.max(best, n);
  }
  for (const m of s.matchAll(/(?<![\d.])(\d{1,3})\s?秒/g)) best = Math.max(best, +m[1]);
  for (const m of s.matchAll(/(?<![\d.])0?0:(\d{2})(?:\.\d+)?(?!\d)/g)) best = Math.max(best, +m[1]);
  return best > 0 && best <= 180 ? best : null;
}

/** Whether a prompt makes somebody speak (a line, a voice-over, a narration). */
function speaksIn(prompt) {
  return /\b(?:says?|said|speaks?|saying|dialogue|dialog|voice[- ]?over|voiceover|narrat\w*|whispers?|shouts?|yells?|asks?|line:|lip[- ]?sync)\b|台词|对白|旁白|说[:：]|“[^”]{3,}”/i.test(String(prompt || ''));
}

/** A retest's verdict in one letter: r reproduced, d degraded, f failed. */
function verdictOf(retests, re) {
  const r = (retests || []).find((x) => re.test(String((x && x.model) || '')));
  if (!r) return null;
  const v = String(r.verdict || '').toLowerCase();
  return v.startsWith('repro') ? 'r' : v.startsWith('degr') ? 'd' : v.startsWith('fail') ? 'f' : null;
}

// ── Ours: a case, two-step ──────────────────────────────────────────────────
// Two steps HERE means a STORYBOARD SHEET drawn first and the video following it (phase V8): the storyboard template, or
// a case whose first step is a storyboard ("STEP 1 - STORYBOARD", "GPT Image 2 Storyboard prompt: ... Seedance 2.0
// prompt: ..."). A case whose picture made first is a character, a product or a first frame (an image model among its
// models, "STEP 1 - GENERATE CHARACTERS FIRST") is ONE step here (review V8): that picture is the person's, from the
// Library - and the writer would be told to draw a storyboard nobody asked for.
function twoStepOf(c, templateId) {
  if (templateId === 'storyboard-grid-to-video') return true;
  const p = String((c && c.promptFull) || '');
  if (/\bSTEP\s*1\b[^\n]{0,60}\bSTORYBOARD/i.test(p)) return true;
  return /storyboard[^\n]{0,30}prompt\s*[:：]/i.test(p) && /seedance[\s\d.]*(?:\w+\s*)?prompt\s*[:：#]/i.test(p);
}

/**
 * The grid's index and the details of the cases fetched from the pinned data/cases.json - what the catalog filters by
 * (short keys: the index of 670 is read in one go) and what it shows when one is opened.
 *   index   [{ s slug, t title, tz zh title, cr creator, v '2.5'|'2.0', tp template, cat category, h heat, st stability,
 *              ev evidence, lc 'en'|'zh', ri images, rx exact, rv videos, ra audios, rn says none, a aspect, d seconds,
 *              sp speech, ts two-step, ps poster, ms media, rg / rm Grok / MiniMax retest r|d|f, dt date }]
 *   details { slug: { title, titleZh, summary, summaryZh, prompt, creator, sourceUrl, goodcaseUrl, models, retests,
 *              roles, named } }
 * opts: { assignments (taxonomy), categoryOf(templateId), removed: Set, mediaHosts: [] }
 */
function deriveCases(cases, opts) {
  const o = opts || {};
  const removed = o.removed || new Set();
  const hosts = new Set(o.mediaHosts || []);
  const assignments = o.assignments || {};
  const hosted = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && hosts.has(x.hostname) ? x.href : null; } catch (e) { return null; } };
  const index = [];
  const details = {};
  let skipped = 0;
  for (const c of cases || []) {
    if (!c || !c.slug || removed.has(c.slug)) { skipped++; continue; }
    const p = String(c.promptFull || '');
    const tp = Object.prototype.hasOwnProperty.call(assignments, c.slug) ? assignments[c.slug] : null;
    const refs = parseRefs(p);
    const en = String(c.titleEn || '').trim();
    const zh = String(c.title || '').trim();
    index.push({
      s: c.slug, t: en || zh, tz: en && zh && zh !== en ? zh : '', cr: String(c.creator || ''),
      v: classifySeedance(c), tp: tp || null, cat: tp && o.categoryOf ? (o.categoryOf(tp) || null) : null,
      h: +c.heatScore || 0, st: +c.stabilityScore || 0, ev: String(c.evidenceLevel || ''),
      lc: /^zh/i.test(String(c.contentLocale || '')) ? 'zh' : 'en',
      ri: refs.images, rx: refs.exact ? 1 : 0, rv: refs.videos, ra: refs.audios, rn: refs.none ? 1 : 0,
      a: aspectOf(p), d: secondsOf(p), sp: speaksIn(p) ? 1 : 0, ts: twoStepOf(c, tp) ? 1 : 0,
      ps: hosted(c.posterUrl), ms: hosted(c.mediaUrl),
      rg: verdictOf(c.retests, /grok/i), rm: verdictOf(c.retests, /minimax/i),
      dt: String(c.sourcePublishedAt || '').slice(0, 10),
    });
    details[c.slug] = {
      title: en || zh, titleZh: zh, summary: String(c.summaryEn || c.summary || ''), summaryZh: String(c.summary || ''),
      prompt: p, creator: String(c.creator || ''), sourceUrl: String(c.sourceUrl || ''),
      goodcaseUrl: 'https://goodcase.ai/en/cases/' + encodeURIComponent(c.slug),
      models: (c.models || []).map(String).slice(0, 12),
      retests: (c.retests || []).map(r => ({ model: String((r && r.model) || ''), verdict: String((r && r.verdict) || ''), at: String((r && r.testedAt) || '').slice(0, 10) })),
      roles: refs.roles, named: refs.named,
    };
  }
  index.sort((a, b) => b.h - a.h);
  return { index, details, skipped };
}

module.exports = {
  applyTemplateOverride, mergeLibrary, buildTemplateIndex, pickLang, copyPromptOf, defaultCopyPrompt,
  renderTemplateBody, masterOf, classifySeedance, parseRefs, aspectOf, secondsOf, speaksIn, verdictOf,
  twoStepOf, deriveCases,
};
