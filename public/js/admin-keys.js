/* admin-keys.js — the API keys, on the Keys tab of /admin.

   This used to be the "Brains" popup on Library, reachable by anyone signed in. Now that people
   sign in as themselves, a key is something only the admin should see or set, so the popup is
   gone and its rows live here. The server enforces the same line: /api/settings/reveal and any
   secret field in a POST answer 403 to a non-admin, whatever the page.

   Every field below is read by the server on a real request path, so an empty field is a
   feature that silently does not work.

   TWO KINDS OF ROW. A secret is a masked field with an eye; its value never travels with the
   settings load and is fetched only when the eye is pressed. A plain field (`plain: true`) is an
   identifier - an R2 account id, a bucket name - useless on its own and worth reading at a
   glance, so it arrives with the load and is shown as text. */

(function () {

const ROWS = [
  {
    label: 'kie.ai API:', settingsKey: 'kieApiKey',
    placeholder: 'kie_••• (kie.ai)',
    link: 'https://kie.ai/api-key', linkText: 'kie.ai/api-key',
    desc: 'Video / avatar generation and the balance counter. Image generation goes through Replicate.',
  },
  {
    label: 'OpenRouter API:', settingsKey: 'openRouterApiKey',
    placeholder: 'sk-or-v1-••• (openrouter.ai)',
    link: 'https://openrouter.ai/settings/keys', linkText: 'openrouter.ai → keys',
    desc: 'Primary text and vision analysis; replaces the kie.ai cascade for prompt engineering when set.',
  },
  {
    label: 'Replicate API:', settingsKey: 'replicateApiKey',
    placeholder: 'r8_••• (replicate.com)',
    link: 'https://replicate.com/account/api-tokens', linkText: 'replicate.com → API tokens',
    desc: 'Image generation: nano-banana-2, gpt-image-2, seedream-5-lite, qwen-image-edit-plus.',
  },
  {
    label: 'imgBB (image host):', settingsKey: 'imgbbApiKey',
    placeholder: '••• (api.imgbb.com)',
    link: 'https://api.imgbb.com/', linkText: 'api.imgbb.com',
    desc: 'Fallback host for the INPUT image on img2img (character sheets, edits) so Replicate and kie can fetch it.',
  },
  {
    label: 'ElevenLabs API:', settingsKey: 'elevenLabsApiKey',
    placeholder: 'sk_••• (elevenlabs.io)',
    link: 'https://elevenlabs.io/app/settings/api-keys', linkText: 'elevenlabs.io → API keys',
    desc: 'Speech synthesis (TTS) for scenes, and Voice Design.',
  },
  {
    label: 'Groq (Whisper STT):', settingsKey: 'groqApiKey',
    placeholder: 'gsk_••• (console.groq.com)',
    link: 'https://console.groq.com/keys', linkText: 'console.groq.com → API keys',
    desc: 'Speech-to-Text for subtitles. Model whisper-large-v3-turbo.',
  },
  {
    group: 'R2 · where reference images are hosted',
    label: 'R2 account ID:', settingsKey: 'r2AccountId', plain: true,
    placeholder: '32 hex characters (Cloudflare dashboard)',
    link: 'https://dash.cloudflare.com/?to=/:account/r2/api-tokens', linkText: 'dash.cloudflare.com → R2',
    desc: 'Every generated reference image is uploaded here so Replicate and kie can fetch it over https. Without R2 the providers refuse the image and generation fails.',
  },
  {
    label: 'R2 access key ID:', settingsKey: 'r2AccessKeyId', plain: true,
    placeholder: 'the ID half of the R2 API token',
  },
  {
    label: 'R2 secret key:', settingsKey: 'r2SecretAccessKey',
    placeholder: '••• (the secret half, shown once at creation)',
  },
  {
    label: 'R2 bucket:', settingsKey: 'r2Bucket', plain: true,
    placeholder: 'bucket name',
  },
  {
    label: 'R2 public base:', settingsKey: 'r2PublicBase', plain: true,
    placeholder: 'https://pub-••••.r2.dev  (optional)',
    desc: 'The bucket\'s own public address. Left empty, links are presigned instead — longer, and they expire, but nothing has to be switched on in the dashboard.',
  },
  {
    group: 'Facebook',
    label: 'FB access token:', settingsKey: 'fbAccessToken',
    placeholder: 'EAA••• (long-lived token)',
    desc: 'Set by the Facebook page\'s own connect flow; shown here so it can be checked or replaced. It is a secret like the rest and is never sent to the browser with the load.',
  },
];

// Values live in data/settings.json. R2 can also come from R2_* in .env - the way it was
// configured before there were fields for it - and the server says when that is the case, so an
// empty field here does not read as "not set up" on an install that works.

const $ = (id) => document.getElementById(id);

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
  field.type = r.plain ? 'text' : 'password';
  field.placeholder = r.placeholder || '';
  field.autocomplete = 'off';
  field.spellcheck = false;
  lbl.htmlFor = field.id = 'bk-' + r.settingsKey;
  line.appendChild(field);

  let eye = null;
  if (!r.plain) {
    eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'bk-eye';
    eye.textContent = '👁';
    eye.title = 'Show / hide';
    line.appendChild(eye);
  }
  wrap.appendChild(line);

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
    wrap.appendChild(d);
  }

  const row = {
    wrap, field, key: r.settingsKey, eye,
    plain: !!r.plain, revealedValue: null, loadedValue: '',
    hint: r.placeholder || '',
  };
  field.addEventListener('input', () => { row.revealedValue = null; });
  eye?.addEventListener('click', () => toggleReveal(row));
  return row;
}

