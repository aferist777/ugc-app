#!/usr/bin/env node
// Rebuild finished sessions from an older checkout as projects here, with their media.
//
// Texts already came across as scenarios (scripts/import-old-scenarios.js). This brings
// the work that hangs off them: the voice takes and the clips. Those live on PROJECTS,
// not on scenarios - a scenario is the words, a project is what was made from them.
//
// A session is taken when both hold:
//   - between 5 and 60 fragments. Fewer means it is a source upload wearing a session's
//     clothes (one fragment, hundreds of MB); more means a transcript dump, not a script.
//   - some of its media is findable - in EITHER tree. Work done in August ran against this
//     instance while it was still on the old code, so those files are already in this
//     uploads/ while the session state was mirrored to both boxes by the localStorage sync.
//     Looking only in the old tree called eight finished projects empty when nothing was.
//
// A scenario here with the same title (date prefix stripped) is used when there is one: it
// carries a narrator gender someone actually chose. Without one the scenario is written
// from the session's own lines under --gender (default female), which the Scenarios meta
// pane can correct in a click - the titles name a product, not a speaker, so there is
// nothing there to infer from.
//
// The old and new apps both serve /uploads, so a copied file keeps the URL it already had
// and nothing has to be rewritten - only the directory on disk differs.
//
//   node scripts/import-old-projects.js --dry-run
//   node scripts/import-old-projects.js
//   node scripts/import-old-projects.js --old /root/ugc-test --api http://localhost:3000
//
// Re-running is safe: a project whose name is already here is skipped, and copying a file
// that already exists is a no-op.

const fs = require('fs');
const path = require('path');
const { mediaDur } = require('../lib/av-extract');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const OLD_ROOT = flag('old', '/root/ugc-test');
const API = flag('api', 'http://localhost:3000') + '/api/scen3';
const NEW_ROOT = path.join(__dirname, '..');
// A session recorded in the old checkout can point at media that is already HERE. That is
// not a mix-up: work done in August ran against this instance while it was still on the old
// code, so the files landed in this uploads/ while the session state was mirrored to both
// boxes by the browser's localStorage sync. Looking only in the old tree reported those
// sessions as having lost all their media, when nothing had been lost at all.
const ROOTS = [NEW_ROOT, OLD_ROOT];
// Sessions with no matching scenario are imported under this narrator unless --gender says
// otherwise. Stated rather than guessed per title: the titles name a product, not a speaker.
const FALLBACK_GENDER = flag('gender', 'female');

const MIN_FRAG = 5, MAX_FRAG = 60;
const PREFIX = 'mig — ';
// Only media directories. A path outside them is a bug or an attack, and either way not
// something to copy blindly.
const COPYABLE = /^\/(uploads|characters|obrazy|environments|hooks|refs)\//;

const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const stripDate = t => String(t || '')
  .replace(/^\s*\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}\s*[—-]\s*/, '')
  .replace(/\s*[—-]\s*$/, '').trim();
const takeId = p => 'v' + path.basename(p).replace(/\.[^.]+$/, '');   // must match routes/scen3.js _normTake

// Where a referenced file actually is, if anywhere. NEW_ROOT is checked first so a file
// that is already here is recognised rather than copied over itself.
const findFile = (url) => {
  if (!url || !COPYABLE.test(url)) return null;
  for (const r of ROOTS) { const p = path.join(r, url); if (fs.existsSync(p)) return { root: r, abs: p }; }
  return null;
};

function copyOver(url) {
  const at = findFile(url);
  if (!at) return null;
  if (at.root === NEW_ROOT) return { url, bytes: 0, reused: true };   // already in place
  const to = path.join(NEW_ROOT, url);
  if (fs.existsSync(to)) return { url, bytes: 0, reused: true };
  if (!DRY) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(at.abs, to);
  }
  return { url, bytes: fs.statSync(at.abs).size, reused: false };
}

