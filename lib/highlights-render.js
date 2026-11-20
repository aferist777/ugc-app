'use strict';

/* highlights-render.js - the ticked fragments of a highlights project rendered together.

   In a highlights project the project bar's Render renders the TICKED fragments, with ONE set of export settings: each
   one's timeline, as the store holds it, goes into the render queue (routes/mv3q.js) armed - one at a time, in the tiles'
   order -, and the settings are kept on each of their timelines (their own Export shows the same) and on the project
   (`renderAdv`, what the window starts from next time). A fragment not made yet, one with a clip whose file is gone, one
   under the encoder right now is left out, and said so; one already waiting, interrupted or failed has its entry REPLACED -
   never two of one fragment in the line.

   ITS FILE: media/renders/<the project's folder>/<the fragment's name>.mp4, its .en_US.srt
   beside it (the Export box) - named when its turn comes, so a rename on the way is followed. It TAKES THE PLACE of the
   fragment's own earlier render (lib/mv3b-job.js finish drops the old one's poster and subtitles); another file of that
   name is not touched ("(2)"). A fragment renamed afterwards - its file is renamed with it, through lib/relocate.js (the
   queue's entry and this record follow, as every store does).

   THE RECORD: a fragment's `render: { url, srt, at, rev, seconds, queueId }` - `rev` is its timeline's when it was queued:
   a timeline changed since says "changed since". A render deleted from the Renders shelf is not "rendered" any more - its
   file is looked at.

     render(id, ns, adv)  -> { queued: [n], skipped: [{ n, title, why }] }
     stop(id)             -> { removed, stopping }   all of the project's renders
     target(item)         -> { name, replace }       asked by the queue when an entry's turn comes
     rendered(item, abs)  the queue's word that an entry's file is made
     renamed(id, n)       its render's file follows the fragment's name
     viewOf(rec)          -> { byN: { [n]: { line, render } }, rendering } - for GET /api/highlights/:id */

const fs = require('fs');
const path = require('path');
const HL = require('./highlights-store');
const MSTORE = require('./merge-store');
const JOB = require('./mv3b-job');
const { MEDIA } = require('./config');
const { toDisk, toDiskWithin, toUrl } = require('./media');
const { folderName, uniqueName } = require('./names');
const I18N = require('./i18n');

// The queue is a route module that requires this one when an entry's turn comes: asked for when needed, not at load.
const MVQ = () => require('../routes/mv3q');

const _frag = (r, n) => ((r && r.fragments) || []).find((f) => f.n === Number(n)) || null;
const _err = (msg, status) => Object.assign(new Error(msg), { status });
const _mine = (id) => (x) => !!x.hl && x.hl.id === String(id);
const _exists = (url) => { const abs = url ? toDisk(url) : null; return !!(abs && fs.existsSync(abs)); };

// How long a timeline runs: the end of its last clip.
const _dur = (tl) => Math.round(require('../public/js/timeline/rules.js').endOf(tl) * 100) / 100;

