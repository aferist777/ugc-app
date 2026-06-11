// Facebook Marketing/Graph API proxy — keeps the access token server-side
// (data/settings.json, gitignored) and never exposes it to the browser. Powers
// the /facebook stats-explorer page. Read-only insights + a generic GET passthrough
// for experimentation; creative upload is a separate (ads_management) concern.
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
const GRAPH         = 'https://graph.facebook.com';
const DEFAULT_VER   = 'v21.0';

function loadSettings() { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; } }
function saveSettings(obj) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}
function _cfg() {
  const s = loadSettings();
  return {
    token:     String(s.fbAccessToken || '').trim(),
    version:   String(s.fbApiVersion || DEFAULT_VER).trim() || DEFAULT_VER,
    appId:     String(s.fbAppId || '').trim(),
    appSecret: String(s.fbAppSecret || '').trim(),
    expiresAt: s.fbTokenExpiresAt || null,   // ms epoch, null = never/unknown
  };
}
function _mask(t) { return !t ? '' : (t.length <= 12 ? '****' : t.slice(0, 6) + '...' + t.slice(-4)); }

// Read a token's expiry via /debug_token (needs an app token = appId|appSecret).
// Returns ms-epoch expiry, null for "never", or undefined when it can't be read.
async function _debugExpiry(token) {
  const { version, appId, appSecret } = _cfg();
  if (!appId || !appSecret) return undefined;
  try {
    const res = await axios.get(`${GRAPH}/${version}/debug_token`, {
      params: { input_token: token, access_token: `${appId}|${appSecret}` }, timeout: 20000,
    });
    const ea = res.data && res.data.data && res.data.data.expires_at;
    if (ea === 0) return null;                 // never expires
    return ea ? ea * 1000 : undefined;
  } catch { return undefined; }
}

