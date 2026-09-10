'use strict';

// users.js — who is allowed in, and how that is proven.
//
// One record per person in data/users.json. The password is never in it: what is stored is a
// scrypt hash and its salt, so the file leaking hands out nothing that logs anyone in. The only
// moment a password exists in the clear is the response to the request that created it, once,
// so the admin can pass it on. After that nobody can read it back - including the admin, who
// can only issue a new one.
//
// scrypt comes from Node's own crypto. A dependency for this would be the tenth in a project
// that has kept itself to nine, and it would buy nothing scryptSync does not already do.
//
// NAMES. A person is created with a generated nickname - two plain words, "swift-heron" - that
// doubles as their first login. They may change both later; the nickname stays as the label the
// admin sees, so a list of people stays readable after everyone has picked a login of their own.
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'users.json');

// ── the file ────────────────────────────────────────────────────────────────
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

// Written whole and swapped in, so a crash mid-write leaves the previous file rather than half
// of a new one. This store is small and is read on every login, which is exactly the file that
// must never be found truncated.
function save(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

// ── passwords ───────────────────────────────────────────────────────────────
// scrypt parameters are the library defaults (N = 16384): a login takes a few tens of
// milliseconds, a brute force takes lifetimes. The cost is recorded per record so it can be
// raised later without invalidating everyone.
const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
  return { salt, hash };
}

// Typed by hand from a message, so the alphabet drops what is read wrongly: no O/0, no l/1/I.
// Three groups of six from 54 letters is ~103 bits.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generatePassword() {
  const pick = (n) => {
    let out = '';
    while (out.length < n) {
      for (const b of crypto.randomBytes(n * 2)) {
        if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length];
        if (out.length === n) break;
      }
    }
    return out;
  };
  return pick(6) + '-' + pick(6) + '-' + pick(6);
}

// ── nicknames ───────────────────────────────────────────────────────────────
// Two words a person can say aloud and an admin can tell apart in a list. Plain, unloaded
// words on purpose - a nickname is a label, not a joke about the person wearing it.
const ADJ = ['swift', 'calm', 'grey', 'bright', 'quiet', 'bold', 'keen', 'plain', 'late', 'early',
  'amber', 'blue', 'green', 'ivory', 'slate', 'brisk', 'mild', 'still', 'deep', 'clear'];
const ANIMAL = ['heron', 'otter', 'marten', 'finch', 'lynx', 'crane', 'badger', 'swift', 'kite',
  'stoat', 'plover', 'wren', 'ibis', 'moth', 'pike', 'fox', 'hare', 'owl', 'teal', 'newt'];

function generateNickname(taken) {
  for (let i = 0; i < 200; i++) {
    const a = ADJ[crypto.randomInt(ADJ.length)];
    const b = ANIMAL[crypto.randomInt(ANIMAL.length)];
    const nick = a + '-' + b;
    if (!taken.has(nick)) return nick;
  }
  // Four hundred combinations exhausted - improbable, but a suffix keeps it from looping.
  return 'user-' + crypto.randomBytes(3).toString('hex');
}

// What a login is allowed to look like. Lower-case so "Anna" and "anna" cannot be two people.
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
function normalizeLogin(s) { return String(s || '').trim().toLowerCase(); }

// ── the shape the browser is allowed to see ─────────────────────────────────
// Everything except the two fields that would let someone log in. The list is sent to the admin
// page on every open; the hash must never ride along.
function publicView(u) {
  return {
    id: u.id, login: u.login, nickname: u.nickname, role: u.role,
    mustChange: !!u.mustChange, disabled: !!u.disabled,
    createdAt: u.createdAt, lastSeenAt: u.lastSeenAt || null,
    // Where the person came from, and their address on that side. Set for accounts made by
    // signing in through Partner; absent for anyone the admin created here.
    source: u.source || 'local', email: u.email || null,
  };
}

// ── reading, on every request ───────────────────────────────────────────────
// The gate asks "does this person still exist, and are they still allowed in" on every click.
// That must not cost a file read each time, so the list is cached against the file's mtime: a
// change the admin page makes is seen on the very next request, and nothing is re-parsed until
// then.
let _cache = { mtime: -1, list: [] };
function loadCached() {
  let m = -1;
  try { m = fs.statSync(FILE).mtimeMs; } catch { m = -1; }
  if (m !== _cache.mtime) _cache = { mtime: m, list: load() };
  return _cache.list;
}

function findById(id)       { return loadCached().find(u => u.id === id) || null; }
function findByLogin(login) { const l = normalizeLogin(login); return l ? (loadCached().find(u => u.login === l) || null) : null; }

