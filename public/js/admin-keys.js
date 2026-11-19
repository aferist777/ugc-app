/* admin-keys.js — the API keys, on /admin.

   Nobody sees a whole key here: the field shows its first six and last four characters, the
   server keeps the rest. There is no reveal. The full values live in data/settings.json in the
   library and nowhere else - to read one, read the file.

   EVERY FIELD SAYS WHETHER IT IS FILLED, in colour: green when the key is there and the
   provider accepted it, amber when it is there but the provider refused it (the reason sits
   under the field), red when it is missing. The check is the same one Home's block "The app"
   reads (GET /api/keys/health: Claude, kie.ai, OpenRouter, Replicate, ElevenLabs, Groq, Freesound, Pixabay, Telegram,
   Cloudflare).

   THE ONE CLOUDFLARE KEY: saved, it is checked step by step at once (POST /api/cloudflare/check - the key,
   the account, the bucket, an upload), the steps shown under it with a "check" of its own and "How to get this key"
   under them; once it has passed, R2 is spoken to with it. It is the only way R2 is set up.

   EDITING. Focusing a filled field clears it for typing; leaving it empty puts the mask back.
   Typing replaces on Save. The × beside a field removes the key on Save - the button asks
   "really?" first, because an empty key is a feature that stops working. */

import { t, tn } from './i18n/t.js';

