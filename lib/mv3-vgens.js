'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — the clips this project has asked for, and the watcher that carries them home.
//
// The picture store's twin, and deliberately NOT the picture store with a flag in it. The
// record shape is nearly the same; everything that happens to a record is not. A clip is
// polled at a different door, needs a poster frame made for it, and is filed on the Birols
// shelf rather than the images one. Three branches in one file would have been three places
// where the picture path could be broken by a video change.
//
// WHY THE SERVER WATCHES AND NOT THE PAGE. A clip takes minutes. Closing the window, opening
// another project, reloading - none of those should cost the generation that was already paid
// for. So the submit records the task and this file follows it to the end; the window only
// reads the list.
//
// A RECORD LEFT PENDING IS NOT A LOST ONE. The watcher gives up after an hour and says so, and
// resume() picks every pending record back up on the next boot. The alternative - marking it
// failed - would tell somebody their money was gone while the aggregator was still working.
//
// EACH ENGINE GETS A CATEGORY OF ITS OWN, by name. Which model made a clip is the one thing you
// cannot see by looking at it, and it is what you sort by when a model turns out to be the good
// one. LC.add is idempotent by label, so asking for the category every time is the same as
// asking whether it exists.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('./config');
const LC = require('./library-cats');
const VT = require('./video-thumb');

const FILE = path.join(DATA_DIR, 'mv3-vgens.json');
const BIROLY_FILE = path.join(DATA_DIR, 'biroly.json');

const EVERY_MS = 5000;
const LIMIT_MS = 60 * 60 * 1000;      // an hour, then it is left for resume()
const KEEP_PER_PROJECT = 300;

// Required late. routes/video-engines requires lib/config and lib/helpers, and asking for it at
// the top of a lib/ file is the shape that turns into a cycle the first time something else
// changes. Both halves are hung on the router - see the note there.
const _vroutes = () => require('../routes/video-engines');

const _newId = () => 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function _read() {
  try {
    const v = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(v) ? v.filter(Boolean) : [];
  } catch (e) { return []; }
}

// Read-modify-write, synchronously: several writes can land in one tick and each is a
// whole-file write.
function _write(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

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

const get = (id) => _read().find(r => r && r.id === id) || null;

// Off the strip, not off the shelf. The clip is in the library and stays there.
function remove(id) {
  const all = _read();
  if (!all.some(r => r && r.id === id)) return false;
  _write(all.filter(r => r && r.id !== id));
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

// ── Onto the Birols shelf ───────────────────────────────────────────────────
// Written straight into the store rather than posted to our own route: this is the server, and
// a process making an HTTP call to itself to write a file it can already reach is a round trip
// that can fail for reasons that have nothing to do with the work.
function _file(rec, videoPath, thumbPath) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(BIROLY_FILE, 'utf8')) || {}; } catch (e) {}
  const arch = Array.isArray(s.archive) ? s.archive : [];
  if (arch.some(e => e && e.videoPath === videoPath)) return null;

  let cat = { id: '', label: '' };
  try { cat = LC.add('birols', rec.engine).cat || cat; } catch (e) {}

  const item = {
    id: 'lib' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(rec.prompt || rec.engine).replace(/\s+/g, ' ').trim().slice(0, 90) || rec.engine,
    prompt: String(rec.prompt || '').slice(0, 2000),
    videoPath,
    thumbPath: thumbPath || null,
    imagePath: thumbPath || null,
    categoryId: cat.id, categoryLabel: cat.label,
    status: 'done',
    date: new Date().toISOString(),
  };
  // WHERE IT CAME FROM. A clip animated out of a still keeps a path back to that picture, so
  // the viewer can show what it was made from - a generated six seconds is very hard to place
  // months later, and the reference frame is the one thing that identifies it.
  const still = (rec.refs || []).find(p => !/\.(mp4|mov|webm|mkv)$/i.test(String(p)));
  if (still) item.refImage = still;

  arch.unshift(item);
  s.archive = arch;
  const tmp = BIROLY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
  fs.renameSync(tmp, BIROLY_FILE);
  return item;
}

// ── The watcher ─────────────────────────────────────────────────────────────
const _live = new Set();      // ids being watched right now, so resume() cannot double up