// ── Into the queue ──────────────────────────────────────────────────────────
function render(id, ns, adv) {
  const rec = HL.get(id);
  if (!rec) throw _err(I18N.t('no such highlights project'), 404);
  const want = new Set((Array.isArray(ns) ? ns : []).map(Number).filter((n) => n > 0));
  const frags = (rec.fragments || []).filter((f) => want.has(f.n) && !f.deletedAt).sort((a, b) => (a.rank || 0) - (b.rank || 0));
  if (!frags.length) throw _err(I18N.t('none of these fragments is here'), 400);
  const a = adv && typeof adv === 'object' ? adv : null;
  const busy = new Set(MVQ().entriesOf((x) => _mine(id)(x) && x.status === 'running').map((x) => x.hl.n));
  const batch = 'b' + Date.now().toString(36);
  const list = [];
  const skipped = [];
  for (const f of frags) {
    const skip = (why) => skipped.push({ n: f.n, title: f.title, why });
    if (f.state !== 'ready' || !f.key) { skip(I18N.t('not made yet')); continue; }
    if (busy.has(f.n)) { skip(I18N.t('rendering now')); continue; }
    const tl = MSTORE.one(f.key);
    if (!tl || !Array.isArray(tl.tracks)) { skip(I18N.t('its timeline is gone')); continue; }
    const gone = JOB.missingCount(tl);
    if (gone) { skip(I18N.tn(gone, '{n} clip has no file', '{n} clips have no file')); continue; }
    list.push({ key: f.key, title: f.title, timeline: tl, adv: a, dur: _dur(tl), hl: { id: rec.id, n: f.n }, rev: Number(tl.rev) || 0, batch });
  }
  if (list.length) {
    // The fragment's entry already waiting, interrupted or failed is replaced by this one.
    const ns2 = new Set(list.map((x) => x.hl.n));
    MVQ().removeWhere((x) => _mine(id)(x) && ns2.has(x.hl.n));
    if (a) {
      MSTORE.setAdv(list.map((x) => x.key), a);
      HL.apply(id, (r) => { r.renderAdv = a; });
    }
    MVQ().addArmed(list);
  }
  return { queued: list.map((x) => x.hl.n), skipped };
}

function stop(id) {
  return MVQ().stopWhere(_mine(id));
}

// ── The queue's questions and word ──────────────────────────────────────────
/** When an entry's turn comes: the name its file takes - the fragment's as it is now - and its own earlier render's address. */
function target(item) {
  const hl = (item && item.hl) || {};
  const f = _frag(HL.get(hl.id), hl.n);
  return {
    name: (f && f.title) || (item && item.title) || 'render',
    replace: f && f.render && f.render.url ? String(f.render.url) : '',
  };
}

// A render of a fragment let go of: its file and what was derived from it, and its entry in the queue. Only in the renders
// folder - never anything else.
function _dropRender(url) {
  const abs = toDiskWithin(url, [MEDIA.renders]);
  if (!abs) return;
  JOB.dropDerived(abs);
  try { fs.rmSync(abs, { force: true }); } catch (e) { console.warn('[highlights] an older render stays (' + e.message + ')'); }
  try { MVQ().removeByUrl(url); } catch (e) { /* not listed */ }
}

/** An entry's file is made: the fragment learns it; its earlier render under another name goes. */
function rendered(item, abs) {
  const hl = item.hl;
  const url = toUrl(abs);
  const srtAbs = JOB.srtOf(abs);
  const srt = fs.existsSync(srtAbs) ? toUrl(srtAbs) : null;
  let old = '';
  const rec = HL.apply(hl.id, (r) => {
    const f = _frag(r, hl.n);
    if (!f) return false;
    old = f.render && f.render.url && f.render.url !== url ? String(f.render.url) : '';
    f.render = { url, srt, at: new Date().toISOString(), rev: Number(item.rev) || 0, seconds: Number(item.dur) || null, queueId: item.id };
    return true;
  });
  if (!rec || !_frag(rec, hl.n)) return;
  if (old) _dropRender(old);
  // Its older finished entries in the queue named a render this one has replaced: one row a fragment.
  try { MVQ().forgetWhere((x) => _mine(hl.id)(x) && x.hl.n === Number(hl.n) && x.id !== item.id && x.status === 'done'); }
  catch (e) { /* the queue keeps them */ }
  // Renamed while it was rendering: the file follows now.
  try { renamed(hl.id, hl.n); } catch (e) { console.warn('[highlights] a render kept its old name:', e.message); }
}