async function graphGet(p, params) {
  const { token, version } = _cfg();
  if (!token) { const e = new Error('No Facebook token saved — paste one above first'); e.status = 400; throw e; }
  const clean = String(p || '').replace(/^\/+/, '');
  if (/^https?:|:\/\//i.test(clean)) { const e = new Error('path must be a Graph path, not a full URL'); e.status = 400; throw e; }
  const res = await axios.get(`${GRAPH}/${version}/${clean}`, {
    params: Object.assign({ access_token: token }, params || {}),
    timeout: 30000,
  });
  return res.data;
}
function _fbErr(res, e) {
  const fb = e.response && e.response.data && e.response.data.error;
  if (fb) return res.status(e.response.status || 400).json({ success: false, error: fb.message, fb });
  return res.status(e.status || 500).json({ success: false, error: e.message });
}

// ── Save / inspect the token ──────────────────────────────────────────────────
router.post('/fb/token', async (req, res) => {
  const token   = String((req.body && req.body.token)   || '').trim();
  const version = String((req.body && req.body.version) || '').trim();
  if (!token) return res.status(400).json({ success: false, error: 'token required' });
  const s = loadSettings();
  s.fbAccessToken = token;
  if (version) s.fbApiVersion = version;
  saveSettings(s);
  const exp = await _debugExpiry(token);          // undefined when no app creds / unreadable
  if (exp !== undefined) { s.fbTokenExpiresAt = exp; saveSettings(s); }
  res.json({ success: true, masked: _mask(token), version: version || _cfg().version, expiresAt: _cfg().expiresAt });
});

// Save the app id + secret (needed to renew and to read token expiry). Stored
// server-side only — the secret is never returned to the browser.
router.post('/fb/app', (req, res) => {
  const appId     = String((req.body && req.body.appId)     || '').trim();
  const appSecret = String((req.body && req.body.appSecret) || '').trim();
  const s = loadSettings();
  if (appId)     s.fbAppId     = appId;
  if (appSecret) s.fbAppSecret = appSecret;
  saveSettings(s);
  res.json({ success: true, appId: s.fbAppId || '', hasSecret: !!s.fbAppSecret });
});

// Renew: exchange the current token for a fresh long-lived (~60d) one.
router.post('/fb/renew', async (_req, res) => {
  const { token, version, appId, appSecret } = _cfg();
  if (!token) return res.status(400).json({ success: false, error: 'No token to renew' });
  if (!appId || !appSecret) return res.status(400).json({ success: false, error: 'App ID + App Secret required to renew (save them above)' });
  try {
    const r = await axios.get(`${GRAPH}/${version}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token }, timeout: 25000,
    });
    const nt = r.data && r.data.access_token;
    if (!nt) throw new Error('No access_token in the exchange response');
    const s = loadSettings();
    s.fbAccessToken = nt;
    const expiresIn = r.data.expires_in;          // seconds; absent => never/long-lived
    let exp = expiresIn ? (Date.now() + (+expiresIn) * 1000) : await _debugExpiry(nt);
    if (exp === undefined) exp = null;
    s.fbTokenExpiresAt = exp;
    saveSettings(s);
    res.json({ success: true, masked: _mask(nt), expiresAt: exp });
  } catch (e) { _fbErr(res, e); }
});

router.get('/fb/status', (_req, res) => {
  const { token, version, appId, appSecret, expiresAt } = _cfg();
  res.json({ success: true, hasToken: !!token, masked: _mask(token), version, appId, hasSecret: !!appSecret, expiresAt });
});

// Validate the token: who it belongs to + granted permissions.
router.get('/fb/validate', async (_req, res) => {
  try {
    const me = await graphGet('me', { fields: 'id,name' });
    let permissions = null;
    try { const p = await graphGet('me/permissions'); permissions = (p.data || []).filter(x => x.status === 'granted').map(x => x.permission); } catch {}
    res.json({ success: true, me, permissions });
  } catch (e) { _fbErr(res, e); }
});

// ── Ad accounts the token can see ───────────────────────────────────────────────
router.get('/fb/accounts', async (_req, res) => {
  try {
    const d = await graphGet('me/adaccounts', { fields: 'name,account_id,account_status,currency,amount_spent', limit: 200 });
    res.json({ success: true, accounts: d.data || [], paging: d.paging || null });
  } catch (e) { _fbErr(res, e); }
});

// ── Per-ad creatives + insights for one account ────────────────────────────────
router.get('/fb/creatives', async (req, res) => {
  const account = String(req.query.account || '').trim();
  if (!account) return res.status(400).json({ success: false, error: 'account required (act_...)' });
  const datePreset = String(req.query.date_preset || 'last_30d').trim();
  const insFields  = 'spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,' +
    'video_play_actions,video_avg_time_watched_actions,video_thruplay_watched_actions,' +
    'video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions,video_p100_watched_actions';
  const fields     = `name,effective_status,creative{thumbnail_url,image_url,object_story_spec},insights.date_preset(${datePreset}){${insFields}}`;
  const _av = (arr) => (Array.isArray(arr) && arr[0] && arr[0].value != null ? +arr[0].value : 0);
  try {
    const d = await graphGet(`${account}/ads`, { fields, limit: 200 });
    const ads = (d.data || []).map(a => {
      const ins = (a.insights && a.insights.data && a.insights.data[0]) || {};
      const cr  = a.creative || {};
      return {
        id: a.id, name: a.name || '(no name)', status: a.effective_status || '',
        thumb: cr.thumbnail_url || cr.image_url || null,
        spend: +ins.spend || 0, impressions: +ins.impressions || 0, reach: +ins.reach || 0,
        clicks: +ins.clicks || 0, ctr: +ins.ctr || 0, cpc: +ins.cpc || 0, cpm: +ins.cpm || 0,
        frequency: +ins.frequency || 0, actions: ins.actions || [],
        // Video retention (for drop-off analysis)
        videoPlays: _av(ins.video_play_actions),
        avgWatch:   _av(ins.video_avg_time_watched_actions),   // average seconds watched
        thruplays:  _av(ins.video_thruplay_watched_actions),
        p25: _av(ins.video_p25_watched_actions), p50: _av(ins.video_p50_watched_actions),
        p75: _av(ins.video_p75_watched_actions), p95: _av(ins.video_p95_watched_actions),
        p100: _av(ins.video_p100_watched_actions),
      };
    });
    res.json({ success: true, ads, count: ads.length, paging: d.paging || null });
  } catch (e) { _fbErr(res, e); }
});

// ── Generic GET passthrough (for experimentation) ──────────────────────────────
// e.g. /api/fb/graph?path=me/adaccounts&fields=name,account_id
router.get('/fb/graph', async (req, res) => {
  const p = String(req.query.path || '').trim();
  if (!p) return res.status(400).json({ success: false, error: 'path required' });
  const params = Object.assign({}, req.query);
  delete params.path;
  try { const d = await graphGet(p, params); res.json({ success: true, data: d }); }
  catch (e) { _fbErr(res, e); }
});

module.exports = router;
