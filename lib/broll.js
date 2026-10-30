'use strict';

/* broll.js - THE B-ROLL ENGINE (phase V62, block 1; docs/local-app/plan/ "Фаза V62"; the old phase U). A voiceover's picture: for
   every sentence of its voice a batch of videos and pictures from the stock, laid on main video edge to edge through the voice.

   THE WORK, one run per project (find / setMode / relay - routes/broll.js; the page's field 2 follows `state`):
     1. the script as it is SPOKEN - each live line's cell on main audio (its span) and its words with their moments, from its
        caption pages (bound to the read by `voice`, lib/frag-mirror.js); a line not heard yet stops `find` in words
     2. its sentences and their pieces (lib/broll-plan.js)
     3. (`find` only) for the sentences with no batch yet: the agent's two ENGLISH queries for each - ONE call for all of them,
        whatever the language of the script (the owner: "ключевики должны быть на английском языке"); then the stock (lib/stock.js)
        for each: up to BATCH videos and BATCH pictures, vertical and horizontal ((во7), (во19))
     4. the deal: which item of its sentence's batch stands in each piece - at random, kept from run to run (a sentence's piece
        keeps its item when the voice is retimed), by the mode ((во24): mixed / only videos / only pictures)
     5. the items dealt that are not in the library yet are downloaded and filed - videos into VIDEO -> Uploads -> Stock, pictures
        into IMAGES -> Stock ((во11), (во22), (во23): only what is laid)
     6. the pieces laid in ONE tick on main video (`v1`): every cell of the engine is replaced, the person's own cells are never
        touched and the pieces give way to them ((во12): "туда, где main video пуст"); no sound, Fill, and `pip` - so a piece
        shrunk by hand stands over its own blur ((во20), (во26)) - the PiP of main drawn full-frame is the plain Fill.

   AN ENGINE CELL IS KNOWN BY ITS ID - `br_<line>_<sentence>_<piece>[_<part>]`: the page's save keeps only the fields a clip has
   (lib/timeline-shape.js), so no mark of ours would survive it.

   ITS MEMORY is projects/<folder>/broll.json (beside project.json, which the talking head's normaliser rewrites whole and would
   drop it from): the mode; per sentence (`<line>:<k>:<hash of its words>` - a line read again with the same words keeps its
   sentences, new words make new ones, empty until the next find - (во13)) its queries, batch and deal; per item downloaded its
   library record's id (the path is read from the store each time: a folder renamed moves it).

   NO ALERTS ROW ((во14)): the stock is free, the agent's keywords are fractions of a cent - as the voices. A run cut by the app
   closing leaves what it laid; the next press finishes. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PROJECTS = require('./projects-store');
const MSTORE = require('./merge-store');
const PLAN = require('./broll-plan');
const STOCK = require('./stock');
const FAKE = require('./fake-agg');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR, MEDIA } = require('./config');

const BATCH = 12;             // videos, and pictures, per sentence ((во19))
const MODES = ['mixed', 'video', 'image'];
const MIN_PART = 0.3;         // a piece cut by the person's own cell keeps a part only this long or longer
const _runs = new Map();      // projectId -> { running, step, done, total, error, again }

const _r3 = (x) => Math.round(x * 1000) / 1000;
const _err = (msg, status) => Object.assign(new Error(msg), { status: status || 409 });
const _keyOf = (s) => s.line + ':' + s.k + ':' + crypto.createHash('sha1').update(String(s.text)).digest('hex').slice(0, 8);

// ── Its memory ──────────────────────────────────────────────────────────────
function _file(id) {
  const dir = PROJECTS.dirOf(id);
  return dir ? path.join(dir, 'broll.json') : null;
}
function _load(id) {
  const f = _file(id);
  let j = null;
  try { j = f ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch (e) { j = null; }
  j = j && typeof j === 'object' ? j : {};
  return { v: 1, mode: MODES.includes(j.mode) ? j.mode : 'mixed', sentences: j.sentences || {}, files: j.files || {} };
}
function _save(id, B) {
  const f = _file(id);
  if (f) writeFileAtomic(f, JSON.stringify(B, null, 2));
}

// ── 1. The script as it is spoken ───────────────────────────────────────────
function _spoken(id) {
  const proj = PROJECTS.get(id);
  if (!proj) throw _err('no such project', 404);
  if (proj.type !== 'voiceover') throw _err('B-roll is found for a voiceover');
  const tl = (MSTORE.read().timelines || {})['sv3_' + id];
  if (!tl) throw _err('this voiceover has no timeline yet');
  const tracks = Array.isArray(tl.tracks) ? tl.tracks : [];
  const a1 = tracks.find(t => t && t.id === 'a1') || { clips: [] };
  const subs = tracks.find(t => t && t.kind === 'subs') || { clips: [] };
  const lines = [];
  const unheard = [];
  const unread = [];
  (proj.lines || []).forEach((l, i) => {
    if (!l || l.removed) return;
    const cells = (a1.clips || []).filter(c => Number(c && c.frag) === i + 1);
    if (!cells.length) { unread.push(i + 1); return; }
    const from = Math.min(...cells.map(c => +c.start || 0));
    const to = Math.max(...cells.map(c => (+c.start || 0) + (+c.dur || 0)));
    const voices = new Set(cells.map(c => c.voice).filter(Boolean));
    const words = [];
    for (const p of (subs.clips || [])) {
      if (!p || !voices.has(p.voice) || !Array.isArray(p.words)) continue;
      for (const w of p.words) {
        if (!w || !String(w.w || '').trim()) continue;
        words.push({ text: String(w.w), start: _r3((+p.start || 0) + (+w.s || 0)), end: _r3((+p.start || 0) + (+w.e || +w.s || 0)) });
      }
    }
    words.sort((a, b) => a.start - b.start);
    if (!words.length) unheard.push(i + 1);
    lines.push({ line: i, from, to, words });
  });
  return { proj, tl, lines, unheard, unread, text: (proj.lines || []).filter(l => l && !l.removed).map(l => String(l.text || '')).join(' ') };
}

// ── 3. The agent's queries ──────────────────────────────────────────────────
const SYSTEM = 'You choose stock-footage search words for a short vertical voiceover video. The B-roll of every sentence is found '
  + 'on a stock site (Pixabay) by your words. For each numbered sentence write TWO search queries IN ENGLISH, whatever the '
  + 'language of the script: 2-4 plain words each. The first: a concrete, filmable picture of what that sentence says - people, '
  + 'things, places, actions ("woman drinking coffee", "city street at night"). The second: broader, for when the first finds '
  + 'too little ("morning routine", "busy city"). No brand names, no text or logos, no abstract words alone ("success", '
  + '"emotion"). Read the whole script for what it is about, so the footage of every sentence belongs to the same video.';
const SCHEMA = {
  type: 'object', required: ['sentences'],
  properties: {
    sentences: {
      type: 'array',
      items: { type: 'object', required: ['n', 'queries'], properties: { n: { type: 'integer' }, queries: { type: 'array', items: { type: 'string' } } } },
    },
  },
};
async function _queries(script, list) {
  // The fake aggregator answers here too: the longest words of each sentence, said as they are (a stand has no agent).
  if (FAKE.on()) {
    return list.map((s) => {
      const w = String(s.text).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
      return ['[fake] ' + w.slice(0, 2).join(' '), '[fake] ' + (w[2] || w[0] || 'stock')];
    });
  }
  const { callLadder } = require('./llm-json');
  const user = 'THE SCRIPT:\n' + script + '\n\nTHE SENTENCES:\n' + list.map((s, i) => (i + 1) + '. ' + s.text).join('\n');
  const { data } = await callLadder({ system: SYSTEM, user, schema: SCHEMA, name: 'broll', effort: 'low' });
  const got = new Map(((data && data.sentences) || []).map(e => [Number(e.n), (e.queries || []).map(q => String(q || '').trim()).filter(Boolean)]));
  return list.map((s, i) => {
    const q = got.get(i + 1) || [];
    if (!q.length) throw _err('the agent wrote no keywords for sentence ' + (i + 1) + ' - press again', 502);
    return q.slice(0, 2);
  });
}

// ── 3. The stock ────────────────────────────────────────────────────────────
async function _batchOf(queries) {
  const out = [];
  const seen = new Set();
  for (const kind of ['video', 'image']) {
    let n = 0;
    for (const q of queries) {
      if (n >= BATCH) break;
      const found = await STOCK.search({ query: q, kind, n: BATCH });
      for (const it of found) {
        if (n >= BATCH || seen.has(it.id)) continue;
        if (kind === 'video' && !(+it.dur >= 3)) continue;
        seen.add(it.id);
        out.push(it);
        n++;
      }
    }
  }
  return out;
}

// ── 5. Into the library ─────────────────────────────────────────────────────
function _readJson(file, fb) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fb; } }
// Where a filed item is NOW - its record, read from its store (a folder renamed moves the file).
function _where(f) {
  if (!f || !f.libId) return null;
  if (f.kind === 'video') {
    const st = _readJson(path.join(DATA_DIR, 'biroly.json'), {});
    const r = (Array.isArray(st.archive) ? st.archive : []).find(e => e && e.id === f.libId);
    return r && r.videoPath ? { src: r.videoPath, thumb: r.thumbPath || null, dur: +r.duration || +f.dur || 0 } : null;
  }
  const list = _readJson(path.join(DATA_DIR, 'images.json'), []);
  const r = (Array.isArray(list) ? list : []).find(e => e && e.id === f.libId);
  return r && r.imagePath ? { src: r.imagePath, thumb: '/api/thumb?src=' + encodeURIComponent(r.imagePath) + '&v=card', dur: 0 } : null;
}
const _nameOf = (it) => [String(it.query || it.tags || 'stock').replace(/^\[fake\]\s*/, '').slice(0, 60), it.site + (it.author ? ' · ' + it.author : '')].join(' · ');

