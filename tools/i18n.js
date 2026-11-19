'use strict';

/* The dictionaries checked against the code - node tools/i18n.js [--check] [--verbose]

   The interface's words go through public/js/i18n/t.js: t('English'), tc('ctx', 'English'), tn(n, 'one', 'other').
   For every language other than English (public/js/i18n/<lang>.js):
     - every key the code asks for with a written text has its line - a missing one fails;
     - a count's line is its forms (an array), a text's line a string; the {name}s of a line are the key's;
     - the markup of the pages listed in tools/i18n.json `html` is translated whole (lib/i18n-html.js reads it as the
       server does), but for the words in `keep` (names, the same in every language);
     - a line whose English is nowhere in the code or the pages any more is stale - it fails too.
   Only files that take t.js (`i18n/t.js` imported, lib/i18n.js required) are read for calls; a call with a text
   built at run time cannot be checked and is listed with --verbose.
   --check: the summary and the exit code alone (tools/smoke-local.js runs `check()`). */

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
const espree = require(path.join(APP_DIR, 'node_modules', 'espree'));
const HTML = require('../lib/i18n-html');

const LANGS = ['ru'];
const ROOTS = ['public/js', 'lib', 'routes', 'desktop', 'server.js'];
const FN = new Set(['t', 'tc', 'tn']);

function files() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(APP_DIR, rel);
    let st;
    try { st = fs.statSync(abs); } catch { return; }
    if (st.isDirectory()) {
      for (const n of fs.readdirSync(abs)) if (n !== 'node_modules') walk(path.join(rel, n));
    } else if (/\.(m?js|cjs)$/.test(rel)) out.push(rel.replace(/\\/g, '/'));
  };
  ROOTS.forEach(walk);
  return out;
}

function parse(src) {
  for (const sourceType of ['module', 'commonjs', 'script']) {
    try { return espree.parse(src, { ecmaVersion: 'latest', sourceType, loc: true }); } catch { /* the next */ }
  }
  return null;
}

const lit = (n) => (n && n.type === 'Literal' && typeof n.value === 'string' ? n.value
  : n && n.type === 'TemplateLiteral' && !n.expressions.length ? n.quasis[0].value.cooked : null);

function visit(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((x) => x && typeof x.type === 'string' && visit(x, fn));
    else if (v && typeof v.type === 'string' && k !== 'parent') visit(v, fn);
  }
}

/** What the code asks for: { keys: Map key -> { kind, where }, dynamic: [where], literals: Set }. */
function scan() {
  const keys = new Map();
  const dynamic = [];
  const literals = new Set();
  for (const rel of files()) {
    const src = fs.readFileSync(path.join(APP_DIR, rel), 'utf8');
    const takes = /i18n\/t\.js['"]|require\(['"](\.\.?\/)+(lib\/)?i18n['"]\)|require\(['"]\.\/lib\/i18n['"]\)/.test(src);
    const ast = parse(src);
    if (!ast) continue;
    visit(ast, (n) => {
      const s = lit(n);
      if (s != null) literals.add(s);
      if (!takes || n.type !== 'CallExpression') return;
      const c = n.callee;
      const name = c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' ? c.property.name : '');
      if (!FN.has(name)) return;
      if (c.type === 'MemberExpression' && !(c.object.type === 'Identifier' && /^(I18N|T)$/.test(c.object.name))) return;
      const where = `${rel}:${n.loc ? n.loc.start.line : '?'}`;
      const a = n.arguments;
      let key = null, kind = name;
      if (name === 't') key = lit(a[0]);
      else if (name === 'tc') { const ctx = lit(a[0]), text = lit(a[1]); key = ctx != null && text != null ? ctx + '::' + text : null; }
      else { key = lit(a[2]); }
      if (key == null) { dynamic.push(where); return; }
      if (!keys.has(key)) keys.set(key, { kind, where });
    });
  }
  return { keys, dynamic, literals };
}

function config() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n.json'), 'utf8')); } catch { return { html: [], keep: [] }; }
}

