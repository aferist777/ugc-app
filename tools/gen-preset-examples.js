'use strict';

// Generate the example image for each character preset.
//
//   node tools/gen-preset-examples.js            every preset that has no image yet
//   node tools/gen-preset-examples.js nordic-frost [more ids...]   just these
//   node tools/gen-preset-examples.js --force     redo the ones that already exist
//
// One-off by design: the images are static, committed, and served from public/presets/. This
// script exists so they can be regenerated deliberately rather than on every page load - each
// run costs real API calls, so it skips whatever is already on disk unless told otherwise.
//
// 3:2 landscape (1152x768): it fills the create column's width and still leaves room for the
// prompt underneath. The subject is a head-and-shoulders portrait inside that frame.
//
// Realism markers go in but are never shown in the page's prompt field - they are generation
// policy, not something the user edits. The sentence is the one the old create column used,
// deliberately without its iPhone-14 framing, which made the model put a phone in shot.

const fs = require('fs');
const path = require('path');
const { createZImageTurboTask, resolveTask } = require('../lib/helpers');

const OUT_DIR = path.join(__dirname, '..', 'public', 'presets');
const W = 1152, H = 768;

const REALISM = 'Photorealistic, natural detailed skin texture with visible pores, realistic soft studio lighting, sharp focus, high detail, no text, no watermark, no phone, no hands.';
// Clothing is generation policy rather than a character trait, so it lives here and not in the
// prompt the page shows. The first test came back with bare shoulders: "head and shoulders in
// frame" tells the model where to crop, not that the subject is dressed. Fitted on purpose -
// the shoulders stay in frame so body type reads, and a baggy shirt would hide exactly that.
const WARDROBE = 'Wearing a plain fitted neutral grey crew-neck t-shirt.';

// The preset data and the prompt builder live in an ES module the page also uses, so there is
// one source for both. Read and evaluate it rather than duplicating twenty records here.
function loadPresets() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'character-v2', 'presets.js'), 'utf8');
  const stripped = src
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export /gm, '');
  const mod = { PRESETS: null, promptText: null };
  // eslint-disable-next-line no-new-func
  new Function('out', stripped + '\nout.PRESETS = PRESETS; out.promptText = promptText;')(mod);
  if (!Array.isArray(mod.PRESETS) || typeof mod.promptText !== 'function') {
    throw new Error('could not read PRESETS/promptText out of presets.js');
  }
  return mod;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// resolveTask is a SINGLE poll: it answers 'pending' while the job is still running and
// leaves the looping to the caller, which is how routes/generate.js uses it (the browser
// polls a status endpoint). So poll here rather than reading one 'pending' as a failure.
async function resolveWithPolling(taskId, destDir, prefix, { timeoutMs = 180000, everyMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await resolveTask(taskId, destDir, prefix);
    if (res.state !== 'pending') return res;
    if (Date.now() > deadline) return { state: 'failed', error: 'timed out after ' + Math.round(timeoutMs / 1000) + 's' };
    await sleep(everyMs);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const only = args.filter(a => !a.startsWith('--'));

  const { PRESETS, promptText } = loadPresets();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let todo = PRESETS;
  if (only.length) {
    todo = PRESETS.filter(p => only.includes(p.id));
    const unknown = only.filter(id => !PRESETS.some(p => p.id === id));
    if (unknown.length) { console.error('unknown preset id(s): ' + unknown.join(', ')); process.exit(1); }
  }
  if (!force) {
    const before = todo.length;
    todo = todo.filter(p => !fs.existsSync(path.join(OUT_DIR, p.id + '.jpg')));
    if (before !== todo.length) console.log('skipping ' + (before - todo.length) + ' already on disk (pass --force to redo)');
  }
  if (!todo.length) { console.log('nothing to do'); return; }

  console.log(todo.length + ' to generate, ' + W + 'x' + H + ' (3:2), z-image-turbo\n');
  let ok = 0, failed = [];
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    const prompt = promptText(p.v) + ' ' + WARDROBE + ' ' + REALISM;
    process.stdout.write('[' + (i + 1) + '/' + todo.length + '] ' + p.name.padEnd(18));
    try {
      const taskId = await createZImageTurboTask(prompt, { width: W, height: H, output_format: 'jpg', output_quality: 92 });
      const res = await resolveWithPolling(taskId, OUT_DIR, 'preset_' + p.id);
      if (res.state !== 'success' || !res.imagePath) throw new Error(res.error || 'task did not succeed');
      // resolveTask names the file itself; give it the stable name the page asks for.
      const from = path.join(__dirname, '..', res.imagePath.replace(/^\/+/, ''));
      const to = path.join(OUT_DIR, p.id + '.jpg');
      if (fs.existsSync(to)) fs.unlinkSync(to);
      fs.renameSync(from, to);
      const kb = Math.round(fs.statSync(to).size / 1024);
      console.log('ok  ' + kb + ' KB  -> public/presets/' + p.id + '.jpg');
      ok++;
    } catch (e) {
      console.log('FAILED  ' + e.message);
      failed.push(p.id);
    }
    if (i < todo.length - 1) await sleep(700);   // be polite to the API between calls
  }
  console.log('\n' + ok + ' generated' + (failed.length ? ', ' + failed.length + ' failed: ' + failed.join(', ') : ''));
  if (failed.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
