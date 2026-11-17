'use strict';
/* third-party.js - THIRD_PARTY_NOTICES.md, made from Admin -> Thanks.
       node tools/third-party.js            writes THIRD_PARTY_NOTICES.md
       node tools/third-party.js --check    says whether it is current (exit code 1 when not)
   The list of everything the app uses is public/js/admin-thanks.js - one list for the page and for this file. What is
   not a list - where each license text is, the GPL and LGPL programs a build carries and their source - is
   tools/third-party/notices.md, the list put in place of {{LIST}}. A project whose code or presets are taken into our own
   files has its license text beside it, tools/third-party/<its name on Admin -> Thanks>.txt, put in place of {{COPIED}}.
   tools/smoke-local.js asks current(), so a line added to Admin -> Thanks without a new THIRD_PARTY_NOTICES.md fails it. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const OUT = path.join(REPO, 'THIRD_PARTY_NOTICES.md');
const DIR = path.join(__dirname, 'third-party');

// The page's own list: the array literal between `var THANKS = [` and the line `  ];`, read as data.
function thanks() {
  const src = fs.readFileSync(path.join(REPO, 'public', 'js', 'admin-thanks.js'), 'utf8').replace(/\r\n/g, '\n');
  const a = src.indexOf('var THANKS = [');
  const b = src.indexOf('\n  ];', a);
  if (a < 0 || b < 0) throw new Error('public/js/admin-thanks.js: the THANKS list was not found');
  return vm.runInNewContext('(' + src.slice(a + 'var THANKS = '.length, b + 4) + ')', {});
}

const az = (x, y) => x.localeCompare(y, 'en', { sensitivity: 'base', numeric: true });

function make() {
  const list = thanks();
  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push(t);
  }
  const lines = [];
  for (const g of [...groups.keys()].sort(az)) {
    lines.push('### ' + g, '');
    for (const t of groups.get(g).sort((p, q) => az(p.name, q.name))) {
      lines.push('- **' + t.name + '**' + (t.npm ? ' (npm `' + t.npm + '`)' : '') + ' - ' + t.license + ' - ' + t.url);
    }
    lines.push('');
  }
  const copied = [];
  for (const f of fs.readdirSync(DIR).filter((n) => /\.txt$/.test(n)).sort(az)) {
    const name = f.replace(/\.txt$/, '');
    const t = list.find((x) => x.name === name);
    if (!t) throw new Error('tools/third-party/' + f + ': no "' + name + '" on Admin -> Thanks');
    const text = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n').trim();
    copied.push('### ' + name, '', t.how, '', t.url, '', '```', text, '```', '');
  }
  const tpl = fs.readFileSync(path.join(DIR, 'notices.md'), 'utf8').replace(/\r\n/g, '\n');
  return tpl.replace('{{COUNT}}', String(list.length))
    .replace('{{LIST}}', lines.join('\n').trim())
    .replace('{{COPIED}}', copied.join('\n').trim());
}

function current() {
  let now = '';
  try { now = fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return false; }
  return now === make();
}

module.exports = { make, current };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const ok = current();
    console.log(ok ? '[third-party] THIRD_PARTY_NOTICES.md is current' : '[third-party] THIRD_PARTY_NOTICES.md is not current - node tools/third-party.js');
    process.exitCode = ok ? 0 : 1;
  } else {
    fs.writeFileSync(OUT, make());
    console.log('[third-party] THIRD_PARTY_NOTICES.md written - ' + thanks().length + ' entries');
  }
}