async function _fileItem(it) {
  const got = await STOCK.fetchFile(it);
  const work = MEDIA.work;
  fs.mkdirSync(work, { recursive: true });
  const base = 'stock_' + String(it.site || 'stock') + '_' + crypto.createHash('sha1').update(String(it.id)).digest('hex').slice(0, 10) + '_' + Date.now();
  const abs = path.join(work, base + got.ext);
  fs.copyFileSync(got.file, abs);                    // scratch is not the library: copied, never renamed
  try { fs.unlinkSync(got.file); } catch (e) { /* scratch */ }
  const url = '/media/work/' + path.basename(abs);
  const name = _nameOf(it);
  if (it.kind === 'video') {
    let dim = {};
    try { dim = await require('./media-probe').probe(abs); } catch (e) { dim = {}; }
    let thumbPath = null;
    try { thumbPath = (await require('./video-thumb').makeThumb(url)).thumb; } catch (e) { thumbPath = null; }
    const { item } = require('../routes/library').fileRecord({
      videoPath: url, thumbPath, name, kind: 'uploads', categoryLabel: 'Stock', trimmable: true,
      duration: +dim.duration || +it.dur || 0, w: +dim.w || it.w || 0, h: +dim.h || it.h || 0, ...(it.page ? { link: it.page } : {}),
    });
    return { kind: 'video', libId: item.id, dur: +dim.duration || +it.dur || 0, w: +dim.w || it.w, h: +dim.h || it.h };
  }
  const { cat } = require('./library-cats').add('images', 'Stock');
  const { item } = await require('./images-store').add(url, {
    categoryId: cat.id, categoryLabel: cat.label, name, source: 'upload',
    meta: { site: it.site, author: it.author || '', page: it.page || '', query: it.query || '', tags: it.tags || '' },
  });
  return { kind: 'image', libId: item.id, dur: 0, w: item.w || it.w, h: item.h || it.h };
}

