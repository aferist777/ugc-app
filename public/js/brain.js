/* brain.js — the API keys popup on the Library page, and only that.

   Brain used to be a popup on Birols holding four things: these keys, a CreationEngines section,
   a PROMPTS button and (once) a backup section. The other three are gone - the engine section
   wrote keys nothing read any more (the Character page has its own registry, b-roll params are
   edited in Birols' own popup), and the prompt editor had never once been used.

   What justifies keeping this one: every field below is read by the server on a real request
   path, so an empty field is a feature that silently does not work.

     kieApiKey  openRouterApiKey  replicateApiKey  imgbbApiKey
     elevenLabsApiKey  groqApiKey
     r2AccountId  r2AccessKeyId  r2SecretAccessKey  r2Bucket  r2PublicBase

   Persistence is its own: GET /api/settings fills the fields, POST /api/settings saves them.
   The collapsible group the old shell wrapped this in is gone - inside a popup that exists only
   to show these fields, a fold that hides all of them is a control with no use.

   TWO KINDS OF ROW AGAIN. Everything was a secret until R2 arrived, and R2 is five values of
   which only one is a credential: an account id, an access key id, a bucket name and a public
   base are identifiers, useless on their own and worth reading at a glance to check which
   bucket an install points at. Masking them would hide whether they are filled in correctly,
   so `plain: true` gets a text field with no eye, and its value does travel with the load. */

// Wrapped: this is a classic script sharing the page with app-nav.js and whatever comes next,
// and `load` / `save` / `rows` are exactly the names a future neighbour would also pick.
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
    desc: 'Fallback host for the INPUT image on img2img (character sheets, edits) so Replicate and kie can fetch it. Used when the own-server (PUBLIC_HOST_URL) upload is unavailable.',
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
];

// Values live in data/settings.json next to every other provider's, and lib/r2.js reads them
// from there first, falling back to R2_* in .env so an install configured before this popup
// existed keeps working with nothing changed.

// TWO SETTINGS ARE DELIBERATELY NOT HERE: openRouterTextModel (the model chain) and
// imgVisionModel (the vision model). They are still read on every request - see
// _getOpenRouterModelChain() and getImgVisionModel() in lib/helpers.js - and both fall back to a
// built-in default when unset, so removing the controls changed no behaviour. They are edited in
// data/settings.json when they need changing, which is roughly never; a model chain is not a
// setting you reach for while working, and it was the one field here long enough to make the
// popup look like a config screen rather than a place to paste a key.
//
// Nothing below sends them either: the save posts only the keys listed above, and POST
// /api/settings merges, so whatever they hold on the server survives untouched.

// Every row is a secret now, so there is one kind of row: masked input plus an eye. The select
// and plain-text branches that used to live here went with the two model settings - the only rows
// that ever used them.
function buildRow(r) {
  const wrap = document.createElement('div');
  wrap.className = 'bk-row';

  // A heading only where a group starts. It belongs to the row rather than sitting in its own
  // list so the rows stay one flat array that load and save can walk.
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

  // Nothing to reveal on a field that was never hidden.
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
    hint: r.placeholder || '',   // kept, because the .env notice overwrites the placeholder
  };
  // Typing replaces whatever was revealed/saved, so a later Save sends the new value.
  field.addEventListener('input', () => { row.revealedValue = null; });
  // 👁 reveals on demand — the value is fetched from the server only when asked (toggleReveal),
  // never shipped with the settings load.
  eye?.addEventListener('click', () => toggleReveal(row));
  return row;
}

const rows = ROWS.map(buildRow);
const byKey = new Map(rows.map(r => [r.key, r]));

// CLEARING A KEY HAS TO BE POSSIBLE, and that is why this flag exists. The popup only ever sent
// non-empty fields, so a mistyped key could be replaced but never removed. Sending empties is
// safe only once the current values are known: if the load failed, every field is empty for a
// reason that has nothing to do with intent, and saving then would wipe all eight.
let _loaded = false;

const statusEl = () => document.getElementById('brain-status');
function setStatus(text, kind) {
  const el = statusEl();
  if (!el) return;
  el.textContent = text || '';
  el.className = 'brain-status' + (kind ? ' ' + kind : '');
}

// The server no longer sends key VALUES (see routes/settings.js) — only which keys are set
// and a masked hint. So a set key shows as an empty field with a "•••1234 — saved" placeholder;
// typing into it replaces the key, leaving it empty keeps whatever is stored.
function markSaved(row, preview) {
  row.field.value = '';
  row.field.type  = 'password';
  row.field.placeholder = (preview || '••••') + ' — saved (type to replace)';
  row.revealedValue = null;
  row.eye?.classList.remove('on');
}

