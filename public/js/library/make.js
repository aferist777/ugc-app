// LIBRARY — the scenario generator: "New scenario" on the Scenarios shelf (phase E, the owner
// 2026-09-29). What Library 2 was, moved to where scenarios are.
//
// TWO PARTS, in place of the scenario list. On the LEFT a narrow column of sources - the long videos
// scripts are written from - with a 20px "+" over it that adds one. On the RIGHT the "Generate script"
// form; with no source chosen it writes from the topic alone ("without a source"). Choosing a source
// puts ITS topics on the right instead; choosing a topic brings the form back, filled for that
// fragment. Pressing the chosen source again lets go of it; "← topics" goes back from the form.
//
// PAID WORK IS NEVER LOST (the owner: drafts must not be lost). Everything slow is a job on the server
// that this module polls, and every stage of a script is written into a draft on the server as it
// lands (routes/scriptgen.js, the keepers). So before any paid step the draft is saved at once - a
// form written without a source has no other address the answer could be filed under - and a
// pending save is flushed whenever the form is left: another source or draft, "← Scenarios",
// leaving the shelf, closing the page.
//
// WORK KEEPS RUNNING WHEN IT IS NOT LOOKED AT. Leaving this layout hides it; it is not torn down, so
// its polls go on and its countdown rows are where they were on the way back. The server marks what
// is running - a source whose topics are being found, a draft a stage is writing into - refuses a
// second start of the same thing (409), and says what runs in its lists, so a page opened later
// picks the countdown up again instead of paying twice.

import * as J from './jobs.js';
import * as Layers from '../layers.js';

const $ = (id) => document.getElementById(id);
const el = J.el;

let _hooks = {};
let _built = false;
let _sources = [];        // source summaries, newest first
let _drafts = [];         // draft summaries
let _src = null;          // the chosen source, whole; null = writing without a source
let _view = 'form';       // what the right side shows: 'form' | 'topics'
let _gen = null;          // the form's state - which is also what a draft is made of
let _stage = 'idle';      // idle | hooks | pick | script | working
let _saveT = null;
let _reg = null;          // the model registry, read once
let _pollT = null;        // the sources column's refresh while something is being transcribed
let _ingest = null;       // { jobId, startedAt, key, label, estimateMs, step } - an ingest running
// sourceId -> { kind: 'topics'|'transcribe', jobId, startedAt, rows, step, followed } - see _followSrcJob
const _srcJobs = new Map();
const _srcLast = new Map();  // sourceId -> { text, err } - what its last job said, when it failed
const _following = new Map();  // draftId -> { jobId, run, rows } - the stages this page follows

// ── Markup ──────────────────────────────────────────────────────────────────
const HTML = `
  <aside class="mk-src">
    <button class="mk-add" id="mk-add" type="button" title="Add a source - a long video, or its audio">+</button>
    <div class="mk-src-list" id="mk-src-list"></div>
  </aside>
  <section class="mk-main">
    <div class="mk-said" id="mk-said" hidden></div>
    <div class="mk-view" id="mk-topics" hidden>
      <div class="mk-head">
        <input class="mk-title-in" id="mk-src-title" type="text" spellcheck="false"
               title="The name of this source - click to rename" placeholder="Untitled source">
        <span class="mk-note" id="mk-title-saved"></span>
        <span class="sp"></span>
        <button class="lib-btn" type="button" id="mk-mine">Find topics</button>
        <button class="lib-btn" type="button" id="mk-src-off" title="Let go of this source and write without one">✕</button>
      </div>
      <div class="mk-body">
        <div class="mk-summary" id="mk-summary"></div>
        <div class="mk-job" id="mk-topics-job" hidden></div>
        <div class="mk-topics" id="mk-topic-list"></div>
      </div>
    </div>
    <div class="mk-view" id="mk-form">
      <div class="mk-head">
        <button class="lib-btn" type="button" id="mk-to-topics" hidden title="Back to this source's topics">← topics</button>
        <span class="mk-col-title">Generate script</span>
        <span class="mk-note" id="mk-from"></span>
        <span class="sp"></span>
        <button class="lib-btn danger" type="button" id="mk-discard" hidden>Discard draft</button>
      </div>
      <div class="mk-body">
        <label class="mk-field"><span>Topic</span>
          <input type="text" id="mk-topic" placeholder="What the video is about"></label>
        <div class="mk-controls" id="mk-controls"></div>
        <div class="mk-note-line" id="mk-nar-note" hidden></div>
        <div class="mk-job" id="mk-job" hidden></div>
        <div class="mk-stage" id="mk-hook-stage">
          <div class="mk-stage-h">
            <span>Hook <em>— the first line said out loud</em></span>
            <span class="sp"></span>
            <span class="mk-go-slot" id="mk-go-slot-hook">
              <button class="lib-btn primary" type="button" id="mk-go">Generate script</button>
            </span>
          </div>
          <textarea id="mk-hook" rows="3" placeholder="Write it yourself, or let the model suggest five."></textarea>
          <div class="mk-hooks" id="mk-hook-list"></div>
        </div>
        <div class="mk-stage" id="mk-save-stage" hidden>
          <div class="mk-stage-h">
            <span>Save as a scenario</span>
            <span class="sp"></span>
            <button class="lib-btn" type="button" id="mk-newhooks" title="Suggest five fresh hooks and write from the one you pick">New hooks</button>
            <span class="mk-go-slot" id="mk-go-slot-save"></span>
            <button class="lib-btn primary" type="button" id="mk-save">Save to Scenarios</button>
          </div>
          <div class="mk-save-row">
            <label class="mk-field"><span>Title</span><input type="text" id="mk-title"></label>
            <label class="mk-field"><span>Narrator gender <em>— the store requires it</em></span>
              <select id="mk-gender"><option value="male">male</option><option value="female">female</option></select></label>
            <label class="mk-field"><span>Vertical</span><input type="text" id="mk-vertical" placeholder="e.g. history"></label>
            <label class="mk-field"><span>Product</span><input type="text" id="mk-product" placeholder="what it sells, if anything"></label>
          </div>
          <div class="mk-stage-h">
            <span class="lib-status" id="mk-save-status"></span>
            <span class="sp"></span>
            <span class="mk-note" id="mk-used"></span>
          </div>
        </div>
        <div class="mk-stage" id="mk-script-stage" hidden>
          <div class="mk-stage-h">
            <span>Script</span>
            <span class="sp"></span>
            <button class="lib-btn" type="button" id="mk-humanize">Clean to the narrator</button>
          </div>
          <div class="mk-scenes" id="mk-scenes"></div>
        </div>
      </div>
    </div>
  </section>`;

function _build() {
  if (_built) return;
  const host = $('lib-make');
  host.innerHTML = HTML;
  _built = true;

  $('mk-add').addEventListener('click', _openAddSource);
  $('mk-mine').addEventListener('click', _mineTopics);
  $('mk-src-off').addEventListener('click', () => _chooseSource(null));
  $('mk-to-topics').addEventListener('click', () => { if (_src) _showTopics(); });
  $('mk-src-title').addEventListener('input', _queueRename);
  $('mk-src-title').addEventListener('blur', _saveTitle);
  $('mk-src-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mk-src-title').blur(); });

  $('mk-go').addEventListener('click', _runGo);
  $('mk-newhooks').addEventListener('click', _newHooks);
  $('mk-humanize').addEventListener('click', _humanize);
  $('mk-save').addEventListener('click', _saveScript);
  $('mk-discard').addEventListener('click', _discardDraft);
  for (const id of ['mk-topic', 'mk-title', 'mk-hook', 'mk-vertical', 'mk-product']) $(id).addEventListener('input', _queueDraft);
  // A hook typed by hand while five wait to be picked is a choice too: the chain goes on from it.
  $('mk-hook').addEventListener('input', () => { if (_stage === 'pick' && $('mk-hook').value.trim()) _setStage('idle'); });
  $('mk-gender').addEventListener('change', _queueDraft);

  // The narrators window says when a narrator was made, deleted or read again (js/library/narrators.js);
  // the form's list of them is rebuilt, keeping the choice while it still exists.
  document.addEventListener('lib:narrators', () => { if (_gen) _paintNarrators(); });
  // Closing the page is leaving the form: a save still waiting out its pause goes now.
  window.addEventListener('pagehide', () => { if (_saveT && _gen) _saveDraft({ keepalive: true }); });
}

// ── Opening and leaving ─────────────────────────────────────────────────────
/** The page's hooks: status(text, kind), counts(), openScenario(id) - "Saved · open". */
export function init(hooks) { _hooks = hooks || {}; }

