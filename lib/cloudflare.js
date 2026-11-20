'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ONE CLOUDFLARE KEY - an API token made from Cloudflare's template "Edit Cloudflare Workers": the only way R2 is
// set up, and the Telegram receiver's.
//
// THE CHECK, step by step - each step said on Admin in green or red, the last result kept in cache/cloudflare/check.json:
//   key      GET /user/tokens/verify - alive, and its id (an account's own token: /accounts/{id}/tokens/verify)
//   account  GET /accounts - the account R2 is set up with already when the key sees it, else the only one (or the first)
//   bucket   GET /accounts/{id}/r2/buckets - the bucket set up already when it is there, else "ugc-studio", made when
//            missing (POST) - a new Cloudflare account gets its bucket by itself; R2 not turned on
//            in the account is said in words: that one step is the person's, in the dashboard
//   upload   a little file put up with the PAIR made from the key (lib/r2.js pairOf: the token's id and the SHA-256 of its
//            value - Cloudflare's R2 docs), read back by its link as kie.ai would read it, and taken down again
// All four green: the key's id, the account and the bucket are written into the settings, and whatever a library still
// holds of the R2 fields of older versions is wiped - from then on lib/r2.js speaks to R2 with the key. A
// step red: nothing changes.
//
// A KEY REPLACED OR REMOVED drops `cloudflareTokenId` (routes/settings.js): a new key is used for R2 only once IT has
// passed.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { CACHE_DIR } = require('./config');
const { getSettings, updateSettings } = require('./settings-io');
const { writeFileAtomic } = require('./atomic-write');
const R2 = require('./r2');
const I18N = require('./i18n');

let API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT = 20000;
const BUCKET = 'ugc-studio';
const CHECK_FILE = path.join(CACHE_DIR, 'cloudflare', 'check.json');
// The words for R2 not turned on in the account (Cloudflare answers code 10042 "Please enable R2 through the Cloudflare
// Dashboard").
// Turning it on asks for a payment card, even within the free allowance.
const _r2Off = () => I18N.t('R2 is not turned on in this Cloudflare account - open R2 Object Storage in the Cloudflare dashboard, turn it on once (Cloudflare asks for a payment card for it, even within the free allowance), then press "check" here');

const token = () => String(getSettings().cloudflareApiToken || '').trim();

// What Cloudflare said, from its envelope: { success:false, errors:[{ code, message }] }.
function _why(e) {
  const d = e && e.response && e.response.data;
  const errs = (d && Array.isArray(d.errors)) ? d.errors : [];
  const st = e && e.response && e.response.status;
  if (errs.length) return { code: Number(errs[0].code) || 0, status: st || 0, words: errs.map(x => x.message).filter(Boolean).join('; ').slice(0, 200) };
  return { code: 0, status: st || 0, words: String((e && e.message) || I18N.t('no answer')).slice(0, 200) };
}

async function _get(url, tok) {
  const r = await axios.get(API + url, { headers: { Authorization: 'Bearer ' + tok }, timeout: TIMEOUT });
  return r.data && r.data.result;
}

/** The key alive, and its id. An account's own token (cfat_) is verified under its account. */
async function verify(tok, accountId) {
  try {
    const res = await _get('/user/tokens/verify', tok);
    if (!res || res.status !== 'active') {
      throw Object.assign(new Error(res && res.status ? I18N.t('the key is {status}', { status: res.status }) : I18N.t('the key is not active')), { soft: true });
    }
    return { id: String(res.id || ''), status: res.status };
  } catch (e) {
    if (e.soft) throw e;
    if (accountId) {
      try {
        const res = await _get('/accounts/' + encodeURIComponent(accountId) + '/tokens/verify', tok);
        if (res && res.status === 'active') return { id: String(res.id || ''), status: res.status };
      } catch (e2) { /* the user's verdict is the one to say */ }
    }
    const w = _why(e);
    const refused = w.words ? I18N.t('Cloudflare refused this key ({why})', { why: w.words }) : I18N.t('Cloudflare refused this key');
    throw new Error(w.status === 401 || w.status === 403 ? refused : w.words);
  }
}

// keys-health's probe: one free question.
async function probe(tok) {
  await verify(tok, String(getSettings().r2AccountId || '').trim());
  const v = view();
  return v.inUse ? I18N.t('active · R2: {bucket}', { bucket: v.bucket }) : I18N.t('active');
}

