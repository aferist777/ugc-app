'use strict';

/* drop-language.js - a scenario's language, taken out of the stores once (phase V29, the owner 2026-10-14:
   "p5 - убираем без следа"; docs/local-app/PLAN.md, "Фаза V29", block 1).

   Every script is written in English now, so nothing chooses, shows or keeps a language: the generator has no
   Language menu and the scenario shelf no language field, column or filter. What the stores still carry from
   before goes here:
     data/scen3-scenarios.json   a scenario's own `language` (its label, often null) and `origin.language` (what
                                 the generator wrote it in);
     data/script-drafts.json     a draft's `settings.language` (the dropdown it was written with).
   The normalisers (routes/scen3.js `_norm`, lib/script-drafts.js `_norm`) no longer name the field, so a record
   rewritten later loses it anyway - this takes it from the ones nobody touches again.

   At start (lib/library-upgrade.js `upgrade`, and on a staged Import the same way). A store it changes is copied
   first to backups/<date> scenario language/. Nothing else in a record moves; run again, it finds nothing.

   No lib/config.js here, like the rest of the upgrade: it works on the library it is given. */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');

const _has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// The scenarios without it: { list, changed } - `changed` how many records lost something.
function dropScenarios(list) {
  if (!Array.isArray(list)) return { list, changed: 0 };
  let changed = 0;
  const out = list.map((s) => {
    const own = _has(s, 'language');
    const org = _has(s && s.origin, 'language');
    if (!own && !org) return s;
    changed++;
    const next = { ...s };
    delete next.language;
    if (org) { next.origin = { ...s.origin }; delete next.origin.language; }
    return next;
  });
  return { list: out, changed };
}

// The drafts without it: { doc, changed }.
function dropDrafts(doc) {
  const drafts = doc && Array.isArray(doc.drafts) ? doc.drafts : null;
  if (!drafts) return { doc, changed: 0 };
  let changed = 0;
  const out = drafts.map((d) => {
    if (!_has(d && d.settings, 'language')) return d;
    changed++;
    const settings = { ...d.settings };
    delete settings.language;
    return { ...d, settings };
  });
  return { doc: { ...doc, drafts: out }, changed };
}

const README = `This folder was made when the scenario's language was taken out of the stores: every script is
written in English now (phase V29), and nothing chooses, shows or keeps a language any more.

data/scen3-scenarios.json   the scenarios as they were, with "language" and "origin.language"
data/script-drafts.json     the generator's drafts as they were, with "settings.language"

Эта папка появилась, когда из баз убрали язык сценария: все сценарии теперь пишутся по-английски (фаза V29),
и язык больше нигде не выбирается, не показывается и не хранится. data/scen3-scenarios.json и
data/script-drafts.json - базы в прежнем виде.
`;

const STORES = [
  { rel: 'data/scen3-scenarios.json', drop: (v) => { const r = dropScenarios(v); return { value: r.list, changed: r.changed }; } },
  { rel: 'data/script-drafts.json', drop: (v) => { const r = dropDrafts(v); return { value: r.doc, changed: r.changed }; } },
];

// The library's stores. `dry` counts and writes nothing. Returns { records, stores, failed, backup, which }.
function dropLibrary(root, { log = () => {}, dry = false } = {}) {
  const result = { records: 0, stores: 0, failed: 0, backup: null, which: [] };
  for (const st of STORES) {
    const abs = path.join(root, st.rel);
    let value;
    try { value = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { continue; }
    const r = st.drop(value);
    if (!r.changed) continue;
    result.which.push(`${st.rel} - ${r.changed}`);
    if (dry) { result.stores++; result.records += r.changed; continue; }
    try {
      if (!result.backup) {
        const now = new Date();
        const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        let rel = `backups/${day} scenario language`;
        for (let i = 2; fs.existsSync(path.join(root, rel)) && !fs.existsSync(path.join(root, rel, 'README.txt')); i++) rel = `backups/${day} scenario language (${i})`;
        fs.mkdirSync(path.join(root, rel), { recursive: true });
        fs.writeFileSync(path.join(root, rel, 'README.txt'), README);
        result.backup = rel;
      }
      // The original first, and never over an earlier copy.
      const copy = path.join(root, result.backup, st.rel);
      if (!fs.existsSync(copy)) {
        fs.mkdirSync(path.dirname(copy), { recursive: true });
        fs.copyFileSync(abs, copy);
      }
      writeFileAtomic(abs, JSON.stringify(r.value, null, 2));
      result.stores++;
      result.records += r.changed;
    } catch (e) {
      result.failed++;
      log(`[language] could not take the language out of ${st.rel}: ${e.message}`);
    }
  }
  if (result.records && !dry) log(`[language] the scenario language taken out of ${result.records} record(s) in ${result.stores} store(s); the originals are in ${result.backup}`);
  return result;
}

module.exports = { dropScenarios, dropDrafts, dropLibrary };
