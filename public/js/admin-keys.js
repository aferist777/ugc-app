/* admin-keys.js — the API keys, on /admin.

   Nobody sees a whole key here: the field shows its first six and last four characters, the
   server keeps the rest. There is no reveal. The full values live in data/settings.json in the
   library and nowhere else - to read one, read the file.

   EVERY FIELD SAYS WHETHER IT IS FILLED, in colour: green when the key is there and the
   provider accepted it, amber when it is there but the provider refused it (the reason sits
   under the field), red when it is missing. The check is the same one the Character page
   runs (GET /api/keys/health: Claude, kie.ai, OpenRouter, Replicate, ElevenLabs, Groq, Cloudflare); the keys it
   does not probe - the separate R2 fields - are green when present, with "not probed" said.

   THE ONE CLOUDFLARE KEY (phase TG): saved, it is checked step by step at once (POST /api/cloudflare/check - the key,
   the account, the bucket, an upload), the steps shown under it with a "check" of its own and "How to get this key"
   under them; once it has passed, R2 is spoken to with it and the R2 fields are hidden (their values wiped).

   EDITING. Focusing a filled field clears it for typing; leaving it empty puts the mask back.
   Typing replaces on Save. The × beside a field removes the key on Save - the button asks
   "really?" first, because an empty key is a feature that stops working. */

