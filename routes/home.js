'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HOME (the owner 2026-10-22; the page is public/home.html, its plan and mockup docs/local-app/mockups/home.html) - what
// the Overview's blocks read that no other route gives in one piece. The rest comes from where it already is: Now from
// the journal (/api/alerts), the render queue (/api/mv3q), the bot (/api/telegram) and the links (/api/links); The app from
// the key check (/api/keys/health - the balances of kie.ai, ElevenLabs and OpenRouter are in its words), /api/telegram,
// /api/cloudflare.
//
//   GET /api/home/continue           -> { items: [{ key, title, kind, updatedAt, clips, thumb, sub }] }   four: the draft
//                                       first when it has clips (phase V49), then newest first
//   GET /api/home/news?since=<iso>   -> { since, refs, renders, made, failed }   what came since the last visit
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const { MEDIA } = require('../lib/config');
const { toDiskExisting, toUrl } = require('../lib/media');

const router = express.Router();

const IMG_RE = /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i;
const VID_RE = /\.(mp4|mov|webm|mkv|m4v)(\?|$)/i;
const onDisk = (u) => { const a = u && toDiskExisting(String(u).split('?')[0]); return !!(a && fs.existsSync(a)); };

// The first picture of a timeline: a still clip as it is (through the thumbnail door), a clip by its poster beside it.
function _thumbOf(t) {
  const VT = require('../lib/video-thumb');
  for (const tr of (Array.isArray(t && t.tracks) ? t.tracks : [])) {
    if (!tr || tr.kind !== 'video') continue;
    for (const c of (tr.clips || [])) {
      const src = c && c.src ? String(c.src).split('?')[0] : '';
      if (!src || !onDisk(src)) continue;
      if (IMG_RE.test(src)) return '/api/thumb?src=' + encodeURIComponent(src) + '&v=card';
      if (VID_RE.test(src)) { const p = VT.thumbUrlFor(src); if (p && onDisk(p)) return p; }
    }
  }
  return null;
}

const _clipsOf = (t) => (Array.isArray(t && t.tracks) ? t.tracks : []).reduce((n, tr) => n + ((tr && tr.clips) || []).length, 0);

router.get('/home/continue', (_req, res) => {
  try {
    const { timelines } = require('../lib/merge-store').read();
    const HLS = require('../lib/highlights-store');
    const PROJECTS = require('../lib/projects-store');
    const kindOfProject = new Map(PROJECTS.entries().map((e) => [String(e.id), e.kind]));
    const items = [];
    for (const [key, t] of Object.entries(timelines || {})) {
      if (!t) continue;
      const hl = HLS.ofKey(key);
      if (hl && hl.n > 0) continue;                       // a fragment opens from its project's tiles
      const clips = _clipsOf(t);
      if (t.draft && !clips) continue;                    // an empty draft is nothing to continue
      let kind = 'project', sub = clips + ' clip' + (clips === 1 ? '' : 's'), thumb = _thumbOf(t);
      if (t.draft) { kind = 'draft'; sub = clips + ' clip' + (clips === 1 ? '' : 's') + ', not saved'; }
      else if (hl) {
        kind = 'highlights';
        const rec = HLS.get(hl.id);
        const frs = ((rec && rec.fragments) || []).filter((f) => !f.deletedAt);
        const ready = frs.filter((f) => f.state === 'ready');
        sub = frs.length ? ready.length + ' of ' + frs.length + ' fragments made' : 'no fragments yet';
        // Its own timeline is often empty - the first made fragment shows what it is.
        if (!thumb) for (const f of ready) { const ft = timelines['hl_' + hl.id + '_' + f.n]; thumb = ft && _thumbOf(ft); if (thumb) break; }
      } else if (kindOfProject.get((/^sv3_([^_]+)(?:_\d+)?$/.exec(key) || [])[1]) === 'scenarios') {
        // (phase V56, (ги6)) A talking head - its second timeline (sv3_<project>_<n>) too: Merge's rule (js/merge-v3/workshop.js projectIdOf).
        kind = 'talking head';
      }
      items.push({ key, title: t.title || 'Untitled', kind, updatedAt: t.updatedAt || t.createdAt || null, clips, thumb, sub });
    }
    // (phase V49, the owner's (пр12)) The draft first, as in Merge's list - when there is something in it to continue.
    items.sort((a, b) => ((b.kind === 'draft') - (a.kind === 'draft')) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    res.json({ success: true, items: items.slice(0, 4) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Renders finished since: the files of the renders folder newer than `since`.
function _rendersSince(sinceMs) {
  const out = { n: 0, mb: 0, projects: {} };
  const walk = (dir, rel) => {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of list) {
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) { if (d.name !== 'thumbs') walk(abs, rel ? rel + '/' + d.name : d.name); continue; }
      if (!VID_RE.test(d.name)) continue;
      let st = null;
      try { st = fs.statSync(abs); } catch (e) { continue; }
      if (st.mtimeMs <= sinceMs) continue;
      out.n++;
      out.mb += st.size / 1048576;
      const top = rel.split('/')[0] || '';
      if (top && top.toLowerCase() !== 'nocat') out.projects[top] = (out.projects[top] || 0) + 1;
    }
  };
  walk(MEDIA.renders, '');
  out.mb = Math.round(out.mb);
  out.folder = toUrl(MEDIA.renders);
  return out;
}

router.get('/home/news', (req, res) => {
  try {
    const since = String(req.query.since || '');
    const sinceMs = Date.parse(since) || 0;
    // REFERENCES: what the bot brought (not what was moved by hand), by its folder.
    const REFS = require('../lib/references-store');
    const where = {};
    let nRefs = 0;
    for (const p of REFS.read()) {
      if (!p || p.from !== 'telegram' || p.handled) continue;
      if ((Date.parse(p.receivedAt) || 0) <= sinceMs) continue;
      nRefs++;
      const label = p.categoryId ? 'REFERENCES · ' + (p.categoryLabel || 'a category') : REFS.labelOf(p.source, p.folder);
      where[label] = (where[label] || 0) + 1;
    }
    // The journal: what was made, and what failed, since.
    const ALERTS = require('../lib/alerts');
    const made = { pictures: 0, clips: 0, music: 0, other: 0 };
    const failed = { n: 0, last: null };
    for (const a of ALERTS.list()) {
      const at = Date.parse(a.doneAt || a.startedAt) || 0;
      if (at <= sinceMs) continue;
      if (a.state === 'done') {
        if (a.kind === 'image') made.pictures++;
        else if (a.kind === 'video') made.clips++;
        else if (a.kind === 'music') made.music++;
        else made.other++;
      } else if (a.state === 'failed') {
        failed.n++;
        if (!failed.last || at > (Date.parse(failed.last.at) || 0)) failed.last = { title: a.title || a.kind, error: a.error || '', at: a.doneAt || a.startedAt };
      }
    }
    res.json({ success: true, since, refs: { n: nRefs, where }, renders: _rendersSince(sinceMs), made, failed });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
