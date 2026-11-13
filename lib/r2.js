// Cloudflare R2, spoken to directly over the S3 API.
//
// WHY BY HAND. Two operations are needed here - put one object, hand out a link to it - and
// the AWS SDK is tens of megabytes of client for that. Signing is forty lines of crypto that
// is already in Node. Every other host in helpers.js is one small function too; this one is
// longer only because S3 makes you prove who you are on every request.
//
// TWO KINDS OF ADDRESS, and mixing them up is the thing to get right. The endpoint the
// credentials open - <account>.r2.cloudflarestorage.com - is for US: every request to it must
// be signed, and an unsigned GET is refused. The renderers fetch anonymously and cannot sign
// anything, so they are handed a PRESIGNED link: the same S3 endpoint with the signature carried
// in the query string, which anyone holding the link can read until it expires. Long and ugly,
// but it needs nothing switched on in the dashboard, so it works the moment the key has passed
// its check. It is https, on port 443, at a real hostname - which is the whole argument for
// being here at all.
const crypto = require('crypto');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

const REGION  = 'auto';          // R2 has no regions; the signature still demands one
const SERVICE = 's3';
const ALGO    = 'AWS4-HMAC-SHA256';

const SETTINGS_FILE = path.join(require('./config').DATA_DIR, 'settings.json');

// WHERE THE VALUES COME FROM: data/settings.json, where Admin -> API keys and the Cloudflare key's
// check (lib/cloudflare.js) write them. Read fresh each time rather than cached: a key is saved while
// the process is running, and a cached blank would mean a restart before the new key took. It is a
// 5 KB file read on the upload path only, which already spends a network round trip.
function fromSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; }
  catch { return {}; }
}

// ONE CLOUDFLARE KEY (phase TG, the owner 2026-10-21: "хочу решить вопрос одним ключом"). R2's S3 keys are made from a
// Cloudflare API token - the Access Key ID is the token's id, the Secret Access Key the SHA-256 of its value (Cloudflare's
// R2 docs, "API tokens") - so one token with R2 rights is the whole pair. It is used once lib/cloudflare.js has checked it
// end to end (`cloudflareTokenId` written - the token's id - with the account and the bucket it found); until then R2 is
// not configured. It is the only way in: no fields of its own on Admin, nothing from .env.
function pairOf(token, tokenId) {
  return { key: String(tokenId || '').trim(), secret: crypto.createHash('sha256').update(String(token || '').trim()).digest('hex') };
}

// A day is long enough for any render to start, and short enough that a link that leaks stops working on its own.
const LINK_TTL = 86400;

// The account and the bucket the check found, and the pair made from the key that passed it.
function cfg() {
  const s = fromSettings();
  const pick = (v) => String(v || '').trim();
  const token = pick(s.cloudflareApiToken);
  const tokenId = pick(s.cloudflareTokenId);
  const pair = token && tokenId ? pairOf(token, tokenId) : null;
  return {
    account: pick(s.r2AccountId),
    key:     pair ? pair.key : '',
    secret:  pair ? pair.secret : '',
    bucket:  pick(s.r2Bucket),
  };
}

// `over` (lib/cloudflare.js's check): the pair, account and bucket to try BEFORE any of them is written down.
const _cfgOf = (over) => (over ? { ...cfg(), ...over } : cfg());

const isConfigured = (over) => {
  const c = _cfgOf(over);
  return !!(c.account && c.key && c.secret && c.bucket);
};

const _sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const _hmac   = (k, s) => crypto.createHmac('sha256', k).update(s, 'utf8').digest();

// S3 wants RFC 3986, which encodeURIComponent very nearly gives: these five it leaves alone
// and the signature would not match.
const _enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
  '%' + c.charCodeAt(0).toString(16).toUpperCase());

// The path is encoded segment by segment - the slashes between them are structure, not data.
const _encPath = (p) => String(p).split('/').map(_enc).join('/');

function _stamp() {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');   // 20260821T104500Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function _signingKey(secret, dateStamp) {
  return _hmac(_hmac(_hmac(_hmac('AWS4' + secret, dateStamp), REGION), SERVICE), 'aws4_request');
}

function _sign(stringToSign, secret, dateStamp) {
  return crypto.createHmac('sha256', _signingKey(secret, dateStamp)).update(stringToSign, 'utf8').digest('hex');
}

// Where the S3 endpoint is: R2's own, or - for a check on this computer with no Cloudflare (a stand) - what
// _setEndpoint said, `(c) => ({ origin: 'http://127.0.0.1:3113', host: '127.0.0.1:3113' })`.
let _endpoint = null;
const _host = (c) => (_endpoint ? _endpoint(c).host : `${c.account}.r2.cloudflarestorage.com`);
const _origin = (c) => (_endpoint ? _endpoint(c).origin : `https://${_host(c)}`);
const _uri  = (c, key) => `/${_enc(c.bucket)}/${_encPath(key)}`;