/** The fragment's render file under the fragment's name (and its subtitles with it). Returns the new address, or null. */
function renamed(id, n) {
  const f = _frag(HL.get(id), n);
  const r = f && f.render;
  if (!r || !r.url) return null;
  const abs = toDiskWithin(r.url, [MEDIA.renders]);
  if (!abs || !fs.existsSync(abs)) return null;
  const dir = path.dirname(abs);
  const here = path.basename(abs);
  let taken = [];
  try { taken = fs.readdirSync(dir).filter((x) => /\.mp4$/i.test(x) && !JOB.isDraft(x) && x !== here).map((x) => x.replace(/\.mp4$/i, '')); }
  catch (e) { /* read below */ }
  const stem = uniqueName(folderName(f.title, 'render'), taken);
  // The same name - or only its case changed, which Windows does not see as another name: it stays.
  if ((stem + '.mp4').toLowerCase() === here.toLowerCase()) return null;
  const to = path.join(dir, stem + '.mp4');
  const files = [[toUrl(abs), toUrl(to)]];
  const srt = JOB.srtOf(abs);
  if (fs.existsSync(srt)) files.push([toUrl(srt), toUrl(JOB.srtOf(to))]);
  require('./relocate').relocate({ files });
  if (r.queueId) { try { MVQ().updateEntry(r.queueId, { title: f.title }); } catch (e) { /* not listed */ } }
  return toUrl(to);
}

// ── What the field is shown ─────────────────────────────────────────────────
// Seconds of encoding a second of film takes, as this project's renders took it (the median of the last ones); 0.3 until
// one has been made here (0.27 was measured).
function _ratio(entries) {
  const r = entries.filter((e) => e.status === 'done' && e.tookMs > 0 && e.dur > 0).slice(-7)
    .map((e) => e.tookMs / 1000 / e.dur).sort((a, b) => a - b);
  return r.length ? r[Math.floor(r.length / 2)] : 0.3;
}

function viewOf(rec) {
  const entries = MVQ().entriesOf(_mine(rec.id));
  const last = new Map();
  for (const e of entries) {
    const p = last.get(e.hl.n);
    if (!p || String(e.addedAt) >= String(p.addedAt)) last.set(e.hl.n, e);
  }
  const ratio = _ratio(entries);
  const byN = {};
  let left = 0, live = 0, interrupted = 0, failed = 0;
  // The rendered fragments' timelines read at once (lib/merge-store.js many), not the store's index once each.
  const tls = MSTORE.many((rec.fragments || []).filter((f) => f.key && f.render && f.render.url).map((f) => f.key));
  for (const f of (rec.fragments || [])) {
    const e = last.get(f.n);
    let line = null;
    if (e && e.status !== 'done') {
      if (e.status === 'running') {
        const pc = Math.max(0, Math.min(100, Number(e.percent) || 0));
        line = { state: 'running', percent: pc, remain: e.remain != null ? e.remain : null, phase: e.phase || null };
        left += e.remain != null ? e.remain : (e.dur || 30) * ratio * (1 - pc / 100);
        live++;
      } else if (e.status === 'queued' && e.armed) {
        line = { state: 'line', ahead: e.ahead };
        left += (e.dur || 30) * ratio;
        live++;
      } else if (e.status === 'queued') {
        line = { state: 'interrupted' };
        interrupted++;
      } else if (e.status === 'failed') {
        line = { state: 'failed', error: e.error || I18N.t('it failed') };
        failed++;
      }
      if (line) line.queueId = e.id;
    }
    let render = null;
    const r = f.render;
    if (r && r.url && _exists(r.url)) {
      const tl = f.key ? (tls.get(String(f.key)) || null) : null;
      // `rev`: the open fragment's page compares it with its own timeline as it saves (highlights.js).
      render = { url: r.url, srt: r.srt && _exists(r.srt) ? r.srt : null, at: r.at || null, seconds: r.seconds || null,
        rev: Number(r.rev) || 0, changed: !!(tl && (Number(tl.rev) || 0) > (Number(r.rev) || 0)) };
    }
    byN[f.n] = { line, render };
  }
  // The last press's batch: "rendering 2 of 5".
  let rendering = null;
  if (live) {
    const lastBatch = entries.filter((e) => e.batch).map((e) => e.batch).sort().pop() || '';
    const batch = entries.filter((e) => e.batch && e.batch === lastBatch);
    const done = batch.filter((e) => e.status === 'done').length;
    rendering = { live, of: Math.max(batch.length, live), done, left: Math.round(left) };
  }
  return { byN, rendering, interrupted, failed };
}

module.exports = { render, stop, target, rendered, renamed, viewOf };
