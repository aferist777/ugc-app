// LIBRARY 2 — the writing workshop.
//
// Three shelves and what each is for:
//   scenarios  the output. Generated here, edited on the Scenarios page.
//   narrators  HOW a script is written. Samples in, a behavioural profile out.
//   sources    what it is written FROM — and the accordion that turns one into a script.
//
// SOURCES IS THREE STEPS, NOT A DIALOG: gallery -> topics -> script, exactly one column open and
// the rest folded into spines on the left. Folding is not closing, so stepping back to the topics
// and returning finds the script as it was left. See js/accordion.js.
//
// AND THE WORK SURVIVES LEAVING THE PAGE. One script is four model calls and a read-through; a
// dialog that forgot all of it on close was throwing away paid work. Every stage is written to a
// draft on the server, so an unfinished script is a row you can come back to and finish.
//
// Everything slow runs as a job on the server and is polled. While one is running the whole
// accordion is inert - including the gallery, because walking off to another source would leave
// the answer arriving into a column nobody is watching. The bar under a step is deliberately
// indeterminate: none of these can report a percentage honestly.

import { initNav } from '../app-nav.js';
import { mountLibSwitch } from '../lib-switch.js';
import { createAccordion } from '../accordion.js';
import { startInlineProgress } from '../progress.js';
import { openViewer } from '../library/viewer.js';

const $ = (id) => document.getElementById(id);

const SHELVES = { scenarios: 'Scenarios', narrators: 'Narrators', sources: 'Sources', characters: 'Characters' };
const LS_SHELF = 'library2_shelf_v1';      // mirrored server-side by storage-sync.js

const LEVEL = { GALLERY: 0, TOPICS: 1, SCRIPT: 2 };

let _shelf = 'sources';
let _items = [];
let _nar = null;        // the narrator open in the editor
let _reads = [];        // its readings, oldest first
let _readIdx = 0;       // which one the pager is showing
let _src = null;        // the source whose topics are showing
let _scen = null;       // the saved scenario open in its panel
let _acc = null;        // the accordion
let _reg = null;        // the model registry, read once
let _drafts = [];       // draft summaries, for the markers and the shelf

// The script column's whole state - which is also what a draft is made of.
let _gen = null;        // { draftId, sourceId, sourceTitle, topicId, topicTitle, hooks, paragraphs, humanized }
let _stage = 'idle';    // idle | hooks | pick | script | working
let _saveT = null;

// ── plumbing ────────────────────────────────────────────────────────────────

async function api(url, opts) {
  const r = await fetch(url, opts);
  let d = null;
  try { d = await r.json(); } catch (e) { /* a non-JSON body is handled below */ }
  if (!r.ok || !d || d.success === false) {
    throw new Error((d && d.error) || `${r.status} ${r.statusText}`);
  }
  return d;
}

function status(text, kind) {
  const el = $('l2-status');
  el.textContent = text || '';
  el.className = 'l2-status' + (kind ? ' ' + kind : '');
}

async function pollJob(base, jobId, onStep) {
  for (;;) {
    await new Promise(r => setTimeout(r, 1500));
    let job;
    try { job = await api(`${base}/${encodeURIComponent(jobId)}`); }
    catch (e) { throw new Error('lost track of the job: ' + e.message); }
    if (onStep) onStep(job);
    if (job.state === 'done') return job;
    if (job.state === 'error') throw new Error(job.error || 'the job failed');
  }
}

// ── slow jobs, with a countdown that learns ─────────────────────────────────
// Everything slow on this page goes through here. The row says what is happening and how long is
// left, and it teaches itself from each run (js/progress.js keeps an EMA).
//
// `key` is WHAT IS BEING TIMED and must not carry the free text of the label - "Finding topics in
// 82k of transcript" would be a new kind of job every time. It carries the things that actually
// change the duration instead: how much text, which model, how many scenes.
function startJob(hostId, { key, label, estimateMs }) {
  const host = $(hostId);
  host.hidden = false;
  host.textContent = '';
  return startInlineProgress(host, { key, label, estimateMs });
}

// A line in the same place with no job behind it: "pick a file first", or a call that failed
// before it ever became a job.
function sayJob(hostId, text, isError) {
  const host = $(hostId);
  host.textContent = '';
  host.hidden = !text;
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'l2-job-say' + (isError ? ' err' : '');
  el.textContent = text;
  host.appendChild(el);
}

const clearJob = (hostId) => { $(hostId).hidden = true; $(hostId).textContent = ''; };

// Rounds a size to the nearest power of two, so runs of a similar size share an estimate. A
// ten-minute video and a two-hour one are not the same job, and one average over both would make
// both countdowns wrong. Doubling buckets rather than fixed steps because the sizes here span
// three orders of magnitude - a fixed 100 MB step would file a 4 MB upload and a 140 MB one
// together, and then teach the small one's four seconds to the big one.
const _bucket = (n) => {
  const v = Math.max(1, +n || 0);
  return Math.pow(2, Math.round(Math.log2(v)));
};

// First-run guesses, from what these took on this machine. After one run of a given key the
// countdown is the measured average and these stop mattering.
const EST = {
  ingestFile: (bytes) => Math.max(90000, Math.round((bytes / 1048576) * 400)),
  ingestLink: 300000,
  topics: 45000,
  hooks: 20000,
  script: (scenes) => Math.max(40000, (scenes || 15) * 9000),
  humanize: 40000,
  rewrite: 20000,
  analyse: 45000,
  sample: (bytes) => Math.max(60000, Math.round((bytes / 1048576) * 500)),
};

const fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const clock = (s) => {
  const n = Math.max(0, Math.floor(+s || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(n % 60).padStart(2, '0');
};
const mb = (b) => (b >= 1048576 ? Math.round(b / 1048576) + ' MB' : Math.round(b / 1024) + ' KB');
const spokenSeconds = (t) => Math.round(String(t || '').trim().split(/\s+/).filter(Boolean).length / 2.5);

function empty(text) {
  const e = document.createElement('div');
  e.className = 'l2-empty';
  e.textContent = text;
  return e;
}

// ── the shelf counts ────────────────────────────────────────────────────────
// All three badges, in one request, at load. They used to be filled only for the shelf being
// read, so the other two sat blank until opened - and a count you have to click to see is not
// doing the job of a count.

async function refreshCounts() {
  try {
    const d = await api('/api/library2/counts');
    const counts = d.counts || {};
    for (const b of document.querySelectorAll('.l2-shelf')) {
      const n = counts[b.dataset.kind];
      const el = b.querySelector('.l2-n');
      if (el) el.textContent = n == null ? '' : String(n);
    }
  } catch (e) { /* a missing badge is not worth a visible error */ }
}

async function refreshDrafts() {
  try { _drafts = (await api('/api/library2/drafts')).drafts || []; }
  catch (e) { _drafts = []; }
}

const draftFor = (sourceId, topicId) => _drafts.find(d =>
  String(d.sourceId) === String(sourceId) && String(d.topicId) === String(topicId)) || null;

// ── shelves ─────────────────────────────────────────────────────────────────

function paintShelves() {
  document.querySelectorAll('.l2-shelf').forEach(b => b.classList.toggle('cur', b.dataset.kind === _shelf));
  $('l2-bar-label').textContent = SHELVES[_shelf] || '';
  $('l2-add-narrator').hidden = _shelf !== 'narrators';
  $('l2-add-source').hidden = _shelf !== 'sources';
  $('l2-open-scenarios').hidden = _shelf !== 'scenarios';
  $('l2-write').hidden = _shelf === 'narrators';
  // Sources is the accordion; the other two shelves are lists in the plain area.
  const isSources = _shelf === 'sources';
  $('l2-cols').hidden = !isSources;
  $('l2-area').hidden = isSources;
}

async function load() {
  paintShelves();
  status('reading…');
  try {
    await refreshDrafts();
    if (_shelf === 'scenarios') {
      // Only what was generated here. A hand-written scenario belongs to the page that wrote it.
      const d = await api('/api/scen3/scenarios?lib=library2');
      _items = d.scenarios || [];
      $('l2-area').textContent = '';
      renderScenarios();
    } else if (_shelf === 'characters') {
      // The Library page's own endpoint, not a copy of it. Characters are made and edited
      // elsewhere; here they are only something to look at while writing.
      const d = await api('/api/library/shelf/characters');
      _items = d.items || [];
      $('l2-area').textContent = '';
      renderCharacters();
    } else if (_shelf === 'narrators') {
      const d = await api('/api/narrators');
      _items = d.narrators || [];
      $('l2-area').textContent = '';
      renderNarrators(d.minWords || 500);
    } else {
      const d = await api('/api/sources');
      _items = d.sources || [];
      renderGallery();
    }
    status('');
    await refreshCounts();
  } catch (e) {
    status(e.message, 'err');
  }
}

// ── characters shelf ────────────────────────────────────────────────────────
// Read-only. Everything that MAKES a character lives on the Character page and everything
// that files one lives on the Library page; what is useful in a writing workshop is the
// face and the name of whoever the script is about, so that is all this draws.
function renderCharacters() {
  const area = $('l2-area');
  if (!_items.length) {
    area.appendChild(empty('No characters yet. They are made on the Character page.'));
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'l2-grid';
  _items.forEach((it, i) => {
    const card = document.createElement('div');
    card.className = 'l2-card';
    card.title = it.name;

    const box = document.createElement('div');
    box.className = 'l2-thumb-box' + (it.thumb || it.media ? '' : ' pending');
    if (it.thumb || it.media) {
      const img = document.createElement('img');
      img.className = 'l2-thumb';
      img.loading = 'lazy';
      img.alt = it.name;
      img.src = it.thumb || it.media;
      box.appendChild(img);
    }
    card.appendChild(box);

    const b = document.createElement('div');
    b.className = 'l2-card-b';
    const t = document.createElement('div');
    t.className = 'l2-card-t';
    t.textContent = it.name || 'character';
    b.appendChild(t);
    const m = it.meta || {};
    const bits = [m.gender, m.looks ? m.looks + ' looks' : '', m.voices ? m.voices + ' voices' : '']
      .filter(Boolean);
    if (bits.length) {
      const sline = document.createElement('div');
      sline.className = 'l2-card-s';
      for (const x of bits) { const sp = document.createElement('span'); sp.textContent = x; sline.appendChild(sp); }
      b.appendChild(sline);
    }
    card.appendChild(b);

    // The same viewer the Library page opens, so a sheet is read at full size in the place
    // the reader already knows - and the whole shelf pages through it.
    card.addEventListener('click', () => openViewer(_items, i, {}));
    grid.appendChild(card);
  });
  area.appendChild(grid);
}

// ── scenarios shelf ─────────────────────────────────────────────────────────

function draftRow(d) {
  const row = document.createElement('div');
  row.className = 'l2-row';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  const main = document.createElement('div');
  main.className = 'l2-row-main';
  const t = document.createElement('div');
  t.className = 'l2-row-t';
  t.textContent = d.title || d.topicTitle || d.topic || 'untitled draft';
  const s = document.createElement('div');
  s.className = 'l2-row-s';
  s.textContent = [
    d.paragraphs ? d.paragraphs + (d.paragraphs === 1 ? ' paragraph' : ' paragraphs') : '',
    d.narratorName, d.sourceTitle,
  ].filter(Boolean).join(' · ');
  main.append(t, s);
  const tag = document.createElement('span');
  tag.className = 'l2-tag wait';
  tag.textContent = 'draft · ' + (d.stageLabel || '');
  const date = document.createElement('div');
  date.className = 'l2-row-d';
  date.textContent = fmtDate(d.updatedAt);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'l2-x';
  x.textContent = '✕';
  x.title = 'Discard this draft';
  x.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Discard this draft? What was generated into it is lost.')) return;
    try { await api('/api/library2/drafts/' + encodeURIComponent(d.id), { method: 'DELETE' }); await load(); }
    catch (err) { status(err.message, 'err'); }
  });
  row.append(main, tag, date, x);
  const open = () => resumeDraft(d.id);
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return row;
}

function renderScenarios() {
  const area = $('l2-area');
  if (!_items.length && !_drafts.length) {
    area.appendChild(empty('Nothing here yet. Open Sources, pick a topic out of a long video and write from it.'));
    return;
  }
  const box = document.createElement('div');
  box.className = 'l2-rows';
  // Drafts first, and marked: unfinished work is the thing you came back for.
  for (const d of _drafts) box.appendChild(draftRow(d));

  for (const it of _items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'l2-row';
    row.title = 'Where it came from, and what it says';
    const main = document.createElement('div');
    main.className = 'l2-row-main';
    const t = document.createElement('div');
    t.className = 'l2-row-t';
    t.textContent = it.title || 'untitled';
    const s = document.createElement('div');
    s.className = 'l2-row-s';
    s.textContent = [
      (it.lineCount || 0) + (it.lineCount === 1 ? ' line' : ' lines'),
      (it.origin && it.origin.narratorName) || '', (it.origin && it.origin.sourceTitle) || '',
    ].filter(Boolean).join(' · ');
    main.append(t, s);
    const d = document.createElement('div');
    d.className = 'l2-row-d';
    d.textContent = fmtDate(it.updatedAt || it.createdAt);
    row.append(main, d);
    row.addEventListener('click', () => openScenario(it.id));
    box.appendChild(row);
  }
  area.appendChild(box);
}

const ORIGIN_ROWS = [
  ['sourceTitle', 'Written from'], ['topicTitle', 'Topic'], ['narratorName', 'Narrator'],
  ['narratorReading', 'Which reading'],
  ['language', 'Language'], ['tone', 'Tone'], ['model', 'Model'],
  ['hook', 'The hook it had to deliver on'],
];

async function openScenario(id) {
  try {
    const s = (await api('/api/scen3/scenarios/' + encodeURIComponent(id))).scenario;
    _scen = s;
    $('l2-scen-title').textContent = s.title || 'untitled';
    $('l2-scen-meta').textContent = [
      (s.lines || []).length + ' lines', s.vertical, s.product,
      (s.roles && s.roles[0] && s.roles[0].gender) || '',
    ].filter(Boolean).join(' · ');

    const ob = $('l2-scen-origin');
    ob.textContent = '';
    const o = s.origin;
    if (!o) ob.appendChild(empty('No provenance on this one — it was written by hand.'));
    else {
      const rows = ORIGIN_ROWS.slice();
      if (o.humanized) rows.push(['__cleaned', 'Cleaning pass']);
      for (const [key, label] of rows) {
        const v = key === '__cleaned' ? 'applied' : String(o[key] || '').trim();
        if (!v) continue;
        const r = document.createElement('div');
        r.className = 'l2-prof-row';
        const k = document.createElement('div');
        k.className = 'l2-prof-k';
        k.textContent = label;
        const val = document.createElement('div');
        val.className = 'l2-prof-v';
        val.textContent = v;
        r.append(k, val);
        ob.appendChild(r);
      }
    }

    const lb = $('l2-scen-lines');
    lb.textContent = '';
    (s.lines || []).forEach((ln, i) => {
      const el = document.createElement('div');
      el.className = 'l2-scene' + (i === 0 ? ' hook' : '');
      const n = document.createElement('div');
      n.className = 'l2-scene-n';
      n.textContent = String(i + 1);
      const p = document.createElement('div');
      p.className = 'l2-scene-ro';
      p.textContent = ln.text || '';
      const secs = document.createElement('div');
      secs.className = 'l2-scene-secs';
      secs.textContent = spokenSeconds(ln.text) + 's';
      el.append(n, p, secs);
      lb.appendChild(el);
    });

    closeAll();
    $('l2-scen-ov').hidden = false;
  } catch (e) { status(e.message, 'err'); }
}

// ── narrators shelf ─────────────────────────────────────────────────────────

function renderNarrators(minWords) {
  const area = $('l2-area');
  if (!_items.length) {
    area.appendChild(empty('No narrators yet. A narrator is HOW a script is written — build one out of writing by an author you want to sound like.'));
    return;
  }
  const box = document.createElement('div');
  box.className = 'l2-rows';
  for (const it of _items) {
    const row = document.createElement('div');
    row.className = 'l2-row';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const main = document.createElement('div');
    main.className = 'l2-row-main';
    const t = document.createElement('div');
    t.className = 'l2-row-t';
    t.textContent = it.name;
    const s = document.createElement('div');
    s.className = 'l2-row-s';
    s.textContent = [
      it.samples + (it.samples === 1 ? ' sample' : ' samples'),
      it.words + ' words', it.origin,
    ].filter(Boolean).join(' · ');
    main.append(t, s);
    const tag = document.createElement('span');
    // Several readings is the good state, not a warning: one of them is picked at random per script.
    if (it.readings > 1) { tag.className = 'l2-tag ready'; tag.textContent = `${it.readings} readings`; }
    else if (it.ready) { tag.className = 'l2-tag ready'; tag.textContent = 'voice read'; }
    else if (!it.enough) { tag.className = 'l2-tag wait'; tag.textContent = `needs ${minWords}+ words`; }
    else { tag.className = 'l2-tag wait'; tag.textContent = 'not read yet'; }
    const d = document.createElement('div');
    d.className = 'l2-row-d';
    d.textContent = fmtDate(it.updatedAt);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'l2-x';
    x.textContent = '✕';
    x.title = 'Delete this narrator';
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete the narrator "${it.name}"? Its samples go with it, and that cannot be undone.`)) return;
      try { await api('/api/narrators/' + encodeURIComponent(it.id), { method: 'DELETE' }); await load(); }
      catch (err) { status(err.message, 'err'); }
    });
    row.append(main, tag, d, x);
    const open = () => openNarrator(it.id);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    box.appendChild(row);
  }
  area.appendChild(box);
}

const PROFILE_ROWS = [
  ['summary', 'Who this voice is'], ['sentences', 'Sentences'], ['rhythm', 'Rhythm'],
  ['address', 'Address'], ['register', 'Register'], ['imagery', 'Imagery'],
  ['humour', 'Humour'], ['openings', 'Openings'], ['endings', 'Endings'], ['stance', 'Stance'],
];

// The pager over readings. It exists because the readings are not versions of one thing where the
// newest wins - they are several descriptions of the same voice, all of them in use, and being able
// to read them is how you tell whether a reading is worth keeping.
function readingPager(box) {
  const total = _reads.length;
  const cur = _reads[_readIdx];
  const row = document.createElement('div');
  row.className = 'l2-pager';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'l2-pager-b';
  prev.textContent = '‹';
  prev.title = 'The reading before this one';
  prev.disabled = _readIdx <= 0;
  prev.addEventListener('click', () => { _readIdx--; renderProfile(_nar); });

  const label = document.createElement('span');
  label.className = 'l2-pager-t';
  label.textContent = [
    `Reading ${_readIdx + 1} of ${total}`,
    fmtDate(cur.at), cur.model,
  ].filter(Boolean).join(' · ');

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'l2-pager-b';
  next.textContent = '›';
  next.title = 'The reading after this one';
  next.disabled = _readIdx >= total - 1;
  next.addEventListener('click', () => { _readIdx++; renderProfile(_nar); });

  const note = document.createElement('span');
  note.className = 'l2-pager-n';
  note.textContent = total > 1 ? 'a script gets one of these at random' : '';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'l2-pager-x';
  del.textContent = '✕';
  del.title = 'Delete this reading — the samples stay';
  del.addEventListener('click', async () => {
    if (!confirm(`Delete reading ${_readIdx + 1} of ${total}? The samples it was made from stay, so the voice can be read again.`)) return;
    try {
      await api(`/api/narrators/${encodeURIComponent(_nar.id)}/readings/${encodeURIComponent(cur.id)}`,
        { method: 'DELETE' });
      _readIdx = Math.max(0, _readIdx - 1);
      await openNarrator(_nar.id, _readIdx);
      await load();
    } catch (e) { status(e.message, 'err'); }
  });

  row.append(prev, label, next, note, del);
  box.appendChild(row);
}

function renderProfile(rec) {
  const box = $('l2-nar-profile');
  box.textContent = '';
  if (!_reads.length) {
    box.appendChild(empty('Not read yet. Add samples, then press “Read the voice”.'));
    return;
  }
  if (_readIdx >= _reads.length) _readIdx = _reads.length - 1;
  readingPager(box);
  const p = _reads[_readIdx].profile;
  if (!p || !p.summary) { box.appendChild(empty('This reading came back empty.')); return; }
  for (const [key, label] of PROFILE_ROWS) {
    const v = String(p[key] || '').trim();
    if (!v) continue;
    const row = document.createElement('div');
    row.className = 'l2-prof-row';
    const k = document.createElement('div');
    k.className = 'l2-prof-k';
    k.textContent = label;
    const val = document.createElement('div');
    val.className = 'l2-prof-v';
    val.textContent = v;
    row.append(k, val);
    box.appendChild(row);
  }
  for (const [key, label] of [['signature_moves', 'Signature moves'], ['never_does', 'Never does']]) {
    const list = (p[key] || []).filter(Boolean);
    if (!list.length) continue;
    const row = document.createElement('div');
    row.className = 'l2-prof-row';
    const k = document.createElement('div');
    k.className = 'l2-prof-k';
    k.textContent = label;
    const ul = document.createElement('ul');
    ul.className = 'l2-prof-list';
    for (const item of list) {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    }
    row.append(k, ul);
    box.appendChild(row);
  }
}

function renderSamples(rec) {
  const box = $('l2-nar-samples');
  box.textContent = '';
  const samples = rec.samples || [];
  if (!samples.length) { box.appendChild(empty('No samples yet.')); return; }
  samples.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'l2-sample';
    const h = document.createElement('div');
    h.className = 'l2-sample-h';
    const b = document.createElement('b');
    b.textContent = s.label || (s.kind === 'file' ? 'a file' : 'pasted text');
    const w = document.createElement('span');
    w.textContent = `${s.words} words`;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'l2-sample-x';
    x.textContent = '✕';
    x.title = 'Remove this sample';
    x.addEventListener('click', async () => {
      if (!confirm('Remove this sample? The voice will need reading again.')) return;
      try {
        await api(`/api/narrators/${encodeURIComponent(rec.id)}/samples/${i}`, { method: 'DELETE' });
        await openNarrator(rec.id);
      } catch (e) { status(e.message, 'err'); }
    });
    h.append(b, w, x);
    const p = document.createElement('p');
    p.className = 'l2-sample-p';
    const text = String(s.text || '');
    p.textContent = text.slice(0, 180) + (text.length > 180 ? '…' : '');
    el.append(h, p);
    box.appendChild(el);
  });
}

async function openNarrator(id, showReading) {
  try {
    const d = await api('/api/narrators/' + encodeURIComponent(id));
    _nar = d.narrator;
    _reads = d.readings || [];
    // Newest first is what you want after pressing "read again"; otherwise keep where you were.
    _readIdx = showReading != null ? Math.min(showReading, Math.max(0, _reads.length - 1))
      : Math.max(0, _reads.length - 1);
    $('l2-nar-title').textContent = _nar.name;
    $('l2-nar-words').textContent = [
      `${d.words} words`,
      d.words < d.minWords ? `needs at least ${d.minWords}` : '',
      _reads.length ? (_reads.length === 1 ? '1 reading' : `${_reads.length} readings`) : 'not read',
    ].filter(Boolean).join(' · ');
    renderSamples(_nar);
    renderProfile(_nar);
    $('l2-nar-analyse').disabled = d.words < d.minWords;
    // Reading it again is the normal case once there is one: the readings are meant to accumulate.
    $('l2-nar-analyse').textContent = _reads.length ? 'Read the voice again' : 'Read the voice';
    $('l2-nar-ov').hidden = false;
  } catch (e) { status(e.message, 'err'); }
}

// ── level 0: the gallery ────────────────────────────────────────────────────

function renderGallery() {
  const grid = $('l2-gallery');
  grid.textContent = '';
  if (!_items.length) {
    grid.appendChild(empty('No sources yet. Add a long video and its transcript becomes material to write from.'));
    return;
  }
  for (const it of _items) {
    const card = document.createElement('div');
    card.className = 'l2-card';
    card.title = it.title;
    if (_src && String(_src.id) === String(it.id)) card.classList.add('cur');

    const box = document.createElement('div');
    box.className = 'l2-thumb-box' + (it.thumb ? '' : ' pending');
    if (it.thumb) {
      const img = document.createElement('img');
      img.className = 'l2-thumb';
      img.loading = 'lazy';
      img.alt = it.title;
      img.src = it.thumb;
      box.appendChild(img);
    }
    if (it.seconds) {
      const dur = document.createElement('span');
      dur.className = 'l2-dur';
      dur.textContent = clock(it.seconds);
      box.appendChild(dur);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'l2-x';
    x.textContent = '✕';
    x.title = 'Delete this source, its video and its transcript';
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${it.title}"?\n\nThe video (${mb(it.bytes || 0)}), its poster and its transcript are removed from disk.`)) return;
      try {
        await api('/api/sources/' + encodeURIComponent(it.id), { method: 'DELETE' });
        if (_src && String(_src.id) === String(it.id)) { _src = null; backToGallery(); }
        await load();
      } catch (err) { status(err.message, 'err'); }
    });
    box.appendChild(x);

    const body = document.createElement('div');
    body.className = 'l2-card-b';
    const t = document.createElement('div');
    t.className = 'l2-card-t';
    t.textContent = it.title;
    const s = document.createElement('div');
    s.className = 'l2-card-s';

    // HOW MUCH OF THIS SOURCE HAS BEEN WRITTEN FROM: topics used, of topics found. Counting
    // scenarios instead would let the card read "15 of 13", since one topic can yield several.
    const t2 = it.transcript || {};
    if (it.topics) {
      const used = document.createElement('span');
      used.className = 'l2-card-used';
      used.textContent = `${it.topicsUsed || 0} of ${it.topics}`;
      used.title = 'topics written from, of topics found';
      s.appendChild(used);
    } else if (t2.state === 'ready') {
      const sp = document.createElement('span');
      sp.textContent = 'no topics yet';
      s.appendChild(sp);
    }
    const state = document.createElement('span');
    if (it.state === 'error') state.textContent = 'failed';
    else if (t2.state === 'running') state.textContent = 'transcribing…';
    else if (t2.state !== 'ready') state.textContent = 'no transcript';
    else state.textContent = `${t2.cues} cues`;
    s.appendChild(state);

    const dcount = _drafts.filter(d => String(d.sourceId) === String(it.id)).length;
    if (dcount) {
      const dr = document.createElement('span');
      dr.className = 'l2-card-draft';
      dr.textContent = dcount === 1 ? '1 draft' : `${dcount} drafts`;
      dr.title = 'unfinished scripts you can come back to';
      s.appendChild(dr);
    }
    if (it.kind === 'youtube') {
      const k = document.createElement('span');
      k.textContent = 'link';
      s.appendChild(k);
    }
    body.append(t, s);
    card.append(box, body);
    card.addEventListener('click', () => openSource(it.id));
    grid.appendChild(card);
  }
}