/** A link a renderer can fetch with no credentials of its own: a presigned GET. */
function linkFor(key, ttlSeconds, over) {
  const c = _cfgOf(over);
  const host = _host(c);
  const uri  = _uri(c, key);
  const { amzDate, dateStamp } = _stamp();
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  // Sorted by name, because the canonical query string is defined that way and an
  // out-of-order pair produces a signature that is simply wrong.
  const params = [
    ['X-Amz-Algorithm',     ALGO],
    ['X-Amz-Credential',    `${c.key}/${scope}`],
    ['X-Amz-Date',          amzDate],
    ['X-Amz-Expires',       String(Math.max(60, Number(ttlSeconds || LINK_TTL)))],
    ['X-Amz-SignedHeaders', 'host'],
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const query = params.map(([k, v]) => `${_enc(k)}=${_enc(v)}`).join('&');

  // UNSIGNED-PAYLOAD: there is no body on a GET, and the reader could not hash one anyway.
  const canonical = ['GET', uri, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign    = [ALGO, amzDate, scope, _sha256(canonical)].join('\n');
  const signature = _sign(toSign, c.secret, dateStamp);

  return `${_origin(c)}${uri}?${query}&X-Amz-Signature=${signature}`;
}

// The headers of a signed request with no body (a GET, a DELETE): what putObject signs, for an empty payload. `query`
// is the canonical query string - its pairs sorted by name and encoded - or ''.
function _signedHeaders(c, method, uri, query = '') {
  const host = _host(c);
  const payloadHash = _sha256('');
  const { amzDate, dateStamp } = _stamp();
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [method, uri, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const toSign = [ALGO, amzDate, scope, _sha256(canonical)].join('\n');
  const signature = _sign(toSign, c.secret, dateStamp);
  return { ...headers, Authorization: `${ALGO} Credential=${c.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

/** One object gone (lib/cloudflare.js's check takes back the little file it put up). Free at Cloudflare. */
async function deleteObject(key, over) {
  const c = _cfgOf(over);
  if (!isConfigured(over)) throw new Error('r2: not configured');
  const uri = _uri(c, key);
  await axios.delete(`${_origin(c)}${uri}`, { headers: _signedHeaders(c, 'DELETE', uri), timeout: 30000 });
}

// (phase TG, block 2) What the Telegram receiver left in the bucket: the names under `prefix` (ListObjectsV2, at most a
// thousand - the receiver's folder is emptied every few seconds), and one object's bytes.
async function listObjects(prefix, over) {
  const c = _cfgOf(over);
  if (!isConfigured(over)) throw new Error('r2: not configured');
  const uri = `/${_enc(c.bucket)}`;
  const query = [['list-type', '2'], ['max-keys', '1000'], ['prefix', String(prefix || '')]]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${_enc(k)}=${_enc(v)}`).join('&');
  const r = await axios.get(`${_origin(c)}${uri}?${query}`, { headers: _signedHeaders(c, 'GET', uri, query), timeout: 30000, responseType: 'text' });
  const keys = [];
  const re = /<Key>([^<]*)<\/Key>/g;
  let m;
  while ((m = re.exec(String(r.data || '')))) {
    keys.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  return keys;
}

async function getObject(key, over) {
  const c = _cfgOf(over);
  if (!isConfigured(over)) throw new Error('r2: not configured');
  const uri = _uri(c, key);
  const r = await axios.get(`${_origin(c)}${uri}`, { headers: _signedHeaders(c, 'GET', uri), timeout: 30000, responseType: 'arraybuffer' });
  return Buffer.from(r.data);
}

/**
 * Store one object and answer with the link a renderer can read it by.
 * contentType matters: a renderer that is handed application/octet-stream where it expected
 * an image tends to refuse it, and R2 serves back exactly what it was told on the way in.
 */
//
// (phase V23) `body` is a Buffer, or { path, size } - a FILE, sent as a stream: a clip of the video chat is up to a
// hundred megabytes and was read whole into memory to be sent. A stream cannot be hashed before it is sent, so its
// signature says UNSIGNED-PAYLOAD (TLS keeps the bytes whole) and its length is given up front - R2 refuses a chunked
// PUT without one. 200 MB at most; the time allowed grows with the size.
const MAX_FILE = 200 * 1024 * 1024;
async function putObject(body, key, contentType, over) {
  const c = _cfgOf(over);
  if (!isConfigured(over)) throw new Error('r2: not configured - a Cloudflare key on Admin -> API keys');

  const file = !Buffer.isBuffer(body) && body && body.path ? body : null;
  const size = file ? (+file.size || require('fs').statSync(file.path).size) : body.length;
  if (file && size > MAX_FILE) throw new Error('r2: the file is ' + Math.round(size / 1048576) + ' MB - 200 MB at most');
  const host = _host(c);
  const uri  = _uri(c, key);
  const payloadHash = file ? 'UNSIGNED-PAYLOAD' : _sha256(body);
  const { amzDate, dateStamp } = _stamp();
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  const headers = {
    host,
    'content-type': String(contentType || 'application/octet-stream'),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const canonical = ['PUT', uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const toSign    = [ALGO, amzDate, scope, _sha256(canonical)].join('\n');
  const signature = _sign(toSign, c.secret, dateStamp);

  await axios.put(`${_origin(c)}${uri}`, file ? require('fs').createReadStream(file.path) : body, {
    headers: {
      ...headers,
      // Not signed - `host` and the three above are - but a stream has no length of its own to tell R2.
      'content-length': String(size),
      Authorization: `${ALGO} Credential=${c.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    // Video is why this exists; axios caps bodies at 10MB unless told otherwise. Two minutes, and two seconds more for
    // every megabyte past the first.
    timeout: 120000 + Math.ceil(size / 1048576) * 2000, maxBodyLength: Infinity, maxContentLength: Infinity,
  });

  return linkFor(key, undefined, over);
}

function _setEndpoint(fn) { _endpoint = typeof fn === 'function' ? fn : null; }

module.exports = { isConfigured, putObject, deleteObject, listObjects, getObject, linkFor, pairOf, cfg, _setEndpoint };