const rows = ROWS.map(buildRow);
const byKey = new Map(rows.map(r => [r.key, r]));

// Saving is only allowed once the current values are known: if the load failed, every field is
// empty for a reason that has nothing to do with intent, and a save then would wipe the lot.
let _loaded = false;

function setStatus(text, kind) {
  const el = $('adm-keys-status');
  el.textContent = text || '';
  el.className = 'adm-status' + (kind ? ' ' + kind : '');
}

// A set secret shows as an empty field with a masked hint; typing replaces it, leaving it empty
// keeps whatever is stored.
function markSaved(row, preview) {
  row.field.value = '';
  row.field.type  = 'password';
  row.field.placeholder = (preview || '••••') + ' — saved (type to replace)';
  row.revealedValue = null;
  row.eye?.classList.remove('on');
}

async function toggleReveal(row) {
  const { field, eye, key } = row;
  if (field.type === 'text') {
    field.type = 'password';
    eye.classList.remove('on');
    if (row.revealedValue !== null && field.value === row.revealedValue) {
      field.value = '';                           // wipe the server-revealed value from the DOM
      row.revealedValue = null;
    }
    return;
  }
  if (field.value !== '') {
    field.type = 'text';
    eye.classList.add('on');
    return;
  }
  try {
    eye.disabled = true;
    const r = await fetch('/api/settings/reveal?key=' + encodeURIComponent(key));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d && d.success && d.value) {
      field.value = d.value;
      row.revealedValue = d.value;
      field.type = 'text';
      eye.classList.add('on');
    } else {
      setStatus('No key saved for this field.', '');
    }
  } catch (e) {
    setStatus('Could not reveal: ' + e.message, 'err');
  } finally {
    eye.disabled = false;
  }
}

async function load() {
  try {
    const d = await fetch('/api/settings').then(r => r.json());
    const set      = (d && d.secretsSet) || {};
    const preview  = (d && d.secretsPreview) || {};
    const settings = (d && d.settings) || {};
    const fromEnv  = (d && d.envFallback) || {};
    for (const [key, row] of byKey) {
      if (row.plain) {
        row.field.value = row.loadedValue = String(settings[key] ?? '');
        row.field.placeholder = (!row.field.value && fromEnv[key]) ? 'set in .env — type to override' : row.hint;
        continue;
      }
      if (set[key]) markSaved(row, preview[key]);
      else if (fromEnv[key]) row.field.placeholder = 'set in .env — type to override';
      else row.field.value = '';
    }
    _loaded = true;
    setStatus('');
  } catch (e) {
    setStatus('Could not read the current settings — saving is disabled so nothing gets overwritten. ' + e.message, 'err');
  }
}

async function save(btn) {
  if (!_loaded) { setStatus('Not saving: the current settings never loaded.', 'err'); return; }
  btn.disabled = true;
  const was = btn.textContent;
  btn.textContent = '⏳ Saving…';
  const payload = {};
  for (const [key, row] of byKey) {
    const v = row.field.value.trim();
    if (row.plain) {
      // An emptied identifier is an instruction, not an omission.
      if (v !== row.loadedValue) payload[key] = v;
      continue;
    }
    if (v && v !== row.revealedValue) payload[key] = v;
  }
  if (!Object.keys(payload).length) {
    setStatus('Nothing to change — type a key to replace it.', 'ok');
    btn.disabled = false; btn.textContent = was;
    return;
  }
  try {
    const r = await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || (d && d.success === false)) throw new Error((d && d.error) || ('HTTP ' + r.status));
    const preview = (d && d.secretsPreview) || {};
    for (const [key, row] of byKey) {
      if (!(key in payload)) continue;
      if (row.plain) { row.loadedValue = row.field.value.trim(); continue; }
      if (payload[key]) markSaved(row, preview[key]);
    }
    setStatus('Saved', 'ok');
  } catch (e) {
    setStatus('Not saved: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

// ── mount ─────────────────────────────────────────────────────────────────
const host = $('adm-keys');
if (host) {
  for (const row of rows) host.appendChild(row.wrap);
  $('adm-keys-save')?.addEventListener('click', (e) => save(e.currentTarget));
  load();
}

})();