// ── level 1: the topics of one source ───────────────────────────────────────

async function openSource(id) {
  try {
    const d = await api('/api/sources/' + encodeURIComponent(id));
    _src = d.source;
    $('l2-topics-title').value = _src.title;
    $('l2-title-saved').textContent = '';
    // The gallery's spine carries the source's name, so the left edge says where you are.
    _acc.setSpine(LEVEL.GALLERY, _src.title.slice(0, 40));
    $('l2-mine').disabled = !(_src.transcript && _src.transcript.state === 'ready');
    clearJob('l2-topics-job');
    renderTopics(_src);
    renderGallery();                      // this card is the current one now
    _acc.open(LEVEL.TOPICS);
  } catch (e) { status(e.message, 'err'); }
}

function renderTopics(rec) {
  const box = $('l2-topics');
  box.textContent = '';
  $('l2-video-summary').textContent = rec.videoSummary || '';
  const t = rec.transcript || {};

  // The two states the old flow walked straight past into an empty list.
  if (t.state === 'running') {
    box.appendChild(empty('Still transcribing. The topics can be found the moment the words are in.'));
    return;
  }
  if (t.state !== 'ready') {
    box.appendChild(empty(rec.state === 'error'
      ? `This source failed: ${rec.error || 'unknown reason'}`
      : 'No transcript yet.'));
    return;
  }
  const topics = rec.topics || [];
  if (!topics.length) {
    box.appendChild(empty('No topics found yet. Press “Find topics” above — one long video usually holds several.'));
    return;
  }

  topics.forEach((tp) => {
    const el = document.createElement('div');
    el.className = 'l2-topic';
    const h = document.createElement('div');
    h.className = 'l2-topic-h';
    const title = document.createElement('span');
    title.className = 'l2-topic-t';
    title.textContent = tp.title;
    const span = document.createElement('span');
    span.className = 'l2-topic-span';
    span.textContent = `${clock(tp.start)}–${clock(tp.end)}`;
    h.append(title, span);

    const used = Array.isArray(tp.usedBy) ? tp.usedBy : [];
    if (used.length) {
      el.classList.add('used');
      const tag = document.createElement('span');
      tag.className = 'l2-tag ready';
      tag.textContent = used.length === 1 ? 'written' : `written ×${used.length}`;
      tag.title = used.map(u => u.title).join('\n');
      h.appendChild(tag);
    }
    const draft = draftFor(rec.id, tp.id);
    if (draft) {
      const tag = document.createElement('span');
      tag.className = 'l2-tag wait';
      tag.textContent = 'draft · ' + (draft.stageLabel || '');
      h.appendChild(tag);
    }

    const s = document.createElement('p');
    s.className = 'l2-topic-s';
    s.textContent = tp.summary;

    const f = document.createElement('div');
    f.className = 'l2-topic-f';
    const name = document.createElement('span');
    name.className = 'l2-topic-name';
    name.textContent = `${tp.projectName} · ${String(tp.text || '').length} chars of transcript`;
    f.appendChild(name);
    for (const u of used) {
      const link = document.createElement('a');
      link.className = 'l2-topic-used';
      link.href = '/scenarios?s=' + encodeURIComponent(u.id);
      link.textContent = u.title;
      link.title = 'Open it on the Scenarios page';
      f.appendChild(link);
    }
    const sp = document.createElement('span');
    sp.className = 'sp';
    const write = document.createElement('button');
    write.type = 'button';
    write.className = 'l2-btn primary';
    write.textContent = draft ? 'Continue the draft' : 'Write a script';
    f.append(sp, write);

    el.append(h, s, f);
    const go = () => enterScript({ source: rec, topic: tp });
    write.addEventListener('click', (e) => { e.stopPropagation(); go(); });
    el.addEventListener('click', go);
    box.appendChild(el);
  });
}

