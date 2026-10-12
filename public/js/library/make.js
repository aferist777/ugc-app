// LIBRARY — the scenario generator: "New scenario" on the Scenarios shelf (phase E, the owner
// 2026-09-29). What Library 2 was, moved to where scenarios are.
//
// TWO PARTS, in place of the scenario list. On the LEFT a column of sources - the long videos scripts are written
// from - as LINES, not posters (phase V28.1, the owner: a podcast has no picture), with a 20px "+" over it that adds
// one, and a sash between it and the right (its width remembered). On the RIGHT the "Generate script"
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
import * as NR from './narrators.js';
import * as Layers from '../layers.js';
import { flyToAlerts, pulseAlerts } from '../alerts-bell.js';

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
let _pollT = null;        // the sources column's refresh while something is being added or transcribed
let _pollMs = 0;
let _tickT = null;        // the time left on the lines being added, every second between two reads
let _stopArmed = '';      // the source whose cross says "really?" - the next press stops it
// sourceId -> { kind: 'topics'|'transcribe', jobId, startedAt, rows, step, followed } - see _followSrcJob
const _srcJobs = new Map();
const _srcLast = new Map();  // sourceId -> { text, err } - what its last job said, when it failed
const _following = new Map();  // draftId -> { jobId, run, rows } - the stages this page follows

// ── Markup ──────────────────────────────────────────────────────────────────
const HTML = `
  <aside class="mk-src" id="mk-src">
    <button class="mk-add" id="mk-add" type="button" title="Add a source - a long video, by a link or from a file">+</button>
    <div class="mk-src-list" id="mk-src-list"></div>
  </aside>
  <div class="mk-sash" id="mk-sash" title="Drag to resize, double-click for the usual width"></div>
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
  _wireSash();
  // Questions about a link left waiting before a reload are the add window's again (phase V28.1).
  _loadAsks();
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
  // A vertical or product removed on the Scenarios shelf (phase G4) leaves this form too, hidden or not:
  // the server cleared the drafts' copies, and a stage landing later would save the form's copy back.
  document.addEventListener('lib:values-removed', (e) => {
    const { field, value } = (e && e.detail) || {};
    if (field !== 'vertical' && field !== 'product') return;
    const inp = $('mk-' + field);
    if (inp && inp.value.trim().toLowerCase() === String(value || '').trim().toLowerCase()) inp.value = '';
  });
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
  if (o.sourceId) { await showSource(o.sourceId, { opening: true }); return; }
  if (o.draftId && await _resumeDraft(o.draftId)) return;
  _src = null;
  _paintSources();
  await _enterScript({});
}

/**
 * A source by its id - an Alerts row leads here (phase V28.1, ?shelf=scenarios&make=1&src=): its topics when it is a
 * source, its line in the column, lit, while it is being added or waits for a decision. `opening`: the layout was
 * just opened for it, and a form is put up when there are no topics to show.
 */
export async function showSource(id, { opening = false } = {}) {
  _build();
  if (!opening) {
    await _flushDraft();
    await _readSources();
    _paintSources();
  }
  const it = _sources.find(s => String(s.id) === String(id));
  if (it && _choosable(it)) {
    if (_src && String(_src.id) === String(id)) { await _refreshSource(); if (_src) _showTopics(); }
    else await _chooseSource(it);
  } else if (opening) {
    _src = null;
    _paintSources();
    await _enterScript({});
  }
  _flashRow(id);
}

// Lit for a moment, and brought into view.
function _flashRow(id) {
  const row = document.querySelector(`#mk-src-list .mk-srow[data-id="${CSS.escape(String(id))}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'nearest' });
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}

/** Leave the layout: what is typed is saved; what runs keeps running. */
export async function close() {
  _say('');
  await _flushDraft();
}

// ── Sources: the column ─────────────────────────────────────────────────────
// Being read: the states only a running job leaves behind (routes/sources.js LIVE), or a transcript
// under way. A source that failed is never "being read", whatever its transcript still says.
const READING = new Set(['waiting', 'downloading', 'copying', 'stored', 'transcribing']);
const _reading = (s) => !!s && s.state !== 'error'
  && (READING.has(s.state) || !!(s.transcript && s.transcript.state === 'running'));