/**
 * Show the layout. `draftId` continues that draft; without one it is what the button says - a NEW
 * scenario, the form without a source. What was open is saved first, and a stage it runs goes on:
 * its draft heads the Scenarios list as "draft · writing…", one press away.
 */
export async function open(opts) {
  _build();
  const o = opts || {};
  await _flushDraft();
  await Promise.all([_readSources(), _readDrafts()]);
  _paintSources();
  if (o.draftId && await _resumeDraft(o.draftId)) return;
  _src = null;
  _paintSources();
  await _enterScript({});
}

/** Leave the layout: what is typed is saved; what runs keeps running. */
export async function close() {
  _say('');
  await _flushDraft();
}

// ── Sources: the column ─────────────────────────────────────────────────────
// Being read: the states only a running job leaves behind (routes/sources.js LIVE), or a transcript
// under way. A source that failed is never "being read", whatever its transcript still says.
const READING = new Set(['stored', 'downloading', 'transcribing']);
const _reading = (s) => !!s && s.state !== 'error'
  && (READING.has(s.state) || !!(s.transcript && s.transcript.state === 'running'));

async function _readSources() {
  try { _sources = (await J.api('/api/sources')).sources || []; } catch (e) { return; }
  for (const s of _sources) {
    // A topics job the server knows about and this page does not - the page was reloaded, or Library 2
    // started it. Followed at once, so its card is right when it lands whether it is opened or not.
    const id = String(s.id);
    if (s.job && s.job.kind === 'topics' && s.job.jobId && !_srcJobs.has(id)) {
      _srcJobs.set(id, { kind: 'topics', jobId: s.job.jobId, startedAt: s.job.startedAt || Date.now(), rows: [], step: '' });
      _followSrcJob(id);
    }
  }
  _pollWhileBusy();
}

async function _readDrafts() {
  try { _drafts = (await J.api('/api/scriptgen/drafts')).drafts || []; } catch (e) { /* the last list stands */ }
}

// While a source is being fetched or read, the column asks again every few seconds - the job that
// does it belongs to whoever started it, and a card saying "transcribing…" forever is the one thing
// the column must not do.
function _pollWhileBusy() {
  const busy = _sources.some(_reading);
  if (busy && !_pollT) {
    _pollT = setInterval(async () => {
      await _readSources();
      if (_built) _paintSources();
      if (_src) {
        const fresh = _sources.find(s => String(s.id) === String(_src.id));
        const was = (_src.transcript || {}).state;
        if (fresh && (fresh.state !== _src.state || (fresh.transcript || {}).state !== was)) await _refreshSource();
      }
    }, 5000);
  } else if (!busy && _pollT) { clearInterval(_pollT); _pollT = null; }
}

function _stateLine(it) {
  const t = it.transcript || {};
  if (it.state === 'error') return /interrupted/i.test(it.error || '') ? 'interrupted' : 'failed';
  if (it.state === 'downloading') return 'downloading…';
  if (_reading(it)) return 'transcribing…';
  if (t.state !== 'ready') return 'no transcript';
  const run = _srcJobs.get(String(it.id));
  if (run && run.kind === 'topics') return 'finding topics…';
  return it.topics ? `${it.topicsUsed || 0} of ${it.topics} topics used` : 'no topics yet';
}

function _paintSources() {
  const box = $('mk-src-list');
  if (!box) return;
  box.textContent = '';
  if (!_sources.length) {
    box.appendChild(el('div', 'mk-src-empty', 'No sources yet. A long video, added with +, becomes material to write from.'));
    return;
  }
  for (const it of _sources) {
    const card = el('div', 'mk-src-card' + (_src && String(_src.id) === String(it.id) ? ' cur' : ''));
    card.title = it.title + (_src && String(_src.id) === String(it.id) ? '\nPress again to write without a source' : '');
    const box2 = el('div', 'mk-src-thumb' + (it.thumb ? '' : ' pending'));
    if (it.thumb) {
      const img = el('img');
      img.loading = 'lazy';
      img.alt = it.title;
      img.src = it.thumb;
      box2.appendChild(img);
    }
    if (it.seconds) box2.appendChild(el('span', 'mk-src-dur', J.clock(it.seconds)));
    const x = el('button', 'mk-x', '✕');
    x.type = 'button';
    x.title = 'Delete this source, its video and its transcript';
    x.addEventListener('click', (e) => { e.stopPropagation(); _deleteSource(it); });
    box2.appendChild(x);
    card.appendChild(box2);
    card.appendChild(el('div', 'mk-src-t', it.title));
    const sub = el('div', 'mk-src-s');
    sub.appendChild(el('span', null, _stateLine(it)));
    const nd = _drafts.filter(d => String(d.sourceId) === String(it.id)).length;
    if (nd) sub.appendChild(el('span', 'mk-src-draft', nd === 1 ? '1 draft' : `${nd} drafts`));
    card.appendChild(sub);
    card.addEventListener('click', () => _chooseSource(it));
    box.appendChild(card);
  }
}

// Choosing a source shows its topics; choosing the chosen one again - or its ✕ - lets go of it and
// the form writes without a source.
async function _chooseSource(it) {
  await _flushDraft();
  _say('');
  if (!it || (_src && String(_src.id) === String(it.id))) {
    _src = null;
    _paintSources();
    await _enterScript({});
    return;
  }
  try {
    _src = (await J.api('/api/sources/' + encodeURIComponent(it.id))).source;
  } catch (e) { _say(e.message, 'err'); return; }
  _paintSources();
  _showTopics();
}

// The chosen source read again - whatever is on the right, so the form's "← topics" and the next
// generation see the topics as they are now.
async function _refreshSource() {
  if (!_src) return;
  const id = String(_src.id);
  let fresh = null;
  try { fresh = (await J.api('/api/sources/' + encodeURIComponent(id))).source; } catch (e) { fresh = null; }
  if (!_src || String(_src.id) !== id) return;       // another source was chosen meanwhile
  _src = fresh;
  if (!_src) _paintSources();
  if (_view === 'topics') { if (_src) _showTopics(); else await _enterScript({}); }
}

// The form's source or topic is gone - the source deleted, the topic not found again: the draft
// carries on without a source, as the server has already made it, and says so on the next save.
function _detachGen() {
  if (!_gen) return;
  _gen.sourceId = ''; _gen.topicId = ''; _gen.sourceTitle = ''; _gen.topicTitle = ''; _gen.topicSpan = '';
  _paintFrom();
  if (_view === 'form') _showForm();
  if (_gen.draftId) _queueDraft();
}

async function _deleteSource(it) {
  const nd = _drafts.filter(d => String(d.sourceId) === String(it.id)).length;
  const lines = [`Delete "${it.title}"?`, '',
    `The video (${J.mb(it.bytes || 0)}), its poster and its transcript are removed from disk.`];
  if (nd) lines.push('', `${nd === 1 ? 'Its draft is' : `Its ${nd} drafts are`} kept, and carry on without a source.`);
  if (!confirm(lines.join('\n'))) return;
  // What is typed goes first, with the source it was written from - the server then detaches it.
  await _flushDraft();
  try {
    await J.api('/api/sources/' + encodeURIComponent(it.id), { method: 'DELETE' });
    const was = _src && String(_src.id) === String(it.id);
    if (was) _src = null;
    if (_gen && String(_gen.sourceId) === String(it.id)) _detachGen();
    _srcLast.delete(String(it.id));
    await Promise.all([_readSources(), _readDrafts()]);
    _paintSources();
    if (was && _view === 'topics') await _enterScript({});
  } catch (e) { _say(e.message, 'err'); }
}

// ── A source's topics ───────────────────────────────────────────────────────
function _showTopics() {
  _view = 'topics';
  $('mk-topics').hidden = false;
  $('mk-form').hidden = true;
  const rec = _src;
  $('mk-src-title').value = rec.title;
  $('mk-title-saved').textContent = '';
  const ready = rec.transcript && rec.transcript.state === 'ready';
  const has = (rec.topics || []).length > 0;
  $('mk-mine').textContent = has ? 'Find topics again' : 'Find topics';
  $('mk-mine').disabled = !ready || _srcJobs.has(String(rec.id));
  $('mk-summary').textContent = rec.videoSummary || '';
  _paintTopics(rec);
  _reattachSrcJob(rec);
}