// Renaming a source, saved a moment after typing stops. The card and the spine follow it, because
// those are the two places the name is actually read.
let _titleT = null;

async function saveTitle() {
  clearTimeout(_titleT);
  if (!_src) return;
  const title = $('l2-topics-title').value.trim();
  if (!title || title === _src.title) return;
  try {
    const d = await api('/api/sources/' + encodeURIComponent(_src.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    _src.title = d.source.title;
    _acc.setSpine(LEVEL.GALLERY, _src.title.slice(0, 40));
    const i = _items.findIndex(x => String(x.id) === String(_src.id));
    if (i >= 0) { _items[i] = { ..._items[i], title: _src.title }; renderGallery(); }
    $('l2-title-saved').textContent = 'saved';
    setTimeout(() => { $('l2-title-saved').textContent = ''; }, 1600);
  } catch (e) {
    $('l2-title-saved').textContent = e.message;
  }
}

function queueRename() {
  clearTimeout(_titleT);
  _titleT = setTimeout(saveTitle, 700);
}

async function mineTopics() {
  if (!_src) return;
  _acc.lock(true);
  $('l2-mine').disabled = true;
  // Timed by how much transcript there is, in 20k-char buckets: a ten-minute video and a two-hour
  // one are not the same job, and one average over both would make both countdowns wrong.
  const chars = (_src.transcript && _src.transcript.chars) || 0;
  const row = startJob('l2-topics-job', {
    key: `l2-topics|${_bucket(chars)}`,
    label: `Reading ${Math.round(chars / 1000)}k of transcript…`,
    estimateMs: EST.topics,
  });
  try {
    const d = await api(`/api/sources/${encodeURIComponent(_src.id)}/topics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    await pollJob('/api/sources/jobs', d.jobId, (j) => { if (j.step) row.say(j.step); });
    row.finish();
    _src = (await api('/api/sources/' + encodeURIComponent(_src.id))).source;
    renderTopics(_src);
    _items = (await api('/api/sources')).sources || [];
    renderGallery();
    await refreshCounts();
  } catch (e) {
    row.fail(e.message);
  } finally {
    _acc.lock(false);
    $('l2-mine').disabled = false;
  }
}

// ── level 2: writing ────────────────────────────────────────────────────────

function ctl(label, el) {
  const w = document.createElement('label');
  w.className = 'l2-ctl';
  const s = document.createElement('span');
  s.textContent = label;
  w.append(s, el);
  return w;
}

function select(id, values, current) {
  const el = document.createElement('select');
  el.id = id;
  for (const v of values) {
    const o = document.createElement('option');
    o.value = typeof v === 'string' ? v : v.value;
    o.textContent = typeof v === 'string' ? v : v.label;
    el.appendChild(o);
  }
  if (current != null) el.value = current;
  return el;
}

async function buildControls(settings) {
  if (!_reg) _reg = await api('/api/scriptgen/models');
  const box = $('l2-gen-controls');
  box.textContent = '';
  const d = _reg.defaults;
  const s = settings || {};

  box.appendChild(ctl('Language', select('l2-c-lang', _reg.languages, s.language || d.language)));

  const scenes = document.createElement('input');
  scenes.type = 'number';
  scenes.id = 'l2-c-scenes';
  scenes.min = _reg.scenes.min;
  scenes.max = _reg.scenes.max;
  scenes.value = s.scenes || _reg.scenes.default;
  scenes.title = `${_reg.scenes.min}–${_reg.scenes.max}; the scenarios store needs at least ${_reg.minLines} lines`;
  box.appendChild(ctl('Scenes', scenes));

  box.appendChild(ctl('Tone', select('l2-c-tone', _reg.tones, s.tone || d.tone)));

  // A narrator with several readings offers one entry per reading plus a random one, which is the
  // default: rotating the readings is what keeps twenty scripts from opening the same way. With a
  // single reading there is nothing to choose between, so it stays one plain entry.
  const nars = await api('/api/narrators');
  const narValues = [{ value: 'neutral', label: 'Neutral' }];
  for (const n of (nars.narrators || [])) {
    if (!n.ready) { narValues.push({ value: n.id, label: n.name + ' — not read' }); continue; }
    if ((n.readings || 1) < 2) { narValues.push({ value: n.id, label: n.name }); continue; }
    narValues.push({ value: n.id, label: `${n.name} — random of ${n.readings}` });
    for (let i = 1; i <= n.readings; i++) {
      narValues.push({ value: `${n.id}#${i}`, label: `${n.name} — reading ${i}` });
    }
  }
  const narCur = s.narratorId
    ? (s.readingIndex ? `${s.narratorId}#${s.readingIndex}` : s.narratorId) : 'neutral';
  box.appendChild(ctl('Narrator', select('l2-c-narrator', narValues, narCur)));

  const provs = _reg.providers.map(p => ({ value: p.id, label: p.label + (p.wired ? '' : ' (n/a)') }));
  const prov = select('l2-c-provider', provs, s.provider || d.provider);
  const chosen = _reg.providers.find(p => p.id === prov.value) || _reg.providers[0];
  const model = select('l2-c-model', chosen.models, s.model || d.model);
  prov.addEventListener('change', () => {
    const p = _reg.providers.find(x => x.id === prov.value);
    model.textContent = '';
    for (const m of (p ? p.models : [])) {
      const o = document.createElement('option');
      o.value = m; o.textContent = m;
      model.appendChild(o);
    }
    queueDraft();
  });
  box.appendChild(ctl('Provider', prov));
  box.appendChild(ctl('Model', model));
  box.appendChild(ctl('Effort', select('l2-c-effort', _reg.efforts, s.effort || d.effort)));

  // Any change here belongs to the draft: a script continued at a different effort, or in another
  // narrator's voice, is a different script.
  for (const el of box.querySelectorAll('select,input')) el.addEventListener('change', queueDraft);
}

const controlsReady = () => !!$('l2-c-lang');

// Sent with every generation so the SERVER can write the result into the draft as well. Closing the
// tab mid-generation used to throw away a script that had already been paid for.
const draftKey = () => (_gen
  ? { draftId: _gen.draftId || '', sourceId: _gen.sourceId, topicId: _gen.topicId }
  : {});

function genOpts() {
  if (!controlsReady()) return {};
  const nar = $('l2-c-narrator');
  // "<id>#2" is the second reading of that narrator; a bare id means any of them. The server does
  // the picking either way - see routes/scriptgen._narrator.
  const [narratorId, readingIndex] = String(nar.value).split('#');
  return {
    language: $('l2-c-lang').value,
    scenes: parseInt($('l2-c-scenes').value, 10),
    tone: $('l2-c-tone').value,
    narratorId,
    readingId: readingIndex || '',
    readingIndex: readingIndex || '',
    narratorName: nar.options[nar.selectedIndex] ? nar.options[nar.selectedIndex].textContent : '',
    provider: $('l2-c-provider').value,
    model: $('l2-c-model').value,
    effort: $('l2-c-effort').value,
  };
}

// ONE control for the whole chain, relabelled at each step and MOVED between the two top slots.
// "Generate script" that returns five hooks and stops is, as far as the reader can tell, the wrong
// thing having happened - and once a script exists, generating is no longer the main thing to do,
// so the button goes grey and Save takes the accent.
function paintGo() {
  const written = !!(_gen && _gen.paragraphs && _gen.paragraphs.length);
  // The hook block keeps the top only until there is a script - or while hooks are being chosen,
  // which is the one case where a written script still needs the picker on screen.
  const hookOpen = !written || _stage === 'hooks' || _stage === 'pick';
  const map = {
    idle: [written ? 'Generate again' : 'Generate script', false],
    hooks: ['Writing hooks…', true],
    pick: ['Pick a hook', true],
    script: ['Writing the script…', true],
    working: ['Working…', true],
  };
  const [label, disabled] = map[_stage] || map.idle;
  const btn = $('l2-gen-go');
  btn.textContent = label;
  btn.disabled = disabled;
  btn.classList.toggle('primary', !written);
  const slot = $(hookOpen ? 'l2-go-slot-hook' : 'l2-go-slot-save');
  if (btn.parentElement !== slot) slot.appendChild(btn);

  $('l2-gen-hook-stage').hidden = !hookOpen;
  $('l2-gen-save-stage').hidden = !written;
  $('l2-gen-script-stage').hidden = !written;
  $('l2-gen-newhooks').disabled = disabled;
  $('l2-gen-discard').hidden = !(_gen && _gen.draftId);
}

function setStage(s) { _stage = s; paintGo(); }

// ── the draft ───────────────────────────────────────────────────────────────

function draftPayload() {
  const o = genOpts();
  return {
    id: _gen.draftId || undefined,
    sourceId: _gen.sourceId, sourceTitle: _gen.sourceTitle || '',
    topicId: _gen.topicId, topicTitle: _gen.topicTitle || '',
    topic: $('l2-gen-topic').value,
    hook: $('l2-gen-hook').value,
    hooks: _gen.hooks || [],
    paragraphs: _gen.paragraphs || [],
    title: $('l2-gen-title-in').value,
    humanized: !!_gen.humanized,
    settings: {
      language: o.language, tone: o.tone, scenes: o.scenes,
      narratorId: o.narratorId, narratorName: o.narratorName, readingIndex: o.readingIndex,
      provider: o.provider, model: o.model, effort: o.effort,
    },
    save: {
      gender: $('l2-gen-gender').value,
      vertical: $('l2-gen-vertical').value,
      product: $('l2-gen-product').value,
    },
  };
}

async function saveDraft() {
  if (!_gen) return;
  try {
    const d = await api('/api/library2/drafts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draftPayload()),
    });
    _gen.draftId = d.draft.id;
    paintGo();
  } catch (e) { /* a draft that failed to save is not worth interrupting the writing for */ }
}

// Typing is debounced. A stage finishing is not - that is the moment worth not losing.
function queueDraft() {
  clearTimeout(_saveT);
  _saveT = setTimeout(saveDraft, 800);
}

async function discardDraft() {
  if (!_gen || !_gen.draftId) return;
  if (!confirm('Discard this draft? What was generated into it is lost.')) return;
  try {
    await api('/api/library2/drafts/' + encodeURIComponent(_gen.draftId), { method: 'DELETE' });
    await refreshDrafts();
    if (_src) renderTopics(_src);
    renderGallery();
    await refreshCounts();
    backToGallery();
  } catch (e) { status(e.message, 'err'); }
}

// ── entering and leaving the script column ──────────────────────────────────

function clearScriptColumn() {
  $('l2-gen-hook').value = '';
  $('l2-gen-hook-list').textContent = '';
  $('l2-gen-scenes').textContent = '';
  $('l2-gen-save-status').textContent = '';
  $('l2-gen-save-status').className = 'l2-status';
  $('l2-gen-used').textContent = '';
  clearJob('l2-gen-job');
}

async function enterScript({ source = null, topic = null, draft = null } = {}) {
  clearScriptColumn();
  const known = draft || (source && topic ? draftFor(source.id, topic.id) : null);
  let full = null;
  if (known) {
    try { full = (await api('/api/library2/drafts/' + encodeURIComponent(known.id))).draft; }
    catch (e) { full = null; }
  }
  const saved = (full && full.save) || {};

  _gen = {
    draftId: full ? full.id : '',
    sourceId: full ? full.sourceId : (source ? source.id : ''),
    sourceTitle: full ? full.sourceTitle : (source ? source.title : ''),
    topicId: full ? full.topicId : (topic ? topic.id : ''),
    topicTitle: full ? full.topicTitle : (topic ? topic.title : ''),
    hooks: (full && full.hooks) || [],
    paragraphs: (full && full.paragraphs) || [],
    humanized: !!(full && full.humanized),
    readingId: '',      // filled by whichever generation happens next
  };

  $('l2-gen-from').textContent = _gen.sourceTitle
    ? `from “${_gen.sourceTitle}”${topic ? ` · ${clock(topic.start)}–${clock(topic.end)}` : ''}`
    : 'without a source';
  $('l2-gen-topic').value = full ? (full.topic || full.topicTitle || '') : (topic ? topic.title : '');
  $('l2-gen-title-in').value = (full && full.title) || '';
  $('l2-gen-gender').value = saved.gender || 'male';
  $('l2-gen-vertical').value = saved.vertical || '';
  $('l2-gen-product').value = saved.product || '';

  try { await buildControls(full ? full.settings : null); }
  catch (e) { sayJob('l2-gen-job', 'the model list could not be read: ' + e.message, true); }

  if (full && full.hook) $('l2-gen-hook').value = full.hook;
  const needsPick = _gen.hooks.length && !$('l2-gen-hook').value.trim();
  if (needsPick) renderHooks(_gen.hooks);
  if (_gen.paragraphs.length) renderScenes();
  setStage(needsPick ? 'pick' : 'idle');

  _acc.open(LEVEL.SCRIPT);
  // NO draft is written just for opening the column. A row saying "untitled draft, topic only" is
  // not progress worth resuming, and it would appear every time someone looked at a topic and
  // changed their mind. The first edit or the first generation creates it.
}

async function resumeDraft(id) {
  const d = _drafts.find(x => String(x.id) === String(id));
  if (!d) return;
  _shelf = 'sources';
  try { localStorage.setItem(LS_SHELF, _shelf); } catch (e) {}
  paintShelves();
  try { _items = (await api('/api/sources')).sources || []; } catch (e) { _items = []; }
  if (d.sourceId) {
    try {
      _src = (await api('/api/sources/' + encodeURIComponent(d.sourceId))).source;
      $('l2-topics-title').value = _src.title;
      _acc.setSpine(LEVEL.GALLERY, _src.title.slice(0, 40));
      $('l2-mine').disabled = !(_src.transcript && _src.transcript.state === 'ready');
      renderTopics(_src);
    } catch (e) { _src = null; }     // the source may be gone; the draft still opens
  }
  renderGallery();
  await enterScript({ draft: d });
}

function backToGallery() {
  _gen = null;
  setStage('idle');
  clearScriptColumn();
  _acc.reset(LEVEL.GALLERY);
  _acc.setSpine(LEVEL.GALLERY, 'Sources');
}

// ── the chain: hooks, then the script ───────────────────────────────────────

function renderHooks(hooks) {
  const box = $('l2-gen-hook-list');
  box.textContent = '';
  for (const h of hooks) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'l2-hook';
    const k = document.createElement('span');
    k.className = 'l2-hook-k';
    k.textContent = h.kind;
    const t = document.createElement('span');
    t.className = 'l2-hook-t';
    t.textContent = h.text;
    b.append(k, t);
    // Picking a hook runs straight on into the script. That is the whole point of one button.
    b.addEventListener('click', async () => {
      $('l2-gen-hook').value = h.text;
      box.textContent = '';
      await saveDraft();
      runScript();
    });
    box.appendChild(b);
  }
}