async function _readSources() {
  try { _sources = (await J.api('/api/sources')).sources || []; } catch (e) { return; }
  for (const s of _sources) {
    // A topics job the server knows about and this page does not - the page was reloaded, or another
    // window started it. Followed at once, so its card is right when it lands whether it is opened or not.
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

// While a source is being added, fetched or read, the column asks again - every 2 s while one is being added (its
// bar and its time), every 5 s otherwise: the work belongs to the server, and a line saying "transcribing…" forever is
// the one thing the column must not do. Between two reads the time left counts down by itself.
function _pollWhileBusy() {
  const adding = _sources.some(s => s.progress);
  const busy = adding || _sources.some(_reading);
  const ms = adding ? 2000 : 5000;
  if (_pollT && (!busy || _pollMs !== ms)) { clearInterval(_pollT); _pollT = null; }
  if (busy && !_pollT) {
    _pollMs = ms;
    _pollT = setInterval(async () => {
      await _readSources();
      if (_built) _paintSources();
      if (_src) {
        const fresh = _sources.find(s => String(s.id) === String(_src.id));
        const was = (_src.transcript || {}).state;
        if (fresh && (fresh.state !== _src.state || (fresh.transcript || {}).state !== was
          || (fresh.topics || 0) !== ((_src.topics || []).length))) await _refreshSource();
        else if (fresh && fresh.progress && _view === 'topics') _reattachSrcJob(_src);
      }
    }, ms);
  }
  if (adding && !_tickT) _tickT = setInterval(_tickLeft, 1000);
  else if (!adding && _tickT) { clearInterval(_tickT); _tickT = null; }
}

const _leftSays = (ms) => '~' + J.clock(Math.max(0, Math.ceil(ms / 1000))) + ' left';
function _tickLeft() {
  document.querySelectorAll('#mk-src-list [data-end]').forEach((n) => { n.textContent = _leftSays(+n.dataset.end - Date.now()); });
}
const _ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
const STEP_WORD = { download: 'downloading', copy: 'copying', process: 'transcribing', topics: 'finding topics' };
// A line that is a source to write from: not one being added, not one waiting for a decision.
const _offer = (it) => it.state === 'nospeech' || it.state === 'notopics';
const _choosable = (it) => !!it && !it.progress && !_offer(it);

function _stateLine(it) {
  const t = it.transcript || {};
  const way = it.intake || null;
  if (it.state === 'nospeech') return 'no speech - not a source';
  if (it.state === 'notopics') return 'no topics - not a source';
  if (it.state === 'error') {
    const cut = /interrupted/i.test(it.error || '') ? 'interrupted' : 'failed';
    // Its way in is an Alerts row (phase V28.1): "retry" is there.
    return way && way.alertId ? cut + ' - retry in Alerts' : cut;
  }
  if (it.state === 'downloading' || it.state === 'waiting') return 'downloading…';
  if (_reading(it)) return 'transcribing…';
  if (t.state !== 'ready') return 'no transcript';
  const run = _srcJobs.get(String(it.id));
  if (run && run.kind === 'topics') return 'finding topics…';
  if (!it.topics && way && (way.interrupted || way.error)) return 'no topics yet - retry in Alerts';
  return it.topics ? `${it.topicsUsed || 0} of ${it.topics} topics used` : 'no topics yet';
}

// While only a share and a time move (a source being added, read every 2 s), the lines are updated IN PLACE: a line
// made anew under the pointer loses the press that straddles it - the cross of a download would not stop it.
let _painted = '';
const _lineKey = (it) => [it.id, it.state, it.title, it.seconds, it.topics, it.topicsUsed, _stateLine(it),
  _drafts.filter(d => String(d.sourceId) === String(it.id)).length, !!(_src && String(_src.id) === String(it.id)),
  _stopArmed === String(it.id), it.progress ? it.progress.step + '/' + it.progress.place : ''].join('|');

function _paintSources() {
  const box = $('mk-src-list');
  if (!box) return;
  const key = _sources.map(_lineKey).join('\n');
  if (key && key === _painted && box.childElementCount === _sources.length) { _paintProgress(box); return; }
  _painted = key;
  box.textContent = '';
  if (!_sources.length) {
    box.appendChild(el('div', 'mk-src-empty', 'No sources yet. A long video, added with +, becomes material to write from.'));
    return;
  }
  for (const it of _sources) box.appendChild(_srcLine(it));
}

function _paintProgress(box) {
  for (const it of _sources) {
    const p = it.progress;
    if (!p) continue;
    const row = box.querySelector(`.mk-srow[data-id="${CSS.escape(String(it.id))}"]`);
    if (!row) continue;
    const pct = row.querySelector('.mk-srow-pct');
    if (pct) pct.textContent = Math.round(p.pct * 100) + '%';
    const left = row.querySelector('[data-end]');
    if (left) { left.dataset.end = String(Date.now() + p.leftMs); left.textContent = _leftSays(p.leftMs); }
    const fill = row.querySelector('.mk-srow-bar > i');
    if (fill) fill.style.width = (p.pct * 100).toFixed(1) + '%';
    row.title = it.title + '\n' + (p.words || '') + '\nIt is being added - follow it in Alerts';
  }
}

// A LINE (phase V28.1): a mark, the name, what it is at, its length and drafts, a cross at the top right. One being
// added has its share done and the time left, and is not pressed - its cross stops it, twice ("really?"). One with
// nothing to write from offers to go onto Uploads.
function _srcLine(it) {
  const id = String(it.id);
  const p = it.progress || null;
  const offer = _offer(it);
  const cur = !!(_src && String(_src.id) === id);
  const row = el('div', 'mk-srow' + (cur ? ' cur' : '') + (p ? ' adding' : '') + (offer ? ' offer' : ''));
  row.dataset.id = id;
  row.title = it.title + (cur ? '\nPress again to write without a source' : '');
  row.appendChild(el('span', 'mk-srow-k', '▶'));
  const main = el('div', 'mk-srow-main');
  main.appendChild(el('div', 'mk-srow-t', it.title));
  const sub = el('div', 'mk-srow-s');
  if (p) {
    sub.appendChild(el('span', 'mk-srow-pct', Math.round(p.pct * 100) + '%'));
    const left = el('span', null, _leftSays(p.leftMs));
    left.dataset.end = String(Date.now() + p.leftMs);
    sub.appendChild(left);
    sub.appendChild(el('span', null, p.step === 'wait' ? (p.place ? `${_ordinal(p.place)} in the queue` : 'waiting') : (STEP_WORD[p.step] || p.step)));
    row.title = it.title + '\n' + (p.words || '') + '\nIt is being added - follow it in Alerts';
  } else {
    sub.appendChild(el('span', null, _stateLine(it)));
    if (it.seconds) sub.appendChild(el('span', null, J.clock(it.seconds)));
    const nd = _drafts.filter(d => String(d.sourceId) === id).length;
    if (nd) sub.appendChild(el('span', 'mk-src-draft', nd === 1 ? '1 draft' : `${nd} drafts`));
  }
  main.appendChild(sub);
  if (p) {
    const bar = el('div', 'mk-srow-bar');
    const fill = el('i');
    fill.style.width = (p.pct * 100).toFixed(1) + '%';
    bar.appendChild(fill);
    main.appendChild(bar);
  }
  if (offer) {
    const acts = el('div', 'mk-srow-acts');
    const up = el('button', 'lib-btn', 'Put on Uploads');
    up.type = 'button';
    up.title = 'The video goes onto Uploads in Media, and is not kept as a source';
    up.addEventListener('click', (e) => { e.stopPropagation(); _sourceToUploads(it, up); });
    acts.appendChild(up);
    main.appendChild(acts);
  }
  row.appendChild(main);
  const x = el('button', 'mk-x' + (p && _stopArmed === id ? ' armed' : ''), p && _stopArmed === id ? 'really?' : '✕');
  x.type = 'button';
  if (p) {
    x.title = p.step === 'topics'
      ? 'Stop finding its topics - its words stay, and "Find topics" finds them later'
      : 'Stop adding it - it is removed, with what was downloaded';
    x.addEventListener('click', (e) => { e.stopPropagation(); _stopAdding(it); });
  } else {
    x.title = offer ? 'Delete it, and its file' : 'Delete this source, its video and its transcript';
    x.addEventListener('click', (e) => { e.stopPropagation(); _deleteSource(it); });
  }
  row.appendChild(x);
  if (_choosable(it)) {
    row.addEventListener('click', () => _chooseSource(it));
    // Its own menu (phase F2) - never Electron's.
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); _sourceMenu(e, it); });
  } else row.addEventListener('contextmenu', (e) => e.preventDefault());
  return row;
}

