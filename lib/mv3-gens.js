'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE'S GENERATIONS — one record per picture asked for, kept BY PROJECT.
//
// A picture made inside a Merge project belongs to that project. Close the popup, open it
// again from another lane, come back tomorrow: the strip on the right shows the same run of
// work, because the run is the project's and not the window's. That is the whole reason this
// store exists rather than a list in the page's memory.
//
// It is not a second library. The finished picture goes onto the images shelf like everything
// else and lives there for good; what is kept here is the ATTEMPT - what was asked for, of
// whom, whether it arrived, and why it did not. Those are the three states a strip has to be
// able to draw, and only one of them ever becomes a file.
//
// ── Who finishes the job ────────────────────────────────────────────────────
// The watcher is here rather than in the browser because the browser closes. A generation
// submitted and then abandoned would otherwise be paid for and never collected.
//
// lib/pending-tasks.js is the other net and is deliberately NOT used: it can download a file
// but it cannot file one on a shelf or mark this record done, so a task recovered by it would
// land in uploads/ with nothing pointing at it. resume() below does that job instead - every
// record still marked pending when the server starts gets its watcher back, because the record
// is on disk and the watcher never was.
//
// resolveTask is shared, and that is the part worth sharing: it already knows a kie task from
// a Replicate one from an OpenRouter one, and it is idempotent - asked twice about a file it
// has already fetched, it hands back the same path rather than paying again.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { DATA_DIR, UPLOADS_DIR } = require('./config');
const { resolveTask, uploadToPublicHost, noteHostFailure, hostOfUrl } = require('./helpers');
const { ROOT_DIR } = require('./config');
const IMG = require('./images-store');
const LC = require('./library-cats');
const MV = require('./mv3-img');

const FILE = path.join(DATA_DIR, 'mv3-gens.json');
const PREFIX = 'mgen';

// ── Which shelf-category a picture lands in ─────────────────────────────────
// The project's own name, so a library full of generations can be read back by the film they
// were made for. A category label is capped at 60 characters and a project title at 120, so the
// rule for shortening one into the other lives HERE and is exported - the rename route has to
// find the existing category by exactly the name this made, and two copies of a slicing rule
// are two rules waiting to disagree.
//
// Nothing belongs to no project - a generation made before a project exists - so those keep the
// old catch-all. It is also where every picture made before this existed already sits.
const LOOSE_CAT = 'Generated';
const catLabelFor = (title) => String(title || '').trim().slice(0, 60) || LOOSE_CAT;

// The titles live in the timeline store, which belongs to routes/mergev3.js. Read rather than
// asked for: this runs in a watcher that may outlive the page by minutes, so the title cannot
// be handed in at submit time and trusted - it may have been renamed since.
function _titleOf(key) {
  if (!key) return '';
  try {
    const f = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'merge-v3.json'), 'utf8'));
    const rec = (f.timelines || {})[key];
    return (rec && rec.title) || '';
  } catch (e) { return ''; }
}

// How long a watcher waits before letting go. Longer than any page would: nobody is staring at
// this one, and a 4K sheet can genuinely take ten minutes. Giving up does NOT mark the record
// failed - the aggregator may still be working, and saying "failed" would throw away a picture
// that is on its way. It stays pending and the next server start picks it up again.
const EVERY_MS = 4000;
const LIMIT_MS = 12 * 60 * 1000;

// Per project, oldest done records fall off past this. A strip nobody has cleared for a month
// is not a reason for a file that grows forever.
const KEEP_PER_PROJECT = 300;

// ── The file ────────────────────────────────────────────────────────────────
// Read-modify-write, synchronously, on every change: several watchers finish at once and each
// one is a whole-file write, so the read and the write have to happen without an await between
// them. In one node process that is enough to make them atomic with respect to each other.
function _read() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}

