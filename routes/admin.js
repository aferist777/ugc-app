'use strict';

// admin.js — the people list, for the one person who keeps it.
//
// Four things and no more: see who is on file, make someone, give someone a new password, switch
// someone off. Every answer is the public view from lib/users.js; a hash never leaves the server,
// and a password leaves it exactly once, in the response that minted it.
//
// WHO MAY CALL THIS, for now. Per-person login is the next phase; until it lands there is no
// session that says "this is the admin", only the shared gate in front of the whole app. So the
// rule here is the honest interim one: with the gate on, the gate has already done the checking;
// with the gate off - a machine with no APP_PASSWORD, which is a developer's own - only the
// machine itself may reach these. The next phase replaces this block with a role check on the
// session, and this comment goes with it.
const express = require('express');
const users   = require('../lib/users');

const router = express.Router();

function onlyAdmin(req, res, next) {
  if (process.env.APP_PASSWORD) return next();
  const ip = String(req.ip || req.socket.remoteAddress || '');
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
  return res.status(403).json({ success: false, error: 'admin routes are local-only while the login gate is off' });
}

router.use('/admin', onlyAdmin, express.json({ limit: '16kb' }));

router.get('/admin/users', (_req, res) => {
  try { res.json({ success: true, users: users.list() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The password in this answer is the only copy there will ever be.
router.post('/admin/users', (req, res) => {
  try {
    const role = (req.body && req.body.role === 'admin') ? 'admin' : 'user';
    const made = users.create({ role });
    res.json({ success: true, user: made.user, password: made.password });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post('/admin/users/:id/reset', (req, res) => {
  try {
    const made = users.resetPassword(String(req.params.id));
    res.json({ success: true, user: made.user, password: made.password });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post('/admin/users/:id/disable', (req, res) => {
  try { res.json({ success: true, user: users.setDisabled(String(req.params.id), true) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post('/admin/users/:id/enable', (req, res) => {
  try { res.json({ success: true, user: users.setDisabled(String(req.params.id), false) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

module.exports = router;