// The cross of a line being added: the first press asks ("really?" for 3 s), the second stops it.
async function _stopAdding(it) {
  const id = String(it.id);
  if (_stopArmed !== id) {
    _stopArmed = id;
    _paintSources();
    setTimeout(() => { if (_stopArmed === id) { _stopArmed = ''; _paintSources(); } }, 3000);
    return;
  }
  _stopArmed = '';
  try { await J.api('/api/sources/' + encodeURIComponent(id) + '/stop', { method: 'POST' }); }
  catch (e) { _say(e.message, 'err'); }
  // The server lets go of the work first - a download killed, a call dropped - and only then of the source.
  setTimeout(async () => { await _readSources(); _paintSources(); }, 1200);
}

// Nothing to write from (phase V28.1): onto Uploads in Media, and the line goes.
async function _sourceToUploads(it, btn) {
  if (btn) btn.disabled = true;
  try {
    await J.api('/api/sources/' + encodeURIComponent(it.id) + '/to-uploads', { method: 'POST' });
    _say(`"${it.title}" is on Uploads in Media.`, 'ok');
  } catch (e) { _say(e.message, 'err'); if (btn) btn.disabled = false; }
  await _readSources();
  _paintSources();
}

// ── The sash between the column and the generator (phase V28.1) ──
const LS_SRC_W = 'lib_mk_src_w';
const SRC_W = { def: 240, min: 170, max: 560 };
const MAIN_MIN = 420;
function _clampSrcW(v) {
  const host = $('lib-make');
  let max = SRC_W.max;
  if (host && host.clientWidth) max = Math.min(max, host.clientWidth - MAIN_MIN - 5);
  return Math.round(Math.max(SRC_W.min, Math.min(Math.max(SRC_W.min, max), v)));
}
function _wireSash() {
  const sash = $('mk-sash');
  const col = $('mk-src');
  if (!sash || !col) return;
  let w = SRC_W.def;
  try { const v = +localStorage.getItem(LS_SRC_W); if (v > 0) w = v; } catch (e) { /* the usual width */ }
  col.style.flexBasis = w + 'px';
  const keep = () => { try { localStorage.setItem(LS_SRC_W, String(w)); } catch (e) { /* this view only */ } };
  sash.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = e.clientX;
    // From what is DRAWN: a narrower window may have squeezed the column below what was remembered.
    const start = Math.round(col.getBoundingClientRect().width) || w;
    document.body.classList.add('mk-resizing');
    sash.classList.add('on');
    const move = (ev) => { w = _clampSrcW(start + ev.clientX - from); col.style.flexBasis = w + 'px'; };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mk-resizing');
      sash.classList.remove('on');
      keep();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  sash.addEventListener('dblclick', () => { w = _clampSrcW(SRC_W.def); col.style.flexBasis = w + 'px'; keep(); });
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
      ? `This source failed: ${rec.error || 'unknown reason'}${rec.intake && rec.intake.alertId ? ' - its row in Alerts has "retry".' : ''}`
      : 'No transcript yet.');
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
    // since - by a generation from here, or in another window - and a blank form saved over it would wipe
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

// ONE RENAME, wherever it is typed - the topics header or the source window (phase F2) - and
// everything this page shows the name in follows it: the card, the topics header, the form's
// "from", the drafts. The server reads the name live for the scenarios and drafts it has.
async function _renameSource(id, title) {
  const d = await J.api('/api/sources/' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
  });
  const name = d.source.title;
  const i = _sources.findIndex(x => String(x.id) === id);
  if (i >= 0) _sources[i] = { ..._sources[i], title: name };
  if (_src && String(_src.id) === id) {
    _src.title = name;
    const inp = $('mk-src-title');
    if (inp && document.activeElement !== inp) inp.value = name;
  }
  if (_gen && String(_gen.sourceId) === id) { _gen.sourceTitle = name; _paintFrom(); }
  for (const dr of _drafts) if (String(dr.sourceId) === id) dr.sourceTitle = name;
  _paintSources();
  return name;
}

let _titleT = null;
async function _saveTitle() {
  clearTimeout(_titleT);
  if (!_src) return;
  // By id: the source may be let go of while the rename is on its way.
  const id = String(_src.id);
  const title = $('mk-src-title').value.trim();
  if (!title || title === _src.title) return;
  try {
    await _renameSource(id, title);
    if (_src && String(_src.id) === id) {
      $('mk-title-saved').textContent = 'saved';
      setTimeout(() => { if ($('mk-title-saved')) $('mk-title-saved').textContent = ''; }, 1600);
    }
  } catch (e) { if (_src && String(_src.id) === id) $('mk-title-saved').textContent = e.message; }
}