// ── 6. Laid ─────────────────────────────────────────────────────────────────
// The free parts of [a, b) around the person's own cells.
function _free(a, b, busy) {
  let parts = [[a, b]];
  for (const [x, y] of busy) {
    const next = [];
    for (const [p, q] of parts) {
      if (y <= p || x >= q) { next.push([p, q]); continue; }
      if (x > p) next.push([p, x]);
      if (y < q) next.push([y, q]);
    }
    parts = next;
  }
  return parts.filter(([p, q]) => q - p >= MIN_PART);
}
// What the person gave a piece by hand - its place, size, turn, crop, Fit - stays with it when it is laid again on the same file
// (the voice retimed); a piece given another file (the mode changed) starts plain.
const LOOK = ['fit', 'tw', 'tx', 'ty', 'angle', 'feather', 'rotation', 'cropAlign', 'crop', 'pip', 'radius', 'outline', 'outlineColor'];
function _lay(id, plan, B) {
  let laid = 0;
  const stored = MSTORE.update('sv3_' + id, (tl) => {
    const v = (tl.tracks || []).find(t => t && t.id === 'v1');
    if (!v) return false;
    const was = new Map((v.clips || []).filter(c => String((c && c.id) || '').startsWith('br_')).map(c => [c.id, c]));
    const mine = (v.clips || []).filter(c => !String((c && c.id) || '').startsWith('br_'));
    const busy = mine.map(c => [+c.start || 0, (+c.start || 0) + (+c.dur || 0)]);
    const cells = [];
    for (const s of plan) {
      const deal = (B.sentences[s.key] || {}).deal || [];
      const batch = (B.sentences[s.key] || {}).batch || [];
      s.pieces.forEach((pc, j) => {
        const it = batch.find(b => b.id === deal[j]);
        const at = it && _where(B.files[it.id]);
        if (!at) return;
        _free(pc.from, pc.to, busy).forEach(([a, b], part) => {
          const dur = _r3(b - a);
          const video = it.kind === 'video';
          const srcDur = video ? (+at.dur || dur) : 0;
          const speed = video && srcDur < dur ? Math.max(0.25, Math.round((srcDur / dur) * 100) / 100) : 1;
          const cid = 'br_' + s.line + '_' + s.k + '_' + j + (part ? '_' + part : '');
          const cell = {
            id: cid,
            src: at.src, thumb: at.thumb, poster: null, name: _nameOf(it), libId: B.files[it.id].libId,
            start: _r3(a), dur, srcDur: _r3(srcDur), trimIn: 0, trimOut: video ? _r3(Math.max(0, srcDur - dur * speed)) : 0,
            speed, reversed: false, transition: null, animation: null, filter: null, volume: 0, pairId: null,
            fit: 'fill', pip: true,
          };
          const old = was.get(cid);
          if (old && old.src === cell.src) for (const k of LOOK) { if (old[k] !== undefined) cell[k] = old[k]; }
          cells.push(cell);
        });
      });
    }
    v.clips = mine.concat(cells);
    laid = cells.length;
    return true;
  });
  if (stored === null) throw _err('the timeline is gone');
  return laid;
}