let _checking = null;

function lastCheck() {
  try { return JSON.parse(fs.readFileSync(CHECK_FILE, 'utf8')); } catch (e) { return null; }
}

function _keep(c) {
  try { fs.mkdirSync(path.dirname(CHECK_FILE), { recursive: true }); writeFileAtomic(CHECK_FILE, JSON.stringify(c, null, 2)); }
  catch (e) { console.warn('[cloudflare] could not keep the check:', e.message); }
}

/** The check, step by step. Resolves to { at, ok, steps: [{ id, ok, words }] } - never throws. */
function check() {
  if (_checking) return _checking;
  _checking = _check().finally(() => { _checking = null; });
  return _checking;
}

async function _check() {
  const s = getSettings();
  const tok = token();
  const known = { account: String(s.r2AccountId || '').trim(), bucket: String(s.r2Bucket || '').trim() };
  const steps = [];
  // The account and the bucket found - Admin links them in Cloudflare's dashboard.
  const found = { account: '', bucket: '' };
  const done = (ok) => {
    const c = { at: new Date().toISOString(), ok, steps, tokenTail: tok.slice(-4), account: found.account, bucket: found.bucket };
    _keep(c);
    return c;
  };
  const fail = (id, words) => { steps.push({ id, ok: false, words }); return done(false); };
  if (!tok) return fail('key', I18N.t('no key'));

  // 1. the key
  let tokenId = '';
  try { tokenId = (await verify(tok, known.account)).id; }
  catch (e) { return fail('key', e.message); }
  if (!tokenId) return fail('key', I18N.t('Cloudflare did not say the key\'s id'));
  steps.push({ id: 'key', ok: true, words: I18N.t('active') });

  // 2. the account
  let account = null;
  let listErr = null;
  try {
    const list = (await _get('/accounts?per_page=50', tok)) || [];
    account = list.find(a => a && a.id === known.account) || list[0] || null;
    if (account && list.length > 1 && account.id !== known.account) {
      steps.push({ id: 'account', ok: true, words: I18N.t('{name} (the first of {n} accounts this key sees)', { name: account.name || account.id, n: list.length }) });
    } else if (account) {
      steps.push({ id: 'account', ok: true, words: account.name || account.id });
    }
  } catch (e) { listErr = _why(e); /* said below, unless the account is known already */ }
  if (!account) {
    if (!known.account) {
      // A list that did not come is not an empty one (a poor connection must not read as "no account").
      if (listErr && !listErr.status) return fail('account', I18N.t('no answer from Cloudflare - check the connection and press "check" again ({why})', { why: listErr.words }));
      if (listErr) return fail('account', I18N.t('Cloudflare refused the list of accounts: {why}', { why: listErr.words }));
      return fail('account', I18N.t('the key sees no account - in Cloudflare open this token (My Profile -> API Tokens) and set Account Resources: Include -> your account; or make it again from the template "Edit Cloudflare Workers"'));
    }
    account = { id: known.account, name: '' };
    steps.push({ id: 'account', ok: true, words: I18N.t('the account set up already (the key cannot list accounts)') });
  }
  found.account = account.id;

  // 3. the bucket
  let bucket = '';
  let made = false;
  try {
    const res = (await _get('/accounts/' + encodeURIComponent(account.id) + '/r2/buckets?per_page=1000', tok)) || {};
    const names = (Array.isArray(res.buckets) ? res.buckets : []).map(b => b && b.name).filter(Boolean);
    if (known.bucket && names.includes(known.bucket)) bucket = known.bucket;
    else if (names.includes(BUCKET)) bucket = BUCKET;
    else {
      await axios.post(API + '/accounts/' + encodeURIComponent(account.id) + '/r2/buckets', { name: BUCKET },
        { headers: { Authorization: 'Bearer ' + tok }, timeout: TIMEOUT });
      bucket = BUCKET;
      made = true;
    }
  } catch (e) {
    const w = _why(e);
    if (w.code === 10042 || /enable r2/i.test(w.words)) return fail('bucket', _r2Off());
    return fail('bucket', w.status === 401 || w.status === 403 ? I18N.t('the key may not read R2 buckets - {why}', { why: w.words }) : w.words);
  }
  steps.push({ id: 'bucket', ok: true, words: made ? I18N.t('{bucket} (made now)', { bucket })
    : bucket === known.bucket ? I18N.t('{bucket} (the one set up already)', { bucket }) : bucket });
  found.bucket = bucket;

  // 4. a little file up, read back by its link, and down again - with the pair made from the key
  const over = { account: account.id, bucket, ...R2.pairOf(tok, tokenId) };
  const key = `ugc-check/${Date.now()}_${crypto.randomBytes(3).toString('hex')}.txt`;
  const body = Buffer.from('UGC Studio checks its Cloudflare key ' + new Date().toISOString());
  try {
    const link = await R2.putObject(body, key, 'text/plain', over);
    const r = await axios.get(link, { responseType: 'arraybuffer', timeout: TIMEOUT });
    if (!Buffer.from(r.data).equals(body)) throw new Error(I18N.t('the file read back is not the one put up'));
  } catch (e) {
    const st = e && e.response && e.response.status;
    // A key that is R2's already (it passed before) goes on being used; a new one is not R2's until it passes.
    const wasR2s = String(s.cloudflareTokenId || '').trim() === tokenId;
    const why = st === 401 || st === 403 ? I18N.t('R2 refused the pair made from this key ({status})', { status: st }) : _why(e).words;
    return fail('upload', wasR2s ? I18N.t('{why} - uploads to R2 may fail until the key passes again', { why })
      : I18N.t('{why} - there is no R2 until the key passes', { why }));
  }
  try { await R2.deleteObject(key, over); } catch (e) { /* a few bytes left in ugc-check/ - harmless */ }
  steps.push({ id: 'upload', ok: true, words: I18N.t('a file put up, read back by its link and taken down') });

  // All four: the key is R2's from now on, and what is left of the R2 fields of older versions goes.
  updateSettings((cur) => {
    if (String(cur.cloudflareApiToken || '').trim() !== tok) return;   // replaced while this ran
    cur.cloudflareTokenId = tokenId;
    cur.r2AccountId = account.id;
    cur.r2Bucket = bucket;
    delete cur.r2AccessKeyId;
    delete cur.r2SecretAccessKey;
    delete cur.r2PublicBase;
  });
  return done(true);
}