function _paintTopics(rec) {
  const box = $('mk-topic-list');
  box.textContent = '';
  const t = rec.transcript || {};
  if (_reading(rec)) {
    box.appendChild(el('div', 'mk-empty', 'Still being read. The topics can be found the moment the words are in.'));
    return;
  }
  if (t.state !== 'ready') {
    const e = el('div', 'mk-empty', rec.state === 'error'
      ? `This source failed: ${rec.error || 'unknown reason'}` : 'No transcript yet.');
    box.appendChild(e);
    if (rec.videoPath && !_srcJobs.has(String(rec.id))) {
      // An ingest killed by a server restart, or one that failed: its file is here, so it can be read
      // again. Paid - it is the same speech-to-text call.
      const again = el('button', 'lib-btn', 'Transcribe again');
      again.type = 'button';
      again.title = 'Read the words out of this source again - a paid transcription';
      again.addEventListener('click', () => _transcribeAgain(rec));
      box.appendChild(again);
    }
    return;
  }
  const topics = rec.topics || [];
  if (!topics.length) {
    box.appendChild(el('div', 'mk-empty', 'No topics found yet. Press “Find topics” above - one long video usually holds several.'));
    return;
  }
  for (const tp of topics) {
    const card = el('div', 'mk-topic');
    const h = el('div', 'mk-topic-h');
    h.appendChild(el('span', 'mk-topic-t', tp.title));
    h.appendChild(el('span', 'mk-topic-span', `${J.clock(tp.start)}–${J.clock(tp.end)}`));
    const used = Array.isArray(tp.usedBy) ? tp.usedBy : [];
    if (used.length) {
      card.classList.add('used');
      const tag = el('span', 'mk-tag ready', used.length === 1 ? 'written' : `written ×${used.length}`);
      tag.title = used.map(u => u.title).join('\n');
      h.appendChild(tag);
    }
    const draft = _draftFor(rec.id, tp.id);
    if (draft) h.appendChild(el('span', 'mk-tag wait', draft.running ? 'draft · writing…' : 'draft · ' + (draft.stageLabel || '')));
    card.appendChild(h);
    card.appendChild(el('p', 'mk-topic-s', tp.summary));
    const f = el('div', 'mk-topic-f');
    f.appendChild(el('span', 'mk-topic-name', `${tp.projectName || ''} · ${String(tp.text || '').length} chars of transcript`));
    f.appendChild(el('span', 'sp'));
    const write = el('button', 'lib-btn primary', draft ? 'Continue the draft' : 'Write a script');
    write.type = 'button';
    f.appendChild(write);
    card.appendChild(f);
    // Decided at the press, not when the card was painted: a draft may have been made on this topic
    // since - by a generation from here, or in Library 2 - and a blank form saved over it would wipe
    // what it holds.
    const go = async () => {
      await _readDrafts();
      const d = _draftFor(rec.id, tp.id);
      return d ? _resumeDraft(d.id) : _enterScript({ source: rec, topic: tp });
    };
    write.addEventListener('click', (e) => { e.stopPropagation(); go(); });
    card.addEventListener('click', go);
    box.appendChild(card);
  }
}

const _draftFor = (sourceId, topicId) => _drafts.find(d =>
  String(d.sourceId) === String(sourceId) && String(d.topicId) === String(topicId)) || null;

let _titleT = null;
async function _saveTitle() {
  clearTimeout(_titleT);
  if (!_src) return;
  // By id: the source may be let go of while the rename is on its way.
  const id = String(_src.id);
  const title = $('mk-src-title').value.trim();
  if (!title || title === _src.title) return;
  try {
    const d = await J.api('/api/sources/' + encodeURIComponent(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    });
    const i = _sources.findIndex(x => String(x.id) === id);
    if (i >= 0) _sources[i] = { ..._sources[i], title: d.source.title };
    if (_src && String(_src.id) === id) _src.title = d.source.title;
    _paintSources();
    if (_src && String(_src.id) === id) {
      $('mk-title-saved').textContent = 'saved';
      setTimeout(() => { if ($('mk-title-saved')) $('mk-title-saved').textContent = ''; }, 1600);
    }
  } catch (e) { if (_src && String(_src.id) === id) $('mk-title-saved').textContent = e.message; }
}
function _queueRename() { clearTimeout(_titleT); _titleT = setTimeout(_saveTitle, 700); }

// ── A source's own slow work: finding its topics, or reading it again ───────
// Per source, and the module's, not the screen's: switching sources and coming back finds it still
// counting, and one that ends unseen still updates its card. What a failed one said stays with the
// source until its next job.
function _srcTiming(kind, rec) {
  if (kind === 'topics') {
    const chars = (rec && rec.transcript && rec.transcript.chars) || 0;
    return { key: `l2-topics|${J.bucket(chars)}`, estimateMs: J.EST.topics,
      label: chars ? `Reading ${Math.round(chars / 1000)}k of transcript…` : 'Finding topics…' };
  }
  return { key: 'l2-ingest|again', label: 'Transcribing again…', estimateMs: J.EST.ingestLink };
}

// The countdown for the source on screen: its job's row, or its last word, or nothing.
function _reattachSrcJob(rec) {
  const id = String(rec.id);
  const host = $('mk-topics-job');
  const run = _srcJobs.get(id);
  if (!run) {
    const last = _srcLast.get(id);
    if (last) J.sayJob(host, last.text, last.err); else J.clearJob(host);
    return;
  }
  const row = J.startJob(host, { ..._srcTiming(run.kind, rec), startedAt: run.startedAt });
  if (run.step) row.say(run.step);
  run.rows.push(row);
}

function _followSrcJob(id) {
  const run = _srcJobs.get(id);
  if (!run || run.followed) return;
  run.followed = true;
  const onScreen = () => _view === 'topics' && _src && String(_src.id) === id;
  J.pollJob('/api/sources/jobs', run.jobId, (j) => {
    if (!j.step) return;
    run.step = j.step;
    if (onScreen() && run.rows.length) run.rows[run.rows.length - 1].say(j.step);
  })
    .then((job) => {
      // One timing for the whole job, however many rows showed it.
      run.rows.forEach((r, i) => (i === 0 ? r.finish() : r.detach()));
      _srcLast.delete(id);
      // The form's topic did not come back with the new reading: its draft carries on without one.
      if (run.kind === 'topics' && _gen && String(_gen.sourceId) === id && _gen.topicId
        && !(job.topics || []).some(t => String(t.id) === String(_gen.topicId))) _detachGen();
    })
    .catch((e) => {
      run.rows.forEach(r => r.detach());
      _srcLast.set(id, { text: e.message, err: true });
    })
    .finally(async () => {
      if (_srcJobs.get(id) === run) _srcJobs.delete(id);
      await Promise.all([_readSources(), _readDrafts()]);
      if (_built) _paintSources();
      if (_src && String(_src.id) === id) await _refreshSource();
    });
}

