'use strict';

/* The audit log's two doors.

   POST /api/audit/events         the batches public/js/audit-client.js sends: each event becomes
                                  one row in the caller's name, on the click layer.
   GET  /api/audit/activity       the admin's reader (Admin / Activity): day files newest first,
                                  filtered, paged by time.
   GET  /api/audit/meta           what the filters can offer: people, pages, the days on disk,
                                  and the mutating routes that still have no phrase.
   GET  /api/audit/day/:day.:fmt  one day as it is on disk (jsonl) or flattened (csv).

   The rows' words are written elsewhere - lib/audit-map.js for actions, the client for clicks;
   here they are stored, bounded and read back. Reading is the admin's alone. */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const audit = require('../lib/audit');
const MAP = require('../lib/audit-map');
const users = require('../lib/users');

// ── the sink ────────────────────────────────────────────────────────────────
const MARKERS = new Set(['button', 'link', 'dropdown', 'field', 'toggle', 'key', 'drag']);
const KIND_RE = /^(click|timeline)\.[a-z.]{1,40}$/;

router.post('/audit/events', express.json({ limit: '256kb' }), (req, res) => {
  const b = req.body || {};
  const page = String(b.page || '').slice(0, 24) || null;
  const events = Array.isArray(b.events) ? b.events.slice(0, 200) : [];
  let n = 0;
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const marker = MARKERS.has(e.marker) ? e.marker : 'button';
    audit.record(req, {
      layer: 'click', page, marker,
      kind: KIND_RE.test(String(e.kind || '')) ? e.kind : 'click.' + marker,
      label: String(e.label || '').slice(0, 300),
      ids: (e.ids && typeof e.ids === 'object') ? e.ids : null,
      text: e.text == null ? null : String(e.text).slice(0, 4000),
      // The browser's own clock, so a batch keeps its order however it arrived.
      params: e.at ? { at: String(e.at).slice(0, 40) } : null,
    });
    n++;
  }
  res.json({ success: true, n });
});

// ── the reader ──────────────────────────────────────────────────────────────
function onlyAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ success: false, error: 'admin only' });
}

const DAY_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
function days() {
  try { return fs.readdirSync(audit.DIR).map(f => (DAY_RE.exec(f) || [])[1]).filter(Boolean).sort(); }
  catch (e) { return []; }
}
function readDay(day) {
  try {
    return fs.readFileSync(path.join(audit.DIR, day + '.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { return []; }
}

// The filter's idea of a kind: groups of markers and layers, the way the tab offers them.
const KINDS = {
  buttons:   (r) => r.marker === 'button' || r.marker === 'link',
  inputs:    (r) => r.marker === 'dropdown' || r.marker === 'field' || r.marker === 'toggle' || r.marker === 'key',
  edits:     (r) => r.marker === 'drag',
  actions:   (r) => r.layer === 'action' && r.marker !== 'error',
  processes: (r) => r.layer === 'process',
  signin:    (r) => r.layer === 'signin',
  admin:     (r) => r.marker === 'admin',
  errors:    (r) => r.marker === 'error' || (r.status !== 'ok' && r.status != null),
};

function matches(r, f) {
  if (f.user && r.uid !== f.user && r.nick !== f.user) return false;
  if (f.page && r.page !== f.page) return false;
  // The ticked kinds, any of them. No list means everything; an empty list ('none') nothing.
  if (f.kinds && !f.kinds.some(k => KINDS[k] ? KINDS[k](r) : (r.kind === k || r.marker === k))) return false;
  if (f.fromT && r.t < f.fromT) return false;
  if (f.toT && r.t > f.toT) return false;
  if (f.q) {
    const hay = (r.label + ' ' + (r.text || '') + ' ' + JSON.stringify(r.ids || '') + ' ' + JSON.stringify(r.params || '') + ' ' + (r.error || '') + ' ' + (r.nick || '') + ' ' + (r.kind || '')).toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

router.get('/audit/activity', onlyAdmin, (req, res) => {
  try {
    const qs = req.query || {};
    const kindsRaw = String(qs.kinds || qs.kind || '');
    const f = {
      user: String(qs.user || ''), page: String(qs.page || ''),
      kinds: kindsRaw ? kindsRaw.split(',').map(k => k.trim()).filter(k => k && k !== 'none') : null,
      q: String(qs.q || '').trim().toLowerCase().slice(0, 200),
      fromT: qs.fromT ? String(qs.fromT) : null, toT: qs.toT ? String(qs.toT) : null,
    };
    if (kindsRaw === 'none') f.kinds = [];
    const limit = Math.max(1, Math.min(500, parseInt(qs.limit, 10) || 50));
    const offset = Math.max(0, parseInt(qs.offset, 10) || 0);
    // Which day files can hold rows in the window. Files are named by UTC date, the window is
    // in instants, so a day on either side is read and the rows themselves decide.
    const all = days();
    const lo = f.fromT ? f.fromT.slice(0, 10) : (all[0] || '');
    const hi = f.toT ? f.toT.slice(0, 10) : '9999';
    const pick = all.filter(d => d >= shiftDay(lo, -1) && d <= shiftDay(hi, 1)).reverse();
    // Every day in the window is walked so the total is known - the pager needs it - and the
    // page is the matching rows from `offset` on. Day files are small enough for that today.
    const rows = [];
    let scanned = 0, total = 0;
    for (const day of pick) {
      const list = readDay(day);
      scanned += list.length;
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i];
        if (!matches(r, f)) continue;
        if (total >= offset && rows.length < limit) rows.push(r);
        total++;
      }
    }
    res.json({ success: true, rows, total, offset, limit, scanned, days: pick.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
function shiftDay(day, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

router.get('/audit/meta', onlyAdmin, (req, res) => {
  try {
    const people = users.list().map(u => ({ id: u.id, nick: u.nickname, role: u.role, disabled: !!u.disabled }));
    let unmapped = [];
    try { unmapped = MAP.unmappedRoutes(req.app, audit.isSkipped); } catch (e) {}
    // How busy each person has been today - the number on the Users tab. Today's file only.
    const todayCounts = {};
    for (const r of readDay(audit.dayOf(new Date()))) if (r.uid) todayCounts[r.uid] = (todayCounts[r.uid] || 0) + 1;
    res.json({
      success: true, people, days: days(), today: audit.dayOf(new Date()), keepDays: audit.KEEP_DAYS, todayCounts,
      pages: ['Character', 'Scenarios', 'Merge', 'Birols', 'Library', 'Library2', 'Admin', 'Sign-in'],
      unmapped,
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// One day, to take away. CSV is the row flattened: the long fields as JSON in their cell.
router.get('/audit/day/:day.:fmt', onlyAdmin, (req, res) => {
  const day = String(req.params.day || '');
  const fmt = String(req.params.fmt || 'jsonl');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ success: false, error: 'day?' });
  const file = path.join(audit.DIR, day + '.jsonl');
  if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'no such day' });
  if (fmt === 'csv') {
    const cols = ['t', 'nick', 'role', 'layer', 'page', 'marker', 'kind', 'label', 'status', 'error', 'ms', 'route', 'ids', 'params', 'text', 'ip', 'ua'];
    const esc = (v) => { const s = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); return '"' + s.replace(/"/g, '""') + '"'; };
    const lines = [cols.join(',')].concat(readDay(day).map(r => cols.map(c => esc(r[c])).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-${day}.csv"`);
    return res.send('﻿' + lines.join('\r\n'));
  }
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="activity-${day}.jsonl"`);
  fs.createReadStream(file).pipe(res);
});

module.exports = router;