// ── The run ─────────────────────────────────────────────────────────────────
function _plan(sp) {
  return PLAN.sentencesOf(sp.lines).map(s => Object.assign(s, { key: _keyOf(s), pieces: PLAN.piecesOf(s) }));
}

async function _run(id, o) {
  const run = _runs.get(id);
  const say = (step, done, total) => { run.step = step; if (done != null) run.done = done; if (total != null) run.total = total; };
  const B = _load(id);
  let sp = _spoken(id);
  // A line read again, or at another speed, loses its captions until they are heard again (a few seconds, lib/captions-auto.js):
  // laid now, its pieces would go. So the pieces wait where they are - the captions' own run calls this again when they come
  // (lib/captions-job.js).
  if (!o.fetch && (sp.unheard.length || sp.unread.length)) {
    console.log('[broll] ' + id + ': waits for the captions of line ' + sp.unheard.concat(sp.unread).join(', '));
    return 0;
  }
  let plan = _plan(sp);
  // 3. The batches of the sentences that have none.
  if (o.fetch) {
    const need = plan.filter(s => !((B.sentences[s.key] || {}).batch || []).length);
    if (need.length) {
      say('keywords…', 0, need.length);
      const qs = await _queries(sp.text, need);
      for (let i = 0; i < need.length; i++) {
        say('finding ' + (i + 1) + ' of ' + need.length + '…', i, need.length);
        const s = need[i];
        const batch = await _batchOf(qs[i]);
        B.sentences[s.key] = { line: s.line, k: s.k, text: s.text, queries: qs[i], batch, deal: [], hand: {}, at: new Date().toISOString() };
        _save(id, B);                                   // a run cut short keeps what it found
      }
      say('found', need.length, need.length);
    }
  }
  // 4. The deal - a sentence's pieces keep their items; new pieces and a mode changed deal anew (the hand's stay).
  let before = null;
  for (const s of plan) {
    const S = B.sentences[s.key];
    if (!S || !(S.batch || []).length) { before = null; continue; }
    const n = s.pieces.length;
    const keep = [];
    for (let j = 0; j < n; j++) {
      const hand = (S.hand || {})[j];
      const had = (S.deal || [])[j];
      const fits = (id2) => { const b = S.batch.find(x => x.id === id2); return b && (B.mode === 'mixed' || b.kind === B.mode); };
      keep.push(hand || (had && !o.redeal && fits(had) ? had : null));
    }
    S.deal = PLAN.dealOf(S.batch, B.mode, n, keep, before);
    before = S.deal[n - 1] || null;
  }
  _save(id, B);
  // 5. What is dealt and not in the library yet.
  const want = [];
  for (const s of plan) {
    const S = B.sentences[s.key];
    if (!S) continue;
    for (const itId of S.deal || []) {
      if (!itId || want.some(w => w.id === itId)) continue;
      if (B.files[itId] && _where(B.files[itId])) continue;
      const it = S.batch.find(b => b.id === itId);
      if (it) want.push(it);
    }
  }
  for (let i = 0; i < want.length; i++) {
    say('downloading ' + (i + 1) + ' of ' + want.length + '…', i, want.length);
    B.files[want[i].id] = await _fileItem(want[i]);
    _save(id, B);
  }
  // 6. Laid - on the voice as it is NOW (a read may have landed meanwhile; then its captions are not heard yet, and the pieces
  // wait for them as above).
  say('laying…');
  sp = _spoken(id);
  if (sp.unheard.length || sp.unread.length) return 0;
  plan = _plan(sp);
  const laid = _lay(id, plan, B);
  console.log('[broll] ' + id + ': ' + laid + ' pieces laid over ' + plan.length + ' sentences (' + B.mode + ')');
  return laid;
}