// Finding topics: a paid read of the transcript. Once there are topics it is asked for again only
// on purpose - the new reading replaces the old, and what was tied to a topic that does not come
// back (a "written" mark, a draft) is let go of.
async function _mineTopics() {
  const rec = _src;
  if (!rec) return;
  const id = String(rec.id);
  if (_srcJobs.has(id)) return;
  if ((rec.topics || []).length && !confirm('Find the topics of this source again?\n\nIt is a paid read of the transcript. The new topics replace these; a "written" mark and a draft stay with a topic only if it comes back the same.')) return;
  $('mk-mine').disabled = true;
  let run = null;
  try {
    const d = await J.api(`/api/sources/${encodeURIComponent(id)}/topics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    run = { kind: 'topics', jobId: d.jobId, startedAt: Date.now(), rows: [], step: '' };
  } catch (e) {
    if (e.status === 409 && e.data && e.data.jobId) run = { kind: 'topics', jobId: e.data.jobId, startedAt: e.data.startedAt || Date.now(), rows: [], step: '' };
    else { J.sayJob($('mk-topics-job'), e.message, true); $('mk-mine').disabled = false; return; }
  }
  // A read of the column may have picked the same job up meanwhile; one follower is enough.
  if (!_srcJobs.has(id)) { _srcJobs.set(id, run); _followSrcJob(id); }
  _srcLast.delete(id);
  _paintSources();
  if (_view === 'topics' && _src && String(_src.id) === id) _showTopics();
}

async function _transcribeAgain(rec) {
  const id = String(rec.id);
  if (_srcJobs.has(id)) return;
  if (!confirm(`Transcribe "${rec.title}" again?\n\nIt is a paid speech-to-text read of the whole file.`)) return;
  try {
    const d = await J.api(`/api/sources/${encodeURIComponent(id)}/transcribe`, { method: 'POST' });
    if (!_srcJobs.has(id)) {
      _srcJobs.set(id, { kind: 'transcribe', jobId: d.jobId, startedAt: Date.now(), rows: [], step: '' });
      _followSrcJob(id);
    }
    _srcLast.delete(id);
    await _readSources();
    _paintSources();
    await _refreshSource();              // the failed view and its paid button go at once
  } catch (e) { J.sayJob($('mk-topics-job'), e.message, true); }
}

// ── The form ────────────────────────────────────────────────────────────────
function _showForm() {
  _view = 'form';
  $('mk-topics').hidden = true;
  $('mk-form').hidden = false;
  $('mk-to-topics').hidden = !(_src && _gen && _gen.sourceId && String(_gen.sourceId) === String(_src.id));
}

function _paintFrom() {
  if (!_gen) return;
  $('mk-from').textContent = _gen.sourceTitle
    ? `from “${_gen.sourceTitle}”${_gen.topicSpan ? ' · ' + _gen.topicSpan : ''}`
    : 'without a source';
}

function _ctl(label, node) {
  const w = el('label', 'mk-ctl');
  w.appendChild(el('span', null, label));
  w.appendChild(node);
  return w;
}

function _select(id, values, current) {
  const s = el('select');
  s.id = id;
  for (const v of values) {
    const o = el('option', null, typeof v === 'string' ? v : v.label);
    o.value = typeof v === 'string' ? v : v.value;
    if (v && v.disabled) o.disabled = true;
    s.appendChild(o);
  }
  if (current != null) s.value = current;
  return s;
}

async function _buildControls(settings) {
  if (!_reg) _reg = await J.api('/api/scriptgen/models');
  const box = $('mk-controls');
  box.textContent = '';
  const d = _reg.defaults;
  const s = settings || {};
  box.appendChild(_ctl('Language', _select('mk-c-lang', _reg.languages, s.language || d.language)));
  const scenes = el('input');
  scenes.type = 'number';
  scenes.id = 'mk-c-scenes';
  scenes.min = _reg.scenes.min;
  scenes.max = _reg.scenes.max;
  scenes.value = s.scenes || _reg.scenes.default;
  scenes.title = `${_reg.scenes.min}–${_reg.scenes.max}; the scenarios store needs at least ${_reg.minLines} lines`;
  box.appendChild(_ctl('Scenes', scenes));
  box.appendChild(_ctl('Tone', _select('mk-c-tone', _reg.tones, s.tone || d.tone)));
  const nar = _select('mk-c-narrator', [{ value: 'neutral', label: 'Neutral' }], 'neutral');
  box.appendChild(_ctl('Narrator', nar));
  const provs = _reg.providers.map(p => ({ value: p.id, label: p.label + (p.wired ? '' : ' (n/a)') }));
  const prov = _select('mk-c-provider', provs, s.provider || d.provider);
  const chosen = _reg.providers.find(p => p.id === prov.value) || _reg.providers[0];
  const model = _select('mk-c-model', chosen.models, s.model || d.model);
  prov.addEventListener('change', () => {
    const p = _reg.providers.find(x => x.id === prov.value);
    model.textContent = '';
    for (const m of (p ? p.models : [])) { const o = el('option', null, m); o.value = m; model.appendChild(o); }
    _queueDraft();
  });
  box.appendChild(_ctl('Provider', prov));
  box.appendChild(_ctl('Model', model));
  box.appendChild(_ctl('Effort', _select('mk-c-effort', _reg.efforts, s.effort || d.effort)));
  for (const n of box.querySelectorAll('select,input')) n.addEventListener('change', _queueDraft);
  const want = s.narratorId ? (s.readingIndex ? `${s.narratorId}#${s.readingIndex}` : s.narratorId) : 'neutral';
  await _paintNarrators(want, s.narratorName);
}

// The narrator list, rebuilt from the server: once per form, and again when the narrators window
// changes something. A narrator a draft was written with and that has since been deleted is shown as
// such rather than quietly swapped for Neutral: a script continued in another voice is another script.
async function _paintNarrators(want, wantName) {
  const sel = $('mk-c-narrator');
  if (!sel) return;
  const cur = want != null ? want : sel.value;
  let list = [];
  try { list = (await J.api('/api/narrators')).narrators || []; } catch (e) { list = []; }
  const values = [{ value: 'neutral', label: 'Neutral' }];
  for (const n of list) {
    if (!n.ready) { values.push({ value: n.id, label: n.name + ' — not read' }); continue; }
    if ((n.readings || 1) < 2) { values.push({ value: n.id, label: n.name }); continue; }
    values.push({ value: n.id, label: `${n.name} — random of ${n.readings}` });
    for (let i = 1; i <= n.readings; i++) values.push({ value: `${n.id}#${i}`, label: `${n.name} — reading ${i}` });
  }
  let pick = cur || 'neutral';
  const note = $('mk-nar-note');
  note.hidden = true;
  if (!values.some(v => v.value === pick) && pick !== 'neutral') {
    const [nid, ri] = pick.split('#');
    const nar = list.find(n => String(n.id) === nid);
    if (nar && ri) {
      // The narrator is there and only the pinned READING is gone (deleted in the narrators window):
      // the choice falls back to the narrator itself, a reading picked at random - and says so.
      pick = nid;
      note.hidden = false;
      note.textContent = `Reading ${ri} of ${nar.name} is gone - one of its readings is picked at random now. Pin another if it matters.`;
      if (_gen && _gen.draftId) _queueDraft();
    } else {
      const name = wantName || (sel.selectedOptions[0] && sel.selectedOptions[0].textContent.replace(/ — .*$/, '')) || 'the narrator';
      values.push({ value: pick, label: name + ' — deleted' });
      note.hidden = false;
      note.textContent = `${name}, the narrator this was written with, has been deleted. Pick another - written as it is, the server refuses a narrator it does not have.`;
    }
  }
  sel.textContent = '';
  for (const v of values) { const o = el('option', null, v.label); o.value = v.value; sel.appendChild(o); }
  sel.value = pick;
}

const _controlsReady = () => !!$('mk-c-lang');

function _opts() {
  if (!_controlsReady()) return {};
  const nar = $('mk-c-narrator');
  const [narratorId, readingIndex] = String(nar.value).split('#');
  return {
    language: $('mk-c-lang').value,
    scenes: parseInt($('mk-c-scenes').value, 10),
    tone: $('mk-c-tone').value,
    narratorId,
    readingId: readingIndex || '',
    readingIndex: readingIndex || '',
    // The name alone, not the option's label ("Azazin — reading 2"): it is what the draft remembers
    // the narrator by once the narrator itself may be gone.
    narratorName: nar.selectedOptions[0] ? nar.selectedOptions[0].textContent.replace(/ — .*$/, '') : '',
    provider: $('mk-c-provider').value,
    model: $('mk-c-model').value,
    effort: $('mk-c-effort').value,
  };
}

// Sent with every generation, so the server can write the answer into the draft (the keeper).
const _draftKey = () => (_gen ? { draftId: _gen.draftId || '', sourceId: _gen.sourceId, topicId: _gen.topicId } : {});

// ONE button for the whole chain, relabelled at each step and MOVED between the two top slots.
function _paintGo() {
  if (!_built) return;
  const written = !!(_gen && _gen.paragraphs && _gen.paragraphs.length);
  const hookOpen = !written || _stage === 'hooks' || _stage === 'pick';
  const map = {
    idle: [written ? 'Generate again' : 'Generate script', false],
    hooks: ['Writing hooks…', true],
    pick: ['Pick a hook', true],
    script: ['Writing the script…', true],
    working: ['Working…', true],
  };
  const [label, disabled] = map[_stage] || map.idle;
  const btn = $('mk-go');
  btn.textContent = label;
  btn.disabled = disabled;
  btn.classList.toggle('primary', !written);
  const slot = $(hookOpen ? 'mk-go-slot-hook' : 'mk-go-slot-save');
  if (btn.parentElement !== slot) slot.appendChild(btn);
  $('mk-hook-stage').hidden = !hookOpen;
  $('mk-save-stage').hidden = !written;
  $('mk-script-stage').hidden = !written;
  // Only a stage that RUNS locks the script. Five hooks waiting to be picked do not: a person who
  // likes none of them keeps the script they have, and saves or cleans it.
  const busy = _busy();
  $('mk-newhooks').disabled = busy;
  $('mk-humanize').disabled = busy;
  $('mk-save').disabled = busy;
  $('mk-discard').hidden = !(_gen && _gen.draftId);
  document.querySelectorAll('#mk-scenes .mk-scene-rw').forEach(b => { b.disabled = busy; });
}
function _setStage(s) { _stage = s; _paintGo(); }
const _busy = () => _stage === 'hooks' || _stage === 'script' || _stage === 'working';

function _clearForm() {
  $('mk-hook').value = '';
  $('mk-hook-list').textContent = '';
  $('mk-scenes').textContent = '';
  $('mk-save-status').textContent = '';
  $('mk-save-status').className = 'lib-status';
  $('mk-used').textContent = '';
  J.clearJob($('mk-job'));
}

// ── The draft ───────────────────────────────────────────────────────────────
function _payload() {
  const o = _opts();
  return {
    id: _gen.draftId || undefined,
    sourceId: _gen.sourceId, sourceTitle: _gen.sourceTitle || '',
    topicId: _gen.topicId, topicTitle: _gen.topicTitle || '',
    topic: $('mk-topic').value,
    hook: $('mk-hook').value,
    hooks: _gen.hooks || [],
    paragraphs: _gen.paragraphs || [],
    title: $('mk-title').value,
    humanized: !!_gen.humanized,
    settings: {
      language: o.language, tone: o.tone, scenes: o.scenes,
      narratorId: o.narratorId, narratorName: o.narratorName, readingIndex: o.readingIndex,
      provider: o.provider, model: o.model, effort: o.effort,
    },
    save: { gender: $('mk-gender').value, vertical: $('mk-vertical').value, product: $('mk-product').value },
  };
}

async function _saveDraft(o) {
  clearTimeout(_saveT);
  _saveT = null;
  if (!_gen) return;
  const gen = _gen;
  const post = () => J.api('/api/scriptgen/drafts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(_payload()),
    keepalive: !!(o && o.keepalive),
  });
  try {
    let d;
    try { d = await post(); }
    catch (e) {
      // The server does not make a draft under an id it no longer has (saved or discarded elsewhere,
      // in Library 2): the form keeps its work as a new draft instead.
      if (e.status !== 404 || gen !== _gen) throw e;
      _gen.draftId = '';
      d = await post();
    }
    _noteDraft(d.draft);
    if (gen === _gen) { _gen.draftId = d.draft.id; _paintGo(); }
  } catch (e) { /* a draft that failed to save is not worth interrupting the writing for */ }
}

// The drafts list kept as the server has it after a save, so a topic card painted next says "draft"
// and a stage's reattach finds it - the list is otherwise read only now and then.
function _noteDraft(dr) {
  if (!dr) return;
  const stage = (dr.paragraphs || []).length ? 'script written' : ((dr.hooks || []).length || dr.hook) ? 'hook chosen' : 'topic only';
  const i = _drafts.findIndex(x => String(x.id) === String(dr.id));
  const sum = { ...(i >= 0 ? _drafts[i] : {}), id: dr.id, sourceId: dr.sourceId, topicId: dr.topicId,
    sourceTitle: dr.sourceTitle, topicTitle: dr.topicTitle, topic: dr.topic, title: dr.title, stageLabel: stage };
  if (i >= 0) _drafts[i] = sum; else _drafts.unshift(sum);
}

function _queueDraft() {
  clearTimeout(_saveT);
  _saveT = setTimeout(_saveDraft, 800);
}

// A save still waiting out its pause goes now - before the form is left or replaced.
async function _flushDraft() { if (_saveT && _gen) await _saveDraft(); }

// Before a paid step: the answer must have a draft to be filed into, whatever happens to the page.
async function _ensureDraft() {
  if (_saveT || !_gen.draftId) await _saveDraft();
  return !!_gen.draftId;
}

async function _discardDraft() {
  if (!_gen || !_gen.draftId) return;
  if (!confirm('Discard this draft? What was generated into it is lost.')) return;
  // A save still waiting would land after the delete and bring the draft back.
  clearTimeout(_saveT);
  _saveT = null;
  try {
    await J.api('/api/scriptgen/drafts/' + encodeURIComponent(_gen.draftId), { method: 'DELETE' });
    _gen = null;
    await _readDrafts();
    _paintSources();
    if (_src) _showTopics(); else await _enterScript({});
  } catch (e) {
    J.sayJob($('mk-job'), e.message, true);
    _queueDraft();                                // not discarded: what was typed is kept
  }
}

// ── Entering the form ───────────────────────────────────────────────────────
async function _enterScript({ source = null, topic = null, draft = null } = {}) {
  await _flushDraft();
  _clearForm();
  let full = null;
  if (draft) full = draft;
  const saved = (full && full.save) || {};
  _gen = {
    draftId: full ? full.id : '',
    sourceId: full ? full.sourceId : (source ? source.id : ''),
    sourceTitle: full ? full.sourceTitle : (source ? source.title : ''),
    topicId: full ? full.topicId : (topic ? topic.id : ''),
    topicTitle: full ? full.topicTitle : (topic ? topic.title : ''),
    topicSpan: topic ? `${J.clock(topic.start)}–${J.clock(topic.end)}` : '',
    hooks: (full && full.hooks) || [],
    paragraphs: (full && full.paragraphs) || [],
    humanized: !!(full && full.humanized),
    readingId: '',
  };
  _paintFrom();
  $('mk-topic').value = full ? (full.topic || full.topicTitle || '') : (topic ? topic.title : '');
  $('mk-title').value = (full && full.title) || '';
  $('mk-gender').value = saved.gender || 'male';
  $('mk-vertical').value = saved.vertical || '';
  $('mk-product').value = saved.product || '';
  _showForm();
  try { await _buildControls(full ? full.settings : null); }
  catch (e) { J.sayJob($('mk-job'), 'the model list could not be read: ' + e.message, true); }
  if (full && full.hook) $('mk-hook').value = full.hook;
  const needsPick = _gen.hooks.length && !$('mk-hook').value.trim();
  if (needsPick) _renderHooks(_gen.hooks);
  if (_gen.paragraphs.length) _renderScenes();
  _setStage(needsPick ? 'pick' : 'idle');
  _reattachStage();
  // NO draft is written just for opening the form: the first edit or the first generation makes it.
}

// A draft, from the Scenarios list or a topic's "Continue". Its source is chosen with it. A draft
// whose source or topic is gone - the source deleted, the topics found again without it - carries on
// without a source rather than failing at every press.
async function _resumeDraft(id) {
  await _flushDraft();
  let d = null;
  try {
    const r = await J.api('/api/scriptgen/drafts/' + encodeURIComponent(id));
    d = r.draft;
    // What runs in it NOW, not when the list was read: a stage that has landed since is not
    // followed (its job may be gone), one started since is.
    const i = _drafts.findIndex(x => String(x.id) === String(d.id));
    if (i >= 0) _drafts[i] = { ..._drafts[i], running: r.running || null };
    else _drafts.push({ id: d.id, running: r.running || null });
  } catch (e) { _say('That draft could not be opened: ' + e.message, 'err'); return false; }
  let src = null;
  let topic = null;
  if (d.sourceId) {
    try { src = (await J.api('/api/sources/' + encodeURIComponent(d.sourceId))).source; } catch (e) { src = null; }
    topic = src && d.topicId ? (src.topics || []).find(t => String(t.id) === String(d.topicId)) || null : null;
  }
  let lost = '';
  if (d.sourceId && (!src || (d.topicId && !topic))) {
    lost = !src ? 'Its source is gone' : 'Its topic did not come back when the topics were found again';
    d.sourceId = ''; d.topicId = ''; d.sourceTitle = ''; d.topicTitle = '';
    src = null; topic = null;
  }
  _src = src;
  _paintSources();
  await _enterScript({ draft: d, source: src, topic });
  if (topic) { _gen.topicSpan = `${J.clock(topic.start)}–${J.clock(topic.end)}`; _paintFrom(); }
  if (lost) {
    await _saveDraft();
    _say(lost + ' - this draft carries on without a source.', 'err');
  }
  return true;
}

// A stage the server is still writing into this draft - the page was reloaded, or the draft was left
// and opened again. Its countdown comes back at its real age, and its answer lands in the form.
function _reattachStage() {
  if (!_gen || !_gen.draftId) return;
  const rec = _following.get(String(_gen.draftId));
  if (rec) {                                  // followed already: only its row comes back
    if (_stage === 'idle' || _stage === 'pick') _setStage('working');
    _stageRow(rec);
    return;
  }
  const sum = _drafts.find(x => String(x.id) === String(_gen.draftId));
  if (!sum || !sum.running) return;
  _followStage(sum.running.jobId, sum.running, _gen, null);
}

// ── The chain: hooks, then the script ───────────────────────────────────────
function _renderHooks(hooks) {
  const box = $('mk-hook-list');
  box.textContent = '';
  for (const h of hooks) {
    const b = el('button', 'mk-hook');
    b.type = 'button';
    b.appendChild(el('span', 'mk-hook-k', h.kind));
    b.appendChild(el('span', 'mk-hook-t', h.text));
    // Picking a hook runs straight on into the script. That is the whole point of one button.
    b.addEventListener('click', async () => {
      $('mk-hook').value = h.text;
      box.textContent = '';
      await _saveDraft();
      _runScript();
    });
    box.appendChild(b);
  }
}

const _TIMING = {
  hooks: (o) => ({ key: `l2-hooks|${o.model}|${o.effort}`, label: 'Writing five hooks…', estimateMs: J.EST.hooks }),
  script: (o) => ({ key: `l2-script|${o.model}|${o.effort}|${o.scenes}`, label: `Writing ${o.scenes} paragraphs…`, estimateMs: J.EST.script(o.scenes) }),
  humanize: (o) => ({ key: `l2-humanize|${o.model}|${o.effort}`, label: 'Cleaning to the narrator…', estimateMs: J.EST.humanize }),
  rewrite: (o, i) => ({ key: `l2-rewrite|${o.model}|${o.effort}`, label: `Rewriting paragraph ${i + 1}…`, estimateMs: J.EST.rewrite }),
};

// Starts a stage on the server and follows it. A draft that is already being written into is not
// started twice: the server says so (409), and the page follows the job that is running instead.
async function _runStage(path, body, timing, onResult) {
  const gen = _gen;
  if (!(await _ensureDraft())) { J.sayJob($('mk-job'), 'The draft could not be saved, so nothing was started.', true); return false; }
  const send = { ...body, ..._draftKey() };
  const what = path.split('/').pop();              // hooks | script | humanize | rewrite
  let jobId;
  try {
    jobId = (await J.api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(send) })).jobId;
  } catch (e) {
    if (e.status === 409 && e.data && e.data.jobId) {
      J.sayJob($('mk-job'), 'This draft is already being written - following that instead.');
      return _followStage(e.data.jobId, e.data, gen, null);
    }
    J.sayJob($('mk-job'), e.message, true);
    return false;
  }
  return _followStage(jobId, { startedAt: Date.now(), timing, what }, gen, onResult);
}

