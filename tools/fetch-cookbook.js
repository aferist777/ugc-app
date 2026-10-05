'use strict';

/* fetch-cookbook.js - the video chat's cookbook (phase V4, docs/local-app/PLAN.md "V-D"): the awesome-seedance
   templates, their categories, tag names and case taxonomy, and its production guide, at the commit pinned in
   lib/cookbook-pin.js - every file checked by its size and SHA-256 - laid out in vendor/cookbook/ for the server
   (lib/video-catalog.js).

   npm install runs it (postinstall, with --optional: no network is a warning, not a failed install). By hand:
       node tools/fetch-cookbook.js                lay out the pinned files, fetched from raw.githubusercontent.com
       node tools/fetch-cookbook.js --from <dir>   the same from a local copy of the repository (no network)
       node tools/fetch-cookbook.js --bump         what the repository's main holds now: a new PIN block to paste
                                                    into lib/cookbook-pin.js, and the cases added and REMOVED since
                                                    the pin (removals are takedowns - think before showing them)

   What is laid out (licences differ, and the repository says so itself): the CODE it was made with is MIT
   (LICENSE-MIT.txt), the templates, categories, tags and taxonomy are its CC BY 4.0 curation (NOTICE.txt says
   whose, the licence, and that we changed them). Each template carries:
     master.en / master.zh   its "Copy this" block - the lead-in and the template body - the recipe our writer
                             follows (lib/cookbook-lib.js, ported from the repository's own render)
     needs / speech / twoStep   OUR reading of what it needs attached (presets-src/video/cookbook-needs.json)

   The cases (data/cases.json - the authors' own prompts, under no licence) are NOT laid out here and never ship
   with the program: the server fetches them into the library's cache when the catalog first asks, checked against
   the same pin. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PIN, rawUrl } = require('../lib/cookbook-pin');
const L = require('../lib/cookbook-lib');

const DIR = path.join(__dirname, '..', 'vendor', 'cookbook');
const MARK = path.join(DIR, 'PINNED.json');
const NEEDS = path.join(__dirname, '..', 'presets-src', 'video', 'cookbook-needs.json');
// How the files are laid out: moved when that changes, so an installed copy is laid out again.
const LAYOUT = 1;
const args = process.argv.slice(2);
const optional = args.includes('--optional');
const fromAt = args.indexOf('--from');
const FROM = fromAt >= 0 ? args[fromAt + 1] : '';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function _get(url, what) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'ugc-studio-cookbook' } });
  if (!res.ok) throw new Error(what + ': ' + res.status + ' ' + url);
  return Buffer.from(await res.arrayBuffer());
}

// One pinned file: from the local copy or the network, refused unless it is exactly the pinned one.
async function pinned(rel, want, from) {
  const buf = from ? fs.readFileSync(path.join(from, ...rel.split('/'))) : await _get(rawUrl(rel), rel);
  if (buf.length !== want.size || sha256(buf) !== want.sha256) throw new Error(rel + ': not the pinned file (' + buf.length + ' bytes, sha256 ' + sha256(buf).slice(0, 12) + '...)');
  return buf;
}

const NOTICE = (exportedAt) => [
  'The video chat\'s cookbook: LearnPrompt/awesome-seedance, commit ' + PIN.commit + ' (data exported ' + exportedAt + ').',
  'https://github.com/' + PIN.repo,
  '',
  'In the repository\'s own words, it "carries three kinds of material under three different terms":',
  '- Code (generator scripts, Agent Skill, tooling): MIT - LICENSE-MIT.txt here (Copyright (c) 2026 LearnPrompt).',
  '- Curation (selection, organization, statistics, template extraction, summaries written by them): CC BY 4.0,',
  '  https://creativecommons.org/licenses/by/4.0/ - attribution: awesome-seedance / goodcase.ai.',
  '- Prompts and media remain the copyright of their original creators. They are NOT in this folder: the app',
  '  fetches the cases into the library\'s cache when the catalog is first opened, and shows each with its author,',
  '  its X post and its goodcase.ai page - "prompts belong to their authors, shown for learning".',
  '',
  'Changed by UGC Studio: the templates were merged as the repository merges them and each rendered as an',
  'instruction for the app\'s writer agent (its "Copy this" block); what each template needs attached, whether',
  'it speaks and whether it is two-step are ours (presets-src/video/cookbook-needs.json). The person may edit any',
  'of it in the app.',
  '',
].join('\n');

async function layOut(from) {
  const got = {};
  for (const [rel, want] of Object.entries(PIN.ship)) got[rel] = await pinned(rel, want, from);
  const json = (rel) => JSON.parse(got[rel].toString('utf8'));
  const lib = L.mergeLibrary(json('data/style-library.json'), json('data/templates-local.json'));
  const style = json('data/style-library.json');
  const taxonomy = json('data/case-taxonomy.json');
  const skills = json('data/skills.json');
  const needs = JSON.parse(fs.readFileSync(NEEDS, 'utf8')).templates || {};

  // What fails the tool: a template we know nothing about (or one we know that is gone), one without its lead-in,
  // a case filed under a template that does not exist.
  const ids = new Set(lib.templates.map(t => t.id));
  for (const t of lib.templates) {
    if (!needs[t.id]) throw new Error('presets-src/video/cookbook-needs.json says nothing about the template "' + t.id + '"');
    if (!t.copyPrompt || !String(t.copyPrompt.en || '').trim()) throw new Error('the template "' + t.id + '" has no copyPrompt.en');
  }
  for (const id of Object.keys(needs)) if (!ids.has(id)) throw new Error('cookbook-needs.json names "' + id + '", which the pinned repository does not have');
  for (const [slug, id] of Object.entries(taxonomy.assignments || {})) {
    if (id != null && !ids.has(id)) throw new Error('case-taxonomy.json files "' + slug + '" under an unknown template "' + id + '"');
  }

  const templates = lib.templates.map(t => Object.assign({}, t, {
    master: { en: L.masterOf(t, 'en'), zh: L.masterOf(t, 'zh') },
    needs: (needs[t.id].needs || []).map(s => Object.assign({}, s)),
    speech: !!needs[t.id].speech,
    twoStep: needs[t.id].twoStep || null,
  }));

  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const put = (name, data) => fs.writeFileSync(path.join(DIR, name), (typeof data === 'string' || Buffer.isBuffer(data)) ? data : JSON.stringify(data, null, 1) + '\n');
  put('templates.json', templates);
  put('categories.json', lib.categories);
  put('tags.json', style.tagLabels || {});
  put('taxonomy.json', { assignments: taxonomy.assignments || {} });
  put('guide.md', '# ' + 'Seedance production workflow (awesome-seedance, MIT)\n\n'
    + got['agents/skills/seedance-production-workflow/SKILL.md'].toString('utf8').trim() + '\n\n---\n\n'
    + got['agents/skills/seedance-production-workflow/references/editable-template.md'].toString('utf8').trim() + '\n');
  put('LICENSE-MIT.txt', got.LICENSE);
  put('NOTICE.txt', NOTICE(PIN.exportedAt));
  const counts = { templates: templates.length, categories: lib.categories.length, tags: Object.keys(style.tagLabels || {}).length,
                   filed: Object.values(taxonomy.assignments || {}).filter(Boolean).length };
  put('PINNED.json', { repo: PIN.repo, commit: PIN.commit, exportedAt: PIN.exportedAt, layout: LAYOUT, moreSkills: skills.moreUrl || '', counts });
  return counts;
}

// --bump: main's head, its files' sizes and hashes, and what happened to the cases between the two.
async function bump() {
  const head = JSON.parse((await _get('https://api.github.com/repos/' + PIN.repo + '/commits/main', 'main')).toString('utf8'));
  const sha = head.sha;
  const at = String((head.commit && head.commit.committer && head.commit.committer.date) || '').slice(0, 16) + 'Z';
  const raw = (rel) => 'https://raw.githubusercontent.com/' + PIN.repo + '/' + sha + '/' + rel;
  const block = { ship: {}, cases: {} };
  let newCases = null;
  for (const group of ['ship', 'cases']) {
    for (const rel of Object.keys(PIN[group])) {
      const buf = await _get(raw(rel), rel);
      block[group][rel] = { size: buf.length, sha256: sha256(buf) };
      if (rel === 'data/cases.json') newCases = JSON.parse(buf.toString('utf8'));
    }
  }
  const oldCases = JSON.parse((await pinned('data/cases.json', PIN.cases['data/cases.json'], FROM)).toString('utf8'));
  const before = new Set(oldCases.cases.map(c => c.slug));
  const after = new Set(newCases.cases.map(c => c.slug));
  const added = [...after].filter(s => !before.has(s));
  const gone = [...before].filter(s => !after.has(s));
  const line = (rel, w) => "    '" + rel + "': { size: " + w.size + ", sha256: '" + w.sha256 + "' },";
  console.log('main is ' + sha + ' (' + at + ')' + (sha === PIN.commit ? ' - the pin already' : ''));
  console.log('\nconst PIN = {\n  repo: \'' + PIN.repo + '\',\n  commit: \'' + sha + '\',\n  committed: \'' + at + '\',\n  exportedAt: \'' + String((newCases.meta || {}).exportedAt || '') + '\',\n  ship: {');
  for (const [rel, w] of Object.entries(block.ship)) console.log(line(rel, w));
  console.log('  },\n  cases: {');
  for (const [rel, w] of Object.entries(block.cases)) console.log(line(rel, w));
  console.log('  },\n};');
  console.log('\ncases: ' + before.size + ' -> ' + after.size + '; added ' + added.length + ', REMOVED ' + gone.length);
  if (gone.length) console.log('removed upstream (takedowns - add any that matter to presets-src/video/cookbook-removed.json):\n  ' + gone.join('\n  '));
  if (added.length) console.log('added:\n  ' + added.slice(0, 200).join('\n  ') + (added.length > 200 ? '\n  ...' : ''));
}

async function main() {
  if (args.includes('--bump')) return bump();
  try {
    const have = JSON.parse(fs.readFileSync(MARK, 'utf8'));
    if (!FROM && have.commit === PIN.commit && have.layout === LAYOUT) { console.log('[cookbook] ' + PIN.commit.slice(0, 8) + ' already in place'); return; }
  } catch (e) { /* not there yet */ }
  const counts = await layOut(FROM);
  console.log('[cookbook] ' + PIN.commit.slice(0, 8) + ' laid out in ' + DIR + ' - ' + counts.templates + ' templates, '
    + counts.categories + ' categories, ' + counts.tags + ' tags, ' + counts.filed + ' cases filed by the taxonomy');
}

main().catch((e) => {
  console[optional ? 'warn' : 'error']('[cookbook] ' + e.message);
  if (!optional) process.exit(1);
});
