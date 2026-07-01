// One-off demo: generate tiny parameter-icon candidates with 3 cheap Replicate
// models (z-image-turbo / flux-schnell / sdxl-lightning-4step) so we can pick
// the house style for dropdown thumbnails. 19 params x 2 options x 3 models.
// Outputs (gitignored): public/param-icons-demo/<model>/<param>__<opt>.jpg
// Manifest for the showcase page:  public/param-icons-demo/manifest.json
// Run from repo root:  node scripts/gen-param-icons-demo.js
require('dotenv').config();   // scratch scripts MUST load dotenv (memory rule)
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) { console.error('REPLICATE_API_TOKEN missing'); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const OUT = path.join(__dirname, '..', 'public', 'param-icons-demo');

// ── Prompt set: every dropdown, 2 expressive options each ─────────────────────
const TAIL = ', plain dark grey seamless studio background, soft even studio light, photorealistic, high detail, no text, no watermark';
const HEAD = 'close-up headshot portrait of an adult person, ';
const S = [
  ['age', '20s',            HEAD + 'in their 20s, young adult, smooth fresh face' + TAIL],
  ['age', '60plus',         HEAD + 'elderly 60+, deep wrinkles, age spots' + TAIL],
  ['gender', 'female',      HEAD + 'feminine woman, soft facial features' + TAIL],
  ['gender', 'male',        HEAD + 'masculine man, strong jaw and brow' + TAIL],
  ['ethnicity', 'african',  HEAD + 'African woman, deep skin, coily hair' + TAIL],
  ['ethnicity', 'eastasian',HEAD + 'East Asian woman, monolid almond eyes, straight black hair' + TAIL],
  ['body', 'slim',          'full-body photo of a person with a slim slender build, standing straight, head to toe, plain fitted grey clothing' + TAIL],
  ['body', 'plussize',      'full-body photo of a person with a plus-size heavier build, standing straight, head to toe, plain fitted grey clothing' + TAIL],
  ['skin', 'veryfair',      HEAD + 'very fair porcelain skin tone, cool undertone' + TAIL],
  ['skin', 'deep',          HEAD + 'very deep ebony skin tone' + TAIL],
  ['hairColor', 'blonde',   HEAD + 'blonde hair clearly visible' + TAIL],
  ['hairColor', 'red',      HEAD + 'natural red ginger hair clearly visible' + TAIL],
  ['hairLength', 'buzzcut', HEAD + 'very short buzzcut hair' + TAIL],
  ['hairLength', 'verylong','waist-up photo of a person with very long hair well past the chest' + TAIL],
  ['hairStyle', 'coily',    HEAD + 'tight coily afro-textured hair' + TAIL],
  ['hairStyle', 'slicked',  HEAD + 'slicked-back hair' + TAIL],
  ['eyeColor', 'blue',      'macro close-up photo of a human eye with a bright blue iris, sharp focus' + TAIL],
  ['eyeColor', 'amber',     'macro close-up photo of a human eye with an amber golden iris, sharp focus' + TAIL],
  ['eyeShape', 'monolid',   'close-up photo of a person\'s eyes area, monolid eye shape without a visible crease, both eyes visible' + TAIL],
  ['eyeShape', 'round',     'close-up photo of a person\'s eyes area, large round open eyes, both eyes visible' + TAIL],
  ['faceShape', 'square',   HEAD + 'square face shape with a strong angular jaw' + TAIL],
  ['faceShape', 'heart',    HEAD + 'heart face shape, wide forehead and pointed chin' + TAIL],
  ['eyebrows', 'bushy',     'close-up photo of a person\'s brow area, bushy untrimmed eyebrows, both eyes visible' + TAIL],
  ['eyebrows', 'thin',      'close-up photo of a person\'s brow area, thin sparse eyebrows, both eyes visible' + TAIL],
  ['facialHair', 'fullbeard', HEAD.replace('an adult person', 'a man') + 'full thick beard' + TAIL],
  ['facialHair', 'moustache', HEAD.replace('an adult person', 'a man') + 'moustache above the lip, otherwise clean-shaven' + TAIL],
  ['makeup', 'glam',        HEAD.replace('an adult person', 'a woman') + 'full glam makeup, defined eyes and lips' + TAIL],
  ['makeup', 'smoky',       HEAD.replace('an adult person', 'a woman') + 'smoky eye makeup' + TAIL],
  ['emotion', 'smiling',    HEAD + 'warm genuine smile' + TAIL],
  ['emotion', 'angry',      HEAD + 'angry intense expression, furrowed brows' + TAIL],
  ['scars', 'cheekscar',    HEAD + 'a visible scar across one cheek' + TAIL],
  ['scars', 'browscar',     HEAD + 'a visible scar through one eyebrow' + TAIL],
  ['tattoos', 'teardrop',   HEAD + 'a small teardrop tattoo under one eye' + TAIL],
  ['tattoos', 'tribal',     HEAD + 'a tribal-pattern tattoo on the face' + TAIL],
  ['piercings', 'septum',   'close-up photo of a person\'s nose and mouth area, a septum ring piercing' + TAIL],
  ['piercings', 'nosestud', 'close-up photo of a person\'s nose area, a small nose stud piercing' + TAIL],
  ['freckles', 'heavy',     HEAD + 'dense freckles across the cheeks and nose' + TAIL],
  ['freckles', 'beautymark',HEAD + 'a single beauty mark on the cheek' + TAIL],
];

// ── Models ────────────────────────────────────────────────────────────────────
const MODELS = [
  { key: 'z-image-turbo', path: 'prunaai/z-image-turbo',
    input: p => ({ prompt: p, width: 256, height: 256, num_inference_steps: 8, guidance_scale: 0, go_fast: true, output_format: 'jpg', output_quality: 90 }) },
  { key: 'flux-schnell', path: 'black-forest-labs/flux-schnell',
    input: p => ({ prompt: p, aspect_ratio: '1:1', megapixels: '0.25', num_inference_steps: 4, output_format: 'jpg', output_quality: 90, disable_safety_checker: false }) },
  { key: 'sdxl-lightning', path: 'bytedance/sdxl-lightning-4step',
    input: p => ({ prompt: p, width: 512, height: 512, num_inference_steps: 4, guidance_scale: 0, negative_prompt: 'text, watermark, deformed, cartoon', scheduler: 'K_EULER', disable_safety_checker: false }) },
];

const verCache = {};
async function resolveVersion(modelPath) {
  if (verCache[modelPath]) return verCache[modelPath];
  const r = await axios.get(`https://api.replicate.com/v1/models/${modelPath}`, { headers: H, timeout: 15000 });
  const v = r.data && r.data.latest_version && r.data.latest_version.id;
  if (!v) throw new Error('no latest_version for ' + modelPath);
  verCache[modelPath] = v;
  return v;
}
async function createPrediction(modelPath, input) {
  try {
    const r = await axios.post(`https://api.replicate.com/v1/models/${modelPath}/predictions`, { input }, { headers: H, timeout: 30000 });
    return r.data.id;
  } catch (e) {
    if (e.response && e.response.status === 404) {
      const version = await resolveVersion(modelPath);
      const r2 = await axios.post('https://api.replicate.com/v1/predictions', { version, input }, { headers: H, timeout: 30000 });
      return r2.data.id;
    }
    throw e;
  }
}
async function waitPrediction(id, timeoutMs = 120000) {
  const t0 = Date.now();
  for (;;) {
    const r = await axios.get(`https://api.replicate.com/v1/predictions/${id}`, { headers: H, timeout: 15000 });
    const d = r.data;
    if (d.status === 'succeeded') {
      const out = d.output;
      const url = Array.isArray(out) ? out[0] : (typeof out === 'string' ? out : (out && (out.image || out[0])));
      if (!url) throw new Error('no output url');
      return url;
    }
    if (d.status === 'failed' || d.status === 'canceled') throw new Error(d.error || d.status);
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout');
    await new Promise(s => setTimeout(s, 1200));
  }
}
async function genOne(model, param, opt, prompt, attempt = 0) {
  try {
    const id = await createPrediction(model.path, model.input(prompt));
    const url = await waitPrediction(id);
    const img = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    const dir = path.join(OUT, model.key);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${param}__${opt}.jpg`);
    fs.writeFileSync(file, Buffer.from(img.data));
    return { ok: true };
  } catch (e) {
    const status = e.response && e.response.status;
    if ((status === 429 || status === 402) && attempt < 3) {
      const wait = 12000 * (attempt + 1);
      console.warn(`  throttled (${status}) — retry in ${wait / 1000}s: ${model.key}/${param}__${opt}`);
      await new Promise(s => setTimeout(s, wait));
      return genOne(model, param, opt, prompt, attempt + 1);
    }
    return { ok: false, error: (e.response && e.response.data && JSON.stringify(e.response.data).slice(0, 160)) || e.message };
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { generatedAt: new Date().toISOString(), models: MODELS.map(m => m.key), items: [] };
  let done = 0, fail = 0;
  const total = S.length * MODELS.length;
  // Small concurrency (3 = one per model lane) to stay friendly to rate limits.
  for (const [param, opt, prompt] of S) {
    const results = await Promise.all(MODELS.map(m =>
      fs.existsSync(path.join(OUT, m.key, `${param}__${opt}.jpg`))
        ? Promise.resolve({ ok: true, skipped: true })
        : genOne(m, param, opt, prompt)
    ));
    results.forEach((r, i) => {
      done++;
      if (!r.ok) { fail++; console.error(`  FAIL ${MODELS[i].key}/${param}__${opt}: ${r.error}`); }
    });
    manifest.items.push({ param, opt, prompt, files: MODELS.map(m => `${m.key}/${param}__${opt}.jpg`) });
    console.log(`[${done}/${total}] ${param}__${opt}`);
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`DONE: ${done - fail}/${total} ok, ${fail} failed. Manifest written.`);
})();
