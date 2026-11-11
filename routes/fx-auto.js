'use strict';

/* fx-auto.js - "Auto effects" (phase V90, the owner 2026-11-11, (аэ1), (аэ7); docs/local-app/plan/, "Подфаза 5 — V90: подробный
   план", block 3).

     POST /api/fx/auto { timeline, targets: [clip ids], count: 'auto' | 1-8 }
       -> { byClip: { <clip id>: [{ k, t0, len?, txt?, ai: 1 }] }, placed, dropped: [{ k, at, why }], noWords, count, by }

   The page hands the timeline AS IT IS ON THE PAGE (the open one may hold what is not saved yet) and lays the answer itself, one undo
   step - nothing is written here. A highlights fragment's timeline (`hl_<id>_<n>`) is told its kind, title and language from its
   project. The agent is asked once (lib/fx-auto.js choose - paid once); the page going away (its ✕) cancels it. */

const express = require('express');
const router = express.Router();
const FXA = require('../lib/fx-auto');

/** What a highlights fragment's timeline tells the agent: its kind (the one it acts as), title and language. */
function _hlOf(key) {
  try {
    const HL = require('../lib/highlights-store');
    const at = HL.ofKey(key);
    if (!at || !at.n) return {};
    const rec = HL.get(at.id);
    const f = rec && (rec.fragments || []).find((x) => x.n === at.n);
    if (!rec) return {};
    let language = (rec.agent && rec.agent.language) || '';
    if (!language) { try { language = require('../lib/highlights-job').languageOf(rec); } catch (e) { language = ''; } }
    return { kind: HL.actingKind(rec), title: f ? String(f.headline || f.title || '') : '', language };
  } catch (e) { return {}; }
}

router.post('/fx/auto', async (req, res) => {
  const b = req.body || {};
  const tl = b.timeline && typeof b.timeline === 'object' ? b.timeline : null;
  if (!tl || !Array.isArray(tl.tracks)) return res.status(400).json({ success: false, error: 'which timeline?' });
  const ids = (Array.isArray(b.targets) ? b.targets : []).map(String).slice(0, 400);
  if (!ids.length) return res.status(400).json({ success: false, error: 'which clips?' });
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  try {
    const out = await FXA.choose(tl, ids, { count: b.count, ..._hlOf(tl.key), signal: ac.signal });
    if (!res.writableEnded) res.json({ success: true, ...out });
  } catch (e) {
    if (e && e.cancelled) { if (!res.writableEnded) res.status(499).json({ success: false, error: 'stopped', cancelled: true }); return; }
    console.warn('[fx-auto] ' + (e && e.message));
    if (!res.writableEnded) res.status(e.status || 502).json({ success: false, error: String((e && e.message) || e).slice(0, 400), unsure: !!(e && e.unsure) });
  }
});

module.exports = router;