// 👁 handler: show a field's value, fetching a saved key from the server on demand. The value
// travels to the browser only at this click, never with the settings load.
async function toggleReveal(row) {
  const { field, eye, key } = row;
  if (field.type === 'text') {                    // currently shown → hide
    field.type = 'password';
    eye.classList.remove('on');
    if (row.revealedValue !== null && field.value === row.revealedValue) {
      field.value = '';                           // wipe the server-revealed value from the DOM
      row.revealedValue = null;
    }
    return;
  }
  if (field.value !== '') {                        // user typed something → just show it
    field.type = 'text';
    eye.classList.add('on');
    return;
  }
  try {                                            // empty + saved → fetch the real value once
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
    setStatus('Could not reveal (session may have expired — reload to sign in). ' + e.message, 'err');
  } finally {
    eye.disabled = false;
  }
}

async function load() {
  try {
    const d = await fetch('/api/settings').then(r => r.json());
    const set     = (d && d.secretsSet) || {};
    const preview = (d && d.secretsPreview) || {};
    const settings = (d && d.settings) || {};
    const fromEnv  = (d && d.envFallback) || {};
    for (const [key, row] of byKey) {
      if (row.plain) {
        // Not a secret, so the value came with the load. Remembered as well as shown, because
        // save has to tell "left alone" apart from "deliberately emptied".
        row.field.value = row.loadedValue = String(settings[key] ?? '');
        // Empty here does not mean unconfigured if the environment is covering it.
        row.field.placeholder = (!row.field.value && fromEnv[key])
          ? 'set in .env — type to override'
          : row.hint;
        continue;
      }
      if (set[key]) markSaved(row, preview[key]);
      else if (fromEnv[key]) row.field.placeholder = 'set in .env — type to override';
      else row.field.value = ''; // unset: keep the original hint placeholder from buildRow
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
  // Send only the fields the user actually typed. Values no longer reach the browser, so an
  // empty field means "keep the saved key", not "clear it".
  const payload = {};
  for (const [key, row] of byKey) {
    const v = row.field.value.trim();
    if (row.plain) {
      // An emptied identifier is an instruction, not an omission: the field showed its real
      // value, so clearing it can only mean clearing it.
      if (v !== row.loadedValue) payload[key] = v;
      continue;
    }
    // A value equal to what we just revealed is unchanged — don't resend it.
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
    // Reset each just-saved field to its masked "saved" state, from the view the server returned.
    const preview = (d && d.secretsPreview) || {};
    for (const [key, row] of byKey) {
      if (!(key in payload)) continue;
      if (row.plain) { row.loadedValue = row.field.value.trim(); continue; }
      if (payload[key]) markSaved(row, preview[key]);
    }
    setStatus('Saved', 'ok');
    try { window.refreshBalance?.(); } catch (e) {}
  } catch (e) {
    setStatus('Not saved: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

// ── The popup ───────────────────────────────────────────────────────────────
// Built on first open, not at load: eight rows and a GET of the settings are pointless work for
// the many visits to Library that never touch a key. After that it stays built, so reopening is
// instant and a half-typed key survives a close.
let _built = false;

function openPopup() {
  const ov = document.getElementById('brain-ov');
  const host = document.getElementById('brain-keys');
  if (!ov || !host) { console.error('[brain] popup markup is missing'); return; }
  if (!_built) {
    host.innerHTML = '';
    for (const row of rows) host.appendChild(row.wrap);
    document.getElementById('brain-save')?.addEventListener('click', (e) => save(e.currentTarget));
    _built = true;
    load();
  }
  ov.hidden = false;
  // Focus the first empty field, or the first field if all are filled: on a page of secrets the
  // useful cursor position is the thing not yet answered.
  const first = rows.find(r => !r.field.value) || rows[0];
  setTimeout(() => { try { first.field.focus(); } catch (e) {} }, 0);
}

function closePopup() {
  const ov = document.getElementById('brain-ov');
  if (ov) ov.hidden = true;
}

(function wire() {
  document.getElementById('btn-open-brain')?.addEventListener('click', openPopup);
  document.getElementById('brain-close')?.addEventListener('click', closePopup);
  // The gear opens Import / Export ON TOP of this, deliberately: Brains is not dismissed,
  // so closing the other one puts you back where you were rather than nowhere.
  document.getElementById('brain-io')?.addEventListener('click', () => window.openDataIO?.());
  // The scrim closes, the panel does not: a click that started inside must not fall through.
  document.getElementById('brain-ov')?.addEventListener('click', (e) => {
    if (e.target.id === 'brain-ov') closePopup();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const ov = document.getElementById('brain-ov');
    if (ov && !ov.hidden) { closePopup(); e.stopPropagation(); }
  });
})();

})();