(function () {

// (phase V25, the owner 2026-10-13) Claude first; every description says what the key does in the app as it is now.
const ROWS = [
  {
    label: 'Claude (Anthropic):', settingsKey: 'anthropicApiKey', probe: 'anthropic',
    placeholder: 'sk-ant-••• (console.anthropic.com)',
    link: 'https://console.anthropic.com/settings/keys', linkText: 'console.anthropic.com → API keys',
    desc: 'Claude directly - Opus, Sonnet and Haiku 5.5. Used only where you choose it: as a step of the agents\' ladder on AI settings, or as the model of the scenario generator in its form.',
  },
  {
    label: 'kie.ai API:', settingsKey: 'kieApiKey', probe: 'kie.ai',
    placeholder: 'kie_••• (kie.ai)',
    link: 'https://kie.ai/api-key', linkText: 'kie.ai/api-key',
    desc: 'Pictures and video in the chats, New Character and the talking head; Suno music; the agents and the scenario generator on Gemini; the 3D Studio\'s Claude. The number beside it is the credit balance.',
  },
  {
    label: 'OpenRouter API:', settingsKey: 'openRouterApiKey', probe: 'openrouter',
    placeholder: 'sk-or-v1-••• (openrouter.ai)',
    link: 'https://openrouter.ai/settings/keys', linkText: 'openrouter.ai → keys',
    desc: 'Not used at the moment - kept so it can be connected: with a working key it becomes an aggregator of the agents\' ladder on AI settings.',
  },
  {
    label: 'Replicate API:', settingsKey: 'replicateApiKey', probe: 'replicate',
    placeholder: 'r8_••• (replicate.com)',
    link: 'https://replicate.com/account/api-tokens', linkText: 'replicate.com → API tokens',
    desc: 'Pictures and video in the chats and New Character; transcribing sources and narrator samples; the agents and the scenario generator on Gemini and GPT.',
  },
  {
    label: 'ElevenLabs API:', settingsKey: 'elevenLabsApiKey', probe: 'elevenlabs',
    placeholder: 'sk_••• (elevenlabs.io)',
    link: 'https://elevenlabs.io/app/settings/api-keys', linkText: 'elevenlabs.io → API keys',
    desc: 'The talking head\'s voice (text to speech), and the voices of characters from the ElevenLabs library.',
  },
  {
    label: 'Groq (Whisper STT):', settingsKey: 'groqApiKey', probe: 'groq',
    placeholder: 'gsk_••• (console.groq.com)',
    link: 'https://console.groq.com/keys', linkText: 'console.groq.com → API keys',
    desc: 'Hearing the words for captions (whisper-large-v3-turbo); without it, or when Groq cannot be asked, this computer hears them.',
  },
  {
    // (phase TG, the owner 2026-10-21: "хочу решить вопрос одним ключом") ONE key for Cloudflare: R2 is spoken to with the
    // pair made from it, and (block 2) the Telegram receiver is set up with it. Checked step by step once saved
    // (lib/cloudflare.js); the R2 fields below go when it has passed.
    group: 'Cloudflare · where reference media are hosted (R2)',
    label: 'Cloudflare API token:', settingsKey: 'cloudflareApiToken', probe: 'cloudflare', cloudflare: true,
    placeholder: 'cfut_••• (one key for R2)',
    desc: 'One key in place of the R2 fields: the app finds your account and its bucket (or makes one), and hosts every reference image and clip the models fetch there.',
  },
  {
    group: 'R2 · separate keys (only while there is no checked Cloudflare token)',
    label: 'R2 account ID:', settingsKey: 'r2AccountId', plain: true, r2: true,
    placeholder: '32 hex characters (Cloudflare dashboard)',
    link: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens', linkText: 'dash.cloudflare.com → R2',
    desc: 'Every generated reference image is uploaded here so Replicate and kie can fetch it over https. Without R2 the providers refuse the image and generation fails.',
  },
  {
    label: 'R2 access key ID:', settingsKey: 'r2AccessKeyId', plain: true, r2: true,
    placeholder: 'the ID half of the R2 API token',
  },
  {
    label: 'R2 secret key:', settingsKey: 'r2SecretAccessKey', r2: true,
    placeholder: '••• (the secret half, shown once at creation)',
  },
  {
    label: 'R2 bucket:', settingsKey: 'r2Bucket', plain: true, r2: true,
    placeholder: 'bucket name',
  },
  {
    label: 'R2 public base:', settingsKey: 'r2PublicBase', plain: true, optional: true, r2: true,
    placeholder: 'https://pub-••••.r2.dev  (optional)',
    desc: 'The bucket\'s own public address. Left empty, links are presigned instead — longer, and they expire, but nothing has to be switched on in the dashboard.',
  },
];

const $ = (id) => document.getElementById(id);

// HOW TO GET THE CLOUDFLARE KEY (the owner 2026-10-21: the instruction "в дропдауне под новым ключом ... типа хелпера").
// Cloudflare's own words for its buttons (developers.cloudflare.com, "Create API token"), checked 2026-10-21.
const CF_TOKENS = 'https://dash.cloudflare.com/profile/api-tokens';
const CF_HOWTO = [
  ['Open ', ['dash.cloudflare.com → My Profile → API Tokens', CF_TOKENS], ' and sign in.'],
  ['Press “Create Token”.'],
  ['Find the template “Edit Cloudflare Workers” and press “Use template”.'],
  ['Give it a name, for example “UGC Studio”.'],
  ['Account Resources: Include → your account (the one with R2). Zone Resources: Include → All zones.'],
  ['Leave Client IP Address Filtering and TTL empty.'],
  ['Press “Continue to summary”, then “Create Token”.'],
  ['Copy the token - it starts with cfut_ and is shown only once - paste it in the field above and press Save. The app checks it step by step: the key, the account, the bucket, an upload.'],
];
const CF_NOTE = 'R2 has to be turned on in the account once (R2 Object Storage in the Cloudflare dashboard). The bucket is found, or made, by the app.';
const CF_STEP = { key: 'key', account: 'account', bucket: 'bucket', upload: 'upload' };

function _cfHelp() {
  const d = document.createElement('details');
  d.className = 'bk-help';
  const s = document.createElement('summary');
  s.textContent = 'How to get this key';
  d.appendChild(s);
  const ol = document.createElement('ol');
  for (const parts of CF_HOWTO) {
    const li = document.createElement('li');
    for (const p of parts) {
      if (Array.isArray(p)) {
        const a = document.createElement('a');
        a.href = p[1]; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = p[0];
        li.appendChild(a);
      } else li.appendChild(document.createTextNode(p));
    }
    ol.appendChild(li);
  }
  d.appendChild(ol);
  const n = document.createElement('div');
  n.className = 'bk-help-note';
  n.textContent = CF_NOTE;
  d.appendChild(n);
  return d;
}

function buildRow(r) {
  const wrap = document.createElement('div');
  wrap.className = 'bk-row';

  if (r.group) {
    const g = document.createElement('div');
    g.className = 'bk-group';
    g.textContent = r.group;
    wrap.appendChild(g);
  }

  const line = document.createElement('div');
  line.className = 'bk-line';

  const lbl = document.createElement('label');
  lbl.className = 'bk-label';
  lbl.textContent = r.label;
  line.appendChild(lbl);

  const field = document.createElement('input');
  field.className = 'bk-field';
  field.type = 'text';
  field.placeholder = r.placeholder || '';
  field.autocomplete = 'off';
  field.spellcheck = false;
  lbl.htmlFor = field.id = 'bk-' + r.settingsKey;
  line.appendChild(field);

  // Remove on Save. Where the eye used to be; the opposite of a reveal.
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'bk-x';
  x.textContent = '×';
  x.title = 'Remove this key (on Save)';
  line.appendChild(x);

  // The verdict and the description sit to the RIGHT of the field, on the same line, so a
  // row is one line tall and twelve keys fit on one screen.
  const side = document.createElement('div');
  side.className = 'bk-side';
  const state = document.createElement('div');
  state.className = 'bk-state';
  side.appendChild(state);
  if (r.desc) {
    const d = document.createElement('div');
    d.className = 'bk-desc';
    d.textContent = r.desc;
    if (r.link) {
      d.appendChild(document.createTextNode(' '));
      const a = document.createElement('a');
      a.href = r.link; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = r.linkText || r.link;
      d.appendChild(a);
    }
    side.appendChild(d);
  }
  // The Cloudflare key's check, step by step, with its own "check" - and how to get the key.
  let steps = null, again = null;
  if (r.cloudflare) {
    const sr = document.createElement('div');
    sr.className = 'bk-steps-row';
    steps = document.createElement('div');
    steps.className = 'bk-steps';
    again = document.createElement('button');
    again.type = 'button';
    again.className = 'bk-mini';
    again.textContent = 'check';
    again.title = 'Check the key again: the key, the account, the bucket, an upload';
    sr.append(steps, again);
    side.appendChild(sr);
    side.appendChild(_cfHelp());
  }
  line.appendChild(side);
  wrap.appendChild(line);

  const row = {
    wrap, field, x, state, key: r.settingsKey, probe: r.probe || null,
    plain: !!r.plain, optional: !!r.optional, hint: r.placeholder || '',
    present: false, mask: '', fromEnv: false,
    mode: 'shown',          // shown | editing | typed | cleared
    health: null,           // { state, detail } from the probe, when there is one
    r2: !!r.r2, steps, again,
  };
  if (again) again.addEventListener('click', () => cfCheck());

  // Focusing a filled field clears it for typing; leaving it empty puts the mask back.
  field.addEventListener('focus', () => {
    if (row.mode === 'shown' && (row.present || row.fromEnv)) { row.mode = 'editing'; field.value = ''; field.classList.remove('is-mask'); }
  });
  field.addEventListener('input', () => { row.mode = field.value ? 'typed' : 'editing'; paint(row); });
  field.addEventListener('blur', () => { if (row.mode === 'editing' && !field.value) { row.mode = 'shown'; paint(row); } });
  field.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); row.mode = 'shown'; paint(row); field.blur(); } });
  x.addEventListener('click', () => {
    if (row.mode === 'cleared') { row.mode = 'shown'; paint(row); return; }
    if (!row.present && !row.fromEnv && row.mode !== 'typed') return;    // nothing to remove
    row.mode = 'cleared';
    paint(row);
  });
  return row;
}