function _start(id, o) {
  const was = _runs.get(id);
  if (was && was.running) { was.again = was.again || o; return state(id); }
  const run = { running: true, step: 'starting…', done: 0, total: 0, error: '', again: null };
  _runs.set(id, run);
  (async () => {
    let next = o;
    while (next) {
      try { await _run(id, next); run.error = ''; }
      catch (e) {
        run.error = (e && e.message) || String(e);
        console.warn('[broll] ' + id + ':', run.error);
      }
      next = run.again;
      run.again = null;
    }
    run.running = false;
    run.step = '';
  })();
  return state(id);
}

// ── The doors ───────────────────────────────────────────────────────────────
/** How far it has got, and what there is: { running, step, done, total, error, sentences, left, laid, mode, stock }. */
function state(id) {
  const run = _runs.get(String(id)) || {};
  const B = _load(id);
  let sentences = 0, left = 0, laid = 0;
  try {
    const sp = _spoken(id);
    const plan = _plan(sp);
    sentences = plan.length;
    left = plan.filter(s => !((B.sentences[s.key] || {}).batch || []).length).length;
    const v = ((sp.tl.tracks || []).find(t => t && t.id === 'v1') || { clips: [] });
    laid = (v.clips || []).filter(c => String((c && c.id) || '').startsWith('br_')).length;
  } catch (e) { /* not a voiceover with a timeline yet */ }
  return { running: !!run.running, step: run.step || '', done: run.done || 0, total: run.total || 0, error: run.error || '',
    sentences, left, laid, mode: B.mode, stock: STOCK.ready() };
}