function _watch(rec) {
  if (!rec || !rec.taskId || _live.has(rec.id)) return;
  _live.add(rec.id);
  const started = Date.parse(rec.at) || Date.now();

  (async () => {
    while (Date.now() - started < LIMIT_MS) {
      await new Promise(r => setTimeout(r, EVERY_MS));
      let out;
      // A refused poll is not a refused generation - the network hiccups, an aggregator
      // rate-limits. Ask again.
      try { out = await _vroutes().checkVideoTask(rec.taskId); } catch (e) { continue; }

      if (out && out.state === 'success' && out.videoPath) {
        let thumb = null;
        // A poster frame, and its absence is survivable: the shelf draws a blank tile rather
        // than losing the clip, which is the right trade for a frame grab.
        //
        // makeThumb answers a RECORD - { thumb, w, bytes } - and not a path. Taken whole it
        // reaches the page as "[object Object]" in a src attribute, which is a broken poster
        // that looks exactly like a missing one.
        try {
          const t = await VT.makeThumb(out.videoPath);
          thumb = (t && typeof t === 'object') ? (t.thumb || null) : (t || null);
        } catch (e) { console.warn('[mv3-vgens] no thumb for', out.videoPath, '-', e.message); }
        let item = null;
        try { item = _file(rec, out.videoPath, thumb); }
        catch (e) { console.warn('[mv3-vgens] could not file', out.videoPath, '-', e.message); }
        _patch(rec.id, {
          state: 'done', videoPath: out.videoPath, thumbPath: thumb || '',
          libId: (item && item.id) || '',
          doneAt: new Date().toISOString(), secs: Math.round((Date.now() - started) / 1000),
        });
        _trim(rec.project);
        console.log('[mv3-vgens] done', rec.id, rec.engine + '@' + rec.provider, '->', out.videoPath);
        _live.delete(rec.id);
        return;
      }

      if (out && out.state === 'failed') {
        _patch(rec.id, {
          state: 'failed', error: String(out.error || 'the generation failed').slice(0, 400),
          doneAt: new Date().toISOString(), secs: Math.round((Date.now() - started) / 1000),
        });
        console.log('[mv3-vgens] failed', rec.id, '-', out.error);
        _live.delete(rec.id);
        return;
      }
    }
    // Left pending on purpose - see the note at the top of the file.
    console.log('[mv3-vgens] gave up watching', rec.id, '- still pending, will resume on restart');
    _live.delete(rec.id);
  })().catch(e => {
    _live.delete(rec.id);
    console.warn('[mv3-vgens] watcher crashed for', rec.id, '-', e.message);
  });
}

/**
 * Ask for a clip. Answers the RECORD, not the clip: the clip is minutes away and the strip has
 * something to draw in the meantime.
 */
async function start(opts) {
  const o = opts || {};
  const refs = (Array.isArray(o.refs) ? o.refs : []).map(String).filter(Boolean).slice(0, 4);
  const isVid = (p) => /\.(mp4|mov|webm|mkv)$/i.test(String(p));
  const imagePath = refs.find(p => !isVid(p)) || '';
  const videoPath = refs.find(isVid) || '';

  const rec = {
    id: _newId(),
    project: String(o.project == null ? '' : o.project),
    prompt: String(o.prompt || '').trim().slice(0, 20000),
    // What the person actually typed, when the prompt above was written for them. Kept beside
    // it rather than instead of it: a clip that came out wrong has to be arguable, and that
    // needs both halves - what was asked for and what was sent.
    said: String(o.said || '').trim().slice(0, 20000),
    engine: String(o.engine || ''),
    provider: String(o.provider || ''),
    aspect: String(o.aspect || '9:16'),
    params: (o.params && typeof o.params === 'object') ? o.params : {},
    state: 'pending',
    refs,
    // The segment of the motion clip that was chosen, so a record can say what was actually
    // sent - the whole file is usually longer than what the model was given.
    videoIn: +o.videoIn || 0,
    videoOut: +o.videoOut || 0,
    hosted: [],
    taskId: '', videoPath: '', thumbPath: '', libId: '',
    error: '', at: new Date().toISOString(), doneAt: '', secs: 0,
  };

  const list0 = _read();
  list0.unshift(rec);
  _write(list0);

  try {
    const sub = await _vroutes().submitAnimate({
      engine: rec.engine, provider: rec.provider, prompt: rec.prompt,
      imagePath, videoPath, videoIn: rec.videoIn, videoOut: rec.videoOut,
      params: rec.params,
    });
    const live = _patch(rec.id, {
      taskId: String(sub.taskId), provider: sub.provider || rec.provider,
      hosted: sub.hosted || [],
    });
    _watch(live);
    return live;
  } catch (e) {
    // A submit that never happened is a failure the person can see and act on, not a record
    // left pending forever waiting for a task that was never made.
    const dead = _patch(rec.id, {
      state: 'failed', error: String(e.message || e).slice(0, 400),
      doneAt: new Date().toISOString(),
    });
    console.warn('[mv3-vgens] submit failed', rec.id, '-', e.message);
    return dead;
  }
}

// Every unfinished job picked back up. Called once on boot: the process that was watching them
// is gone, and the aggregator has been working the whole time.
function resume() {
  const pend = _read().filter(r => r && r.state === 'pending' && r.taskId);
  if (pend.length) console.log('[mv3-vgens] resuming', pend.length, 'unfinished clip(s)');
  for (const r of pend) _watch(r);
}

module.exports = { FILE, list, get, remove, start, resume };