const rows = ROWS.map(buildRow);
const byKey = new Map(rows.map(r => [r.key, r]));
const byProbe = new Map(rows.filter(r => r.probe).map(r => [r.probe, r]));

// Saving is only allowed once the current values are known: if the load failed, every field is
// empty for a reason that has nothing to do with intent, and a save then would wipe the lot.
let _loaded = false;

function setStatus(text, kind) {
  const el = $('adm-keys-status');
  el.textContent = text || '';
  el.className = 'adm-status' + (kind ? ' ' + kind : '');
}

// ── how a row looks ───────────────────────────────────────────────────────
// Colour says whether the key is there and whether it works; the line under the field says why.
function paint(row) {
  const { field, state, x } = row;
  field.classList.remove('is-ok', 'is-down', 'is-missing', 'is-cleared', 'is-mask');
  x.textContent = row.mode === 'cleared' ? '↶' : '×';
  x.title = row.mode === 'cleared' ? 'Keep it after all' : 'Remove this key (on Save)';
  x.disabled = !(row.present || row.fromEnv || row.mode === 'typed' || row.mode === 'cleared') || (row.fromEnv && !row.present && row.mode !== 'typed');

  if (row.mode === 'cleared') {
    field.value = '';
    field.placeholder = 'removed on Save';
    field.classList.add('is-cleared');
    state.textContent = 'will be removed when you press Save'
      + (row.key === 'cloudflareApiToken' ? ' - uploads to R2 stop until a new key (or the R2 fields)' : '');
    state.className = 'bk-state missing';
    return;
  }
  if (row.mode === 'shown') {
    if (row.present) { field.value = row.mask; field.classList.add('is-mask'); field.placeholder = ''; }
    else if (row.fromEnv) { field.value = 'set in .env'; field.classList.add('is-mask'); field.placeholder = ''; }
    else { field.value = ''; field.placeholder = row.hint; }
  }
  const have = row.present || row.fromEnv || row.mode === 'typed';
  const h = row.health;
  let cls = '', text = '';
  if (h && row.mode !== 'typed') {
    if (h.state === 'ok') { cls = 'is-ok'; text = 'ok' + (h.detail ? ' · ' + h.detail : ''); }
    else if (h.state === 'down') { cls = 'is-down'; text = 'refused · ' + (h.detail || 'no answer'); }
    else { cls = 'is-missing'; text = 'no key'; }
  } else if (have) {
    cls = 'is-ok';
    text = row.mode === 'typed' ? 'new value · saved and checked on Save' : (row.fromEnv && !row.present ? 'present in .env · not probed' : (row.probe ? 'present · checking…' : 'present · not probed'));
  } else {
    cls = row.optional ? '' : 'is-missing';
    text = row.optional ? 'optional' : 'no key';
  }
  if (cls) field.classList.add(cls);
  state.textContent = text;
  state.className = 'bk-state ' + (cls === 'is-ok' ? 'ok' : cls === 'is-down' ? 'down' : cls === 'is-missing' ? 'missing' : '');
}

