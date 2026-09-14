'use strict';

/* ownership.js — who may change a project, in an app with one person in it.

   The server version had people. Merge timelines and Scenarios projects each carried the id of
   whoever made them, and only that person or the admin could change one; everybody else copied
   it. The desktop app has exactly one user, so every project is theirs - including those carried
   over from the server with somebody else's id on them. That is why the stored `owner` is never
   consulted: a project from a colleague must not turn up read-only, or vanish from a picker that
   lists "your" projects.

   The helpers keep their names and shapes, so the routes that ask and the pages that draw the
   answer did not have to change. */

const LOCAL_USER = Object.freeze({ id: 'local', login: 'local', nickname: 'You', role: 'admin' });

const isAdmin = () => true;

/** The id new records are stamped with. */
const uidOf = () => LOCAL_USER.id;

const canEdit = () => true;

const nickOf = () => LOCAL_USER.nickname;

/** What a list entry carries about its owner. Spread into the summary. */
const ownerView = () => ({ owner: LOCAL_USER.id, ownerNick: LOCAL_USER.nickname });

/** The person, as the page needs them: enough to say "mine" and "admin". */
const meView = () => ({ id: LOCAL_USER.id, nickname: LOCAL_USER.nickname, role: LOCAL_USER.role });

/** The picker's owner list: one entry, holding everything. The pages hide a list of one. */
const ownersOf = (records) => [{ id: LOCAL_USER.id, nick: LOCAL_USER.nickname, count: (records || []).length, me: true }];

/** Kept for the routes that still guard with canEdit; with one person it is never reached. */
const refuse = (res) => res.status(403).json({ success: false, error: 'read only' });

module.exports = { LOCAL_USER, isAdmin, uidOf, canEdit, nickOf, ownerView, meView, ownersOf, refuse };