// Everything slow goes through here, so everything slow locks the accordion the same way and
// counts down the same way.
async function runStage(path, body, timing, onResult) {
  _acc.lock(true);
  const row = startJob('l2-gen-job', timing);
  try {
    const d = await api(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const job = await pollJob('/api/scriptgen/jobs', d.jobId, (j) => { if (j.step) row.say(j.step); });
    row.finish();
    await onResult(job.result || {});
    return true;
  } catch (e) {
    row.fail(e.message);
    return false;
  } finally {
    _acc.lock(false);
  }
}

// One press: five hooks, then - once one is chosen - the script. A hook already written skips
// straight to the script, because there is nothing left to suggest.
async function runGo() {
  if (!controlsReady()) { sayJob('l2-gen-job', 'the model list is not loaded yet', true); return; }
  const topic = $('l2-gen-topic').value.trim();
  if (!topic) { sayJob('l2-gen-job', 'Describe the topic first.', true); return; }
  // ONE draw of the narrator's reading per press, not per request. "Random" that re-rolled between
  // the hooks and the script would write the opening in one description of the voice and the rest
  // in another; pressing the button again is what asks for a new draw.
  _gen.readingId = '';
  if ($('l2-gen-hook').value.trim()) { runScript(); return; }

  setStage('hooks');
  $('l2-gen-hook-list').textContent = '';
  const o = genOpts();
  const ok = await runStage('/api/scriptgen/hooks',
    { ...o, ...draftKey(), topic },
    { key: `l2-hooks|${o.model}|${o.effort}`, label: 'Writing five hooks…', estimateMs: EST.hooks },
    async (r) => {
      _gen.hooks = r.hooks || [];
      noteReading(r);
      renderHooks(_gen.hooks);
      await saveDraft();
    });
  setStage(ok && _gen.hooks.length ? 'pick' : 'idle');
}

// Which reading wrote it. Recorded on the draft as well as shown, because it is what has to go
// into the scenario's provenance when this is saved - the random pick happened on the server, and
// after the fact nothing else can say which one it was.
function noteReading(r) {
  const rd = r && r.reading;
  _gen.readingId = (rd && rd.id) || '';
  const el = $('l2-gen-used');
  if (!rd || rd.total < 2) { el.textContent = ''; return; }
  el.textContent = `written with ${r.narrator}`;
}

// Five fresh ones, over a script that already exists. It clears the hook first so the chain starts
// at the hooks rather than skipping to a rewrite of the same opening.
function newHooks() {
  if (!_gen || _acc.locked()) return;
  $('l2-gen-hook').value = '';
  runGo();
}

async function runScript() {
  const topic = $('l2-gen-topic').value.trim();
  const hook = $('l2-gen-hook').value.trim();
  if (!topic || !hook) { setStage('idle'); return; }
  setStage('script');
  const o = genOpts();
  const opts = { ...o, ...draftKey(), topic, hook };
  if (_gen.readingId) opts.readingId = _gen.readingId;   // the reading the hooks were drawn with
  await runStage('/api/scriptgen/script', opts,
    { key: `l2-script|${o.model}|${o.effort}|${o.scenes}`,
      label: `Writing ${o.scenes} paragraphs…`, estimateMs: EST.script(o.scenes) },
    async (r) => {
      _gen.paragraphs = r.paragraphs || [];
      _gen.humanized = false;
      noteReading(r);
      if (!$('l2-gen-title-in').value.trim()) $('l2-gen-title-in').value = r.title || topic.slice(0, 60);
      renderScenes();
      await saveDraft();
      if (r.asked && r.paragraphs && r.paragraphs.length !== r.asked) {
        sayJob('l2-gen-job',
          `Note: ${r.paragraphs.length} paragraphs came back, ${r.asked} were asked for.`);
      }
    });
  setStage('idle');
}

function renderScenes() {
  const box = $('l2-gen-scenes');
  box.textContent = '';
  const list = (_gen && _gen.paragraphs) || [];
  list.forEach((text, i) => {
    const el = document.createElement('div');
    el.className = 'l2-scene' + (i === 0 ? ' hook' : '');
    const n = document.createElement('div');
    // Paragraph one is not paragraph one, it is the hook - and saying so is what lets the separate
    // hook box go away instead of sitting above the script disagreeing with it.
    n.className = 'l2-scene-n' + (i === 0 ? ' is-hook' : '');
    n.textContent = i === 0 ? 'hook' : String(i + 1);
    const ta = document.createElement('textarea');
    ta.className = 'l2-scene-t';
    ta.rows = 2;
    ta.value = text;
    const acts = document.createElement('div');
    acts.className = 'l2-scene-a';
    const secs = document.createElement('div');
    secs.className = 'l2-scene-secs';
    secs.textContent = spokenSeconds(text) + 's';
    acts.appendChild(secs);
    const fit = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
    ta.addEventListener('input', () => {
      _gen.paragraphs[i] = ta.value;
      // Editing the first paragraph edits the hook, so the hidden box follows it: "Generate again"
      // must write from what is on screen, not from whatever was picked an hour ago.
      if (i === 0) $('l2-gen-hook').value = ta.value;
      secs.textContent = spokenSeconds(ta.value) + 's';
      fit();
      queueDraft();
    });
    setTimeout(fit, 0);
    if (i > 0) {
      const rw = document.createElement('button');
      rw.type = 'button';
      rw.className = 'l2-scene-rw';
      rw.textContent = 'rewrite';
      rw.title = 'Rewrite this paragraph from a different angle';
      rw.addEventListener('click', () => rewriteScene(i, rw));
      acts.appendChild(rw);
    }
    el.append(n, ta, acts);
    box.appendChild(el);
  });
  paintGo();
}

async function humanize() {
  if (!_gen || !_gen.paragraphs.length) return;
  setStage('working');
  // The SAME reading that wrote the script, not another random one: a cleaning pass aimed at a
  // different description of the voice edits the script towards a voice it was not written in.
  const o = genOpts();
  const opts = { ...o, ...draftKey(), paragraphs: _gen.paragraphs };
  if (_gen.readingId) opts.readingId = _gen.readingId;
  await runStage('/api/scriptgen/humanize', opts,
    { key: `l2-humanize|${o.model}|${o.effort}`,
      label: 'Cleaning to the narrator…', estimateMs: EST.humanize },
    async (r) => {
      _gen.paragraphs = r.paragraphs || _gen.paragraphs;
      _gen.humanized = !!r.applied;
      renderScenes();
      await saveDraft();
      if (r.note) sayJob('l2-gen-job', r.note);
    });
  setStage('idle');
}

async function rewriteScene(index, btn) {
  const was = btn.textContent;
  btn.textContent = '…';
  setStage('working');
  const o = genOpts();
  await runStage('/api/scriptgen/rewrite',
    { ...o, topic: $('l2-gen-topic').value.trim(), script: _gen.paragraphs, index },
    { key: `l2-rewrite|${o.model}|${o.effort}`,
      label: `Rewriting paragraph ${index + 1}…`, estimateMs: EST.rewrite },
    async (r) => {
      _gen.paragraphs[index] = r.paragraph || _gen.paragraphs[index];
      renderScenes();
      await saveDraft();
    });
  btn.textContent = was;
  setStage('idle');
}

async function saveScript() {
  if (!_gen || !_gen.paragraphs.length) return;
  const st = $('l2-gen-save-status');
  const btn = $('l2-gen-save');
  btn.disabled = true;
  _acc.lock(true);
  st.textContent = 'saving…';
  st.className = 'l2-status';
  try {
    const o = genOpts();
    const d = await api('/api/scriptgen/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: $('l2-gen-title-in').value.trim(),
        paragraphs: _gen.paragraphs,
        gender: $('l2-gen-gender').value,
        vertical: $('l2-gen-vertical').value.trim(),
        product: $('l2-gen-product').value.trim(),
        narratorId: o.narratorId, language: o.language, tone: o.tone, model: o.model,
        // The reading the script was ACTUALLY written with, not the one the dropdown asks for:
        // "random" has to resolve to a real reading in the record.
        readingId: _gen.readingId || o.readingId,
        sourceId: _gen.sourceId, topicId: _gen.topicId, humanized: _gen.humanized,
        draftId: _gen.draftId,
      }),
    });
    // Done: the draft is gone, the topic is marked written, the source's counter has moved, and
    // the gallery is where you choose what to write next. The source stays selected, so one click
    // on its spine is back among its topics.
    await refreshDrafts();
    _items = (await api('/api/sources')).sources || [];
    if (_src) {
      try { _src = (await api('/api/sources/' + encodeURIComponent(_src.id))).source; renderTopics(_src); }
      catch (e) { /* the source may be gone */ }
    }
    renderGallery();
    await refreshCounts();
    backToGallery();
    const n = (d.scenario.lines || []).length;
    status(`Saved “${d.scenario.title}” — ${n} lines, on the Scenarios shelf.`, 'ok');
  } catch (e) {
    st.textContent = e.message;
    st.className = 'l2-status err';
  } finally {
    btn.disabled = false;
    _acc.lock(false);
  }
}

