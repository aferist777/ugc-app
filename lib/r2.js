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
// anything, so they need a different address:
//
//   R2_PUBLIC_BASE set   the bucket's own public address (pub-<hash>.r2.dev, or a custom
//                        domain) - a short, clean, permanent URL. Preferred.
//   not set              a PRESIGNED link: the same S3 endpoint with the signature carried in
//                        the query string, which anyone holding the link can read until it
//                        expires. Long and ugly, but it needs nothing switched on in the
//                        dashboard, so it works the moment the keys exist.
//
// Either way the answer is https, on port 443, at a real hostname - which is the whole
// argument for being here at all.
const crypto = require('crypto');
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

const REGION  = 'auto';          // R2 has no regions; the signature still demands one
const SERVICE = 's3';
const ALGO    = 'AWS4-HMAC-SHA256';

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

// WHERE THE VALUES COME FROM. The keys popup writes them into data/settings.json alongside every
// other provider's credentials; .env is kept as the fallback so an install configured before the
// popup existed - the deployed server among them - carries on working with nothing changed.
//
// Read fresh each time rather than cached: the popup saves while the process is running, and a
// cached blank would mean a restart before the new keys took. It is a 5 KB file read on the
// upload path only, which already spends a network round trip.
function fromSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {}; }
  catch { return {}; }
}

function cfg() {
  const e = process.env;
  const s = fromSettings();
  const pick = (fromFile, fromEnv) => String(fromFile || fromEnv || '').trim();
  return {
    account:    pick(s.r2AccountId,       e.R2_ACCOUNT_ID),
    key:        pick(s.r2AccessKeyId,     e.R2_ACCESS_KEY_ID),
    secret:     pick(s.r2SecretAccessKey, e.R2_SECRET_ACCESS_KEY),
    bucket:     pick(s.r2Bucket,          e.R2_BUCKET),
    publicBase: pick(s.r2PublicBase,      e.R2_PUBLIC_BASE).replace(/\/+$/, ''),
    // A day is long enough for any render to start, and short enough that a link that leaks
    // stops working on its own. Only used for presigned links.
    ttl: Math.max(60, Number(s.r2LinkTtl || e.R2_LINK_TTL || 86400)),
  };
}

const isConfigured = () => {
  const c = cfg();
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

const _host = (c) => `${c.account}.r2.cloudflarestorage.com`;
const _uri  = (c, key) => `/${_enc(c.bucket)}/${_encPath(key)}`;

/**
 * A link a renderer can fetch with no credentials of its own.
 * The public address when the bucket has one, otherwise a presigned GET.
 */
function linkFor(key, ttlSeconds) {
  const c = cfg();
  if (c.publicBase) return `${c.publicBase}/${_encPath(key)}`;

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
    ['X-Amz-Expires',       String(Math.max(60, Number(ttlSeconds || c.ttl)))],
    ['X-Amz-SignedHeaders', 'host'],
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const query = params.map(([k, v]) => `${_enc(k)}=${_enc(v)}`).join('&');

  // UNSIGNED-PAYLOAD: there is no body on a GET, and the reader could not hash one anyway.
  const canonical = ['GET', uri, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign    = [ALGO, amzDate, scope, _sha256(canonical)].join('\n');
  const signature = _sign(toSign, c.secret, dateStamp);

  return `https://${host}${uri}?${query}&X-Amz-Signature=${signature}`;
}

/**
 * Store one object and answer with the link a renderer can read it by.
 * contentType matters: a renderer that is handed application/octet-stream where it expected
 * an image tends to refuse it, and R2 serves back exactly what it was told on the way in.
 */
async function putObject(buf, key, contentType) {
  const c = cfg();
  if (!isConfigured()) throw new Error('r2: not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET)');

  const host = _host(c);
  const uri  = _uri(c, key);
  const payloadHash = _sha256(buf);
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

  await axios.put(`https://${host}${uri}`, buf, {
    headers: {
      ...headers,
      Authorization: `${ALGO} Credential=${c.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    // Video is why this exists; axios caps bodies at 10MB unless told otherwise.
    timeout: 120000, maxBodyLength: Infinity, maxContentLength: Infinity,
  });

  return linkFor(key);
}

module.exports = { isConfigured, putObject, linkFor };