// ── A source's menu and its window (phase F2) ───────────────────────────────
// Right-click on a card: "change name" and "play", both into the same window - the video on the
// left, the name on the right. "play" starts the video; "change name" puts the caret in the name
// and leaves the video still (the owner, 2026-09-30).
let _menu = null;
function _closeMenu() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.away, true);
  Layers.close(_menu.layer);
  _menu = null;
}

function _sourceMenu(ev, it) {
  _closeMenu();
  const m = el('div', 'mv3-plus-menu');
  const item = (label, sub, on, off) => {
    const b = el('button', 'mv3-plus-item');
    b.type = 'button';
    b.appendChild(el('span', null, label));
    if (sub) b.appendChild(el('small', null, sub));
    b.disabled = !!off;
    b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); on(); });
    m.appendChild(b);
  };
  item('change name', 'what this source is called everywhere', () => _openSourceWin(it, false));
  item('play', it.media ? 'watch it' : 'no file to play - it never downloaded', () => _openSourceWin(it, true), !it.media);
  document.body.appendChild(m);
  m.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - m.offsetWidth - 6, ev.clientX))) + 'px';
  m.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - m.offsetHeight - 6, ev.clientY))) + 'px';
  const away = (e) => { if (!m.contains(e.target)) _closeMenu(); };
  _menu = { el: m, away, layer: Layers.open(m, { modal: false, name: 'source menu', onEsc: _closeMenu }) };
  // On the next tick: this very right-click is still travelling, and would close what it opened.
  setTimeout(() => { if (_menu && _menu.el === m) document.addEventListener('mousedown', away, true); }, 0);
}

const AUDIO_RE = /\.(mp3|m4a|wav|aac|ogg)$/i;
let _srcWin = null;

function _closeSourceWin() {
  if (!_srcWin) return;
  const w = _srcWin;
  _srcWin = null;
  // Let go of the file: a paused element keeps buffering a gigabyte otherwise.
  const media = w.ov.querySelector('video, audio');
  if (media) { try { media.pause(); media.removeAttribute('src'); media.load(); } catch (e) { /* gone anyway */ } }
  w.ov.remove();
  Layers.close(w.layer);
}

