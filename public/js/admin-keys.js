/* admin-keys.js — the API keys, on /admin.

   Nobody sees a whole key here: the field shows its first six and last four characters, the
   server keeps the rest. There is no reveal. The full values live in data/settings.json in the
   library and nowhere else - to read one, read the file.

   EVERY FIELD SAYS WHETHER IT IS FILLED, in colour: green when the key is there and the
   provider accepted it, amber when it is there but the provider refused it (the reason sits
   under the field), red when it is missing. The check is the same one the Character page
   runs (GET /api/keys/health: Claude, kie.ai, OpenRouter, Replicate, ElevenLabs, Groq, Freesound, Cloudflare); the keys it
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
    desc: 'Claude directly - Opus, Sonnet and Haiku 5.5. Used only where you choose it: as a step of the agents\' ladder on AI settings - which writes the scenario generator\'s scripts too.',
  },
  {
    label: 'kie.ai API:', settingsKey: 'kieApiKey', probe: 'kie.ai',
    placeholder: 'kie_••• (kie.ai)',
    link: 'https://kie.ai/api-key', linkText: 'kie.ai/api-key',
    desc: 'Pictures and video in the chats, New Character and the talking head; Suno music; the agents (the scenario generator among them) on Gemini; the 3D Studio\'s Claude. The number beside it is the credit balance.',
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
    desc: 'Pictures and video in the chats and New Character; transcribing sources and narrator samples; the agents (the scenario generator among them) on Gemini and GPT.',
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
    // (phase V54, the owner 2026-10-27, (зв1)) Finding sound effects online - Freesound directly; Openverse without it.
    label: 'Freesound API:', settingsKey: 'freesoundApiKey', probe: 'freesound',
    placeholder: '••• (freesound.org → API credentials)',
    link: 'https://freesound.org/apiv2/apply', linkText: 'freesound.org/apiv2/apply (a free account)',
    desc: 'SFX → "find online…": free sound effects (CC0 only) straight from Freesound. Without it the search goes through Openverse, which is often down.',
  },
  {
    // (phase V62, block 3, the owner's (во43)) A voiceover's B-roll - stock videos and photos from Pixabay (lib/pixabay.js).
    label: 'Pixabay API:', settingsKey: 'pixabayApiKey', probe: 'pixabay',
    placeholder: '12345678-••• (pixabay.com → API docs)',
    link: 'https://pixabay.com/api/docs/', linkText: 'pixabay.com/api/docs (a free account - the key is on that page)',
    desc: 'Voiceover → field 2 "find B-roll": stock videos (1080p) and photos for every sentence of the voice. Free.',
  },
  {
    // (phase TG, block 2; the owner: the bot's key "в админке над r2") The owner's own bot: what it is sent goes into
    // REFERENCES. Under it: who it listens to (the code), how its messages come in, the queue (lib/telegram.js).
    group: 'Telegram bot · links, photos and videos you send it go into REFERENCES',
    label: 'Telegram bot token:', settingsKey: 'telegramBotToken', probe: 'telegram', telegram: true,
    placeholder: '123456789:AA••• (@BotFather)',
    desc: 'Your own bot: send it links to posts, or photos and videos, from your phone. It answers only you.',
    link: 'https://t.me/BotFather', linkText: '@BotFather in Telegram',
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
// R2 of whichever account is signed in (Cloudflare's own deep link, `?to=/:account/...`); after a check, the account's own.
const CF_R2 = 'https://dash.cloudflare.com/?to=/:account/r2/overview';
const CF_ACC = (id) => 'https://dash.cloudflare.com/' + encodeURIComponent(id);
const CF_HOWTO = [
  ['Open ', ['dash.cloudflare.com → My Profile → API Tokens', CF_TOKENS], ' and sign in.'],
  ['Press “Create Token”.'],
  ['Find the template “Edit Cloudflare Workers” and press “Use template”.'],
  ['Give it a name, for example “UGC Studio”.'],
  ['Account Resources: Include → your account (the one with R2). Zone Resources: Include → All zones.'],
  ['Leave Client IP Address Filtering and TTL empty.'],
  ['Press “Continue to summary”, then “Create Token”.'],
  ['Copy the token - it starts with cfut_ and is shown only once - paste it in the field above and press Save. The app checks it step by step: the key, the account, the bucket, an upload.'],
  ['Turn R2 on once in ', ['dash.cloudflare.com → R2 Object Storage', CF_R2], ' - Cloudflare asks for a payment card for it, even within the free allowance. Then press “check” beside the steps.'],
  ['The bucket “ugc-studio” (or the one you had) is then in ', ['dash.cloudflare.com → R2 Object Storage → Buckets', CF_R2], '; the line “bucket” of the check links straight to it.'],
];
// (phase TG, block 8: a new account showed it) Cloudflare asks for a payment card to turn R2 on, even within its free allowance.
const CF_NOTE = 'The bucket is found, or made, by the app. The free allowance of R2 - 10 GB stored, a million uploads a month - is far '
  + 'more than the app uses.';
const CF_STEP = { key: 'key', account: 'account', bucket: 'bucket', upload: 'upload' };
// How to make the bot (phase TG, block 2).
const TG_HOWTO = [
  ['In Telegram open ', ['@BotFather', 'https://t.me/BotFather'], ' and send /newbot.'],
  ['Give the bot a name, then a username that ends in “bot” (for example ugc_studio_inbox_bot).'],
  ['BotFather answers with a token like 123456789:AA… - paste it in the field above and press Save.'],
  ['Then send your bot the code that appears here (or open the link beside it and press Start): from then on it listens to you only.'],
];
const TG_NOTE = 'With the Cloudflare key below working, what you send waits on your Cloudflare while the app is closed; without it, Telegram keeps it for 24 hours.';

function _help(title, steps, note) {
  const d = document.createElement('details');
  d.className = 'bk-help';
  const s = document.createElement('summary');
  s.textContent = title;
  d.appendChild(s);
  const ol = document.createElement('ol');
  for (const parts of steps) {
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
  n.textContent = note;
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
  field.className = 'bk-field u-in';
  field.type = 'text';
  field.placeholder = r.placeholder || '';
  field.autocomplete = 'off';
  field.spellcheck = false;
  lbl.htmlFor = field.id = 'bk-' + r.settingsKey;
  // (phase TG, block 8; the owner 2026-10-22: "сделай инструкции под полями для ключей, а не в правом столбце") The field
  // and its x in a column of their own - a key's instruction opens UNDER its field.
  const col = document.createElement('div');
  col.className = 'bk-col';
  const frow = document.createElement('div');
  frow.className = 'bk-frow';
  frow.appendChild(field);
  col.appendChild(frow);
  line.appendChild(col);

  // Remove on Save. Where the eye used to be; the opposite of a reveal.
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'bk-x u-btn is-icon is-quiet is-del u-x';
  x.title = 'Remove this key (on Save)';
  frow.appendChild(x);

  // The verdict and the description sit to the RIGHT of the field, on the same line, so a
  // row is one line tall and twelve keys fit on one screen (an instruction, when there is one, under the field).
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
    again.className = 'bk-mini u-btn is-s';
    again.textContent = 'check';
    again.title = 'Check the key again: the key, the account, the bucket, an upload';
    sr.append(steps, again);
    side.appendChild(sr);
    col.appendChild(_help('How to get this key', CF_HOWTO, CF_NOTE));
  }
  // The bot's state - who it listens to, how messages come in, the queue - with "connect" and "unpair".
  let tg = null;
  if (r.telegram) {
    tg = document.createElement('div');
    tg.className = 'bk-tg';
    side.appendChild(tg);
    col.appendChild(_help('How to make a bot', TG_HOWTO, TG_NOTE));
  }
  line.appendChild(side);
  wrap.appendChild(line);

  const row = {
    wrap, field, x, state, key: r.settingsKey, probe: r.probe || null,
    plain: !!r.plain, optional: !!r.optional, hint: r.placeholder || '',
    present: false, mask: '', fromEnv: false,
    mode: 'shown',          // shown | editing | typed | cleared
    health: null,           // { state, detail } from the probe, when there is one
    r2: !!r.r2, steps, again, tg,
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
    await tgLoad();
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
    // (block 8) Where the bucket is - or where R2 is turned on - in this account of Cloudflare's dashboard.
    const acc = c.account || v.account, bkt = c.bucket || (s.ok ? v.bucket : '');
    if (s.id === 'bucket' && acc) {
      const a = document.createElement('a');
      a.target = '_blank'; a.rel = 'noopener';
      if (s.ok && bkt) { a.href = CF_ACC(acc) + '/r2/default/buckets/' + encodeURIComponent(bkt); a.textContent = 'open it in Cloudflare'; }
      else { a.href = CF_ACC(acc) + '/r2/overview'; a.textContent = 'R2 in this account'; }
      e.append(' · ', a);
    }
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

// ── the bot (phase TG, block 2) ───────────────────────────────────────────
// Who it listens to (the code until the owner pressed Start), how messages come in, the queue; read again every few
// seconds while the code is waiting, so the line turns into "listens to you only" as soon as Start is pressed.
let _tgTimer = null;
function _tgLine(cls, ...parts) {
  const e = document.createElement('div');
  e.className = 'bk-step' + (cls ? ' ' + cls : '');
  for (const p of parts) {
    if (p && typeof p === 'object' && p.href) {
      const a = document.createElement('a');
      a.href = p.href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = p.text;
      e.appendChild(a);
    } else if (p && typeof p === 'object' && p.button) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'bk-mini u-btn is-s'; b.textContent = p.button; b.title = p.title || '';
      b.addEventListener('click', p.click);
      e.appendChild(document.createTextNode(' '));
      e.appendChild(b);
    } else e.appendChild(document.createTextNode(String(p || '')));
  }
  return e;
}

function tgPaint(v) {
  const row = byKey.get('telegramBotToken');
  if (!row || !row.tg) return;
  const box = row.tg;
  box.textContent = '';
  clearTimeout(_tgTimer);
  if (!v || !v.tokenSet) return;
  if (v.connecting) { box.appendChild(_tgLine('', 'connecting…')); _tgTimer = setTimeout(tgLoad, 2000); return; }
  if (v.error) box.appendChild(_tgLine('down', '✗ ' + v.error, { button: 'connect', title: 'Look at the keys again and connect', click: tgConnect }));
  const bot = v.bot && v.bot.username ? v.bot.username : '';
  if (bot && v.code) {
    // The code alone is enough (phase TG, the owner 2026-10-21: "пишет not connected" - Start pressed on the bot itself
    // sends "/start" without the code).
    box.appendChild(_tgLine('down', `✗ not connected yet: send the code ${v.code} to @${bot} in Telegram - or open `,
      { href: `https://t.me/${bot}?start=${v.code}`, text: `t.me/${bot}?start=${v.code}` }, ' and press Start'));
    _tgTimer = setTimeout(tgLoad, 3000);
  } else if (bot && v.chat) {
    box.appendChild(_tgLine('ok', `✓ @${bot} listens to ${v.chat.name} only`, { button: 'unpair', title: 'Forget this chat - a new code is made', click: tgUnpair }));
  }
  if (v.mode === 'receiver') {
    box.appendChild(_tgLine('ok', '✓ messages wait on your Cloudflare (' + (v.receiver ? v.receiver.script : 'receiver') + ') while the app is closed'));
  } else if (v.mode === 'poll') {
    box.appendChild(_tgLine('', '· the app reads the bot while it is open - Telegram keeps what you send for 24 hours (the Cloudflare key below keeps it for good)'));
  }
  if (v.receiverError) box.appendChild(_tgLine('down', '✗ ' + v.receiverError));
  if (v.conflict) box.appendChild(_tgLine('down', '✗ ' + v.conflict));
  if (v.delivery) box.appendChild(_tgLine('down', '✗ ' + v.delivery));
  const q = v.queue || {};
  if (q.waiting || q.error) box.appendChild(_tgLine('', `in the queue: ${q.waiting || 0}` + (q.error ? ` · ${q.error} could not be taken` : '')));
}

async function tgLoad() {
  try { const v = await fetch('/api/telegram').then(r => r.json()); tgPaint(v && v.success ? v : null); return v; }
  catch (e) { tgPaint(null); return null; }
}
async function tgConnect() {
  const row = byKey.get('telegramBotToken');
  if (row && row.tg) { row.tg.textContent = ''; row.tg.appendChild(_tgLine('', 'connecting the bot…')); }
  try { const v = await fetch('/api/telegram/connect', { method: 'POST' }).then(r => r.json()); tgPaint(v && v.success ? v : null); return v; }
  catch (e) { tgPaint(null); return null; }
}
async function tgUnpair() {
  try { const v = await fetch('/api/telegram/unpair', { method: 'POST' }).then(r => r.json()); tgPaint(v && v.success ? v : null); }
  catch (e) { /* the line stays as it was */ }
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
  // (phase V73 block 2) one "Really?" (js/really.js's words and time - this script is not a module): "Really? · 2 keys", the red fill, 3 s.
  if (removals && !_armed) {
    _armed = setTimeout(() => { _armed = null; btn.textContent = '💾 Save'; btn.classList.remove('is-danger', 'is-armed'); }, 3000);
    btn.textContent = 'Really? · ' + removals + (removals === 1 ? ' key' : ' keys');
    btn.classList.add('is-danger', 'is-armed');
    return;
  }
  if (_armed) { clearTimeout(_armed); _armed = null; }
  btn.classList.remove('is-danger', 'is-armed');
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
    // The bot's way in depends on both keys: the receiver needs the Cloudflare key working.
    if ('telegramBotToken' in payload || 'cloudflareApiToken' in payload) await tgConnect();
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
