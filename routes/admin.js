'use strict';

// admin.js — the people list, for the one person who keeps it.
//
// Four things and no more: see who is on file, make someone, give someone a new password, switch
// someone off. Every answer is the public view from lib/users.js; a hash never leaves the server,
// and a password leaves it exactly once, in the response that minted it.
//
// WHO MAY CALL THIS. The gate (lib/access-gate.js) has already established who the request
// belongs to and put the public record on req.user; here only the role is checked. A signed-in
// person who is not an admin gets a plain 403, not a redirect - these are API routes.
const express = require('express');
const users   = require('../lib/users');

const router = express.Router();

function onlyAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ success: false, error: 'admin only' });
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