(function () {

// Claude first; every description says what the key does in the app.
const ROWS = [
  {
    label: 'Claude (Anthropic):', settingsKey: 'anthropicApiKey', probe: 'anthropic',
    placeholder: 'sk-ant-••• (console.anthropic.com)',
    link: 'https://console.anthropic.com/settings/keys', linkText: 'console.anthropic.com → API keys',
    desc: t('Claude directly - Opus, Sonnet and Haiku 5.5. Used only where you choose it: as a step of the agents\' ladder on AI settings - which writes the scenario generator\'s scripts too.'),
  },
  {
    label: 'kie.ai API:', settingsKey: 'kieApiKey', probe: 'kie.ai',
    placeholder: 'kie_••• (kie.ai)',
    link: 'https://kie.ai/api-key', linkText: 'kie.ai/api-key',
    desc: t('Pictures and video in the chats, New Character and the talking head; Suno music; the agents (the scenario generator among them) on Gemini; the 3D Studio\'s Claude. The number beside it is the credit balance.'),
  },
  {
    label: 'OpenRouter API:', settingsKey: 'openRouterApiKey', probe: 'openrouter',
    placeholder: 'sk-or-v1-••• (openrouter.ai)',
    link: 'https://openrouter.ai/settings/keys', linkText: 'openrouter.ai → keys',
    desc: t('Not used at the moment - kept so it can be connected: with a working key it becomes an aggregator of the agents\' ladder on AI settings.'),
  },
  {
    label: 'Replicate API:', settingsKey: 'replicateApiKey', probe: 'replicate',
    placeholder: 'r8_••• (replicate.com)',
    link: 'https://replicate.com/account/api-tokens', linkText: 'replicate.com → API tokens',
    desc: t('Pictures and video in the chats and New Character; transcribing sources and narrator samples; the agents (the scenario generator among them) on Gemini and GPT.'),
  },
  {
    label: 'ElevenLabs API:', settingsKey: 'elevenLabsApiKey', probe: 'elevenlabs',
    placeholder: 'sk_••• (elevenlabs.io)',
    link: 'https://elevenlabs.io/app/settings/api-keys', linkText: 'elevenlabs.io → API keys',
    desc: t('The talking head\'s voice (text to speech), and the voices of characters from the ElevenLabs library.'),
  },
  {
    label: 'Groq (Whisper STT):', settingsKey: 'groqApiKey', probe: 'groq',
    placeholder: 'gsk_••• (console.groq.com)',
    link: 'https://console.groq.com/keys', linkText: 'console.groq.com → API keys',
    desc: t('Hearing the words for captions (whisper-large-v3-turbo); without it, or when Groq cannot be asked, this computer hears them.'),
  },
  {
    // Finding sound effects online - Freesound directly; Openverse without it.
    label: 'Freesound API:', settingsKey: 'freesoundApiKey', probe: 'freesound',
    placeholder: '••• (freesound.org → API credentials)',
    link: 'https://freesound.org/apiv2/apply', linkText: t('freesound.org/apiv2/apply (a free account)'),
    desc: t('SFX → "find online…": free sound effects (CC0 only) straight from Freesound. Without it the search goes through Openverse, which is often down.'),
  },
  {
    // A voiceover's B-roll - stock videos and photos from Pixabay (lib/pixabay.js).
    label: 'Pixabay API:', settingsKey: 'pixabayApiKey', probe: 'pixabay',
    placeholder: '12345678-••• (pixabay.com → API docs)',
    link: 'https://pixabay.com/api/docs/', linkText: t('pixabay.com/api/docs (a free account - the key is on that page)'),
    desc: t('Voiceover → field 2 "find B-roll": stock videos (1080p) and photos for every sentence of the voice. Free.'),
  },
  {
    // The person's own bot, its key above Cloudflare's: what it is sent goes into
    // REFERENCES. Under it: who it listens to (the code), how its messages come in, the queue (lib/telegram.js).
    group: t('Telegram bot · links, photos and videos you send it go into REFERENCES'),
    label: t('Telegram bot token:'), settingsKey: 'telegramBotToken', probe: 'telegram', telegram: true,
    placeholder: '123456789:AA••• (@BotFather)',
    desc: t('Your own bot: send it links to posts, or photos and videos, from your phone. It answers only you.'),
    link: 'https://t.me/BotFather', linkText: t('@BotFather in Telegram'),
  },
  {
    // ONE key for Cloudflare: R2 is spoken to with the
    // pair made from it, and the Telegram receiver is set up with it. Checked step by step once saved
    // (lib/cloudflare.js).
    group: t('Cloudflare · where reference media are hosted (R2)'),
    label: t('Cloudflare API token:'), settingsKey: 'cloudflareApiToken', probe: 'cloudflare', cloudflare: true,
    placeholder: t('cfut_••• (one key for R2)'),
    desc: t('One key for R2: the app finds your account and its bucket (or makes one), and hosts every reference image and clip the models fetch there. Without it the models cannot be handed a reference.'),
  },
];

const $ = (id) => document.getElementById(id);

// HOW TO GET THE CLOUDFLARE KEY - an instruction under the key's field.
// Cloudflare's own words for its buttons (developers.cloudflare.com, "Create API token").
const CF_TOKENS = 'https://dash.cloudflare.com/profile/api-tokens';
// R2 of whichever account is signed in (Cloudflare's own deep link, `?to=/:account/...`); after a check, the account's own.
const CF_R2 = 'https://dash.cloudflare.com/?to=/:account/r2/overview';
const CF_ACC = (id) => 'https://dash.cloudflare.com/' + encodeURIComponent(id);
// A step is its words, a link's place in them `{link}`, and that link [its words on the site, address] - whole sentences,
// so a language can put the link where it belongs. Cloudflare's own buttons are named as Cloudflare names them.
const CF_HOWTO = [
  [t('Open {link} and sign in.'), ['dash.cloudflare.com → My Profile → API Tokens', CF_TOKENS]],
  [t('Press “Create Token”.')],
  [t('Find the template “Edit Cloudflare Workers” and press “Use template”.')],
  [t('Give it a name, for example “UGC Studio”.')],
  [t('Account Resources: Include → your account (the one with R2). Zone Resources: Include → All zones.')],
  [t('Leave Client IP Address Filtering and TTL empty.')],
  [t('Press “Continue to summary”, then “Create Token”.')],
  [t('Copy the token - it starts with cfut_ and is shown only once - paste it in the field above and press Save. The app checks it step by step: the key, the account, the bucket, an upload.')],
  [t('Turn R2 on once in {link} - Cloudflare asks for a payment card for it, even within the free allowance. Then press “check” beside the steps.'), ['dash.cloudflare.com → R2 Object Storage', CF_R2]],
  [t('The bucket “ugc-studio” (or the one you had) is then in {link}; the line “bucket” of the check links straight to it.'), ['dash.cloudflare.com → R2 Object Storage → Buckets', CF_R2]],
];
// Cloudflare asks for a payment card to turn R2 on, even within its free allowance.
const CF_NOTE = t('The bucket is found, or made, by the app. The free allowance of R2 - 10 GB stored, a million uploads a month - is far more than the app uses.');
const CF_STEP = { key: t('key'), account: t('account'), bucket: t('bucket'), upload: t('upload') };
// How to make the bot.
const TG_HOWTO = [
  [t('In Telegram open {link} and send /newbot.'), ['@BotFather', 'https://t.me/BotFather']],
  [t('Give the bot a name, then a username that ends in “bot” (for example ugc_studio_inbox_bot).')],
  [t('BotFather answers with a token like 123456789:AA… - paste it in the field above and press Save.')],
  [t('Then send your bot the code that appears here (or open the link beside it and press Start): from then on it listens to you only.')],
];
const TG_NOTE = t('With the Cloudflare key below working, what you send waits on your Cloudflare while the app is closed; without it, Telegram keeps it for 24 hours.');

function _help(title, steps, note) {
  const d = document.createElement('details');
  d.className = 'bk-help';
  const s = document.createElement('summary');
  s.textContent = title;
  d.appendChild(s);
  const ol = document.createElement('ol');
  for (const [words, link] of steps) {
    const li = document.createElement('li');
    String(words).split('{link}').forEach((bit, i) => {
      if (i && link) {
        const a = document.createElement('a');
        a.href = link[1]; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = link[0];
        li.appendChild(a);
      }
      if (bit) li.appendChild(document.createTextNode(bit));
    });
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
  // a label at the left, without its colon
  lbl.textContent = String(r.label || '').replace(/:s*$/, '');
  line.appendChild(lbl);

  const field = document.createElement('input');
  field.className = 'bk-field u-in';
  field.type = 'text';
  field.placeholder = r.placeholder || '';
  field.autocomplete = 'off';
  field.spellcheck = false;
  lbl.htmlFor = field.id = 'bk-' + r.settingsKey;
  // The field and its x in a column of their own - a key's instruction opens UNDER its field.
  const col = document.createElement('div');
  col.className = 'bk-col';
  const frow = document.createElement('div');
  frow.className = 'bk-frow';
  frow.appendChild(field);
  col.appendChild(frow);
  line.appendChild(col);

  // Remove on Save; the opposite of a reveal.
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'bk-x u-btn is-icon is-quiet is-del u-x';
  x.title = t('Remove this key (on Save)');
  frow.appendChild(x);

  // The verdict and the description sit to the RIGHT of the field, on the same line, so a
  // row is one line tall and twelve keys fit on one screen (an instruction, when there is one, under the field).
  const side = document.createElement('div');
  side.className = 'bk-side';
  // the key's state is a dot and its words - not the colour of the field's border
  const stateRow = document.createElement('div');
  stateRow.className = 'bk-staterow';
  const dot = document.createElement('span');
  dot.className = 'bk-dot';
  const state = document.createElement('div');
  state.className = 'bk-state';
  stateRow.append(dot, state);
  side.appendChild(stateRow);
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
    again.textContent = t('Check');
    again.title = t('Check the key again: the key, the account, the bucket, an upload');
    sr.append(steps, again);
    side.appendChild(sr);
    col.appendChild(_help(t('How to get this key'), CF_HOWTO, CF_NOTE));
  }
  // The bot's state - who it listens to, how messages come in, the queue - with "connect" and "unpair".
  let tg = null;
  if (r.telegram) {
    tg = document.createElement('div');
    tg.className = 'bk-tg';
    side.appendChild(tg);
    col.appendChild(_help(t('How to make a bot'), TG_HOWTO, TG_NOTE));
  }
  line.appendChild(side);
  wrap.appendChild(line);

  const row = {
    wrap, field, x, state, key: r.settingsKey, probe: r.probe || null,
    hint: r.placeholder || '',
    present: false, mask: '',
    mode: 'shown',          // shown | editing | typed | cleared
    health: null,           // { state, detail } from the probe, when there is one
    steps, again, tg,
  };
  if (again) again.addEventListener('click', () => cfCheck());

  // Focusing a filled field clears it for typing; leaving it empty puts the mask back.
  field.addEventListener('focus', () => {
    if (row.mode === 'shown' && row.present) { row.mode = 'editing'; field.value = ''; field.classList.remove('is-mask'); }
  });
  field.addEventListener('input', () => { row.mode = field.value ? 'typed' : 'editing'; paint(row); });
  field.addEventListener('blur', () => { if (row.mode === 'editing' && !field.value) { row.mode = 'shown'; paint(row); } });
  field.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); row.mode = 'shown'; paint(row); field.blur(); } });
  x.addEventListener('click', () => {
    if (row.mode === 'cleared') { row.mode = 'shown'; paint(row); return; }
    if (!row.present && row.mode !== 'typed') return;    // nothing to remove
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
// A failure is a popup in the corner (js/notice.js) - this is a classic script, so the module
// comes with import(); the status line keeps progress and calm news, a field keeps its own state.
function sayError(text, detail) {
  import('/js/notice.js').then((m) => m.showError(text, detail ? { detail } : {})).catch(() => {});
}

// ── how a row looks ───────────────────────────────────────────────────────
// Colour says whether the key is there and whether it works; the line under the field says why.
function paint(row) {
  const { field, state, x } = row;
  field.classList.remove('is-ok', 'is-down', 'is-missing', 'is-cleared', 'is-mask');
  // the shared ✕ draws itself (.u-x) - a "×" written into it would make two crosses; "keep it after all"
  // is Lucide's undo arrow (css/admin.css .bk-undo)
  x.textContent = '';
  x.classList.toggle('u-x', row.mode !== 'cleared');
  x.classList.toggle('bk-undo', row.mode === 'cleared');
  x.title = row.mode === 'cleared' ? t('Keep it after all') : t('Remove this key (on Save)');
  x.disabled = !(row.present || row.mode === 'typed' || row.mode === 'cleared');

  if (row.mode === 'cleared') {
    field.value = '';
    field.placeholder = t('removed on Save');
    field.classList.add('is-cleared');
    state.textContent = row.key === 'cloudflareApiToken'
      ? t('will be removed when you press Save - uploads to R2 stop until a new key')
      : t('will be removed when you press Save');
    state.className = 'bk-state missing';
    return;
  }
  if (row.mode === 'shown') {
    if (row.present) { field.value = row.mask; field.classList.add('is-mask'); field.placeholder = ''; }
    else { field.value = ''; field.placeholder = row.hint; }
  }
  const have = row.present || row.mode === 'typed';
  const h = row.health;
  let cls = '', text = '';
  if (h && row.mode !== 'typed') {
    if (h.state === 'ok') { cls = 'is-ok'; text = t('ok') + (h.detail ? ' · ' + h.detail : ''); }
    else if (h.state === 'down') { cls = 'is-down'; text = t('refused') + ' · ' + (h.detail || t('no answer')); }
    else { cls = 'is-missing'; text = t('no key'); }
  } else if (have) {
    cls = 'is-ok';
    text = row.mode === 'typed' ? t('new value · saved and checked on Save') : t('present · checking…');
  } else {
    cls = 'is-missing';
    text = t('no key');
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
    for (const [key, row] of byKey) {
      row.present = !!set[key]; row.mask = preview[key] || '';
      row.mode = 'shown';
      paint(row);
    }
    _loaded = true;
    setStatus('');
    await cfLoad();
    await tgLoad();
  } catch (e) {
    setStatus('');
    sayError(t('Could not read the current settings - saving is disabled so nothing gets overwritten.'), e.message);
  }
}

// ── the check ─────────────────────────────────────────────────────────────
const ago = (ms) => ms < 60000 ? t('{n} s ago', { n: Math.round(ms / 1000) }) : t('{n} min ago', { n: Math.round(ms / 60000) });
async function health(force) {
  const line = $('adm-keys-health');
  const btn = $('adm-keys-check');
  if (btn) btn.disabled = true;
  if (line) line.textContent = t('checking…');
  try {
    const d = await fetch('/api/keys/health' + (force ? '?force=1' : '')).then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || t('no answer'));
    let ok = 0, down = 0, unset = 0;
    for (const p of d.providers || []) {
      const row = byProbe.get(p.id);
      if (row) { row.health = { state: p.state, detail: p.detail }; paint(row); }
      if (p.state === 'ok') ok++; else if (p.state === 'down') down++; else unset++;
    }
    if (line) line.textContent = t('checked {ago} · {ok} ok · {down} refused · {unset} missing', { ago: ago(d.ageMs || 0), ok, down, unset });
  } catch (e) {
    if (line) line.textContent = '';
    sayError(t('The keys could not be checked'), e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── the Cloudflare key's check ─────────────────────────────────
// Its steps under the field, in green or red.
function cfPaint(v) {
  const row = byKey.get('cloudflareApiToken');
  if (!row || !row.steps) return;
  row.steps.textContent = '';
  row.again.hidden = !(v && v.tokenSet);
  row.again.disabled = !!(v && v.checking);
  if (!v || !v.tokenSet) return;
  if (v.checking) { row.steps.textContent = t('checking the key…'); return; }
  const c = v.check;
  if (!c) { row.steps.textContent = t('not checked yet'); return; }
  for (const s of c.steps || []) {
    const e = document.createElement('div');
    e.className = 'bk-step ' + (s.ok ? 'ok' : 'down');
    e.textContent = (s.ok ? '✓ ' : '✗ ') + (CF_STEP[s.id] || s.id) + ' · ' + (s.words || '');
    // Where the bucket is - or where R2 is turned on - in this account of Cloudflare's dashboard.
    const acc = c.account || v.account, bkt = c.bucket || (s.ok ? v.bucket : '');
    if (s.id === 'bucket' && acc) {
      const a = document.createElement('a');
      a.target = '_blank'; a.rel = 'noopener';
      if (s.ok && bkt) { a.href = CF_ACC(acc) + '/r2/default/buckets/' + encodeURIComponent(bkt); a.textContent = t('open it in Cloudflare'); }
      else { a.href = CF_ACC(acc) + '/r2/overview'; a.textContent = t('R2 in this account'); }
      e.append(' · ', a);
    }
    row.steps.appendChild(e);
  }
  if (c.ok) {
    const e = document.createElement('div');
    e.className = 'bk-step ok';
    e.textContent = t('R2 works with this key');
    row.steps.appendChild(e);
  }
}

async function cfLoad() {
  try {
    const v = await fetch('/api/cloudflare').then(r => r.json());
    if (!v || !v.success) sayError(t('Could not read the Cloudflare key'), (v && v.error) || t('no answer'));   // said, not silent
    cfPaint(v && v.success ? v : null);
    return v;
  } catch (e) { sayError(t('Could not read the Cloudflare key'), e.message); cfPaint(null); return null; }
}

async function cfCheck() {
  const row = byKey.get('cloudflareApiToken');
  if (row && row.steps) { row.steps.textContent = t('checking the key - the account, the bucket, an upload…'); row.again.disabled = true; }
  try {
    const v = await fetch('/api/cloudflare/check', { method: 'POST' }).then(r => r.json());
    if (!v || !v.success) throw new Error((v && v.error) || t('no answer'));
    await load();
    cfPaint(v);
    return v;
  } catch (e) {
    if (row && row.steps) { row.steps.textContent = ''; row.again.disabled = false; }
    sayError(t('The Cloudflare key could not be checked'), e.message);
    return null;
  }
}

// ── the bot ───────────────────────────────────────────
// Who it listens to (the code until the person presses Start), how messages come in, the queue; read again every few
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
  if (v.connecting) { box.appendChild(_tgLine('', t('connecting…'))); _tgTimer = setTimeout(tgLoad, 2000); return; }
  if (v.error) box.appendChild(_tgLine('down', '✗ ' + v.error, { button: t('connect'), title: t('Look at the keys again and connect'), click: tgConnect }));
  const bot = v.bot && v.bot.username ? v.bot.username : '';
  if (bot && v.code) {
    // The code alone is enough (Start pressed on the bot itself sends "/start" without the code).
    const [before, after] = t('✗ not connected yet: send the code {code} to @{bot} in Telegram - or open {link} and press Start', { code: v.code, bot }).split('{link}');
    box.appendChild(_tgLine('down', before, { href: `https://t.me/${bot}?start=${v.code}`, text: `t.me/${bot}?start=${v.code}` }, after || ''));
    _tgTimer = setTimeout(tgLoad, 3000);
  } else if (bot && v.chat) {
    box.appendChild(_tgLine('ok', t('✓ @{bot} listens to {name} only', { bot, name: v.chat.name }), { button: t('unpair'), title: t('Forget this chat - a new code is made'), click: tgUnpair }));
  }
  if (v.mode === 'receiver') {
    box.appendChild(_tgLine('ok', t('✓ messages wait on your Cloudflare ({script}) while the app is closed', { script: v.receiver ? v.receiver.script : t('receiver') })));
  } else if (v.mode === 'poll') {
    box.appendChild(_tgLine('', t('· the app reads the bot while it is open - Telegram keeps what you send for 24 hours (the Cloudflare key below keeps it for good)')));
  }
  if (v.receiverError) box.appendChild(_tgLine('down', '✗ ' + v.receiverError));
  if (v.conflict) box.appendChild(_tgLine('down', '✗ ' + v.conflict));
  if (v.delivery) box.appendChild(_tgLine('down', '✗ ' + v.delivery));
  const q = v.queue || {};
  if (q.waiting || q.error) box.appendChild(_tgLine('', t('{n} in the queue', { n: q.waiting || 0 }) + (q.error ? ' · ' + t('{n} could not be taken', { n: q.error }) : '')));
}

async function tgLoad() {
  try {
    const v = await fetch('/api/telegram').then(r => r.json());
    if (!v || !v.success) sayError(t('Could not read the bot'), (v && v.error) || t('no answer'));   // said, not silent
    tgPaint(v && v.success ? v : null);
    return v;
  } catch (e) { sayError(t('Could not read the bot'), e.message); tgPaint(null); return null; }
}
async function tgConnect() {
  const row = byKey.get('telegramBotToken');
  if (row && row.tg) { row.tg.textContent = ''; row.tg.appendChild(_tgLine('', t('connecting the bot…'))); }
  try {
    const v = await fetch('/api/telegram/connect', { method: 'POST' }).then(r => r.json());
    if (!v || !v.success) sayError(t('The bot was not connected'), (v && v.error) || t('no answer'));
    tgPaint(v && v.success ? v : null);
    return v;
  } catch (e) { sayError(t('The bot was not connected'), e.message); tgPaint(null); return null; }
}
async function tgUnpair() {
  try {
    const v = await fetch('/api/telegram/unpair', { method: 'POST' }).then(r => r.json());
    if (!v || !v.success) { sayError(t('The bot was not unpaired'), (v && v.error) || t('no answer')); return; }
    tgPaint(v);
  } catch (e) { sayError(t('The bot was not unpaired'), e.message); /* the line stays as it was */ }
}

// ── saving ────────────────────────────────────────────────────────────────
let _armed = null;
async function save(btn) {
  if (!_loaded) { sayError(t('Not saving: the current settings never loaded.')); return; }
  const payload = {};
  let removals = 0;
  for (const [key, row] of byKey) {
    if (row.mode === 'typed' && row.field.value.trim()) payload[key] = row.field.value.trim();
    else if (row.mode === 'cleared') { payload[key] = ''; removals++; }
  }
  if (!Object.keys(payload).length) { setStatus(t('Nothing to change - type a key to replace it, or × to remove one.'), 'ok'); return; }
  // Removing is asked about once: an empty key is a feature that stops working.
  // one "Really?" (js/really.js's words and time - this script is not a module): "Really? · 2 keys", the red fill, 3 s.
  if (removals && !_armed) {
    _armed = setTimeout(() => { _armed = null; btn.textContent = t('Save'); btn.classList.remove('is-danger', 'is-armed'); }, 3000);
    btn.textContent = t('Really?') + ' · ' + tn(removals, '{n} key', '{n} keys');
    btn.classList.add('is-danger', 'is-armed');
    return;
  }
  if (_armed) { clearTimeout(_armed); _armed = null; }
  btn.classList.remove('is-danger', 'is-armed');
  btn.disabled = true;
  btn.textContent = t('Saving');   // no emoji, no dots
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
    setStatus(t('Saved') + (removals ? ' · ' + t('{n} removed', { n: removals }) : '') + ' · ' + t('checked')
      + (cf && cf.check ? ' · ' + (cf.check.ok ? t('the Cloudflare key works for R2') : t('the Cloudflare key did not pass - see its steps')) : ''),
      cf && cf.check && !cf.check.ok ? 'err' : 'ok');
  } catch (e) {
    setStatus('');
    sayError(t('Not saved'), e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t('Save');
  }
}

// ── mount ─────────────────────────────────────────────────────────────────
const host = $('adm-keys');
if (host) {
  for (const row of rows) host.appendChild(row.wrap);
  $('adm-keys-save')?.addEventListener('click', (e) => save(e.currentTarget));
  $('adm-keys-check')?.addEventListener('click', () => health(true));
  load().then(() => health(false));
  backAndNeed();
}

// Come from a place that needs a key (js/key-gate.js: ?back=<that page>&need=<fields>): "← Back" leads there again, and
// the fields it needs are lit until one is typed into. Read once - a tab's press rewrites the address without its query.
// Only a page of this app is a way back.
function backAndNeed() {
  let q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  const back = q.get('back') || '';
  const btn = $('adm-keys-back');
  if (btn && /^\/(?!\/)/.test(back) && !/^\/admin\b/.test(back)) {
    btn.hidden = false;
    btn.title = t('Back to where the key was needed');
    btn.addEventListener('click', () => { location.href = back; });
  }
  const need = String(q.get('need') || '').split(',').filter(k => byKey.has(k));
  need.forEach((k, i) => {
    const row = byKey.get(k);
    row.wrap.classList.add('is-needed');
    row.field.addEventListener('input', () => row.wrap.classList.remove('is-needed'), { once: true });
    if (!i) setTimeout(() => row.wrap.scrollIntoView({ block: 'center' }), 0);
  });
}

})();
