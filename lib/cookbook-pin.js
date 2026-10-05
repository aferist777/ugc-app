'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE COOKBOOK'S PIN (phase V4, docs/local-app/PLAN.md "V-D") - one place, read by tools/fetch-cookbook.js and by
// lib/video-catalog.js: the awesome-seedance commit the video chat's cookbook is made from, and every file taken
// from it with its size and SHA-256. A file that is not exactly that is refused - to move the pin, change the
// commit AND every size and hash (tools/fetch-cookbook.js --bump prints a new block).
//
// Two kinds of file, two places (licences differ - the repository says so in its own words):
//   SHIP    the templates, categories, tags, the taxonomy and the skills: MIT code and CC BY 4.0 curation -
//           fetched by `npm install` into vendor/cookbook/ and shipped with the program
//   CASES   data/cases.json - the 670 cases' prompts and media links belong to their authors and carry no
//           licence, so they are NEVER shipped: the server fetches them into the library's cache the first time
//           the catalog asks (POST /api/mv3/video/catalog/fetch), checked the same way
// ════════════════════════════════════════════════════════════════════════════

const PIN = {
  repo: 'LearnPrompt/awesome-seedance',
  commit: '605283e05dcc00d18f12a183f88eafeda188dbfd',
  committed: '2026-10-03T12:56Z',
  exportedAt: '2026-10-02T22:16:16Z',
  ship: {
    'data/style-library.json': { size: 84809, sha256: 'c6383e935a815f3290bd444234cf574349a2497adb08b94586294ada490badff' },
    'data/templates-local.json': { size: 114439, sha256: '97bc42d9bd2f30fcee65fbe3c23f5bb7d7e2e1aff1c2a331e559a1ff5450acde' },
    'data/case-taxonomy.json': { size: 52291, sha256: 'e806de2887b9a4e556d7dfce7ee1356b81b171ff4836144a3d7c259607d6bead' },
    'data/skills.json': { size: 44674, sha256: 'ef2e62fade1f01efb57d608859e522dd09230776199926eecee02b8bd4e23916' },
    'LICENSE': { size: 1068, sha256: '1eef1394cbdc77865323cb153d3ffc241af74184246ee253ce5bcfd65b61cc0b' },
    'agents/skills/seedance-production-workflow/SKILL.md': { size: 5941, sha256: 'b40482f047a3463cd9a4c7cb4fcbf65997b6ae12d35b67d6187334c458ff0ef4' },
    'agents/skills/seedance-production-workflow/references/editable-template.md': { size: 5216, sha256: '1bb9a2d37e573db5acc6714c150780036abd177a96b4823d44d2859f3fca123b' },
  },
  cases: {
    'data/cases.json': { size: 3281662, sha256: '311d0fec1a7fefdf8c7ae7d4cbfa4e4d761220f9482448562be109259065d6ee' },
  },
};

const rawUrl = (rel) => 'https://raw.githubusercontent.com/' + PIN.repo + '/' + PIN.commit + '/' + rel;

// Where a case's media may come from - a poster is fetched only from these, and only by the address its case
// carries (never one a request names).
const MEDIA_HOSTS = ['media.goodcase.ai', 'goodcase.ai'];

module.exports = { PIN, rawUrl, MEDIA_HOSTS };