function _write(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

const _newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function _patch(id, fields) {
  const list = _read();
  const i = list.findIndex(r => r && r.id === id);
  if (i < 0) return null;
  list[i] = Object.assign({}, list[i], fields);
  _write(list);
  return list[i];
}

// Newest first, which is the order the strip draws in - the thing just asked for should be at
// the top rather than at the end of a scroll.
function list(project) {
  const p = String(project == null ? '' : project);
  return _read().filter(r => r && String(r.project || '') === p);
}

function get(id) {
  return _read().find(r => r && r.id === id) || null;
}

// Off the strip, not off the shelf. The picture is in the library and stays there - this is the
// same bargain the timeline makes when a clip is removed, and it is the one people expect from
// a list of past attempts.
function remove(id) {
  const list0 = _read();
  const rec = list0.find(r => r && r.id === id);
  if (!rec) return false;
  _write(list0.filter(r => r && r.id !== id));
  // And out of the conversation, or the thread would show a turn whose picture no longer
  // exists. Required late rather than at the top because mv3-chat requires this file - asking
  // for it here is what keeps the two from having to be loaded in a particular order.
  try { require('./mv3-chat').dropForGen(id); } catch (e) {}
  return true;
}

function _trim(project) {
  const all = _read();
  const mine = all.filter(r => r && String(r.project || '') === String(project || ''));
  if (mine.length <= KEEP_PER_PROJECT) return;
  // Only settled records are dropped, and the oldest first. A pending one is still owed an
  // answer, however far down the list it has sunk.
  const doomed = new Set(mine.filter(r => r.state !== 'pending')
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .slice(0, mine.length - KEEP_PER_PROJECT).map(r => r.id));
  if (!doomed.size) return;
  _write(all.filter(r => !doomed.has(r.id)));
}

// ── The watcher ─────────────────────────────────────────────────────────────
const _live = new Set();      // ids being watched right now, so resume() cannot double up

async function _file(rec, imagePath) {
  // The shelf gets a category so these are findable among uploads and screenshots. LC.add is
  // idempotent by label - it hands back the existing chip rather than making a second one,
  // which is what makes one category per project cost nothing to maintain.
  let cat = { id: '', label: '' };
  try { cat = LC.add('images', catLabelFor(_titleOf(rec.project))).cat || cat; } catch (e) {}
  const name = String(rec.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 60) || rec.engine;
  const { item } = await IMG.add(imagePath, {
    name,
    source: 'gen',
    categoryId: cat.id,
    categoryLabel: cat.label,
    // What made it. The project is the reason the strip can be rebuilt from the shelf alone if
    // this store is ever lost, and the rest is what makes one apple tellable from another.
    meta: {
      project: rec.project || null, engine: rec.engine, provider: rec.provider,
      model: rec.model || '', quality: rec.quality, aspect: rec.aspect, prompt: rec.prompt,
      said: rec.said || '', refs: (rec.refs || []).slice(0, 14),
    },
  });
  return item;
}

function _watch(rec) {
  if (!rec || !rec.taskId || _live.has(rec.id)) return;
  _live.add(rec.id);
  const started = Date.now();

  (async () => {
    while (Date.now() - started < LIMIT_MS) {
      await new Promise(r => setTimeout(r, EVERY_MS));
      let out;
      try {
        out = await resolveTask(rec.taskId, UPLOADS_DIR, PREFIX);
      } catch (e) {
        // A refused poll is not a refused generation - the network hiccups, kie rate-limits.
        continue;
      }
      if (out && out.state === 'success') {
        let item = null;
        try { item = await _file(rec, out.imagePath); }
        catch (e) { console.warn('[mv3-gens] could not file', out.imagePath, '-', e.message); }
        _patch(rec.id, {
          state: 'done', imagePath: out.imagePath, imageId: (item && item.id) || '',
          w: (item && item.w) || 0, h: (item && item.h) || 0,
          doneAt: new Date().toISOString(), secs: Math.round((Date.now() - started) / 1000),
        });
        _trim(rec.project);
        console.log('[mv3-gens] done', rec.id, rec.engine + '@' + rec.provider, '->', out.imagePath);
        _live.delete(rec.id);
        return;
      }
      if (out && out.state === 'failed') {
        // THE ONE FAILURE WORTH A SECOND TRY, and the reason the ladder never caught it: this
        // happens at POLL time. The aggregator accepted the job, took a minute, and only then
        // discovered it could not read the reference - by which point submitWithFallback has
        // long returned and there is nobody left to fall through to.
        //
        // So the rescue lives here. Same model, same aggregator - the choice was deliberate and
        // nothing was wrong with it - but the pictures go somewhere else first.
        const cur = get(rec.id) || rec;
        if (!cur.rescued && (cur.refs || []).length && _isFetchFailure(out.error)) {
          const bad = (cur.hosted || []).map(u => hostOfUrl(u)).filter(Boolean);
          for (const u of (cur.hosted || [])) { try { noteHostFailure(u); } catch (e) {} }
          console.warn('[mv3-gens] rescue', rec.id, '- could not read', bad.join(', ') || 'the host',
            '- trying somewhere else');
          try {
            const fresh = await _hostRefs(cur.refs, bad);
            const sub = await MV.submitImage({
              engine: cur.engine, provider: cur.provider, prompt: cur.prompt,
              aspect: cur.aspect, quality: cur.quality, imageUrls: fresh,
            });
            const live = _patch(rec.id, {
              taskId: sub.taskId, hosted: fresh, rescued: true,
              error: 'the first host could not be read - moved to ' + (hostOfUrl(fresh[0]) || 'another host'),
            });
            _live.delete(rec.id);
            _watch(live);
            return;
          } catch (e2) {
            console.warn('[mv3-gens] rescue failed for', rec.id, '-', e2.message);
          }
        }
        _patch(rec.id, {
          state: 'failed', error: String(out.error || 'the generation failed').slice(0, 400),
          doneAt: new Date().toISOString(), secs: Math.round((Date.now() - started) / 1000),
        });
        console.log('[mv3-gens] failed', rec.id, '-', out.error);
        _live.delete(rec.id);
        return;
      }
    }
    // Left pending on purpose - see the note at the top of the file.
    console.log('[mv3-gens] gave up watching', rec.id, '- still pending, will resume on restart');
    _live.delete(rec.id);
  })().catch(e => {
    _live.delete(rec.id);
    console.warn('[mv3-gens] watcher crashed for', rec.id, '-', e.message);
  });
}

// ── References, made reachable ──────────────────────────────────────────────
// A picture in this app lives at /uploads/x.jpg, which means nothing to a renderer in another
// datacentre. So anything attached is put on a public host first and the aggregator is handed
// that link instead. What is stored on the record is the LOCAL path: the public link expires,
// the local one does not, and the strip has to be able to draw the attachment tomorrow.
//
// `verify` reads the link back before it is used. It cannot prove the AGGREGATOR can read it -
// only that it is there and is an image - but an upload that half-failed is the cheap half of
// the problem and this catches it before a task is paid for.
//
// CATBOX IS NOT OFFERED FOR A REFERENCE. Measured, one job, two aggregators, two minutes apart:
// kie answered "Timeout while downloading url: https://files.catbox.moe/..." and Replicate
// answered "Connection aborted / RemoteDisconnected", which is the same complaint in its own
// words. It is reachable from HERE - which is what makes it so easy to blame the wrong thing -
// and unreliable from theirs. It stays in the rotation for everything else.
//
// The real answer is PUBLIC_HOST_URL, which makes this app serve the file itself; with it set,
// `own-server` is first in the rotation and none of this arises.
const REF_AVOID = ['catbox.moe', 'litterbox.catbox.moe'];

async function _hostRefs(paths, avoid) {
  const skip = REF_AVOID.concat(avoid || []);
  const out = [];
  for (const rel of (paths || [])) {
    const clean = String(rel || '').trim();
    if (!clean) continue;
    if (/^https?:\/\//i.test(clean)) { out.push(clean); continue; }
    const abs = path.join(ROOT_DIR, clean.replace(/^\/+/, ''));
    if (!fs.existsSync(abs)) throw new Error('no such picture: ' + clean);
    out.push(await uploadToPublicHost(fs.readFileSync(abs), {
      ext: (clean.split('.').pop() || 'jpg'),
      avoid: skip, verify: true, forceFresh: !!(avoid && avoid.length),
    }));
  }
  return out;
}

// ── When the failure is about OUR host, not their model ─────────────────────
// These two sentences mean the same thing and neither says so:
//
//   kie        "Timeout while downloading url: https://files.catbox.moe/zp8tdr.jpg"
//   Replicate  "Input validation error: ('Connection aborted.', RemoteDisconnected(...))"
//
// Nothing is wrong with the picture, the prompt or the model. The renderer simply could not
// pull the file off whichever host we happened to use - and the only useful retry is one that
// puts the file somewhere else.
const FETCH_FAIL = new RegExp([
  'timeout while downloading', 'read timed out', 'connectionpool', 'failed to fetch',
  'could not (download|fetch)', 'unable to (download|fetch)', 'image fetch failed',
  'error downloading', 'connection aborted', 'remotedisconnected', 'remote end closed',
].join('|'));

function _isFetchFailure(msg) {
  return FETCH_FAIL.test(String(msg || '').toLowerCase());
}

// ── Asking for a picture ────────────────────────────────────────────────────
// The record is written BEFORE the submit answers, so a strip can show the attempt while it is
// still being made and a crash between the two leaves something to explain rather than silence.
async function start(opts) {
  const o = opts || {};
  const rec = {
    id: _newId(),
    project: String(o.project == null ? '' : o.project),
    prompt: String(o.prompt || '').trim().slice(0, 20000),
    // What the person actually typed, when the prompt above was written for them. Kept beside
    // it rather than instead of it: a picture that came out wrong has to be arguable, and that
    // needs both halves - what was asked for and what was sent.
    said: String(o.said || '').trim().slice(0, 20000),
    engine: String(o.engine || ''),
    provider: String(o.provider || ''),
    model: '',
    quality: String(o.quality || ''),
    aspect: String(o.aspect || ''),
    state: 'pending',
    // The LOCAL paths of what was attached, in the order they were attached - which is the order
    // the numbers on them refer to. Kept so the strip can draw the attachment long after the
    // public link it was uploaded to has expired.
    refs: (Array.isArray(o.refs) ? o.refs : []).map(String).filter(Boolean).slice(0, 14),
    // Where those references were PUT for the aggregator to read. Kept because a job that dies
    // fetching them has to be able to name the host that failed and pick a different one.
    hosted: [],
    rescued: false,
    taskId: '', imagePath: '', imageId: '', w: 0, h: 0,
    error: '', tried: [],
    at: new Date().toISOString(), doneAt: '', secs: 0,
  };
  if (!rec.prompt) throw new Error('a prompt is needed');

  const list0 = _read();
  list0.unshift(rec);
  _write(list0);

  let sub;
  try {
    // Hosting happens INSIDE the try, so a picture that cannot be uploaded fails the record with
    // a reason rather than throwing past it and leaving a row stuck on pending forever.
    const urls = await _hostRefs(rec.refs);
    if (urls.length) _patch(rec.id, { hosted: urls });
    sub = await MV.submitWithFallback({
      engine: rec.engine, provider: rec.provider, prompt: rec.prompt,
      aspect: rec.aspect, quality: rec.quality, imageUrls: urls,
      // Written down as it happens: "kie could not, trying Replicate" is worth showing while it
      // is true, not only in the log afterwards.
      onAttempt: (a) => { _patch(rec.id, { error: a.label + ': ' + String(a.error).slice(0, 200) }); },
    });
  } catch (e) {
    const why = String(MV.reasonOf(e)).slice(0, 400);
    _patch(rec.id, { state: 'failed', error: why, doneAt: new Date().toISOString() });
    throw e;
  }

  const live = _patch(rec.id, {
    taskId: sub.taskId, provider: sub.provider, quality: sub.quality, aspect: sub.aspect,
    model: sub.model || '', tried: sub.tried || [], error: '',
  });
  _watch(live);
  return live;
}

// Every record still marked pending when the server starts gets its watcher back. The record
// survived the restart; the loop did not.
function resume() {
  const pending = _read().filter(r => r && r.state === 'pending' && r.taskId);
  if (!pending.length) return 0;
  console.log('[mv3-gens] resuming', pending.length, 'generation(s) left over from last run');
  for (const r of pending) _watch(r);
  return pending.length;
}

module.exports = { FILE, LOOSE_CAT, catLabelFor, list, get, remove, start, resume };
