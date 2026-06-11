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
  return { token: String(s.fbAccessToken || '').trim(), version: String(s.fbApiVersion || DEFAULT_VER).trim() || DEFAULT_VER };
}
function _mask(t) { return !t ? '' : (t.length <= 12 ? '****' : t.slice(0, 6) + '...' + t.slice(-4)); }

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
router.post('/fb/token', (req, res) => {
  const token   = String((req.body && req.body.token)   || '').trim();
  const version = String((req.body && req.body.version) || '').trim();
  if (!token) return res.status(400).json({ success: false, error: 'token required' });
  const s = loadSettings();
  s.fbAccessToken = token;
  if (version) s.fbApiVersion = version;
  saveSettings(s);
  res.json({ success: true, masked: _mask(token), version: version || _cfg().version });
});

router.get('/fb/status', (_req, res) => {
  const { token, version } = _cfg();
  res.json({ success: true, hasToken: !!token, masked: _mask(token), version });
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
  const insFields  = 'spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions';
  const fields     = `name,effective_status,creative{thumbnail_url,image_url,object_story_spec},insights.date_preset(${datePreset}){${insFields}}`;
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
