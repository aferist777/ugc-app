'use strict';

// ════════════════════════════════════════════════════════════════════════════
// AN UPDATE'S MANIFEST, AND ITS SIGNATURE.
//
// One module for the two ends: tools/release.js writes and signs, desktop/updater.js reads and checks.
//
// The bucket `ugc-updates` (the publisher's Cloudflare; a folder on a stand):
//   blobs/<sha256>                      a file of a version, gzipped - one object per CONTENT, shared by every version
//                                       and platform that has it (an unchanged vendor/ is never sent again)
//   releases/<version>/<platform>.json  the envelope of that version, kept for history and `prune`
//   channels/<channel>/<platform>.json  the envelope installed copies read - ONE object, so a reader never gets a manifest with
//                                       another manifest's signature
//   access/tokens.json, seen/<name>.json   the Worker's (tools/release-worker.js)
// The envelope: { manifest: <base64 of the manifest's bytes>, sig: <base64 ed25519 signature of those bytes> }.
// The manifest: { app, channel, platform, seq, version, commit, date, format, important, notes, moveTo?,
//                 files: [{ p, h, s, z }] } - p the path in the version folder (forward slashes), h its sha256,
//                 s its size, z the size of its blob.
// The private key is the publisher's alone (%USERPROFILE%\.ugc-release\, never in git); the public one is in the program
// (desktop/update-key.js). `seq` only grows: an older manifest, however well signed, is never taken again.
// No lib/config.js here: the release tool runs with no library.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const APP = 'ugc-studio';
const PLATFORM = `${process.platform}-${process.arch}`;
const VERSION_NAME = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;

const keys = {
  blob: (h) => `blobs/${h}`,
  release: (version, platform = PLATFORM) => `releases/${version}/${platform}.json`,
  channel: (channel, platform = PLATFORM) => `channels/${channel}/${platform}.json`,
};

/** A path inside a version folder that cannot leave it. */
function safePath(p) {
  if (typeof p !== 'string' || !p || p.length > 400) return false;
  if (p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\0')) return false;
  return p.split('/').every((s) => s && s !== '.' && s !== '..');
}

/** The manifest's own checks - a signed manifest is still read as untrusted shape. Throws in words. */
function check(m) {
  if (!m || typeof m !== 'object') throw new Error('the manifest is not an object');
  if (m.app !== APP) throw new Error('the manifest is not UGC Studio\'s');
  if (!Number.isInteger(m.seq) || m.seq < 1) throw new Error('the manifest has no sequence number');
  if (!VERSION_NAME.test(String(m.version || ''))) throw new Error('the manifest names no version');
  if (!Array.isArray(m.files) || !m.files.length) throw new Error('the manifest lists no files');
  const seen = new Set();
  for (const f of m.files) {
    if (!f || !safePath(f.p) || !SHA.test(String(f.h || '')) || !Number.isFinite(f.s) || f.s < 0 || !Number.isFinite(f.z) || f.z < 0) {
      throw new Error('the manifest lists a file it should not: ' + JSON.stringify(f).slice(0, 120));
    }
    const k = f.p.toLowerCase();
    if (seen.has(k)) throw new Error('the manifest lists a file twice: ' + f.p);
    seen.add(k);
  }
  if (!m.files.some((f) => f.p.toLowerCase() === 'ugc studio.exe')) throw new Error('the manifest has no UGC Studio.exe');
  if (m.moveTo != null && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(String(m.moveTo))) throw new Error('the manifest\'s new address is not https');
  return m;
}

/** The envelope's bytes for a manifest, signed with the private key (PEM). */
function seal(manifest, privateKeyPem) {
  check(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const sig = crypto.sign(null, bytes, privateKeyPem);
  return Buffer.from(JSON.stringify({ manifest: bytes.toString('base64'), sig: sig.toString('base64') }), 'utf8');
}

/** The manifest from an envelope - only when its signature is the public key's (PEM), and only in a sound shape. */
function open(envelope, publicKeyPem) {
  if (!publicKeyPem) throw new Error('this copy has no key to check updates with');
  let env;
  try { env = JSON.parse(Buffer.isBuffer(envelope) ? envelope.toString('utf8') : String(envelope)); } catch (e) { throw new Error('the update\'s answer is not readable'); }
  if (!env || typeof env.manifest !== 'string' || typeof env.sig !== 'string') throw new Error('the update\'s answer is not an envelope');
  const bytes = Buffer.from(env.manifest, 'base64');
  let ok = false;
  try { ok = crypto.verify(null, bytes, publicKeyPem, Buffer.from(env.sig, 'base64')); } catch (e) { ok = false; }
  if (!ok) throw new Error('the update is not signed by UGC Studio\'s key - it is not taken');
  let m;
  try { m = JSON.parse(bytes.toString('utf8')); } catch (e) { throw new Error('the signed manifest is not readable'); }
  return check(m);
}

/** A new pair: { privateKey, publicKey } as PEM. */
function keyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

module.exports = { APP, PLATFORM, VERSION_NAME, keys, safePath, check, seal, open, keyPair };