// `onResult` gets the answer while the form still holds the same draft; otherwise - the person moved
// on, or this is a reattach - the draft is simply read again, since the server has filed the answer
// into it.
//
// A draft left while its stage runs keeps being followed: coming back to it only brings its row back
// (_reattachStage), at the job's real age. Another draft can run a stage of its own meanwhile.
async function _followStage(jobId, run, gen, onResult) {
  const draftId = String(gen.draftId);
  const rec = { jobId, run, rows: [] };
  _following.set(draftId, rec);
  const here = () => !!_gen && String(_gen.draftId) === draftId;
  if (_stage === 'idle' || _stage === 'pick') _setStage('working');
  _stageRow(rec);
  try {
    const job = await J.pollJob('/api/scriptgen/jobs', jobId, (j) => {
      if (j.step && here() && rec.rows.length) rec.rows[rec.rows.length - 1].say(j.step);
    });
    // One timing for the whole job, however many rows showed it.
    rec.rows.forEach((r, i) => (i === 0 ? r.finish() : r.detach()));
    if (_gen === gen && onResult) await onResult(job.result || {});
    else if (here()) await _landInto(run.what, job.result || {});
    return true;
  } catch (e) {
    const last = rec.rows.length - 1;
    rec.rows.forEach((r, i) => (i === last && here() ? r.fail(e.message) : r.detach()));
    // A stage nobody started from this form has no caller to put the buttons back.
    if (here() && (_gen !== gen || !onResult)) _setStage('idle');
    return false;
  } finally {
    if (_following.get(draftId) === rec) _following.delete(draftId);
    await _readDrafts();
    if (_built) _paintSources();
    // A topic card showing this draft says how far it got now.
    if (_built && _view === 'topics' && _src) _paintTopics(_src);
  }
}