function _openSourceWin(it, play) {
  _closeSourceWin();
  const id = String(it.id);
  const ov = el('div', 'mk-ov');
  ov.innerHTML = `
    <div class="mk-panel src-panel" role="dialog" aria-modal="true" aria-label="Source">
      <div class="mk-panel-head">
        <span class="mk-panel-t" data-f="head"></span>
        <span class="sp"></span>
        <button class="lib-btn" type="button" data-x="close" title="Close (Esc)">✕</button>
      </div>
      <div class="src-body">
        <div class="src-stage" data-f="stage"></div>
        <aside class="src-side">
          <label class="mk-field"><span>Name</span><input type="text" data-f="name" maxlength="200" spellcheck="false"></label>
          <div class="src-save">
            <button class="lib-btn primary" type="button" data-f="save">Save name</button>
            <span class="lib-status" data-f="st"></span>
          </div>
          <div class="lib-vi" data-f="facts"></div>
        </aside>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const q = (n) => ov.querySelector(`[data-f="${n}"]`);
  ov.querySelector('[data-x="close"]').addEventListener('click', _closeSourceWin);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _closeSourceWin(); });
  _srcWin = { ov, layer: Layers.open(ov, { name: 'source', onEsc: _closeSourceWin }) };

  q('head').textContent = it.title;
  // The picture side: the file itself, played from the library - the server serves it in ranges,
  // so an hour-long source opens at once and seeks.
  const stage = q('stage');
  if (!it.media) stage.appendChild(el('div', 'src-none', 'There is no file for this source - it never downloaded.'));
  else {
    const media = el(AUDIO_RE.test(it.media) ? 'audio' : 'video');
    media.controls = true;
    media.preload = 'metadata';
    if (media.tagName === 'VIDEO' && it.thumb) media.poster = it.thumb;
    // Never Electron's own menu here, nor the controls' own Download: "Save video as" would start
    // copying a gigabyte to Downloads. No picture-in-picture either - it would outlive the window.
    media.addEventListener('contextmenu', (e) => e.preventDefault());
    media.setAttribute('controlslist', 'nodownload noremoteplayback');
    if (media.tagName === 'VIDEO') media.disablePictureInPicture = true;
    media.addEventListener('error', () => {
      if (!_srcWin || _srcWin.ov !== ov) return;
      stage.textContent = '';
      stage.appendChild(el('div', 'src-none', 'This file cannot be played here - its format is not one the window knows.'));
    });
    media.src = it.media;
    stage.appendChild(media);
    if (play) media.play().catch(() => { /* the controls are there */ });
  }

  const fact = (label, value) => {
    if (!value) return;
    const r = el('div', 'lib-vi-row');
    r.append(el('span', 'lib-vi-l', label), el('span', 'lib-vi-v', value));
    q('facts').appendChild(r);
  };
  const t = it.transcript || {};
  fact('length', it.seconds ? J.clock(it.seconds) : '');
  fact('size', it.bytes ? J.mb(it.bytes) : '');
  fact('added', J.fmtDate(it.addedAt));
  fact('from', it.kind === 'youtube' ? (it.url || 'a link') : 'a file');
  fact('transcript', t.state === 'ready'
    ? ((t.chars || 0) >= 1000 ? `${Math.round(t.chars / 1000)}k characters` : `${t.chars || 0} characters`) : _stateLine(it));
  fact('topics', it.topics ? `${it.topicsUsed || 0} of ${it.topics} used` : '');

  const name = q('name');
  name.value = it.title;
  const doSave = async () => {
    const title = name.value.trim();
    const st = q('st');
    if (!title) { st.textContent = 'A name is needed.'; st.className = 'lib-status err'; return; }
    if (title === it.title) { st.textContent = 'unchanged'; st.className = 'lib-status'; return; }
    q('save').disabled = true;
    try {
      const saved = await _renameSource(id, title);
      it = { ...it, title: saved };
      if (_srcWin && _srcWin.ov === ov) {
        q('head').textContent = saved;
        st.textContent = 'saved';
        st.className = 'lib-status ok';
      }
    } catch (e) {
      if (_srcWin && _srcWin.ov === ov) { st.textContent = e.message; st.className = 'lib-status err'; }
    } finally { if (_srcWin && _srcWin.ov === ov) q('save').disabled = false; }
  };
  q('save').addEventListener('click', doSave);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
  if (!play) { name.focus(); name.select(); }
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
  const adding = (_sources.find(s => String(s.id) === id) || {}).progress;
  if (adding) { J.sayJob(host, `${adding.words} · ${Math.round(adding.pct * 100)}% - follow it in Alerts`); return; }
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
    // On the generator's model (phase F3), not on a default of the mining's own.
    const d = await J.api(`/api/sources/${encodeURIComponent(id)}/topics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(J.modelChoice() || {}),
    });
    // Its way in was cut off (phase V28.1): the server retried its Alerts row - the work is that row's.
    if (d.alertId) { await _afterRetry(); return; }
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
    // On the generator's model: when it has no topics yet, they are found after the words (phase V28.1).
    const d = await J.api(`/api/sources/${encodeURIComponent(id)}/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(J.modelChoice() || {}),
    });
    if (d.alertId) { await _afterRetry(); return; }
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

// A source's own button retried its way in: the row in Alerts runs again, and the line in the column shows it.
async function _afterRetry() {
  _say('It goes on from where it stopped - follow it in Alerts.');
  pulseAlerts();
  await _readSources();
  _paintSources();
  await _refreshSource();
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

// A field of the form: its name above it, and beside the name anything that belongs to the field (the
// narrators' gear). A button inside the label is its own press - it does not reach the select.
function _ctl(label, node, extra) {
  const w = el('label', 'mk-ctl');
  // Pointed at its field: a label with no `for` labels its FIRST control, and the gear in the name
  // comes before the select - a press on the word "Narrator" would open the narrators window.
  if (node && node.id) w.htmlFor = node.id;
  const head = el('span', null, label);
  if (extra) head.appendChild(extra);
  w.appendChild(head);
  w.appendChild(node);
  return w;
}

// The narrators window opens from its field (phase G2, the owner 2026-09-30: out of the header, a gear to
// the right of "Narrator").
const GEAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
function _narratorsGear() {
  const b = el('button', 'mk-gear');
  b.type = 'button';
  b.id = 'mk-narrators';
  b.title = 'The narrators - how a script is written';
  b.setAttribute('aria-label', 'Narrators');
  b.innerHTML = GEAR_SVG;
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); NR.open(); });
  return b;
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
  box.appendChild(_ctl('Narrator', nar, _narratorsGear()));

  // PROVIDER, MODEL, EFFORT (phase F3): the aggregators kie.ai and Replicate, their models, and the
  // effort levels THE CHOSEN MODEL takes - the list is rebuilt when the model changes, and hidden
  // for a model that takes none. A draft opens on its own choice; a new form on the last one made.
  const was = J.modelChoice() || {};
  const pick = { provider: s.provider || was.provider || d.provider, model: s.model || was.model || d.model, effort: s.effort || was.effort || d.effort };
  const provs = _reg.providers.map(p => ({ value: p.id, label: p.label + (p.keyed ? '' : ' — no key'), disabled: !p.keyed }));
  const prov = _select('mk-c-provider', provs, pick.provider);
  if (prov.selectedIndex < 0 || prov.selectedOptions[0].disabled) {
    const first = _reg.providers.find(p => p.keyed) || _reg.providers[0];
    prov.value = first.id;
  }
  prov.title = 'Which aggregator runs the model - its key is on Admin';
  const model = el('select');
  model.id = 'mk-c-model';
  const effort = el('select');
  effort.id = 'mk-c-effort';
  const effortCtl = _ctl('Effort', effort);
  const fillEfforts = (wantEffort) => {
    const p = _reg.providers.find(x => x.id === prov.value);
    const m = p && p.models.find(x => x.id === model.value);
    const list = (m && m.efforts) || [];
    effort.textContent = '';
    for (const v of list) { const o = el('option', null, v); o.value = v; effort.appendChild(o); }
    effort.value = list.includes(wantEffort) ? wantEffort : (m ? m.effort : '');
    effortCtl.hidden = !list.length;
    effort.title = 'How long the model thinks before it writes - only the levels this model takes';
  };
  const fillModels = (wantModel, wantEffort) => {
    const p = _reg.providers.find(x => x.id === prov.value) || _reg.providers[0];
    model.textContent = '';
    for (const m of p.models) { const o = el('option', null, m.label); o.value = m.id; o.title = m.id; model.appendChild(o); }
    model.value = p.models.some(m => m.id === wantModel) ? wantModel : p.models[0].id;
    fillEfforts(wantEffort);
  };
  fillModels(pick.model, pick.effort);
  const remember = () => J.rememberModel({ provider: prov.value, model: model.value, effort: effort.value });
  // The choice the form landed on is remembered too, when nothing usable was: topic mining and the
  // narrators window run on the remembered one, and must not fall back to a provider with no key.
  const had = J.modelChoice();
  const hadOk = had && _reg.providers.some(p => p.id === had.provider && p.keyed);
  if (!hadOk && _reg.providers.some(p => p.id === prov.value && p.keyed)) remember();
  prov.addEventListener('change', () => { fillModels('', ''); remember(); });
  model.addEventListener('change', () => { fillEfforts(effort.value); remember(); });
  effort.addEventListener('change', remember);
  box.appendChild(_ctl('Provider', prov));
  box.appendChild(_ctl('Model', model));
  box.appendChild(effortCtl);
  for (const n of box.querySelectorAll('select,input')) n.addEventListener('change', _queueDraft);
  const pin = s.readingId || s.readingIndex;   // a draft from before ids keeps a number - read once (_paintNarrators)
  const want = s.narratorId ? (pin ? `${s.narratorId}#${pin}` : s.narratorId) : 'neutral';
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
    // (phase V23) BY ID: "reading 2" pinned by its number became the old third one when the first was deleted.
    const reads = n.readingList || [];
    reads.forEach((r, i) => values.push({ value: `${n.id}#${r.id}`, label: `${n.name} — reading ${i + 1}` }));
  }
  let pick = cur || 'neutral';
  // A draft from before ids pinned "#2": the second reading AS IT IS NOW, once, and saved by its id.
  {
    const [nid, ri] = String(pick).split('#');
    const nar = list.find(n => String(n.id) === nid);
    if (nar && /^\d+$/.test(ri || '')) {
      const r = (nar.readingList || [])[parseInt(ri, 10) - 1];
      if (r) { pick = `${nid}#${r.id}`; if (_gen && _gen.draftId) _queueDraft(); }
    }
  }
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
      note.textContent = `The pinned reading of ${nar.name} is gone - one of its readings is picked at random now. Pin another if it matters.`;
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
  const [narratorId, readingPin] = String(nar.value).split('#');
  return {
    language: $('mk-c-lang').value,
    scenes: parseInt($('mk-c-scenes').value, 10),
    tone: $('mk-c-tone').value,
    narratorId,
    // The reading pinned in the dropdown, by its id (phase V23) - '' is random.
    readingId: readingPin || '',
    readingPin: readingPin || '',
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
      narratorId: o.narratorId, narratorName: o.narratorName, readingId: o.readingPin, readingIndex: '',
      provider: o.provider, model: o.model, effort: o.effort,
    },
    save: { gender: $('mk-gender').value, vertical: $('mk-vertical').value, product: $('mk-product').value },
  };
}