// ── the add-source dialog ───────────────────────────────────────────────────

function setRoute(route) {
  document.querySelectorAll('.l2-choice-btn').forEach(b => b.classList.toggle('cur', b.dataset.route === route));
  $('l2-route-file').hidden = route !== 'file';
  $('l2-route-link').hidden = route !== 'link';
}

async function refreshLinkState() {
  try {
    const d = await api('/api/sources/ytdlp');
    const ck = d.cookies || {};
    $('l2-ck-state').textContent = (!ck.present ? 'none'
      : ck.verified ? `checked ${fmtDate(ck.verifiedAt)}` : 'uploaded, not checked')
      + (ck.expiresSoon ? ' · expires within a week' : '');
    $('l2-link-lock').hidden = !!d.linksEnabled;
    $('l2-link-why').textContent = d.why || '';
    $('l2-src-link-go').disabled = !d.linksEnabled;
    $('l2-ck-verify').disabled = !ck.present;
    $('l2-ck-delete').disabled = !ck.present;
  } catch (e) {
    $('l2-link-lock').hidden = false;
    $('l2-link-why').textContent = e.message;
    $('l2-src-link-go').disabled = true;
  }
}

async function openAddSource() {
  setRoute('file');
  clearJob('l2-src-job');
  $('l2-src-ov').hidden = false;
  await refreshLinkState();
}

