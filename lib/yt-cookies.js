'use strict';

// ════════════════════════════════════════════════════════════════════════════
// YOUTUBE COOKIES — the one thing that makes link ingest possible.
//
// YouTube refuses to serve most videos to a program and asks for a login. yt-dlp can borrow a
// session two ways: read it out of the browser's own profile, or take an exported file. THE
// FILE IS THE ONLY ONE WIRED HERE, on purpose: the app then has exactly what it was handed and
// no access to the browser, and revoking it is deleting one file rather than trusting that
// nothing else got read along the way.
//
// WHAT THIS FILE IS: a live session credential. Anyone holding it is signed in as you on
// YouTube until it expires. So it lives in data/ - which is not served - is never logged, never
// echoed back through the API, and the only thing the interface ever learns about it is whether
// it exists, how big it is, and whether it worked.
//
// "Verified" means a real request went out with it and YouTube answered. Format-checking alone
// would unlock the link field for a file that fails on first use, which is a worse experience
// than the field staying locked.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const DATA_DIR = require('./config').DATA_DIR;
const FILE = path.join(DATA_DIR, 'yt-cookies.txt');
const META = path.join(DATA_DIR, 'yt-cookies.json');

// A cookie jar for one site is a few KB. A megabyte means someone picked the wrong file.
const MAX_BYTES = 1024 * 1024;

function _meta() {
  try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch (e) { return {}; }
}

function _writeMeta(patch) {
  const next = { ..._meta(), ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(META, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function exists() {
  try { return fs.statSync(FILE).size > 0; } catch (e) { return false; }
}

function filePath() { return exists() ? FILE : null; }

// Never includes the contents. The interface needs to know whether links are possible, not what
// the session token is.
function status() {
  const m = _meta();
  if (!exists()) return { present: false, verified: false };
  const st = fs.statSync(FILE);
  return {
    present: true,
    bytes: st.size,
    uploadedAt: m.uploadedAt || st.mtime.toISOString(),
    verified: !!m.verified,
    verifiedAt: m.verifiedAt || null,
    error: m.error || '',
    youtubeEntries: m.youtubeEntries || 0,
    expiresSoon: m.expiresSoon || false,
  };
}

// The Netscape cookie file format: comment lines, then seven TAB-separated fields per entry -
// domain, includeSubdomains, path, secure, expiry, name, value. Checked before storing, because
// the common mistake is exporting the wrong thing entirely (a JSON dump, or a whole HAR file)
// and that should be caught at the door rather than at the first link.
function validate(text) {
  const body = String(text || '');
  if (!body.trim()) throw new Error('That file is empty.');
  if (Buffer.byteLength(body) > MAX_BYTES) {
    throw new Error('That file is over a megabyte — a cookie export for one site is a few KB. Wrong file?');
  }
  if (/^\s*[[{]/.test(body)) {
    throw new Error('That looks like JSON. yt-dlp needs the Netscape cookie format — the '
      + '"cookies.txt" export, not a JSON one.');
  }

  const lines = body.split(/\r?\n/);
  const entries = [];
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) {
      // #HttpOnly_ is a real entry wearing a comment's clothes, and dropping it would throw
      // away exactly the authentication cookies that matter.
      if (!/^#HttpOnly_/i.test(line.trim())) continue;
    }
    const parts = line.replace(/^#HttpOnly_/i, '').split('\t');
    if (parts.length < 7) continue;
    entries.push({ domain: parts[0], expiry: parseInt(parts[4], 10) || 0, name: parts[5] });
  }
  if (!entries.length) {
    throw new Error('No cookie entries found. The file needs the Netscape format: one cookie '
      + 'per line, fields separated by tabs.');
  }
  const yt = entries.filter(e => /youtube\.com$/i.test(String(e.domain).replace(/^\./, '')));
  if (!yt.length) {
    throw new Error(`Found ${entries.length} cookies but none for youtube.com. Export the cookies `
      + 'while you are on YouTube, signed in.');
  }

  // Expiry is in seconds since the epoch; 0 means a session cookie, which is fine and simply
  // has no date. Worth saying when the useful ones are nearly out - a jar that expires tomorrow
  // will work today and confuse you next week.
  const dated = yt.map(e => e.expiry).filter(n => n > 0);
  const soonest = dated.length ? Math.min(...dated) * 1000 : 0;
  const expiresSoon = !!soonest && soonest - Date.now() < 7 * 24 * 3600 * 1000;

  return { entries: entries.length, youtubeEntries: yt.length, expiresSoon,
    soonestExpiry: soonest ? new Date(soonest).toISOString() : null };
}

function save(text) {
  const info = validate(text);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, String(text), 'utf8');
  fs.renameSync(tmp, FILE);
  // A new jar is unverified by definition: the old verdict belonged to the old file.
  _writeMeta({
    uploadedAt: new Date().toISOString(),
    verified: false, verifiedAt: null, error: '',
    entries: info.entries, youtubeEntries: info.youtubeEntries,
    expiresSoon: info.expiresSoon, soonestExpiry: info.soonestExpiry,
  });
  return { ...status(), ...info };
}

function setVerified(ok, error) {
  return _writeMeta({ verified: !!ok, verifiedAt: new Date().toISOString(), error: ok ? '' : String(error || '') });
}

function remove() {
  let gone = false;
  try { if (fs.existsSync(FILE)) { fs.unlinkSync(FILE); gone = true; } } catch (e) {}
  try { if (fs.existsSync(META)) fs.unlinkSync(META); } catch (e) {}
  return gone;
}

module.exports = { FILE, MAX_BYTES, exists, filePath, status, validate, save, setVerified, remove };