async function _saveDraft(o) {
  clearTimeout(_saveT);
  _saveT = null;
  if (!_gen) return;
  // A form with nothing in it is not a draft yet: turning a dropdown on a blank form made an empty
  // "untitled draft" row. The first word typed - or the first stage started - makes it.
  if (!_gen.draftId && !_hasContent()) return;
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
      // in another window): the form keeps its work as a new draft instead.
      if (e.status !== 404 || gen !== _gen) throw e;
      _gen.draftId = '';
      d = await post();
    }
    _noteDraft(d.draft);
    if (gen === _gen) { _gen.draftId = d.draft.id; _paintGo(); }
  } catch (e) { /* a draft that failed to save is not worth interrupting the writing for */ }
}

function _hasContent() {
  return !!(($('mk-topic') && $('mk-topic').value.trim()) || ($('mk-hook') && $('mk-hook').value.trim())
    || ($('mk-title') && $('mk-title').value.trim()) || (_gen && ((_gen.hooks || []).length || (_gen.paragraphs || []).length)));
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
    // (phase V23) The reading the stages drew with, kept in the draft - a reload no longer forgets it.
    readingId: (full && full.usedReadingId) || '',
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
      if (j.step && here() && rec.rows.length && !rec.cancelling) rec.rows[rec.rows.length - 1].say(j.step);
    });
    // One timing for the whole job, however many rows showed it.
    rec.rows.forEach((r, i) => (i === 0 ? r.finish() : r.detach()));
    if (_gen === gen && onResult) await onResult(job.result || {});
    else if (here()) await _landInto(run.what, job.result || {});
    return true;
  } catch (e) {
    if (e.cancelled) {
      // Cancelled (phase G1): not an error. The form goes back to what it showed before the press -
      // the hooks it had, the script it had - since the server kept nothing of this stage.
      // Painted from the form itself, never read back from the server: nothing of the stage was kept,
      // and a reload would put the draft's copy over edits still waiting out their pause.
      rec.rows.forEach(r => r.detach());
      if (here()) {
        _sayBriefly('cancelled - what was already sent is paid for');
        if ((_gen.hooks || []).length) _renderHooks(_gen.hooks);
        if ((_gen.paragraphs || []).length) _renderScenes();
        // A stage this form did not start has no caller to set the stage back.
        if (_gen !== gen || !onResult) _setStage((_gen.hooks || []).length && !$('mk-hook').value.trim() ? 'pick' : 'idle');
      }
      return 'cancelled';
    }
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
  const row = J.startJob($('mk-job'), { ...t, startedAt: run.startedAt || Date.now(), onCancel: () => _cancelStage(rec) });
  rec.rows.push(row);
  return row;
}

// The ✕ beside the countdown (phase G1, the owner 2026-09-30): the server stops the job and frees the
// draft; the poll sees it cancelled and _followStage puts the form back. A job that ended meanwhile
// lands as usual - the cross came too late, and says nothing.
async function _cancelStage(rec) {
  if (rec.cancelling) return;
  rec.cancelling = true;
  try { await J.cancelJob('/api/scriptgen/jobs', rec.jobId); }
  catch (e) {
    rec.cancelling = false;
    const row = rec.rows[rec.rows.length - 1];
    if (row) row.say('could not cancel: ' + e.message);
  }
}