// The {names} a text fills, as one string to compare; `but` - one a count's form may leave out ("один файл").
const holes = (s, but) => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].filter((x) => x !== but).sort().join(',');

function check({ verbose = false } = {}) {
  const lines = [];
  let bad = 0;
  const { keys, dynamic, literals } = scan();
  const cfg = config();
  const keep = new Set(cfg.keep || []);
  const pageTexts = new Set();
  for (const f of fs.readdirSync(path.join(APP_DIR, 'public')).filter((n) => n.endsWith('.html'))) {
    for (const s of HTML.texts(fs.readFileSync(path.join(APP_DIR, 'public', f), 'utf8'))) pageTexts.add(s);
  }
  for (const L of LANGS) {
    const mod = require(path.join(APP_DIR, 'public', 'js', 'i18n', L + '.js'));
    const dict = mod.default || {};
    const missing = [], wrong = [], stale = [];
    // A line in two parts: the later one wins silently - the same words are fine, different ones are a mistake.
    const seenIn = new Map();
    for (const [part, lines2] of Object.entries(mod.PARTS || {})) {
      for (const [k, v] of Object.entries(lines2)) {
        const had = seenIn.get(k);
        if (had && JSON.stringify(had.v) !== JSON.stringify(v)) wrong.push(`${JSON.stringify(k)} - "${had.part}" and "${part}" say it differently`);
        if (!had) seenIn.set(k, { part, v });
      }
    }
    for (const [key, { kind, where }] of keys) {
      const v = dict[key];
      if (v == null) { missing.push(`${where}  ${JSON.stringify(key)}`); continue; }
      if (kind === 'tn') {
        if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'string')) wrong.push(`${where}  ${JSON.stringify(key)} - a count takes three forms`);
        else if (v.some((x) => holes(x, 'n') !== holes(key, 'n'))) wrong.push(`${where}  ${JSON.stringify(key)} - its {names} differ`);
      } else if (typeof v !== 'string') wrong.push(`${where}  ${JSON.stringify(key)} - a text's line is a string`);
      else if (holes(v) !== holes(key)) wrong.push(`${where}  ${JSON.stringify(key)} - its {names} differ`);
    }
    for (const f of cfg.html || []) {
      const html = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
      for (const s of HTML.texts(html)) if (!keep.has(s) && typeof dict[s] !== 'string') missing.push(`${f}  ${JSON.stringify(s)}`);
    }
    // Admin -> Thanks: every entry's "what" and "how" is said in the app's language when drawn (tools/i18n.json `thanks`).
    if (cfg.thanks) {
      for (const e of require('./third-party.js').thanks()) {
        for (const s of [e.what, e.how]) if (s && typeof dict[s] !== 'string') missing.push(`public/js/admin-thanks.js  ${JSON.stringify(s)}`);
      }
    }
    for (const key of Object.keys(dict)) {
      const text = key.includes('::') ? key.slice(key.indexOf('::') + 2) : key;
      if (!keys.has(key) && !literals.has(text) && !pageTexts.has(key) && !pageTexts.has(text)) stale.push(JSON.stringify(key));
    }
    bad += missing.length + wrong.length + stale.length;
    lines.push(`${L}: ${Object.keys(dict).length} lines, ${keys.size} texts asked for; ${missing.length} missing, ${wrong.length} wrong, ${stale.length} stale`);
    const list = (title, xs) => { if (xs.length) lines.push(`  ${title}:`, ...xs.slice(0, verbose ? xs.length : 20).map((x) => '    ' + x), ...(xs.length > 20 && !verbose ? [`    ... ${xs.length - 20} more (--verbose)`] : [])); };
    list('missing', missing);
    list('wrong', wrong);
    list('stale (the English is nowhere any more)', stale);
  }
  if (verbose && dynamic.length) lines.push(`texts built at run time (not checked): ${dynamic.length}`, ...dynamic.map((x) => '    ' + x));
  return { ok: !bad, lines };
}

if (require.main === module) {
  const r = check({ verbose: process.argv.includes('--verbose') });
  console.log(r.lines.join('\n'));
  process.exitCode = r.ok ? 0 : 1;
}

module.exports = { check, scan };