/** The B-roll of every sentence that has none - found, filed and laid. Refused in words before anything is asked. */
function find(id) {
  const why = STOCK.ready();
  if (why) throw _err(why);
  const sp = _spoken(id);
  if (!sp.lines.length) throw _err('read the lines first - field 1, mood & voice');
  if (sp.unread.length) throw _err('line ' + sp.unread.join(', ') + (sp.unread.length === 1 ? ' is' : ' are') + ' not read yet - field 1');
  if (sp.unheard.length) throw _err('the captions of line ' + sp.unheard.join(', ') + ' are not heard yet - they come a few seconds after a read; then press again');
  return _start(String(id), { fetch: true });
}

/** What is laid: 'mixed' | 'video' | 'image' - and every piece laid again but the ones chosen by hand. */
function setMode(id, mode) {
  if (!MODES.includes(mode)) throw _err('no such mode', 400);
  const B = _load(id);
  B.mode = mode;
  _save(id, B);
  const has = Object.values(B.sentences).some(S => (S.batch || []).length);
  if (!has) return state(id);
  return _start(String(id), { fetch: false, redeal: true });
}

/** (phase V62, (во13)) The voice moved - a line read again, its captions heard, a line taken off or put back: the pieces stand
 *  by the sentences' new moments, each keeping its item. Nothing is found; a piece new to a sentence is dealt and filed. */
function relay(id) {
  const key = String(id || '');
  if (!key) return;
  let proj = null;
  try { proj = PROJECTS.get(key); } catch (e) { proj = null; }
  if (!proj || proj.type !== 'voiceover') return;
  const B = _load(key);
  if (!Object.values(B.sentences).some(S => (S.batch || []).length)) return;
  if (STOCK.ready() && Object.keys(B.files).length === 0) return;
  _start(key, { fetch: false });
}

// ── BLOCK 2 - ANOTHER ITEM FOR A PIECE, chosen in the Library panel (phase V62, (во21)/(во18): "при клике на элемент
// видеодорожки показывает в library скачаные варианты, галочкой отмечены те, которые уже на таймлайне, при наведении показывать
// всплывашку с предпросмотром, кликом заменять на таймлайне") ─────────────────────────────────────────────────────────────────
// A cell's id says its piece: br_<line>_<sentence>_<piece>[_<part>].
const _cellRe = /^br_(\d+)_(\d+)_(\d+)(?:_\d+)?$/;
function _pieceOf(id, cellId) {
  const m = _cellRe.exec(String(cellId || ''));
  if (!m) throw _err('not a piece of the B-roll', 400);
  const line = +m[1], k = +m[2], j = +m[3];
  const sp = _spoken(id);
  const s = _plan(sp).find(x => x.line === line && x.k === k);
  if (!s) throw _err('this piece\'s sentence is not in the voice any more - find the B-roll again');
  return { s, j, sp };
}

/** The batch of a piece's sentence, for the Library panel: { cell, text, queries, piece, pieces, items: [{ id, kind, w, h, dur,
 *  site, author, page, filed, on, here, thumb }] } - `on` laid somewhere on the timeline, `here` in this very piece. */