(async () => {
  const E = readJson(path.join(OLD_ROOT, 'data', 'edit-state.json'), {});
  const scenRes = await (await fetch(API + '/scenarios?lib=library1')).json();
  const scen = scenRes.scenarios || scenRes.items || scenRes.list || [];
  const byTitle = new Map(scen.map(s => [stripDate(s.title).toLowerCase(), s]));

  const projRes = await (await fetch(API + '/projects')).json();
  const already = new Set((projRes.projects || projRes.items || []).map(p => String(p.name || '')));

  console.log('source :', OLD_ROOT);
  console.log('target :', API, DRY ? '(DRY RUN - nothing copied or written)' : '');
  console.log('scenarios here:', scen.length, '| projects here:', already.size);

  const jobs = [];
  for (const key of Object.keys(E.sessions || {})) {
    const s = E.sessions[key] || {};
    const cells = (s.cells || []).filter(c => c && String(c.line || '').trim());
    if (cells.length < MIN_FRAG || cells.length > MAX_FRAG) continue;
    const title = stripDate(s.title);
    // A twin scenario is preferred - it carries a gender someone actually chose - but its
    // absence is no longer a reason to leave the work behind. Without one the scenario is
    // written here from the session's own lines, under FALLBACK_GENDER, which the meta pane
    // can correct in a click.
    const sc = byTitle.get(title.toLowerCase()) || null;
    const withMedia = cells.filter(c => findFile(c.audioPath) || findFile(c.videoPath)).length;
    if (!withMedia) continue;
    jobs.push({ key, title, cells, scenario: sc, withMedia, name: PREFIX + title });
  }

  console.log('sessions to rebuild:', jobs.length);
  let copied = 0, bytes = 0, made = 0, skipped = 0;

  for (const j of jobs) {
    if (already.has(j.name)) { skipped++; console.log('  =', j.title.slice(0, 44), '(project already here)'); continue; }
    const gender = j.scenario ? j.scenario.gender : FALLBACK_GENDER;
    console.log('  >', j.title.slice(0, 44), '|', j.cells.length, 'fragments,', j.withMedia, 'with media ->',
      gender, j.scenario ? '' : '(new scenario, gender assumed)');

    // 1. The files first: a project pointing at media that is not there would be worse
    //    than no project at all.
    const lines = [];
    for (const c of j.cells) {
      const a = copyOver(c.audioPath);
      const v = copyOver(c.videoPath);
      for (const r of [a, v]) if (r && !r.reused) { copied++; bytes += r.bytes; }
      const said = String(c.line || '');
      const aDur = +c._audioSec || 0;
      let audio = null, clips = [];
      if (a) audio = { id: takeId(a.url), path: a.url, dur: aDur, at: '', said, fromAudio: '', fromFrame: '', preset: '', quality: '', thumb: '' };
      if (v) {
        // The clip's own length, read from the file: the fragment card and Merge both
        // time from it, and the audio length is only approximately the clip's.
        const vDur = DRY ? 0 : await mediaDur(path.join(NEW_ROOT, v.url)).catch(() => 0);
        clips = [{ id: takeId(v.url), path: v.url, dur: vDur || aDur, at: '', said,
                   fromAudio: a ? a.url : '', fromFrame: '', preset: '', quality: '', thumb: '' }];
      }
      lines.push({
        text: said, tagged: '', frameId: '',
        audio: { plain: audio, tagged: null },
        video: { plain: clips, tagged: [] },
        pick: { plain: clips.length ? clips[0].id : '', tagged: '' },
      });
    }
    if (DRY) continue;

    // 2. A scenario to belong to. One is written from the session's own lines when no twin
    //    exists, because a project here is always a project OF something.
    let scenarioId = j.scenario ? j.scenario.id : null;
    if (!scenarioId) {
      const made = await (await fetch(API + '/scenarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'mig_ses_' + slug(j.key), title: j.title,
          lines: j.cells.map(c => ({ text: String(c.line || '') })),
          roles: [{ id: 'r0', name: 'Presenter', gender: FALLBACK_GENDER }],
        }),
      })).json();
      if (!made || !made.success) { console.log('    FAIL scenario ->', made && made.error); continue; }
      scenarioId = (made.scenario || made.item || {}).id;
    }

    // 3. Create from the scenario, so the store fills in gender/vertical/roles itself.
    const created = await (await fetch(API + '/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId }),
    })).json();
    if (!created || !created.success) { console.log('    FAIL create ->', created && created.error); continue; }

    // 4. Then the fragments, with the media attached. The lines come from the SESSION,
    //    not the scenario: a take was made from the words as they stood in the project,
    //    and `said` has to agree with them or every take reads as stale.
    const saved = await (await fetch(API + '/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.project.id, name: j.name, lines, stage: 'video' }),
    })).json();
    if (!saved || !saved.success) { console.log('    FAIL save ->', saved && saved.error); continue; }
    made++;
  }

  console.log('\nprojects built:', made, '| skipped (already here):', skipped);
  console.log('files copied:', copied, '|', (bytes / 1048576).toFixed(0), 'MB', DRY ? '(would copy)' : '');
})();