/** True when the password hashes to what is stored. Constant-time on the comparison. */
function verifyPassword(user, password) {
  if (!user || !user.salt || !user.hash) return false;
  const a = crypto.scryptSync(String(password), user.salt, KEYLEN);
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── operations ──────────────────────────────────────────────────────────────
function list() { return load().map(publicView); }

/** Records a sign-in. What the admin list shows as "last seen". */
function touch(id) {
  const all = load();
  const u = all.find(x => x.id === id);
  if (!u) return;
  u.lastSeenAt = new Date().toISOString();
  save(all);
}

/**
 * The person changes their own login and/or password. A blank field means "keep it". Either way
 * mustChange clears: they have been asked, and declining is an answer.
 */
function updateCredentials(id, { login, password } = {}) {
  const all = load();
  const u = all.find(x => x.id === id);
  if (!u) throw new Error('no such user');
  const l = normalizeLogin(login);
  if (l && l !== u.login) {
    if (!LOGIN_RE.test(l)) throw new Error('login must be 3-32 characters: letters, digits, . _ -');
    if (all.some(x => x.login === l && x.id !== id)) throw new Error('that login is already taken');
    u.login = l;
  }
  if (password) {
    if (String(password).length < 8) throw new Error('password must be at least 8 characters');
    Object.assign(u, hashPassword(password));
  }
  u.mustChange = false;
  save(all);
  return publicView(u);
}

/**
 * Makes a person. Returns their public record AND the one password that will ever be shown
 * in the clear - the caller shows it once and forgets it.
 */
function create({ role = 'user', login = null, password = null } = {}) {
  const all = load();
  const taken = new Set(all.map(u => u.nickname).concat(all.map(u => u.login)));
  const nickname = generateNickname(taken);

  let useLogin = login ? normalizeLogin(login) : nickname;
  if (!LOGIN_RE.test(useLogin)) throw new Error('login must be 3-32 characters: letters, digits, . _ -');
  if (all.some(u => u.login === useLogin)) throw new Error('that login is already taken');

  const pw = password || generatePassword();
  const { salt, hash } = hashPassword(pw);
  const user = {
    id: 'u_' + crypto.randomBytes(6).toString('hex'),
    login: useLogin, nickname,
    role: role === 'admin' ? 'admin' : 'user',
    salt, hash,
    // A password the admin handed over is one the admin knows; the person is asked to replace
    // it. One the person chose themselves (bootstrap from .env) is already theirs.
    mustChange: !password,
    disabled: false,
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
  };
  all.push(user);
  save(all);
  return { user: publicView(user), password: pw };
}

/** A fresh one-time password. The old one stops working the moment this returns. */
function resetPassword(id) {
  const all = load();
  const u = all.find(x => x.id === id);
  if (!u) throw new Error('no such user');
  const pw = generatePassword();
  Object.assign(u, hashPassword(pw), { mustChange: true });
  save(all);
  return { user: publicView(u), password: pw };
}

function setDisabled(id, disabled) {
  const all = load();
  const u = all.find(x => x.id === id);
  if (!u) throw new Error('no such user');
  // The last admin cannot be switched off: that would leave nobody able to switch anyone on.
  if (disabled && u.role === 'admin' && !all.some(x => x.role === 'admin' && !x.disabled && x.id !== id)) {
    throw new Error('this is the only active admin');
  }
  u.disabled = !!disabled;
  save(all);
  return publicView(u);
}

// ── the first admin ─────────────────────────────────────────────────────────
// Runs at boot. With no admin on file, one is made - from ADMIN_LOGIN / ADMIN_PASSWORD when .env
// provides them, otherwise with a generated password printed to the log exactly once. Either way
// the install can never come up with a locked door and nobody holding a key.
function ensureAdmin() {
  const all = load();
  if (all.some(u => u.role === 'admin')) return null;

  const login = normalizeLogin(process.env.ADMIN_LOGIN) || 'admin';
  const given = String(process.env.ADMIN_PASSWORD || '').trim();
  const made = create({ role: 'admin', login, password: given || null });

  if (given) {
    console.log(`[users] admin "${login}" created from .env`);
  } else {
    console.log('┌──────────────────────────────────────────────────────────────┐');
    console.log('│  [users] no admin on file - one was created.                 │');
    console.log(`│  login:     ${login.padEnd(48)}│`);
    console.log(`│  password:  ${made.password.padEnd(48)}│`);
    console.log('│  Shown once. Set ADMIN_PASSWORD in .env to choose your own.  │');
    console.log('└──────────────────────────────────────────────────────────────┘');
  }
  return made.user;
}

// ════════════════════════════════════════════════════════════════════════════
// PEOPLE WHO COME FROM PARTNER
//
// They never register here and never have a password here. Their account is made the first
// time they arrive with a token their side signed (lib/mp-sso.js), and it is tied to their
// permanent id over there - `mpId` - rather than to a login, so renaming an address on their
// side changes nothing about who this is.
//
// NO PASSWORD AT ALL, not even a random one. `verifyPassword` refuses a record without a
// hash, so the sign-in form cannot be used against these accounts by anybody, including
// somebody who guesses the address. The one way in is through Partner.
// ════════════════════════════════════════════════════════════════════════════

const findByMpId = (sub) => {
  const want = String(sub || '');
  return want ? (loadCached().find(u => u.mpId && String(u.mpId) === want) || null) : null;
};

// An address becomes a login: the part before the @, cut to what a login may look like, with
// a number on the end if somebody already has it. The address itself is kept as `email`,
// because the login field allows letters, digits and . _ - and an @ is none of those.
function _loginFromEmail(email, taken) {
  let base = normalizeLogin(String(email || '').split('@')[0]).replace(/[^a-z0-9._-]/g, '');
  base = base.replace(/^[^a-z0-9]+/, '').slice(0, 24);
  if (base.length < 3) base = 'mp' + crypto.randomBytes(2).toString('hex');
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n++) { const t = (base + n).slice(0, 32); if (!taken.has(t)) return t; }
  return 'mp' + crypto.randomBytes(4).toString('hex');
}