// ── the current values ────────────────────────────────────────────────────
async function load() {
  try {
    const d = await fetch('/api/settings').then(r => r.json());
    const set      = (d && d.secretsSet) || {};
    const preview  = (d && d.secretsPreview) || {};
    const settings = (d && d.settings) || {};
    const fromEnv  = (d && d.envFallback) || {};
    for (const [key, row] of byKey) {
      if (row.plain) {
        const v = String(settings[key] ?? '').trim();
        row.present = !!v; row.mask = v;
      } else {
        row.present = !!set[key]; row.mask = preview[key] || '';
      }
      row.fromEnv = !!fromEnv[key];
      row.mode = 'shown';
      paint(row);
    }
    _loaded = true;
    setStatus('');
    await cfLoad();
  } catch (e) {
    setStatus('Could not read the current settings — saving is disabled so nothing gets overwritten. ' + e.message, 'err');
  }
}

// ── the check ─────────────────────────────────────────────────────────────
const ago = (ms) => ms < 60000 ? Math.round(ms / 1000) + ' s ago' : Math.round(ms / 60000) + ' min ago';
async function health(force) {
  const line = $('adm-keys-health');
  const btn = $('adm-keys-check');
  if (btn) btn.disabled = true;
  if (line) line.textContent = 'checking…';
  try {
    const d = await fetch('/api/keys/health' + (force ? '?force=1' : '')).then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'no answer');
    let ok = 0, down = 0, unset = 0;
    for (const p of d.providers || []) {
      const row = byProbe.get(p.id);
      if (row) { row.health = { state: p.state, detail: p.detail }; paint(row); }
      if (p.state === 'ok') ok++; else if (p.state === 'down') down++; else unset++;
    }
    if (line) line.textContent = `checked ${ago(d.ageMs || 0)} · ${ok} ok · ${down} refused · ${unset} missing`;
  } catch (e) {
    if (line) line.textContent = 'check failed: ' + e.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── the Cloudflare key's check (phase TG) ─────────────────────────────────
// Its steps under the field, in green or red; the R2 fields hidden while the key is R2's (checked).
function cfPaint(v) {
  const row = byKey.get('cloudflareApiToken');
  if (!row || !row.steps) return;
  const inUse = !!(v && v.inUse);
  for (const r of rows) if (r.r2) r.wrap.hidden = inUse;
  row.steps.textContent = '';
  row.again.hidden = !(v && v.tokenSet);
  row.again.disabled = !!(v && v.checking);
  if (!v || !v.tokenSet) return;
  if (v.checking) { row.steps.textContent = 'checking the key…'; return; }
  const c = v.check;
  if (!c) { row.steps.textContent = 'not checked yet'; return; }
  for (const s of c.steps || []) {
    const e = document.createElement('div');
    e.className = 'bk-step ' + (s.ok ? 'ok' : 'down');
    e.textContent = (s.ok ? '✓ ' : '✗ ') + (CF_STEP[s.id] || s.id) + ' · ' + (s.words || '');
    row.steps.appendChild(e);
  }
  if (c.ok) {
    const e = document.createElement('div');
    e.className = 'bk-step ok';
    e.textContent = 'R2 works with this key - the separate R2 fields are gone';
    row.steps.appendChild(e);
  }
}

async function cfLoad() {
  try {
    const v = await fetch('/api/cloudflare').then(r => r.json());
    cfPaint(v && v.success ? v : null);
    return v;
  } catch (e) { cfPaint(null); return null; }
}

async function cfCheck() {
  const row = byKey.get('cloudflareApiToken');
  if (row && row.steps) { row.steps.textContent = 'checking the key - the account, the bucket, an upload…'; row.again.disabled = true; }
  try {
    const v = await fetch('/api/cloudflare/check', { method: 'POST' }).then(r => r.json());
    if (!v || !v.success) throw new Error((v && v.error) || 'no answer');
    await load();
    cfPaint(v);
    return v;
  } catch (e) {
    if (row && row.steps) { row.steps.textContent = 'the check failed: ' + e.message; row.again.disabled = false; }
    return null;
  }
}

// ── saving ────────────────────────────────────────────────────────────────
let _armed = null;
async function save(btn) {
  if (!_loaded) { setStatus('Not saving: the current settings never loaded.', 'err'); return; }
  const payload = {};
  let removals = 0;
  for (const [key, row] of byKey) {
    if (row.mode === 'typed' && row.field.value.trim()) payload[key] = row.field.value.trim();
    else if (row.mode === 'cleared') { payload[key] = ''; removals++; }
  }
  if (!Object.keys(payload).length) { setStatus('Nothing to change — type a key to replace it, or × to remove one.', 'ok'); return; }
  // Removing is asked about once: an empty key is a feature that stops working.
  if (removals && !_armed) {
    _armed = setTimeout(() => { _armed = null; btn.textContent = '💾 Save'; }, 5000);
    btn.textContent = `really? remove ${removals} key${removals === 1 ? '' : 's'}`;
    return;
  }
  if (_armed) { clearTimeout(_armed); _armed = null; }
  btn.disabled = true;
  btn.textContent = '⏳ Saving…';
  try {
    const r = await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || (d && d.success === false)) throw new Error((d && d.error) || ('HTTP ' + r.status));
    // Reload first - load() clears the status line - then say what happened. A new Cloudflare key is checked step by
    // step at once: only a key that passed becomes R2's.
    await load();
    const cf = payload.cloudflareApiToken ? await cfCheck() : null;
    await health(true);
    setStatus('Saved' + (removals ? ` · ${removals} removed` : '') + ' · checked'
      + (cf && cf.check ? (cf.check.ok ? ' · the Cloudflare key works for R2' : ' · the Cloudflare key did not pass - see its steps') : ''),
      cf && cf.check && !cf.check.ok ? 'err' : 'ok');
  } catch (e) {
    setStatus('Not saved: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save';
  }
}

// ── mount ─────────────────────────────────────────────────────────────────
const host = $('adm-keys');
if (host) {
  for (const row of rows) host.appendChild(row.wrap);
  $('adm-keys-save')?.addEventListener('click', (e) => save(e.currentTarget));
  $('adm-keys-check')?.addEventListener('click', () => health(true));
  load().then(() => health(false));
}

})();