// One call of the REST API with the key, for the Telegram receiver (lib/tg-receiver.js): the `result`, or an
// Error carrying Cloudflare's own code and words. `body` a FormData is sent as it is (a Worker's script and its metadata).
async function api(method, url, body) {
  const tok = token();
  if (!tok) throw new Error(I18N.t('no Cloudflare key on Admin -> API keys'));
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  const r = await fetch(API + url, {
    method,
    headers: { Authorization: 'Bearer ' + tok, ...(body && !form ? { 'content-type': 'application/json' } : {}) },
    body: body == null ? undefined : (form ? body : JSON.stringify(body)),
    signal: AbortSignal.timeout(60000),
  });
  let d = null;
  try { d = await r.json(); } catch (e) { d = null; }
  if (!r.ok || !d || d.success === false) {
    const errs = (d && Array.isArray(d.errors)) ? d.errors : [];
    const err = new Error(errs.map(x => x.message).filter(Boolean).join('; ') || ('HTTP ' + r.status));
    err.code = errs.length ? Number(errs[0].code) || 0 : 0;
    err.status = r.status;
    throw err;
  }
  return d.result;
}

/** Admin's view: whether a key is set, whether it is R2's now, and the last check. */
function view() {
  const s = getSettings();
  const c = lastCheck();
  const tok = token();
  return {
    tokenSet: !!tok,
    inUse: !!(tok && String(s.cloudflareTokenId || '').trim()),
    account: String(s.r2AccountId || ''), bucket: String(s.r2Bucket || ''),
    checking: !!_checking,
    // A check of another key (replaced since) is not this key's.
    check: c && tok && c.tokenTail === tok.slice(-4) ? { at: c.at, ok: c.ok, steps: c.steps, account: c.account || '', bucket: c.bucket || '' } : null,
  };
}

function _setApi(base) { API = String(base).replace(/\/+$/, ''); }

module.exports = { check, verify, probe, view, lastCheck, api, BUCKET, _setApi };
