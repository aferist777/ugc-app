'use strict';

/* The browser's side of the audit log: the batches public/js/audit-client.js sends. Each event
   becomes one row in the caller's name, on the click layer. The row's words are the client's,
   bounded here; what they mean is for the Activity tab to show beside the actions they caused.
   The reader for that tab arrives in phase 5.4. */

const express = require('express');
const router = express.Router();
const audit = require('../lib/audit');

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

module.exports = router;