// A word in the job strip that goes away by itself - unless something else has been said there since.
function _sayBriefly(text) {
  const host = $('mk-job');
  J.sayJob(host, text);
  const said = host.firstChild;
  setTimeout(() => { if (host.firstChild === said && said) J.clearJob(host); }, 3500);
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
        narratorId: o.narratorId, language: o.language, tone: o.tone, provider: o.provider, model: o.model,
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

// ── Adding a source (phase V28.1) ───────────────────────────────────────────
// A window on the layer stack: a link, or a file from this computer - its PATH, handed over by the app's own window
// (desktop/preload.js), and the server copies it. The SERVER reads it and decides by the frame (lib/source-intake.js):
// a horizontal video becomes a source and the window flies into Alerts, where its whole way in goes on; a vertical
// or square one, or one whose frame the site did not name, is asked about here; a sound alone is "in development".
// The window is free again at once - links are added one after another and downloaded in turn. What it still follows
// (a read, a question, a vertical video going onto Uploads) belongs to the module, not the window: closed and opened
// again it is all there, and a question survives a reload (GET /api/sources/add).
let _addWin = null;
const _adds = new Map();       // readId -> the read, as the server last said it
let _addsT = null;
let _addSaid = null;           // { text, err } - the window's own word: "paste a link first", a refusal

const _post = (url, body) => J.api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

function _closeAddSource() {
  if (!_addWin) return;
  const w = _addWin;
  _addWin = null;
  _addSaid = null;
  // What has ended is let go of with the window; what still runs or waits for an answer stays.
  for (const [id, r] of _adds) if (_addSettled(r)) _adds.delete(id);
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
          <button class="mk-choice-btn cur" type="button" data-route="link">From a link</button>
          <button class="mk-choice-btn" type="button" data-route="file">From a file</button>
        </div>
        <section class="mk-route" data-r="link">
          <label class="mk-field"><span>Link to a single video</span>
            <input type="text" data-f="url" placeholder="https://www.youtube.com/watch?v=…"></label>
          <button class="lib-btn primary" type="button" data-go="link">Add</button>
        </section>
        <section class="mk-route" data-r="file" hidden>
          <label class="mk-field"><span>Video file</span><input type="file" data-f="file" accept="video/*"></label>
          <label class="mk-field"><span>Title <em>optional — the file name is used otherwise</em></span>
            <input type="text" data-f="title" placeholder="What this source is"></label>
          <button class="lib-btn primary" type="button" data-go="file">Add</button>
        </section>
        <p class="mk-pnote">A horizontal video becomes a source: it is downloaded - one at a time, in the order added - or
          copied, transcribed and its topics found, all of it in Alerts, so this window lets go at once. A vertical or
          square one is asked about: onto Uploads in Media, or a source after all. A sound without a picture - in
          development. Links are read without a login: a video a site shows only to signed-in people - add it as a
          file. The transcription and the topics are paid calls.</p>
        <div class="mk-adds-say" data-f="said" hidden></div>
        <div class="mk-adds" data-f="adds"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const q = (s) => ov.querySelector(s);
  const f = (name) => q(`[data-f="${name}"]`);
  const route = (r) => {
    ov.querySelectorAll('.mk-choice-btn').forEach(b => b.classList.toggle('cur', b.dataset.route === r));
    ov.querySelectorAll('.mk-route').forEach(s => { s.hidden = s.dataset.r !== r; });
  };
  ov.querySelectorAll('.mk-choice-btn').forEach(b => b.addEventListener('click', () => route(b.dataset.route)));
  q('[data-x="close"]').addEventListener('click', _closeAddSource);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _closeAddSource(); });
  const layer = Layers.open(ov, { name: 'add a source', onEsc: _closeAddSource });
  _addWin = { ov, layer, q, f };

  q('[data-go="link"]').addEventListener('click', () => _addLink(f('url')));
  f('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _addLink(f('url')); } });
  q('[data-go="file"]').addEventListener('click', () => _addFile(f('file'), f('title')));
  setTimeout(() => { if (_addWin && _addWin.ov === ov) f('url').focus(); }, 0);
  _paintAdds();
}

function _addSay(text, err) {
  _addSaid = text ? { text, err: !!err } : null;
  _paintAdds();
}

async function _addLink(input) {
  const url = input.value.trim();
  if (!url) { _addSay('Paste a link first.', true); return; }
  _addSay('');
  try {
    const d = await _post('/api/sources/add/link', { url, mineWith: J.modelChoice() || {} });
    input.value = '';
    _track(d.read);
  } catch (e) { _addSay(e.message, true); }
}

async function _addFile(input, titleIn) {
  const file = input.files && input.files[0];
  if (!file) { _addSay('Pick a file first.', true); return; }
  // The app's own window says where the file lies; the server copies it from there itself, so leaving the page
  // cuts nothing off. A browser tab cannot say.
  const pathOf = window.ugcWindow && window.ugcWindow.pathOf;
  let where = '';
  try { where = typeof pathOf === 'function' ? String(pathOf(file) || '') : ''; } catch (e) { where = ''; }
  if (!where) { _addSay('Adding a file works in the app\'s own window - it hands the file over. Here, add it by a link.', true); return; }
  _addSay('');
  try {
    const d = await _post('/api/sources/add/file', { path: where, title: titleIn.value.trim(), mineWith: J.modelChoice() || {} });
    input.value = '';
    titleIn.value = '';
    _track(d.read);
  } catch (e) { _addSay(e.message, true); }
}

// ── What the window follows ──
const _linkEnded = (r) => !!(r.link && ['done', 'error', 'stopped'].includes(r.link.state));
function _addSettled(r) {
  if (!r) return true;
  if (r.state === 'uploads') return r.from === 'link' ? _linkEnded(r) : !!r.landed;
  return ['audio', 'error', 'dropped', 'source'].includes(r.state);
}
const _addPending = (r) => r.state === 'reading' || (r.state === 'uploads' && !_addSettled(r));

function _track(read) {
  if (!read || !read.id) return;
  _adds.set(read.id, read);
  _landRead(read);
  _paintAdds();
  _followAdds();
}

