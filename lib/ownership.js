'use strict';

/* ownership.js — who may change a project.

   Merge timelines and Scenarios projects each carry an `owner`: the id of the person who
   created it. The rule is the same on both, so it lives here rather than twice:

     • anyone signed in may READ any project - the pickers show every owner's list;
     • only the owner or the admin may WRITE one. Everybody else copies it and works on
       the copy, which is theirs from its first second;
     • `owner: null` is a project from before there were people to own things. It is
       shared: everyone reads it, the admin alone edits it, and anyone who wants their own
       version copies it. Nothing is ever migrated onto a made-up owner.

   The admin is an ordinary user with one extra: every project answers to them, including
   delete. That is the whole of the privilege - there is no separate "admin mode". */

const users = require('./users');

function isAdmin(user) { return !!(user && user.role === 'admin'); }

/** The caller's id, as the stores write it. Null when nobody is signed in, which the gate
 *  does not let happen on /api - kept honest anyway. */
function uidOf(req) {
  const u = req && req.user;
  return u && u.id ? String(u.id) : null;
}

/** Owner, or the admin. A shared record (no owner) is the admin's alone to change. */
function canEdit(rec, user) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const owner = rec && rec.owner ? String(rec.owner) : null;
  return !!owner && owner === String(user.id);
}

// A name for an id, read off the users store. It is mtime-cached there, so asking once per
// project in a list is a lookup and not a file read. A user that no longer exists keeps
// their projects under a name that says so, rather than the projects going anywhere.
function nickOf(uid) {
  if (!uid) return null;
  const u = users.findById(String(uid));
  return u ? u.nickname : null;
}

/** What a list entry carries about its owner. Spread into the summary. */
function ownerView(rec) {
  const owner = rec && rec.owner ? String(rec.owner) : null;
  return { owner, ownerNick: owner ? (nickOf(owner) || 'a removed user') : null };
}

/** The signed-in person, as the page needs them: enough to say "mine" and "admin". */
function meView(user) {
  if (!user) return null;
  return { id: String(user.id), nickname: user.nickname, role: user.role };
}

/** The picker's owner list: everyone who has at least one project, the shared group when
 *  there is one, and the caller always - a person with no projects yet still needs a place
 *  in the dropdown to make their first one under. Counts are what the picker shows. */
function ownersOf(records, user) {
  const counts = new Map();
  for (const r of records || []) {
    const o = r && r.owner ? String(r.owner) : '';
    counts.set(o, (counts.get(o) || 0) + 1);
  }
  const me = user && user.id ? String(user.id) : null;
  if (me && !counts.has(me)) counts.set(me, 0);
  const out = [];
  for (const [id, count] of counts) {
    if (!id) continue;
    out.push({ id, nick: nickOf(id) || 'a removed user', count, me: id === me });
  }
  out.sort((a, b) => (b.me - a.me) || a.nick.localeCompare(b.nick));
  if (counts.has('')) out.push({ id: null, nick: 'Shared', count: counts.get(''), me: false });
  return out;
}

/** The refusal, in one shape for every route: 403, and who it belongs to, so the page can
 *  say "read only - belongs to <name>" without a second request. */
function refuse(res, rec) {
  const v = ownerView(rec);
  const who = v.owner ? v.ownerNick : 'everyone - shared, and only the admin can change it';
  return res.status(403).json({ success: false, error: 'read only: belongs to ' + who, ...v });
}

module.exports = { isAdmin, uidOf, canEdit, nickOf, ownerView, meView, ownersOf, refuse };
