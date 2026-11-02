'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HOME (the owner 2026-10-22; the page is public/home.html, its plan and mockup docs/local-app/mockups/home.html) - what
// the Overview's blocks read that no other route gives in one piece. The rest comes from where it already is: Now from
// the journal (/api/alerts), the render queue (/api/mv3q), the bot (/api/telegram) and the links (/api/links); The app from
// the key check (/api/keys/health - the balances of kie.ai, ElevenLabs and OpenRouter are in its words), /api/telegram,
// /api/cloudflare.
//
//   GET /api/home/projects           -> { kinds: { all, blank, talking, voiceover, highlights } }   (phase V70, P13) the
//                                       block "projects": the five changed last of each kind, each { key, title, kind, format,
//                                       updatedAt, createdAt, thumb, dur, clips, frags, fragsAll }; Merge's draft first in
//                                       `all` and `blank` while something lies on it (the owner's (хп57))
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

// A picture through the thumbnail door - `frame` (440 px) serves both the row's small square and the hover's larger frame.
const _thumbSrc = (src) => '/api/thumb?src=' + encodeURIComponent(src) + '&v=frame';

// The first picture of a timeline: a still clip as it is (through the thumbnail door), a clip by its poster beside it.
function _thumbOf(t) {
  const VT = require('../lib/video-thumb');
  for (const tr of (Array.isArray(t && t.tracks) ? t.tracks : [])) {
    if (!tr || tr.kind !== 'video') continue;
    for (const c of (tr.clips || [])) {
      const src = c && c.src ? String(c.src).split('?')[0] : '';
      if (!src || !onDisk(src)) continue;
      if (IMG_RE.test(src)) return _thumbSrc(src);
      if (VID_RE.test(src)) { const p = VT.thumbUrlFor(src); if (p && onDisk(p)) return p; }
    }
  }
  return null;
}

// What lies on the picture and sound lanes - the clips the person laid; a subtitle's or a text's pages are not counted.
const _media = (t) => (Array.isArray(t && t.tracks) ? t.tracks : []).filter((tr) => tr && (tr.kind === 'video' || tr.kind === 'audio'));
const _clipsOf = (t) => _media(t).reduce((n, tr) => n + ((tr.clips) || []).length, 0);
// How long it is: where its last clip ends, any lane (lib/mv3b-render.js duration - the render's own rule).
function _durOf(t) {
  let end = 0;
  for (const tr of (Array.isArray(t && t.tracks) ? t.tracks : [])) {
    for (const c of ((tr && tr.clips) || [])) end = Math.max(end, (+c.start || 0) + (+c.dur || 0));
  }
  return Math.round(end * 10) / 10;
}

// ── THE BLOCK "PROJECTS" (phase V70, P13, the owner 2026-11-01: "поле проектов - с видом как открытый дропдаун в merge.
// только отображаться будут последние 5 строк проектов выбранного типа. при наведении на строку показывать"; (хп28)-(хп30),
// (хп43), (хп57)) - it took the place of Continue. One read of the timelines answers every chip: the five changed last of
// each kind. The kinds are Merge's list's (js/merge-v3/projects.js): a highlights project is ONE line - its own timeline (a
// fragment opens from its tiles); a talking head is a `sv3_<id>` timeline of a scenarios project - its `sv3_<id>_<n>` too
// (js/merge-v3/workshop.js projectIdOf) -, a voiceover the same kind of project whose record says so (THE voiceover draft is
// not a project yet and is left out); every other timeline is a blank one. MERGE'S DRAFT is first in `all` and `blank` while
// something lies on it ((хп57)); an empty draft is nothing to open.
const KINDS = ['blank', 'talking', 'voiceover', 'highlights'];
const PER_KIND = 5;

router.get('/home/projects', (_req, res) => {
  try {
    const { timelines } = require('../lib/merge-store').read();
    const HLS = require('../lib/highlights-store');
    const PROJECTS = require('../lib/projects-store');
    const kindOfProject = new Map(PROJECTS.entries().map((e) => [String(e.id), e.kind]));
    let draft = null;
    const items = [];
    for (const [key, t] of Object.entries(timelines || {})) {
      if (!t) continue;
      const hl = HLS.ofKey(key);
      if (hl && hl.n > 0) continue;
      const it = {
        key, title: t.title || 'Untitled', kind: 'blank', format: t.format === '16:9' ? '16:9' : '9:16',
        updatedAt: t.updatedAt || t.createdAt || null, createdAt: t.createdAt || null,
        thumb: _thumbOf(t), dur: _durOf(t), clips: _clipsOf(t), frags: null, fragsAll: null,
      };
      if (t.draft) {
        if (!it.clips) continue;
        it.kind = 'draft';
        if (!draft || String(it.updatedAt || '') > String(draft.updatedAt || '')) draft = it;
        continue;
      }
      const pid = (/^sv3_([^_]+)(?:_\d+)?$/.exec(key) || [])[1];
      if (hl) {
        it.kind = 'highlights';
        const rec = HLS.get(hl.id) || {};
        const frs = (rec.fragments || []).filter((f) => !f.deletedAt);
        const ready = frs.filter((f) => f.state === 'ready');
        it.frags = ready.length;
        it.fragsAll = frs.length;
        // Its length is the video's it was cut from; its own timeline is often empty - the first made fragment shows it.
        if (rec.video && +rec.video.seconds > 0) it.dur = Math.round(+rec.video.seconds);
        for (const f of ready) {
          if (it.thumb) break;
          if (f.thumb && onDisk(f.thumb)) { it.thumb = IMG_RE.test(f.thumb) ? _thumbSrc(String(f.thumb).split('?')[0]) : f.thumb; break; }
          const ft = timelines['hl_' + hl.id + '_' + f.n];
          it.thumb = ft ? _thumbOf(ft) : null;
        }
      } else if (pid && kindOfProject.get(pid) === 'scenarios') {
        const pr = PROJECTS.get(pid) || {};
        if (pr.type === 'voiceover' && pr.draft) continue;
        it.kind = pr.type === 'voiceover' ? 'voiceover' : 'talking';
        // A talking head's fragments are its lines (one taken off keeps its place but is not one any more).
        if (it.kind === 'talking') it.frags = (Array.isArray(pr.lines) ? pr.lines : []).filter((l) => l && !l.removed).length;
        // Nothing on its timeline yet: the look it is cast in shows whose it is.
        const look = pr.casting && pr.casting.obrazImage ? String(pr.casting.obrazImage).split('?')[0] : '';
        if (!it.thumb && look && IMG_RE.test(look) && onDisk(look)) it.thumb = _thumbSrc(look);
      }
      items.push(it);
    }
    items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const head = (list) => (draft ? [draft].concat(list) : list).slice(0, PER_KIND);
    const kinds = { all: head(items) };
    for (const k of KINDS) kinds[k] = k === 'blank' ? head(items.filter((x) => x.kind === k)) : items.filter((x) => x.kind === k).slice(0, PER_KIND);
    res.json({ success: true, kinds });
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