// THE POPUP IS DONE WHEN THE WORDS ARE IN. It closes itself, the source opens, and the topics
// start being found - because "Done, 82k chars" with a bar still sliding and a dialog still up is
// the worst of both: nothing is running and nothing is finished, and the next step (which is
// always the same step) is left to be discovered.
async function afterIngest(id, job) {
  const srcId = id || (job && job.source && job.source.id) || '';
  closeAll();
  await load();
  if (!srcId) return;
  await openSource(srcId);
  // Only when there is something to read and nothing read yet: coming back to a source that
  // already has topics must not quietly spend another call on them.
  const t = (_src && _src.transcript) || {};
  if (_src && t.state === 'ready' && !((_src.topics || []).length)) mineTopics();
}

async function addByFile() {
  const input = $('l2-src-file');
  const file = input.files && input.files[0];
  if (!file) { sayJob('l2-src-job', 'Pick a file first.', true); return; }
  const form = new FormData();
  form.append('file', file);
  const title = $('l2-src-file-title').value.trim();
  if (title) form.append('title', title);
  $('l2-src-file-go').disabled = true;
  // Upload plus compression plus the transcription itself, all of it scaling with the file, so
  // the estimate is keyed by size in 100 MB buckets.
  const row = startJob('l2-src-job', {
    key: `l2-ingest|file|${_bucket(file.size / 1048576)}mb`,
    label: `Uploading ${mb(file.size)}…`,
    estimateMs: EST.ingestFile(file.size),
  });
  try {
    const d = await api('/api/sources/upload', { method: 'POST', body: form });
    const job = await pollJob('/api/sources/jobs', d.jobId, (j) => { if (j.step) row.say(j.step); });
    row.finish();
    input.value = '';
    $('l2-src-file-title').value = '';
    await afterIngest(d.source && d.source.id, job);
  } catch (e) {
    row.fail(e.message);
  } finally { $('l2-src-file-go').disabled = false; }
}

async function addByLink() {
  const url = $('l2-src-url').value.trim();
  if (!url) { sayJob('l2-src-job', 'Paste a link first.', true); return; }
  $('l2-src-link-go').disabled = true;
  // No size to key on before the download starts - one bucket, and it learns from the first run.
  const row = startJob('l2-src-job', {
    key: 'l2-ingest|link', label: 'Reading the link…', estimateMs: EST.ingestLink,
  });
  try {
    const d = await api('/api/sources/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
    });
    const job = await pollJob('/api/sources/jobs', d.jobId, (j) => { if (j.step) row.say(j.step); });
    row.finish();
    $('l2-src-url').value = '';
    await afterIngest('', job);
  } catch (e) {
    row.fail(e.message);
    await refreshLinkState();
  } finally { $('l2-src-link-go').disabled = false; }
}

async function uploadCookies() {
  const input = $('l2-ck-file');
  const file = input.files && input.files[0];
  if (!file) { sayJob('l2-src-job', 'Pick the cookies.txt file first.', true); return; }
  const form = new FormData();
  form.append('file', file);
  sayJob('l2-src-job', 'Storing the cookie file…');
  try {
    const d = await api('/api/sources/cookies', { method: 'POST', body: form });
    sayJob('l2-src-job', `Stored — ${d.youtubeEntries} cookies for youtube.com. Now check it against YouTube.`);
    input.value = '';
  } catch (e) { sayJob('l2-src-job', e.message, true); }
  await refreshLinkState();
}