function _followAdds() {
  if (_addsT || ![..._adds.values()].some(_addPending)) return;
  _addsT = setInterval(async () => {
    const pending = [..._adds.values()].filter(_addPending);
    if (!pending.length) { clearInterval(_addsT); _addsT = null; return; }
    for (const r of pending) {
      let fresh = null;
      try { fresh = (await J.api('/api/sources/add/' + encodeURIComponent(r.id))).read; }
      catch (e) { fresh = { ...r, state: 'error', error: e.status === 404 ? 'lost - add it again' : e.message }; }
      if (!_adds.has(r.id)) continue;
      _adds.set(r.id, fresh);
      _landRead(fresh);
    }
    _paintAdds();
  }, 1000);
}

// A read that became a source is handed over: the window flies into Alerts and is closed; the new line is in the
// column at once. A vertical one landed on Uploads leaves the column alone.
function _landRead(r) {
  if (!r || r.state !== 'source' || !_adds.has(r.id)) return;
  _adds.delete(r.id);
  _readSources().then(() => _paintSources());
  if (_addWin) {
    const w = _addWin;
    w.ov.classList.add('is-leaving');
    flyToAlerts(w.ov.querySelector('.mk-panel')).then(() => { if (_addWin === w) _closeAddSource(); });
  } else pulseAlerts();
}

async function _answer(r, as) {
  try {
    const d = await _post('/api/sources/add/' + encodeURIComponent(r.id) + '/answer', { as });
    if (as === 'drop') { _adds.delete(r.id); _paintAdds(); return; }
    _adds.set(r.id, d.read);
    _landRead(d.read);
    _paintAdds();
    _followAdds();
  } catch (e) {
    _adds.set(r.id, { ...r, state: 'error', error: e.message });
    _paintAdds();
  }
}

// The questions left waiting - from before a reload - are the window's again.
async function _loadAsks() {
  try {
    const d = await J.api('/api/sources/add');
    for (const r of d.asks || []) if (!_adds.has(r.id)) _adds.set(r.id, r);
  } catch (e) { /* none to show */ }
}

const _dims = (a) => (a && a.w && a.h ? `${a.w}×${a.h}` : '') + (a && a.seconds ? (a.w ? ' · ' : '') + J.clock(a.seconds) : '');

function _paintAdds() {
  if (!_addWin) return;
  const said = _addWin.f('said');
  said.hidden = !_addSaid;
  said.textContent = _addSaid ? _addSaid.text : '';
  said.classList.toggle('err', !!(_addSaid && _addSaid.err));
  const box = _addWin.f('adds');
  box.textContent = '';
  const list = [..._adds.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
  for (const r of list) box.appendChild(_addLine(r));
}

function _addLine(r) {
  const line = el('div', 'mk-addl');
  line.appendChild(el('div', 'mk-addl-t', r.title || r.url || 'a file'));
  const say = (text, err) => { const s = el('div', 'mk-addl-s', text); if (err) line.classList.add('err'); line.appendChild(s); };
  const acts = el('div', 'mk-addl-acts');
  const btn = (label, title, on, cls) => {
    const b = el('button', 'lib-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (title) b.title = title;
    if (on) b.addEventListener('click', on); else b.disabled = true;
    acts.appendChild(b);
    return b;
  };
  if (r.state === 'reading') say(r.step || 'reading…');
  else if (r.state === 'ask') {
    const a = r.ask || {};
    if (a.kind === 'unknown') {
      say('The site did not say what this is' + (a.seconds ? ` (${J.clock(a.seconds)})` : '') + ' - a video, or a sound?');
      btn('A video with topics - a source', 'Downloaded, transcribed and its topics found, in Alerts', () => _answer(r, 'source'), 'primary');
      btn('A video - onto Uploads', 'Downloaded onto Uploads in Media, nothing read out of it', () => _answer(r, 'uploads'));
      btn('A sound - in development', 'A sound without a picture cannot be added yet');
    } else {
      say(`A ${a.kind === 'square' ? 'square' : 'vertical'} video (${_dims(a)}). It goes onto Uploads in Media - unless it has topics to write from.`);
      btn('Onto Uploads', 'Downloaded onto Uploads in Media, nothing read out of it', () => _answer(r, 'uploads'), 'primary');
      btn('It has topics - add it as a source', 'Yes, this vertical video is a source: downloaded, transcribed and its topics found, in Alerts', () => _answer(r, 'source'));
    }
  } else if (r.state === 'uploads') {
    const lj = r.link || null;
    const item = (lj && lj.items && lj.items[0]) || r.item || null;
    if (lj && lj.state === 'error') say(lj.error || 'it did not come', true);
    else if (lj && lj.state === 'stopped') say('stopped');
    else if ((lj && lj.state === 'done') || r.landed) {
      say('On Uploads in Media.');
      if (item && item.id) btn('show', 'The clip on the Media shelf', () => _showOnMedia(item.id));
    } else say((lj ? lj.step : r.step) || 'onto Uploads…');
  } else if (r.state === 'audio') say(r.step || 'Audio only - in development.');
  else if (r.state === 'error') say(r.error || 'it failed', true);
  if (acts.childNodes.length) line.appendChild(acts);
  // A line that has ended is let go of by its cross; a question is let go of too (nothing was downloaded).
  if (r.state === 'ask' || _addSettled(r)) {
    const x = el('button', 'mk-x', '✕');
    x.type = 'button';
    x.title = r.state === 'ask' ? 'Let go of it - nothing was downloaded' : 'Take this line away';
    x.addEventListener('click', () => { if (r.state === 'ask') _answer(r, 'drop'); else { _adds.delete(r.id); _paintAdds(); } });
    line.appendChild(x);
  }
  return line;
}

function _showOnMedia(itemId) {
  const href = '/library?shelf=media&sel=' + encodeURIComponent(itemId);
  _closeAddSource();
  const ask = new CustomEvent('ugc:goto', { detail: { href }, cancelable: true });
  if (window.dispatchEvent(ask)) location.href = href;
}