// A stage that landed on a form that did not start it - a reload, the draft left and opened again.
// Its answer goes into the form AS IT IS NOW - a title or a paragraph typed meanwhile stays - and the
// form is saved, so the server's copy and the screen agree again.
async function _landInto(what, r) {
  const res = r || {};
  if (what === 'hooks' && Array.isArray(res.hooks)) {
    _gen.hooks = res.hooks;
    $('mk-hook').value = '';
    _noteReading(res);
    _renderHooks(_gen.hooks);
  } else if (what === 'script' && Array.isArray(res.paragraphs)) {
    _gen.paragraphs = res.paragraphs;
    _gen.humanized = false;
    _noteReading(res);
    if (!$('mk-title').value.trim()) $('mk-title').value = res.title || '';
    _renderScenes();
  } else if (what === 'humanize' && Array.isArray(res.paragraphs)) {
    _gen.paragraphs = res.paragraphs;
    _gen.humanized = !!res.applied;
    _renderScenes();
  } else if (what === 'rewrite' && res.paragraph && res.index < (_gen.paragraphs || []).length) {
    _gen.paragraphs[res.index] = res.paragraph;
    _renderScenes();
  } else { await _reloadDraftInto(); return; }
  await _saveDraft();
  _setStage(_gen.hooks.length && !$('mk-hook').value.trim() ? 'pick' : 'idle');
}

// A countdown row for a followed stage, in the form as it is now. Its timing comes from what the
// server says is running when the page did not start it (a reload, another visit).
function _stageRow(rec) {
  const run = rec.run || {};
  const t = run.timing
    || (_TIMING[run.what] ? _TIMING[run.what](run, run.index || 0)
      : { key: 'l2-stage', label: 'Still writing…', estimateMs: J.EST.script(15) });
  const row = J.startJob($('mk-job'), { ...t, startedAt: run.startedAt || Date.now() });
  rec.rows.push(row);
  return row;
}

// The draft as the server has it, into the form - what a stage wrote while nobody was following it.
async function _reloadDraftInto() {
  try {
    const d = (await J.api('/api/scriptgen/drafts/' + encodeURIComponent(_gen.draftId))).draft;
    _gen.hooks = d.hooks || [];
    _gen.paragraphs = d.paragraphs || [];
    _gen.humanized = !!d.humanized;
    if (d.hook) $('mk-hook').value = d.hook;
    if (d.title && !$('mk-title').value.trim()) $('mk-title').value = d.title;
    const needsPick = _gen.hooks.length && !$('mk-hook').value.trim();
    if (needsPick) _renderHooks(_gen.hooks);
    if (_gen.paragraphs.length) _renderScenes();
    _setStage(needsPick ? 'pick' : 'idle');
  } catch (e) { _setStage('idle'); }
}

// One press: five hooks, then - once one is chosen - the script. A hook already written skips
// straight to the script, because there is nothing left to suggest.
async function _runGo() {
  if (!_controlsReady()) { J.sayJob($('mk-job'), 'the model list is not loaded yet', true); return; }
  const topic = $('mk-topic').value.trim();
  if (!topic) { J.sayJob($('mk-job'), 'Describe the topic first.', true); return; }
  // ONE draw of the narrator's reading per press, not per request.
  _gen.readingId = '';
  if ($('mk-hook').value.trim()) { _runScript(); return; }
  const gen = _gen;
  _setStage('hooks');
  $('mk-hook-list').textContent = '';
  const o = _opts();
  const ok = await _runStage('/api/scriptgen/hooks', { ...o, topic }, _TIMING.hooks(o), async (r) => {
    _gen.hooks = r.hooks || [];
    _noteReading(r);
    _renderHooks(_gen.hooks);
    await _saveDraft();
  });
  if (_gen === gen) _setStage(ok && _gen.hooks.length && !$('mk-hook').value.trim() ? 'pick' : 'idle');
}

// Which reading wrote it - recorded because it has to go into the scenario's provenance on save.
function _noteReading(r) {
  const rd = r && r.reading;
  _gen.readingId = (rd && rd.id) || '';
  $('mk-used').textContent = (!rd || rd.total < 2) ? '' : `written with ${r.narrator}`;
}

function _newHooks() {
  if (!_gen || _busy()) return;
  $('mk-hook').value = '';
  _queueDraft();                                  // the cleared hook is saved before the paid step
  _runGo();
}

async function _runScript() {
  const topic = $('mk-topic').value.trim();
  const hook = $('mk-hook').value.trim();
  if (!topic || !hook) { _setStage('idle'); return; }
  const gen = _gen;
  _setStage('script');
  const o = _opts();
  const body = { ...o, topic, hook };
  if (_gen.readingId) body.readingId = _gen.readingId;   // the reading the hooks were drawn with
  await _runStage('/api/scriptgen/script', body, _TIMING.script(o), async (r) => {
    _gen.paragraphs = r.paragraphs || [];
    _gen.humanized = false;
    _noteReading(r);
    if (!$('mk-title').value.trim()) $('mk-title').value = r.title || topic.slice(0, 60);
    _renderScenes();
    await _saveDraft();
    if (r.asked && r.paragraphs && r.paragraphs.length !== r.asked) {
      J.sayJob($('mk-job'), `Note: ${r.paragraphs.length} paragraphs came back, ${r.asked} were asked for.`);
    }
  });
  if (_gen === gen) _setStage('idle');
}