function piece(id, cellId) {
  const { s, j, sp } = _pieceOf(id, cellId);
  const B = _load(id);
  const S = B.sentences[s.key];
  if (!S) throw _err('this sentence has no B-roll yet - find the B-roll');
  const v = ((sp.tl.tracks || []).find(t => t && t.id === 'v1') || { clips: [] });
  const onLib = new Set((v.clips || []).filter(c => String((c && c.id) || '').startsWith('br_')).map(c => c.libId).filter(Boolean));
  const hereId = (S.deal || [])[j] || null;
  const items = (S.batch || []).map(it => {
    const f = B.files[it.id];
    const filed = !!(f && _where(f));
    return {
      id: it.id, kind: it.kind, w: it.w, h: it.h, dur: it.dur || 0, site: it.site, author: it.author || '', page: it.page || '',
      filed, on: filed && onLib.has(f.libId), here: it.id === hereId,
      thumb: '/api/broll/' + encodeURIComponent(id) + '/thumb/' + encodeURIComponent(it.id),
      // What plays on hover: the file once it is in the library, else the stock's own small preview (Pixabay - block 3).
      preview: filed && it.kind === 'video' ? _where(f).src : (it.preview || ''),
    };
  });
  return { cell: cellId, text: s.text, queries: S.queries || [], piece: j, pieces: s.pieces.length, mode: B.mode, items };
}

/** The picture of an item: { file } on the disk or { redirect } - the library's thumbnail once it is filed; the fake stock's
 *  drawn here once and kept in cache/stock/; the site's own thumbnail through here (block 3). */
async function thumbOf(id, itemId) {
  const B = _load(id);
  const f = B.files[itemId];
  const at = f && _where(f);
  if (at) return { redirect: at.thumb || at.src };
  let it = null;
  for (const S of Object.values(B.sentences)) { it = (S.batch || []).find(b => b.id === itemId); if (it) break; }
  if (!it) throw _err('no such item', 404);
  if (it.site === 'fake') {
    const dir = path.join(require('./config').CACHE_DIR, 'stock');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, crypto.createHash('sha1').update(it.id).digest('hex').slice(0, 16) + '.jpg');
    if (!fs.existsSync(file)) {
      const w = it.w >= it.h ? 320 : 180, h = it.w >= it.h ? 180 : 320;
      const label = String(it.kind === 'video' ? '▶ ' : '') + String(it.query || '').replace(/^\[fake\]\s*/, '').replace(/[<>&"]/g, ' ').slice(0, 24);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><rect width="100%" height="100%" fill="hsl('
        + (+it.hue || 0) + ',55%,45%)"/><text x="50%" y="50%" font-size="16" fill="white" text-anchor="middle" font-family="Arial">' + label + '</text></svg>');
      await require('sharp')(svg).jpeg({ quality: 80 }).toFile(file);
    }
    return { file };
  }
  if (it.thumb) return { redirect: it.thumb };      // the site's own (block 3 takes it through here)
  throw _err('no picture of this item', 404);
}

/** Another item for a piece: chosen BY HAND - kept through a mode changed and a voice retimed - downloaded if it is not in the
 *  library yet, and the piece laid again in its place and length. The one it replaces stays in the library. */
function swap(id, cellId, itemId) {
  const { s, j } = _pieceOf(id, cellId);
  const B = _load(id);
  const S = B.sentences[s.key];
  if (!S || !(S.batch || []).some(b => b.id === itemId)) throw _err('not in this sentence\'s batch', 400);
  S.hand = Object.assign({}, S.hand || {}, { [j]: itemId });
  S.deal = Object.assign([], S.deal || []);
  S.deal[j] = itemId;
  _save(id, B);
  return _start(String(id), { fetch: false });
}

module.exports = { state, find, setMode, relay, piece, thumbOf, swap, BATCH, MODES };