// Their display name, if it can be a nickname; otherwise one of ours. Two words a person can
// say aloud beats "user_84213" in a list of eight.
function _nickFrom(name, taken) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 32);
  if (n && !taken.has(n)) return n;
  return generateNickname(taken);
}

/** Find the person behind this token, making the account the first time. Returns the record. */
function upsertFromSso({ sub, email, name }) {
  const all = load();
  const id = String(sub || '');
  if (!id) throw new Error('no sub');

  let u = all.find(x => x.mpId && String(x.mpId) === id);
  // Somebody the admin made here by hand, with the same address: adopt it rather than making a
  // second account for one person. Happens exactly once per person, at the changeover.
  if (!u && email) {
    const mail = normalizeLogin(email);
    u = all.find(x => !x.mpId && (normalizeLogin(x.email || '') === mail || x.login === mail.split('@')[0]));
    if (u) u.mpId = id;
  }

  if (!u) {
    const taken = new Set(all.map(x => x.nickname).concat(all.map(x => x.login)));
    u = {
      id: 'u_' + crypto.randomBytes(6).toString('hex'),
      login: _loginFromEmail(email, taken),
      nickname: _nickFrom(name, taken),
      role: 'user',
      // No salt and no hash: there is no password to get wrong, and none to steal.
      salt: null, hash: null,
      mustChange: false,
      disabled: false,
      mpId: id,
      email: String(email || '').trim() || null,
      source: 'partner',
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    };
    all.push(u);
  } else {
    // Kept in step on every sign-in, so a rename over there shows up here without anybody
    // having to tell us separately.
    if (email && String(email).trim() !== (u.email || '')) u.email = String(email).trim();
    if (name && u.source === 'partner' && String(name).trim() !== u.nickname) {
      const taken = new Set(all.filter(x => x.id !== u.id).map(x => x.nickname));
      const n = String(name).trim().slice(0, 32);
      if (n && !taken.has(n)) u.nickname = n;
    }
    u.source = u.source || 'partner';
  }
  u.lastSeenAt = new Date().toISOString();
  save(all);
  return u;
}

/** Their side says an account changed: blocked, unblocked, renamed. Never deletes - projects,
 *  renders and audit rows point at the record, and removing it would orphan all of it. */
function applySsoChange({ sub, email, name, disabled }) {
  const all = load();
  const u = all.find(x => x.mpId && String(x.mpId) === String(sub || ''));
  if (!u) return null;
  if (typeof disabled === 'boolean') {
    // The last standing admin is never locked out by somebody else's user list.
    if (disabled && u.role === 'admin' && !all.some(x => x.role === 'admin' && !x.disabled && x.id !== u.id)) {
      throw new Error('that is the only admin left');
    }
    u.disabled = disabled;
  }
  if (email) u.email = String(email).trim();
  if (name) {
    const taken = new Set(all.filter(x => x.id !== u.id).map(x => x.nickname));
    const n = String(name).trim().slice(0, 32);
    if (n && !taken.has(n)) u.nickname = n;
  }
  save(all);
  return u;
}

module.exports = {
  list, findById, findByLogin, verifyPassword, touch, updateCredentials,
  create, resetPassword, setDisabled, ensureAdmin, publicView,
  findByMpId, upsertFromSso, applySsoChange,
};