function _renderScenes() {
  const box = $('mk-scenes');
  box.textContent = '';
  const list = (_gen && _gen.paragraphs) || [];
  list.forEach((text, i) => {
    const row = el('div', 'mk-scene' + (i === 0 ? ' hook' : ''));
    // Paragraph one is the hook, and says so instead of saying "1".
    row.appendChild(el('div', 'mk-scene-n' + (i === 0 ? ' is-hook' : ''), i === 0 ? 'hook' : String(i + 1)));
    const ta = el('textarea', 'mk-scene-t');
    ta.rows = 2;
    ta.value = text;
    const acts = el('div', 'mk-scene-a');
    const secs = el('div', 'mk-scene-secs', J.spokenSeconds(text) + 's');
    acts.appendChild(secs);
    const fit = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
    ta.addEventListener('input', () => {
      _gen.paragraphs[i] = ta.value;
      // Editing the first paragraph edits the hook: "Generate again" writes from what is on screen.
      if (i === 0) $('mk-hook').value = ta.value;
      secs.textContent = J.spokenSeconds(ta.value) + 's';
      fit();
      _queueDraft();
    });
    setTimeout(fit, 0);
    if (i > 0) {
      const rw = el('button', 'mk-scene-rw', 'rewrite');
      rw.type = 'button';
      rw.title = 'Rewrite this paragraph from a different angle';
      rw.addEventListener('click', () => _rewrite(i, rw));
      acts.appendChild(rw);
    }
    row.appendChild(ta);
    row.appendChild(acts);
    box.appendChild(row);
  });
  _paintGo();
}

async function _humanize() {
  if (!_gen || !_gen.paragraphs.length || _busy()) return;
  const gen = _gen;
  _setStage('working');
  // The SAME reading that wrote the script: a cleaning pass aimed at another description of the
  // voice edits the script towards a voice it was not written in.
  const o = _opts();
  const body = { ...o, paragraphs: _gen.paragraphs };
  if (_gen.readingId) body.readingId = _gen.readingId;
  await _runStage('/api/scriptgen/humanize', body, _TIMING.humanize(o), async (r) => {
    _gen.paragraphs = r.paragraphs || _gen.paragraphs;
    _gen.humanized = !!r.applied;
    _renderScenes();
    await _saveDraft();
    if (r.note) J.sayJob($('mk-job'), r.note);
  });
  if (_gen === gen) _setStage('idle');
}

async function _rewrite(index, btn) {
  if (!_gen || _busy()) return;
  const was = btn.textContent;
  btn.textContent = '…';
  const gen = _gen;
  _setStage('working');
  const o = _opts();
  await _runStage('/api/scriptgen/rewrite',
    { ...o, topic: $('mk-topic').value.trim(), script: _gen.paragraphs, index }, _TIMING.rewrite(o, index),
    async (r) => {
      _gen.paragraphs[index] = r.paragraph || _gen.paragraphs[index];
      _renderScenes();
      await _saveDraft();
    });
  if (btn.isConnected) btn.textContent = was;
  if (_gen === gen) _setStage('idle');
}

// ── Into the Scenarios shelf ────────────────────────────────────────────────
async function _saveScript() {
  if (!_gen || !_gen.paragraphs.length || _busy()) return;
  // The save carries everything a save still waiting would: that one would only land after the
  // draft has become a scenario, and bring it back beside it.
  clearTimeout(_saveT);
  _saveT = null;
  const st = $('mk-save-status');
  const btn = $('mk-save');
  btn.disabled = true;
  st.textContent = 'saving…';
  st.className = 'lib-status';
  try {
    const o = _opts();
    const d = await J.api('/api/scriptgen/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: $('mk-title').value.trim(),
        paragraphs: _gen.paragraphs,
        gender: $('mk-gender').value,
        vertical: $('mk-vertical').value.trim(),
        product: $('mk-product').value.trim(),
        narratorId: o.narratorId, language: o.language, tone: o.tone, model: o.model,
        // The reading the script was ACTUALLY written with: "random" has to resolve to a real one.
        readingId: _gen.readingId || o.readingId,
        sourceId: _gen.sourceId, topicId: _gen.topicId, humanized: _gen.humanized,
        draftId: _gen.draftId,
      }),
    });
    // The draft became the scenario and is gone; the topic is marked written. The layout stays - the
    // next topic is one press away - and the scenario is one press away on the shelf.
    clearTimeout(_saveT);
    _saveT = null;
    _gen = null;
    await Promise.all([_readDrafts(), _readSources()]);
    _paintSources();
    if (_src) { await _refreshSource(); _showTopics(); } else await _enterScript({});
    const n = (d.scenario.lines || []).length;
    _say(`Saved “${d.scenario.title}” — ${n} lines, on the Scenarios shelf.`, 'ok', d.scenario.id);
    if (_hooks.counts) _hooks.counts();
  } catch (e) {
    st.textContent = e.message;
    st.className = 'lib-status err';
    btn.disabled = false;
    _queueDraft();                                // not saved: the draft keeps what was typed
  }
}

// The layout's own line, over both views: what was saved (with the way to it), what went wrong.
function _say(text, kind, scenarioId) {
  const box = $('mk-said');
  if (!box) return;
  box.textContent = '';
  box.hidden = !text;
  if (!text) return;
  box.className = 'mk-said' + (kind ? ' ' + kind : '');
  box.appendChild(el('span', null, text));
  if (scenarioId && _hooks.openScenario) {
    const a = el('button', 'lib-btn', 'open');
    a.type = 'button';
    a.addEventListener('click', () => _hooks.openScenario(scenarioId));
    box.appendChild(a);
  }
  const x = el('button', 'mk-said-x', '✕');
  x.type = 'button';
  x.addEventListener('click', () => _say(''));
  box.appendChild(x);
}

// ── Adding a source ─────────────────────────────────────────────────────────
// A window on the layer stack. Two routes in: a file from this computer, or a link (locked until a
// cookie file has been checked against YouTube). The ingest belongs to the module, not the window:
// closing it leaves the ingest running, and opening it again shows the same countdown.
let _addWin = null;

let _ingestLast = '';      // what the last ingest said when it failed - shown when the window opens

function _closeAddSource() {
  if (!_addWin) return;
  const w = _addWin;
  _addWin = null;
  // Its row goes with it; the ingest runs on and is shown again when the window is.
  if (_ingest && _ingest.row) { _ingest.row.detach(); _ingest.row = null; }
  w.ov.remove();
  Layers.close(w.layer);
}

