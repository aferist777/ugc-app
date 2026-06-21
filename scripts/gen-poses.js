// One-time generator for the 9 fixed UGC "self-filming" pose mannequin assets.
// Uses kie.ai nano-banana-2 (NOT the in-app Replicate engine) to produce SQUARE
// neutral-grey artist-mannequin pose references. Output -> public/poses/<key>.jpg
// plus a poses.json manifest. Re-run safe: skips poses whose file already exists
// unless FORCE=1.
//
//   node scripts/gen-poses.js            # generate missing
//   FORCE=1 node scripts/gen-poses.js    # regenerate all
//   node scripts/gen-poses.js standing_talk walk_talk   # only these keys

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'poses');
const SETTINGS = path.join(ROOT, 'data', 'settings.json');
const KIE_BASE = 'https://api.kie.ai';

function kieKey() {
  let k = '';
  try { k = (JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).kieApiKey || '').trim(); } catch {}
  if (!k && process.env.KIE_AI_API_KEY) k = process.env.KIE_AI_API_KEY.trim();
  if (!k) throw new Error('No kieApiKey in data/settings.json (or KIE_AI_API_KEY env).');
  return k;
}
const HEADERS = () => ({ Authorization: `Bearer ${kieKey()}`, 'Content-Type': 'application/json' });

// Shared style: a single neutral genderless grey artist mannequin, plain studio
// background, square. It reads as a POSE REFERENCE, identity comes from the
// character later.
const STYLE =
  ' Subject: ONE single neutral genderless artist\'s mannequin made of smooth matte light-grey clay — ' +
  'no face, no facial features, no hair, no clothing, blank grey surface. Plain seamless light-grey studio ' +
  'background, soft even lighting, subtle soft floor shadow. Exactly one figure, centered. This is a clean ' +
  'POSE REFERENCE. No text, no words, no watermark, no logos, no extra people. Square 1:1 framing.';

const POSES = [
  { key: 'selfie_arm_up', label: 'Selfie (arm up)',
    prompt: 'A grey artist mannequin taking a phone selfie: one arm raised high holding a smartphone slightly ABOVE the head, with the hand and the phone cropped off beyond the TOP edge of the frame; head tilted slightly up toward the phone; the other arm relaxed at the side; facing the camera; head and upper body visible.' },
  { key: 'mirror_full', label: 'Mirror selfie (full body)',
    prompt: 'A grey artist mannequin standing turned three-quarters toward a large plain mirror, holding a smartphone toward the mirror at chest height, head turned to look into the camera. Whole body from head to feet visible.' },
  { key: 'sitting_table', label: 'Sitting at a table',
    prompt: 'A grey artist mannequin sitting at a plain neutral table, both hands resting flat on the tabletop, torso turned toward the camera, head facing straight forward looking at the camera. Visible from the tabletop up to the head.' },
  { key: 'standing_talk', label: 'Standing, talking',
    prompt: 'A grey artist mannequin standing relaxed with weight on one leg, both hands raised open at chest height in a mid-gesture as if talking to the camera, facing the camera directly. Most of the body visible.' },
  { key: 'walk_talk', label: 'Walk & talk',
    prompt: 'A grey artist mannequin walking toward the camera, captured mid-stride with one leg forward, one arm swinging naturally and the other raised in a small gesture, facing the camera. Full body visible.' },
  { key: 'selfie_chest', label: 'Selfie (chest height)',
    prompt: 'A grey artist mannequin holding a smartphone at arm\'s length around chest height, the extended arm reaching toward the lower front so the hand and phone sit near the bottom edge of the frame, slight high angle, the other arm relaxed, facing the camera. Upper body visible.' },
  { key: 'sofa_lean', label: 'Sofa, leaning in',
    prompt: 'A grey artist mannequin sitting on the front edge of a plain seat, leaning slightly forward toward the camera, forearms resting on the thighs with hands loosely clasped, head up facing the camera.' },
  { key: 'product_present', label: 'Presenting a product',
    prompt: 'A grey artist mannequin standing, extending one hand forward presenting a small blank plain box toward the camera, the other arm relaxed, facing the camera. Upper body and the presented box visible.' },
  { key: 'point_react', label: 'Pointing / reaction',
    prompt: 'A grey artist mannequin in a lively posture, one arm raised pointing directly at the camera lens, the other hand near its head, energetic body language, facing the camera. Upper body visible.' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function createTask(prompt) {
  const res = await axios.post(`${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'nano-banana-2', input: { prompt: prompt + STYLE, aspect_ratio: '1:1', resolution: '2K', output_format: 'jpg' } },
    { headers: HEADERS(), timeout: 30000 });
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('no taskId: ' + JSON.stringify(res.data).slice(0, 200));
  return taskId;
}

async function poll(taskId) {
  for (let i = 0; i < 60; i++) {
    await sleep(4000);
    const r = await axios.get(`${KIE_BASE}/api/v1/jobs/recordInfo`, { params: { taskId }, headers: HEADERS(), timeout: 15000 });
    const d = r.data?.data;
    const state = d?.state;
    if (state === 'success') {
      const p = JSON.parse(d.resultJson || '{}');
      const url = p.resultUrls?.[0] || p.images?.[0] || p.image_url || p.url || (Array.isArray(p.output) ? p.output[0] : p.output) || null;
      if (!url) throw new Error('success but no url: ' + JSON.stringify(p).slice(0, 200));
      return url;
    }
    if (state === 'failed' || /fail/i.test(state || '')) throw new Error('task failed: ' + (d?.failMsg || state));
  }
  throw new Error('timeout');
}

async function download(url, dest) {
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
  fs.writeFileSync(dest, Buffer.from(r.data));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const force = process.env.FORCE === '1';
  const only = process.argv.slice(2);
  const list = only.length ? POSES.filter(p => only.includes(p.key)) : POSES;

  // kick off all tasks (skip existing unless FORCE)
  const jobs = [];
  for (const pose of list) {
    const dest = path.join(OUT_DIR, pose.key + '.jpg');
    if (!force && fs.existsSync(dest)) { console.log('skip (exists):', pose.key); continue; }
    try {
      const taskId = await createTask(pose.prompt);
      console.log('created:', pose.key, '->', taskId);
      jobs.push({ pose, taskId, dest });
    } catch (e) { console.error('create failed:', pose.key, e.message); }
  }

  for (const j of jobs) {
    try {
      const url = await poll(j.taskId);
      await download(url, j.dest);
      console.log('OK  :', j.pose.key, '->', path.relative(ROOT, j.dest));
    } catch (e) { console.error('FAIL:', j.pose.key, e.message); }
  }

  // (re)write manifest from whatever exists on disk
  const manifest = POSES
    .filter(p => fs.existsSync(path.join(OUT_DIR, p.key + '.jpg')))
    .map(p => ({ key: p.key, label: p.label, file: '/poses/' + p.key + '.jpg' }));
  fs.writeFileSync(path.join(OUT_DIR, 'poses.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest:', manifest.length, 'poses ->', path.relative(ROOT, path.join(OUT_DIR, 'poses.json')));
})();