async function verifyCookies() {
  sayJob('l2-src-job', 'Asking YouTube for a video, twice…');
  try {
    const d = await api('/api/sources/cookies/verify', { method: 'POST' });
    sayJob('l2-src-job', `Works — YouTube served "${d.sawTitle}" on ${d.attempts} attempts. Links are open.`);
  } catch (e) { sayJob('l2-src-job', e.message, true); }
  await refreshLinkState();
}

async function deleteCookies() {
  if (!confirm('Delete the cookie file? Links will be locked again.')) return;
  try { await api('/api/sources/cookies', { method: 'DELETE' }); sayJob('l2-src-job', 'Cookie file deleted.'); }
  catch (e) { sayJob('l2-src-job', e.message, true); }
  await refreshLinkState();
}

// ── narrator actions ────────────────────────────────────────────────────────

async function addNarrator() {
  const name = prompt('Name for the new narrator:');
  if (name === null) return;
  if (!name.trim()) { status('a name is needed', 'err'); return; }
  try {
    const d = await api('/api/narrators', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
    });
    await load();
    await openNarrator(d.narrator.id);
  } catch (e) { status(e.message, 'err'); }
}

async function addSampleText() {
  if (!_nar) return;
  const text = $('l2-nar-text').value.trim();
  if (!text) { sayJob('l2-nar-job', 'Paste some writing first.', true); return; }
  try {
    await api(`/api/narrators/${encodeURIComponent(_nar.id)}/samples`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, label: 'pasted text' }),
    });
    $('l2-nar-text').value = '';
    clearJob('l2-nar-job');
    await openNarrator(_nar.id);
  } catch (e) { sayJob('l2-nar-job', e.message, true); }
}

async function addSampleFile() {
  if (!_nar) return;
  const input = $('l2-nar-file');
  const file = input.files && input.files[0];
  if (!file) { sayJob('l2-nar-job', 'Pick a video or audio file first.', true); return; }
  const form = new FormData();
  form.append('file', file);
  const row = startJob('l2-nar-job', {
    key: `l2-sample|${_bucket(file.size / 1048576)}mb`,
    label: `Uploading ${mb(file.size)}…`,
    estimateMs: EST.sample(file.size),
  });
  try {
    const d = await api(`/api/narrators/${encodeURIComponent(_nar.id)}/samples/upload`, { method: 'POST', body: form });
    await pollJob('/api/narrators/jobs', d.jobId, (j) => { if (j.step) row.say(j.step); });
    row.finish();
    input.value = '';
    await openNarrator(_nar.id);
  } catch (e) { row.fail(e.message); }
}

async function analyseNarrator() {
  if (!_nar) return;
  $('l2-nar-analyse').disabled = true;
  // Timed by how much writing there is to read, in 2k-word buckets.
  const words = (_nar.samples || []).reduce((n, x) => n + (x.words || 0), 0);
  const row = startJob('l2-nar-job', {
    key: `l2-analyse|${_bucket(words)}`,
    label: `Reading ${words} words…`,
    estimateMs: EST.analyse,
  });
  try {
    const d = await api(`/api/narrators/${encodeURIComponent(_nar.id)}/analyse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    await pollJob('/api/narrators/jobs', d.jobId, (j) => { if (j.step) row.say(j.step); });
    row.finish();
    await openNarrator(_nar.id);
    await load();
  } catch (e) {
    row.fail(e.message);
  } finally { $('l2-nar-analyse').disabled = false; }
}

// ── wiring ──────────────────────────────────────────────────────────────────

function closeAll() {
  for (const id of ['l2-src-ov', 'l2-nar-ov', 'l2-scen-ov']) $(id).hidden = true;
}

(function boot() {
  try {
    const remembered = localStorage.getItem(LS_SHELF);
    if (remembered && SHELVES[remembered]) _shelf = remembered;
  } catch (e) {}

  _acc = createAccordion({
    root: $('l2-cols'),
    levels: ['l2-col-gallery', 'l2-col-topics', 'l2-col-script'],
    // A spine click while something is generating is refused rather than obeyed: the answer would
    // arrive into a column nobody is looking at.
    canLeave: () => !_acc || !_acc.locked(),
  });

  document.querySelectorAll('.l2-shelf').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.kind === _shelf || _acc.locked()) return;
      _shelf = b.dataset.kind;
      try { localStorage.setItem(LS_SHELF, _shelf); } catch (e) {}
      load();
    });
  });

  $('l2-add-source').addEventListener('click', openAddSource);
  $('l2-add-narrator').addEventListener('click', addNarrator);
  $('l2-open-scenarios').addEventListener('click', () => { window.location.href = '/scenarios'; });

  // Writing without a source: the same column, entered directly. The topics column stays folded
  // with nothing in it, which is honest - there is no source to have topics.
  $('l2-write').addEventListener('click', async () => {
    if (_acc.locked()) return;
    if (_shelf !== 'sources') {
      _shelf = 'sources';
      try { localStorage.setItem(LS_SHELF, _shelf); } catch (e) {}
      paintShelves();
      try { _items = (await api('/api/sources')).sources || []; } catch (e) { _items = []; }
      renderGallery();
      await refreshCounts();
    }
    if (!_src) {
      const box = $('l2-topics');
      box.textContent = '';
      box.appendChild(empty('No source chosen — this script is being written from the topic alone.'));
      $('l2-topics-title').textContent = 'Topics';
      $('l2-mine').disabled = true;
    }
    await enterScript({});
  });

  $('l2-mine').addEventListener('click', mineTopics);
  // Typing waits out a pause; Enter and leaving the field are both "done", and save at once.
  $('l2-topics-title').addEventListener('input', queueRename);
  $('l2-topics-title').addEventListener('blur', saveTitle);
  $('l2-topics-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('l2-topics-title').blur(); });

  $('l2-gen-go').addEventListener('click', runGo);
  $('l2-gen-newhooks').addEventListener('click', newHooks);
  $('l2-gen-humanize').addEventListener('click', humanize);
  $('l2-gen-save').addEventListener('click', saveScript);
  $('l2-gen-discard').addEventListener('click', discardDraft);
  $('l2-gen-topic').addEventListener('input', queueDraft);
  $('l2-gen-title-in').addEventListener('input', queueDraft);
  for (const id of ['l2-gen-gender', 'l2-gen-vertical', 'l2-gen-product']) {
    $(id).addEventListener('change', queueDraft);
    $(id).addEventListener('input', queueDraft);
  }

  $('l2-gen-hook').addEventListener('input', queueDraft);

  $('l2-src-close').addEventListener('click', closeAll);
  document.querySelectorAll('.l2-choice-btn').forEach(b => b.addEventListener('click', () => setRoute(b.dataset.route)));
  $('l2-src-file-go').addEventListener('click', addByFile);
  $('l2-src-link-go').addEventListener('click', addByLink);
  $('l2-ck-upload').addEventListener('click', uploadCookies);
  $('l2-ck-verify').addEventListener('click', verifyCookies);
  $('l2-ck-delete').addEventListener('click', deleteCookies);

  $('l2-nar-add-text').addEventListener('click', addSampleText);
  $('l2-nar-add-file').addEventListener('click', addSampleFile);
  $('l2-nar-analyse').addEventListener('click', analyseNarrator);
  $('l2-nar-close').addEventListener('click', closeAll);

  $('l2-scen-close').addEventListener('click', closeAll);
  $('l2-scen-open').addEventListener('click', () => {
    if (_scen) window.location.href = '/scenarios?s=' + encodeURIComponent(_scen.id);
  });
  $('l2-scen-del').addEventListener('click', async () => {
    if (!_scen) return;
    if (!confirm(`Delete "${_scen.title || 'untitled'}"? This cannot be undone.`)) return;
    try {
      await api('/api/scen3/scenarios/' + encodeURIComponent(_scen.id), { method: 'DELETE' });
      closeAll();
      await load();
    } catch (e) { status(e.message, 'err'); }
  });

  document.querySelectorAll('.l2-ov').forEach(ov => {
    ov.addEventListener('click', (e) => { if (e.target === ov) closeAll(); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ([...document.querySelectorAll('.l2-ov')].some(o => !o.hidden)) { closeAll(); e.stopPropagation(); }
  });

  initNav();
  mountLibSwitch(document.getElementById('l2-shelves'));
  paintGo();
  load();
})();