function _openAddSource() {
  if (_addWin) return;
  const ov = el('div', 'mk-ov');
  ov.innerHTML = `
    <div class="mk-panel" role="dialog" aria-modal="true">
      <div class="mk-panel-head"><span class="mk-panel-t">Add a source</span><span class="sp"></span>
        <button class="lib-btn" type="button" data-x="close" title="Close (Esc)">✕</button></div>
      <div class="mk-panel-body">
        <div class="mk-choice">
          <button class="mk-choice-btn cur" type="button" data-route="file">From a file</button>
          <button class="mk-choice-btn" type="button" data-route="link">From a link</button>
        </div>
        <section class="mk-route" data-r="file">
          <label class="mk-field"><span>Video or audio file</span><input type="file" data-f="file" accept="video/*,audio/*"></label>
          <label class="mk-field"><span>Title <em>optional — the file name is used otherwise</em></span>
            <input type="text" data-f="title" placeholder="What this source is"></label>
          <p class="mk-pnote">The file is kept whole, so frames and fragments can be cut from it later. Reckon about a
            gigabyte for fifty minutes. Once the words are in, its topics are found straight away -
            both are paid calls to the model.</p>
          <button class="lib-btn primary" type="button" data-go="file">Add and transcribe</button>
        </section>
        <section class="mk-route" data-r="link" hidden>
          <div class="mk-lock" data-f="lock" hidden><strong>Links need a YouTube session.</strong><span data-f="why"></span></div>
          <label class="mk-field"><span>Link to a single video</span>
            <input type="text" data-f="url" placeholder="https://www.youtube.com/watch?v=…"></label>
          <button class="lib-btn primary" type="button" data-go="link">Fetch and transcribe</button>
          <div class="mk-cookies">
            <div class="mk-cookies-head"><span>Cookie file</span><span class="mk-cookies-state" data-f="ck">—</span></div>
            <p class="mk-pnote">A <code>cookies.txt</code> export in the Netscape format, taken while signed in to
              YouTube. It is a live session: it stays in <code>data/</code>, is never served, and deleting it
              here revokes it.</p>
            <div class="mk-cookies-row">
              <input type="file" data-f="ckfile" accept=".txt,text/plain">
              <button class="lib-btn" type="button" data-ck="upload">Upload</button>
              <button class="lib-btn" type="button" data-ck="verify">Check against YouTube</button>
              <button class="lib-btn danger" type="button" data-ck="delete">Delete</button>
            </div>
          </div>
        </section>
        <div class="mk-job" data-f="job" hidden></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const q = (s) => ov.querySelector(s);
  const f = (name) => q(`[data-f="${name}"]`);
  const job = f('job');
  const route = (r) => {
    ov.querySelectorAll('.mk-choice-btn').forEach(b => b.classList.toggle('cur', b.dataset.route === r));
    ov.querySelectorAll('.mk-route').forEach(s => { s.hidden = s.dataset.r !== r; });
  };
  ov.querySelectorAll('.mk-choice-btn').forEach(b => b.addEventListener('click', () => route(b.dataset.route)));
  q('[data-x="close"]').addEventListener('click', _closeAddSource);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _closeAddSource(); });
  const layer = Layers.open(ov, { name: 'add a source', onEsc: _closeAddSource });
  _addWin = { ov, layer, job, f, q, refreshLink: () => {} };

  const refreshLink = async () => {
    try {
      const d = await J.api('/api/sources/ytdlp');
      const ck = d.cookies || {};
      f('ck').textContent = (!ck.present ? 'none' : ck.verified ? `checked ${J.fmtDate(ck.verifiedAt)}` : 'uploaded, not checked')
        + (ck.expiresSoon ? ' · expires within a week' : '');
      f('lock').hidden = !!d.linksEnabled;
      f('why').textContent = d.why || '';
      q('[data-go="link"]').disabled = !d.linksEnabled || !!_ingest;
      q('[data-ck="verify"]').disabled = !ck.present;
      q('[data-ck="delete"]').disabled = !ck.present;
    } catch (e) {
      f('lock').hidden = false;
      f('why').textContent = e.message;
      q('[data-go="link"]').disabled = true;
    }
  };
  _addWin.refreshLink = refreshLink;
  refreshLink();

  q('[data-go="file"]').addEventListener('click', () => _addByFile(f('file'), f('title')));
  q('[data-go="link"]').addEventListener('click', () => _addByLink(f('url')));
  q('[data-ck="upload"]').addEventListener('click', async () => {
    const file = f('ckfile').files && f('ckfile').files[0];
    if (!file) { J.sayJob(job, 'Pick the cookies.txt file first.', true); return; }
    const form = new FormData();
    form.append('file', file);
    J.sayJob(job, 'Storing the cookie file…');
    try {
      const d = await J.api('/api/sources/cookies', { method: 'POST', body: form });
      J.sayJob(job, `Stored — ${d.youtubeEntries} cookies for youtube.com. Now check it against YouTube.`);
      f('ckfile').value = '';
    } catch (e) { J.sayJob(job, e.message, true); }
    refreshLink();
  });
  q('[data-ck="verify"]').addEventListener('click', async () => {
    J.sayJob(job, 'Asking YouTube for a video, twice…');
    try {
      const d = await J.api('/api/sources/cookies/verify', { method: 'POST' });
      J.sayJob(job, `Works — YouTube served "${d.sawTitle}" on ${d.attempts} attempts. Links are open.`);
    } catch (e) { J.sayJob(job, e.message, true); }
    refreshLink();
  });
  q('[data-ck="delete"]').addEventListener('click', async () => {
    if (!confirm('Delete the cookie file? Links will be locked again.')) return;
    try { await J.api('/api/sources/cookies', { method: 'DELETE' }); J.sayJob(job, 'Cookie file deleted.'); }
    catch (e) { J.sayJob(job, e.message, true); }
    refreshLink();
  });
  // An ingest already running: its countdown, and no second one. One that failed while the window
  // was closed: what it said.
  if (_ingest) _showIngest();
  else if (_ingestLast) J.sayJob(job, _ingestLast, true);
}

function _paintIngestButtons() {
  if (!_addWin) return;
  _addWin.q('[data-go="file"]').disabled = !!_ingest;
  if (_ingest) _addWin.q('[data-go="link"]').disabled = true;
  else _addWin.refreshLink();                     // the link button again, if links are open
}

function _showIngest() {
  if (!_addWin || !_ingest) return;
  if (_ingest.row) _ingest.row.detach();
  _ingest.row = J.startJob(_addWin.job, { key: _ingest.key, label: _ingest.label, estimateMs: _ingest.estimateMs, startedAt: _ingest.startedAt });
  if (_ingest.step) _ingest.row.say(_ingest.step);
  _paintIngestButtons();
}

async function _addByFile(input, titleIn) {
  if (_ingest) return;
  const file = input.files && input.files[0];
  if (!file) { J.sayJob(_addWin.job, 'Pick a file first.', true); return; }
  const form = new FormData();
  form.append('file', file);
  const title = titleIn.value.trim();
  if (title) form.append('title', title);
  _ingestLast = '';
  _ingest = { startedAt: Date.now(), key: `l2-ingest|file|${J.bucket(file.size / 1048576)}mb`, label: `Uploading ${J.mb(file.size)}…`, estimateMs: J.EST.ingestFile(file.size) };
  _showIngest();
  try {
    const d = await J.api('/api/sources/upload', { method: 'POST', body: form });
    await _followIngest(d.jobId, d.source && d.source.id);
    input.value = '';
    titleIn.value = '';
  } catch (e) { _ingestFailed(e); }
}

async function _addByLink(urlIn) {
  if (_ingest) return;
  const url = urlIn.value.trim();
  if (!url) { J.sayJob(_addWin.job, 'Paste a link first.', true); return; }
  _ingestLast = '';
  _ingest = { startedAt: Date.now(), key: 'l2-ingest|link', label: 'Reading the link…', estimateMs: J.EST.ingestLink };
  _showIngest();
  try {
    const d = await J.api('/api/sources/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    await _followIngest(d.jobId, '');
    urlIn.value = '';
  } catch (e) { _ingestFailed(e); }
}

async function _followIngest(jobId, knownId) {
  await _readSources();
  _paintSources();
  // A link has no record until its metadata is read: the column is read again when it appears, so
  // its card shows "downloading…" and the column's own poll takes over from there.
  let seen = !!knownId;
  const job = await J.pollJob('/api/sources/jobs', jobId, (j) => {
    if (!seen && j.sourceId) { seen = true; _readSources().then(() => _paintSources()); }
    if (!j.step || !_ingest) return;
    _ingest.step = j.step;
    if (_ingest.row) _ingest.row.say(j.step);
  });
  if (_ingest && _ingest.row) _ingest.row.finish();
  _ingest = null;
  const id = knownId || (job && job.source && job.source.id) || '';
  _closeAddSource();
  await _afterIngest(id);
}

function _ingestFailed(e) {
  const row = _ingest && _ingest.row;
  if (row && _addWin) row.fail(e.message);
  else {
    if (row) row.detach();
    if (_addWin) J.sayJob(_addWin.job, e.message, true);
    else _say('Adding the source failed: ' + e.message, 'err');
  }
  _ingestLast = e.message;
  _ingest = null;
  _paintIngestButtons();
  _readSources().then(() => _paintSources());
}

// The words are in. The new source is chosen and its topics found - but only when the form holds
// nothing it would lose (a generation running, a script half written); otherwise it simply appears
// in the column, and the person chooses it when they are ready.
async function _afterIngest(id) {
  await Promise.all([_readSources(), _readDrafts()]);
  _paintSources();
  if (!id) return;
  const it = _sources.find(s => String(s.id) === String(id));
  if (!it) return;
  // Chosen already - somebody pressed its card to watch it: read it again rather than let go of it.
  if (_src && String(_src.id) === String(id)) {
    await _refreshSource();
    if (_src && _view !== 'topics') _showTopics();
  } else {
    const free = !_busy() && !_saveT
      && !(_gen && ((_gen.hooks || []).length || (_gen.paragraphs || []).length || $('mk-topic').value.trim()));
    if (!free) { _say('The new source is in the column - choose it when the script in hand is done.'); return; }
    await _chooseSource(it);
  }
  const t = (_src && _src.transcript) || {};
  if (_src && String(_src.id) === String(id) && t.state === 'ready' && !((_src.topics || []).length)) _mineTopics();
}
