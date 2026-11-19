// LIBRARY — the scenario generator: "New scenario" on the Scenarios shelf.
//
// TWO PARTS, in place of the scenario list. On the LEFT a column of sources - the long videos scripts are written
// from - as LINES, not posters (a podcast has no picture), with a 20px "+" over it that adds
// one, and a sash between it and the right (its width remembered). On the RIGHT the "Generate script"
// form; with no source chosen it writes from the topic alone ("without a source"). Choosing a source
// puts ITS topics on the right instead; choosing a topic brings the form back, filled for that
// fragment. Pressing the chosen source again lets go of it; "← topics" goes back from the form.
//
// THE FORM ON THE SHELF. The sources are shown only in this layout ("New scenario -> narrator"), never on the shelf.
// A draft selected in the Scenarios list shows THIS module's form on the right of the shelf: the form's node is moved
// there (mount) and back (open) - one form, one state, two places. On the shelf "← topics" opens the whole layout on the
// draft's source and its topics; a save or a discard hands the list back to the page.
//
// PAID WORK IS NEVER LOST. Everything slow is a job on the server
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
import * as HT from './hook-types.js';
import * as Layers from '../layers.js';
import { REALLY, MS } from '../really.js';
import { flyToAlerts, pulseAlerts } from '../alerts-bell.js';
// The question at the button in place of the browser's confirm(); "nothing here", "reading…"
// and "did not load" as the shared parts - the reason of a failed read is the popup in the corner.
import { ask } from '../ask.js';
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';
import { allow } from '../key-gate.js';
// The module has locals called `t` (transcripts, tips, timings): the words are T.t / T.tn / T.tc.
import * as T from '../i18n/t.js';

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
let _reg = null;          // the form's choices (/scriptgen/models: tones, line counts, the ladder), read once
let _pollT = null;        // the sources column's refresh while something is being added or transcribed
let _pollMs = 0;
let _tickT = null;        // the time left on the lines being added, every second between two reads
let _stopArmed = '';      // the source whose cross says "really?" - the next press stops it
// sourceId -> { kind: 'topics'|'transcribe', jobId, startedAt, rows, step, followed } - see _followSrcJob
const _srcJobs = new Map();
const _srcLast = new Map();  // sourceId -> { text, err } - what its last job said, when it failed
const _following = new Map();  // draftId -> { jobId, run, rows } - the stages this page follows
let _embedded = false;         // the form stands on the Scenarios shelf, not in this layout

// ── Markup ──────────────────────────────────────────────────────────────────
const HTML = `
  <aside class="mk-src" id="mk-src">
    <button class="mk-add u-btn is-s" id="mk-add" type="button" title="${T.t('Add a source - a long video, by a link or from a file')}">+</button>
    <div class="mk-src-list" id="mk-src-list"></div>
  </aside>
  <div class="mk-sash" id="mk-sash" title="${T.t('Drag to resize, double-click for the usual width')}"></div>
  <section class="mk-main">
    <div class="mk-said" id="mk-said" hidden></div>
    <div class="mk-view" id="mk-topics" hidden>
      <div class="mk-head">
        <input class="mk-title-in" id="mk-src-title" type="text" spellcheck="false"
               title="${T.t('The name of this source - click to rename')}" placeholder="${T.t('Untitled source')}">
        <span class="mk-note" id="mk-title-saved"></span>
        <span class="sp"></span>
        <button class="u-btn is-s" type="button" id="mk-mine">${T.t('Find topics')}</button>
        <button class="u-btn is-s is-icon is-quiet u-x" type="button" id="mk-src-off" title="${T.t('Let go of this source and write without one')}"></button>
      </div>
      <div class="mk-body">
        <div class="mk-summary" id="mk-summary"></div>
        <div class="mk-job" id="mk-topics-job" hidden></div>
        <div class="mk-topics" id="mk-topic-list"></div>
      </div>
    </div>
    <div class="mk-view" id="mk-form">
      <div class="mk-head">
        <button class="u-btn is-s" type="button" id="mk-to-topics" hidden title="${T.t('Back to this source\'s topics')}">${T.t('← topics')}</button>
        <span class="mk-col-title">${T.t('Generate script')}</span>
        <span class="mk-note" id="mk-from"></span>
        <span class="sp"></span>
        <button class="u-btn is-s is-danger" type="button" id="mk-discard" hidden>${T.t('Discard draft')}</button>
      </div>
      <div class="mk-body">
        <label class="mk-field"><span>${T.t('Topic')}</span>
          <input type="text" id="mk-topic" class="u-in" placeholder="${T.t('What the video is about')}"></label>
        <div class="mk-note-line" id="mk-nar-note" hidden></div>
        <div class="mk-step1">
        <div class="mk-box" id="mk-box1">
          <div class="mk-ctls" id="mk-controls"></div>
          <label class="mk-ctl" for="mk-hook-n"><span>${T.t('Hooks')}</span>
            <select id="mk-hook-n" class="u-in" title="${T.t('How many hooks to write - each of a type picked at random')}"></select></label>
          <span class="sp"></span>
          <span class="mk-ctl"><span>&nbsp;</span><span class="mk-btns">
            <button class="u-btn is-main" type="button" id="mk-go">${T.t('Write hooks')}</button>
            <button class="u-btn is-icon mk-ai" type="button" id="mk-ai" aria-label="${T.t('AI settings')}"></button>
          </span></span>
        </div>
        <!-- The hooks hang under box 1: once one is picked they fold into a bar glued to its bottom. -->
        <div class="mk-hookset" id="mk-hook-stage" hidden>
          <button class="mk-fold" type="button" id="mk-hooks-fold" hidden></button>
          <div class="mk-hooks" id="mk-hook-list"></div>
        </div>
        </div>
        <div class="mk-job" id="mk-job" hidden></div>
        <div class="mk-box mk-box2" id="mk-box2" hidden>
          <div class="mk-box-row">
            <label class="mk-ctl mk-ctl-hook" for="mk-hook"><span>${T.t('Hook')}</span>
              <textarea id="mk-hook" class="u-area" rows="1" spellcheck="false" placeholder="${T.t('Pick a hook above - or type one')}"></textarea></label>
            <label class="mk-ctl" for="mk-c-scenes"><span>${T.t('Lines')}</span><select id="mk-c-scenes" class="u-in"></select></label>
            <span class="mk-ctl"><span>&nbsp;</span>
              <button class="u-btn is-main" type="button" id="mk-write">${T.t('Write scenario')}</button></span>
          </div>
          <textarea class="mk-ad-t u-area" id="mk-ad" rows="2" spellcheck="false"
            placeholder="${T.t('Advertise - optional. What to advertise and what to say about it: worked into 2 paragraphs, natively; a call to buy or a link only if you write it here. Empty - no ad.')}"></textarea>
        </div>
        <div class="mk-stage" id="mk-save-stage" hidden>
          <div class="mk-stage-h">
            <span>${T.t('Save as a scenario')}</span>
            <span class="sp"></span>
            <button class="u-btn is-main" type="button" id="mk-save">${T.t('Save to Scenarios')}</button>
          </div>
          <div class="mk-save-row">
            <label class="mk-field"><span>${T.t('Title')}</span><input type="text" id="mk-title" class="u-in"></label>
            <label class="mk-field"><span>${T.t('Narrator gender')} <em>${T.t('- the store requires it')}</em></span>
              <select id="mk-gender" class="u-in"><option value="male">${T.t('Male')}</option><option value="female">${T.t('Female')}</option></select></label>
            <label class="mk-field"><span>${T.tc('scenario', 'Vertical')}</span><input type="text" id="mk-vertical" class="u-in" placeholder="${T.t('e.g. history')}"></label>
            <label class="mk-field"><span>${T.t('Product')}</span><input type="text" id="mk-product" class="u-in" placeholder="${T.t('what it sells, if anything')}"></label>
          </div>
          <div class="mk-stage-h">
            <span class="lib-status" id="mk-save-status"></span>
          </div>
        </div>
        <div class="mk-stage" id="mk-script-stage" hidden>
          <div class="mk-stage-h">
            <span>${T.t('Script')}</span>
            <span class="sp"></span>
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
  // Questions about a link left waiting before a reload are the add window's again.
  _loadAsks();
  // A row retried in Alerts - a source's way in going on again: its line says so at once, not at the next reload.
  window.addEventListener('ugc:alert-retried', () => { if (_built) _readSources().then(() => _paintSources()); });
  $('mk-mine').addEventListener('click', _mineTopics);
  $('mk-src-off').addEventListener('click', () => _chooseSource(null));
  // On the shelf the source's topics are the whole layout's: the page opens it on that source.
  $('mk-to-topics').addEventListener('click', () => {
    if (!_embedded) { if (_src) _showTopics(); return; }
    if (_gen && _gen.sourceId && _hooks.openSource) _hooks.openSource(_gen.sourceId);
  });
  $('mk-src-title').addEventListener('input', _queueRename);
  $('mk-src-title').addEventListener('blur', _saveTitle);
  $('mk-src-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mk-src-title').blur(); });

  $('mk-go').addEventListener('click', _runGo);
  // Box 2: the hook the script is written from - picked above, edited here - the number of
  // lines and "Write scenario".
  $('mk-write').addEventListener('click', _runScript);
  $('mk-hook').addEventListener('input', () => { _gen.hook = $('mk-hook').value; _markUsed(); _paintGo(); _queueDraft(); });
  $('mk-c-scenes').addEventListener('change', _queueDraft);
  $('mk-ai').innerHTML = GEAR_SVG;
  $('mk-ai').addEventListener('click', _toAiSettings);
  $('mk-hooks-fold').addEventListener('click', () => { _hooksOpen = !_hooksOpen; _paintFold(); });
  // How many hooks a press writes: kept in the draft, and as the last choice for the next new one.
  const nSel = $('mk-hook-n');
  for (let n = HT.HOOK_COUNT.min; n <= HT.HOOK_COUNT.max; n++) {
    const opt = el('option', '', T.tn(n, '{n} hook', '{n} hooks'));
    opt.value = String(n);
    nSel.appendChild(opt);
  }
  nSel.value = String(_lastCount());
  nSel.addEventListener('change', () => {
    try { localStorage.setItem(_COUNT_KEY, nSel.value); } catch (e) { /* remembered for this draft only */ }
    _queueDraft();
  });
  // The hook type's description follows the pointer; a scroll or a new set of rows takes it away.
  document.addEventListener('scroll', _hideTip, true);
  $('mk-save').addEventListener('click', _saveScript);
  $('mk-discard').addEventListener('click', _discardDraft);
  for (const id of ['mk-topic', 'mk-title', 'mk-vertical', 'mk-product', 'mk-ad']) $(id).addEventListener('input', _queueDraft);
  $('mk-gender').addEventListener('change', _queueDraft);

  // The narrators window says when a narrator was made, deleted or read again (js/library/narrators.js);
  // the form's list of them is rebuilt, keeping the choice while it still exists.
  document.addEventListener('lib:narrators', () => { if (_gen) _paintNarrators(); });
  // A vertical or product removed on the Scenarios shelf leaves this form too, hidden or not:
  // the server cleared the drafts' copies, and a stage landing later would save the form's copy back.
  document.addEventListener('lib:values-removed', (e) => {
    const { field, value } = (e && e.detail) || {};
    if (field !== 'vertical' && field !== 'product') return;
    const inp = $('mk-' + field);
    if (inp && inp.value.trim().toLowerCase() === String(value || '').trim().toLowerCase()) inp.value = '';
  });
  // Closing the page is leaving the form: a save still waiting out its pause goes now.
  window.addEventListener('pagehide', () => { if (_saveT && _gen) _saveDraft({ keepalive: true }); });
  // The "rewrite fragment" button stands by its selection: a scroll moves the words away from it.
  window.addEventListener('scroll', () => { if (_frag) _hideFragBtn(); }, true);
}

// ── Opening and leaving ─────────────────────────────────────────────────────
/** The page's hooks: status(text, kind), counts(), openScenario(id) - "Saved · open", narrators() - the gear. */
export function init(hooks) { _hooks = hooks || {}; }

/**
 * Show the layout. `draftId` continues that draft; without one it is what the button says - a NEW
 * scenario, the form without a source. What was open is saved first, and a stage it runs goes on:
 * its draft heads the Scenarios list as "draft · writing…", one press away.
 */
export async function open(opts) {
  _build();
  mount(null);                                    // the form back in this layout
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
 * A source by its id - an Alerts row leads here (?shelf=scenarios&make=1&src=): its topics when it is a
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

/**
 * Where the form stands: `host` - the Scenarios shelf's right side - or, with null, this layout. One node moved,
 * so a stage it follows, a pause before a save and what is typed go with it.
 */
export function mount(host) {
  _build();
  const f = $('mk-form');
  const home = document.querySelector('#lib-make .mk-main');
  const to = host || home;
  if (to && f.parentElement !== to) to.appendChild(f);
  _embedded = !!host;
  if (_embedded) { _hideFragBtn(); f.hidden = false; }
}

/** A draft in the form on the shelf - read as it is now. False when it could not be opened. */
export async function openDraft(id) {
  _build();
  await _flushDraft();
  await _readDrafts();
  return _resumeDraft(id);
}

/** The draft the form on the shelf shows - '' when the form is not there. */
export const embeddedDraft = () => (_embedded && _gen && _gen.draftId ? String(_gen.draftId) : '');
/** The draft the form holds, wherever it stands - the page selects it on the way back from the layout. */
export const currentDraft = () => (_gen && _gen.draftId ? String(_gen.draftId) : '');

/** Leave the layout: what is typed is saved; what runs keeps running. */
export async function close() {
  _say('');
  _hideFragBtn();
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

const _leftSays = (ms) => T.t('~{time} left', { time: J.clock(Math.max(0, Math.ceil(ms / 1000))) });
function _tickLeft() {
  document.querySelectorAll('#mk-src-list [data-end]').forEach((n) => { n.textContent = _leftSays(+n.dataset.end - Date.now()); });
}
// A place in the line said as the language says it: 1st, 2nd, 3rd - or 1-й, 2-й.
const _ordinal = (n) => (T.lang() === 'ru' ? n + '-й'
  : n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'));
const STEP_WORD = { download: T.t('downloading'), copy: T.t('copying'), process: T.t('transcribing'), topics: T.t('finding topics') };
// A line that is a source to write from: not one being added, not one waiting for a decision.
const _offer = (it) => it.state === 'nospeech' || it.state === 'notopics';
const _choosable = (it) => !!it && !it.progress && !_offer(it);

function _stateLine(it) {
  const t = it.transcript || {};
  const way = it.intake || null;
  // Its video stays on the disk and is not there any more.
  if (it.disk && it.disk.missing) return T.t('the file is not where it was');
  if (it.state === 'nospeech') return T.t('no speech - not a source');
  if (it.state === 'notopics') return T.t('no topics - not a source');
  if (it.state === 'error') {
    const cut = /interrupted/i.test(it.error || '');
    // Its way in is an Alerts row: "retry" is there.
    if (way && way.alertId) return cut ? T.t('interrupted - retry in Alerts') : T.t('failed - retry in Alerts');
    return cut ? T.t('interrupted') : T.t('failed');
  }
  if (it.state === 'downloading' || it.state === 'waiting') return T.t('downloading…');
  if (_reading(it)) return T.t('transcribing…');
  if (t.state !== 'ready') return T.t('no transcript');
  const run = _srcJobs.get(String(it.id));
  if (run && run.kind === 'topics') return T.t('finding topics…');
  if (!it.topics && way && (way.interrupted || way.error)) return T.t('no topics yet - retry in Alerts');
  return it.topics ? T.tn(it.topics, '{k} of {n} topic used', '{k} of {n} topics used', { k: it.topicsUsed || 0 }) : T.t('no topics yet');
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
    box.appendChild(emptyEl(T.t('No sources yet. A long video, added with +, becomes material to write from.')));
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
    row.title = it.title + '\n' + (p.words || '') + '\n' + T.t('It is being added - follow it in Alerts');
  }
}

// A LINE: a mark, the name, what it is at, its length and drafts, a cross at the top right. One being
// added has its share done and the time left, and is not pressed - its cross stops it, twice ("really?"). One with
// nothing to write from offers to go onto Uploads.
function _srcLine(it) {
  const id = String(it.id);
  const p = it.progress || null;
  const offer = _offer(it);
  const cur = !!(_src && String(_src.id) === id);
  const row = el('div', 'mk-srow' + (cur ? ' cur' : '') + (p ? ' adding' : '') + (offer ? ' offer' : ''));
  row.dataset.id = id;
  row.title = it.title + (cur ? '\n' + T.t('Press again to write without a source') : '');
  row.appendChild(el('span', 'mk-srow-k', '▶'));
  const main = el('div', 'mk-srow-main');
  main.appendChild(el('div', 'mk-srow-t', it.title));
  const sub = el('div', 'mk-srow-s');
  if (p) {
    sub.appendChild(el('span', 'mk-srow-pct', Math.round(p.pct * 100) + '%'));
    const left = el('span', null, _leftSays(p.leftMs));
    left.dataset.end = String(Date.now() + p.leftMs);
    sub.appendChild(left);
    sub.appendChild(el('span', null, p.step === 'wait' ? (p.place ? T.t('{nth} in the queue', { nth: _ordinal(p.place) }) : T.t('waiting')) : (STEP_WORD[p.step] || p.step)));
    row.title = it.title + '\n' + (p.words || '') + '\n' + T.t('It is being added - follow it in Alerts');
  } else {
    sub.appendChild(el('span', null, _stateLine(it)));
    if (it.seconds) sub.appendChild(el('span', null, J.clock(it.seconds)));
    const nd = _drafts.filter(d => String(d.sourceId) === id).length;
    if (nd) sub.appendChild(el('span', 'mk-src-draft', T.tn(nd, '{n} draft', '{n} drafts')));
  }
  main.appendChild(sub);
  if (p) {
    const bar = el('div', 'mk-srow-bar');
    const fill = el('i');
    fill.style.width = (p.pct * 100).toFixed(1) + '%';
    bar.appendChild(fill);
    main.appendChild(bar);
  }
  // Its video stays on the disk and is not where it was: point at it again (the same file - its
  // words stay its own), or delete the source, with its transcripts or keeping them for the same file added again.
  if (it.disk && it.disk.missing && !p) {
    row.classList.add('offer');
    const where = el('div', 'mk-srow-s mk-srow-missing', it.disk.path);
    where.style.color = 'var(--danger)';
    main.appendChild(where);
    const acts = el('div', 'mk-srow-acts');
    const re = el('button', 'u-btn is-s', T.t('Point at the file…'));
    re.type = 'button';
    re.title = T.t('The video was moved or renamed: show where it is now - the same file, its words are kept');
    re.addEventListener('click', (e) => { e.stopPropagation(); _relinkSource(it); });
    const del = el('button', 'u-btn is-s', T.t('Delete…'));
    del.type = 'button';
    del.title = T.t('Delete this source - your files on the disk are not touched');
    del.addEventListener('click', (e) => { e.stopPropagation(); _deleteMissing(it); });
    acts.append(re, del);
    main.appendChild(acts);
  }
  if (offer) {
    const acts = el('div', 'mk-srow-acts');
    const up = el('button', 'u-btn is-s', T.t('Put on Uploads'));
    up.type = 'button';
    up.title = T.t('The video goes onto Uploads in Media, and is not kept as a source');
    up.addEventListener('click', (e) => { e.stopPropagation(); _sourceToUploads(it, up); });
    acts.appendChild(up);
    main.appendChild(acts);
  }
  row.appendChild(main);
  // the shared cross on the row; armed - "Really?" in the part's red fill
  const x = el('button', 'mk-x u-onpic is-del' + (p && _stopArmed === id ? ' is-armed' : ' u-x'), p && _stopArmed === id ? REALLY : '');
  x.type = 'button';
  if (p) {
    x.title = p.step === 'topics'
      ? T.t('Stop finding its topics - its words stay, and "Find topics" finds them later')
      : T.t('Stop adding it - it is removed, with what was downloaded');
    x.addEventListener('click', (e) => { e.stopPropagation(); _stopAdding(it); });
  } else {
    x.title = offer ? T.t('Delete it, and its file') : T.t('Delete this source, its video and its transcript');
    x.addEventListener('click', (e) => { e.stopPropagation(); _deleteSource(it, x); });
  }
  row.appendChild(x);
  if (_choosable(it)) {
    row.addEventListener('click', () => _chooseSource(it));
    // Its own menu - never Electron's.
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
    setTimeout(() => { if (_stopArmed === id) { _stopArmed = ''; _paintSources(); } }, MS);
    return;
  }
  _stopArmed = '';
  try { await J.api('/api/sources/' + encodeURIComponent(id) + '/stop', { method: 'POST' }); }
  catch (e) { _say(e.message, 'err'); }
  // The server lets go of the work first - a download killed, a call dropped - and only then of the source.
  setTimeout(async () => { await _readSources(); _paintSources(); }, 1200);
}

// Nothing to write from: onto Uploads in Media, and the line goes.
async function _sourceToUploads(it, btn) {
  if (btn) btn.disabled = true;
  try {
    await J.api('/api/sources/' + encodeURIComponent(it.id) + '/to-uploads', { method: 'POST' });
    _say(T.t('"{name}" is on Uploads in Media.', { name: it.title }), 'ok');
  } catch (e) { _say(e.message, 'err'); if (btn) btn.disabled = false; }
  await _readSources();
  _paintSources();
}

// ── The sash between the column and the generator ──
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

// The video of a source that stays on the disk, pointed at again: the app's window hands the file's path over,
// the server checks it is the same video (its print).
function _relinkSource(it) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'video/*';
  inp.addEventListener('change', async () => {
    const file = inp.files && inp.files[0];
    const pathOf = window.ugcWindow && window.ugcWindow.pathOf;
    let where = '';
    try { where = file && typeof pathOf === 'function' ? String(pathOf(file) || '') : ''; } catch (e) { where = ''; }
    if (!where) { _say(T.t('Pointing at a file works in the app\'s own window - it hands the file over.'), 'err'); return; }
    try {
      await J.api('/api/sources/' + encodeURIComponent(it.id) + '/relink', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: where }) });
      _say(T.t('"{name}" - its video is found again.', { name: it.title }), 'ok');
    } catch (e) { _say(e.message, 'err'); }
    await _readSources();
    _paintSources();
  });
  inp.click();
}

// A source whose video is gone from the disk: deleted - with its transcripts (the box ticked), or keeping them (the box
// not ticked) for the same file added again, which then is not heard twice.
// The shared question IN THE MIDDLE over the dimmed page (the update's and the
// speech model's - `.dr-back` + `.u-ask`): the question, what goes, the tick inside, "Cancel" left and the red "Delete" right.
function _deleteMissing(it) {
  const back = el('div', 'dr-back');
  const box = el('div', 'nm-box dr-box u-ask is-float mk-delq');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.appendChild(el('b', 'nm-t', T.t('Delete "{name}"?', { name: it.title })));
  box.appendChild(el('p', 'mk-delq-p', T.t('Its video is not where it was ({path}). The source and its poster go; your files on the disk are not touched.', { path: (it.disk && it.disk.path) || '' })));
  const lab = el('label', 'mk-delq-tick');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.classList.add('u-check');
  lab.append(cb, el('span', null, T.t('and its transcripts - not ticked, they are kept, and the same video added again is not heard a second time')));
  box.appendChild(lab);
  const row = el('div', 'nm-r u-ask-r');
  const cancel = el('button', 'u-btn is-s', T.t('Cancel'));
  cancel.type = 'button';
  const go = el('button', 'u-btn is-s is-danger is-armed', T.t('Delete'));
  go.type = 'button';
  row.append(cancel, go);
  box.appendChild(row);
  document.body.append(back, box);
  const close = () => { back.remove(); box.remove(); Layers.close(layer); };
  const layer = Layers.open(box, { name: 'delete-source', onEsc: close });
  cancel.addEventListener('click', close);
  back.addEventListener('mousedown', close);
  go.addEventListener('click', async () => {
    go.disabled = true;
    await _flushDraft();
    try {
      await J.api('/api/sources/' + encodeURIComponent(it.id) + (cb.checked ? '' : '?keepWords=1'), { method: 'DELETE' });
      const was = _src && String(_src.id) === String(it.id);
      if (was) _src = null;
      if (_gen && String(_gen.sourceId) === String(it.id)) _detachGen();
      _srcLast.delete(String(it.id));
      close();
      await Promise.all([_readSources(), _readDrafts()]);
      _paintSources();
      if (was && _view === 'topics') await _enterScript({});
    } catch (e) { go.disabled = false; _say(e.message, 'err'); }
  });
}

async function _deleteSource(it, anchor) {
  const nd = _drafts.filter(d => String(d.sourceId) === String(it.id)).length;
  // A video that stays on the disk is never deleted by the app - only what the library holds goes.
  const lines = [T.t('Delete "{name}"?', { name: it.title }), '',
    it.disk ? T.t('Its poster and its transcript are removed. Your video stays where it is on the disk ({path}).', { path: it.disk.path })
      : T.t('The video ({size}), its poster and its transcript are removed from disk.', { size: J.mb(it.bytes || 0) })];
  if (nd) lines.push('', T.tn(nd, 'Its {n} draft is kept, and carries on without a source.', 'Its {n} drafts are kept, and carry on without a source.'));
  // `stay`: the column repaints as its sources move along, and a repaint's scroll must not answer "no" for the person.
  if (!await ask(anchor, lines.join('\n'), { yes: T.t('Delete'), danger: true, stay: true })) return;
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
  $('mk-mine').textContent = has ? T.t('Find topics again') : T.t('Find topics');
  $('mk-mine').disabled = !ready || _srcJobs.has(String(rec.id));
  $('mk-summary').textContent = rec.videoSummary || '';
  _paintTopics(rec);
  _reattachSrcJob(rec);
}

function _paintTopics(rec) {
  const box = $('mk-topic-list');
  box.textContent = '';
  const t = rec.transcript || {};
  // No topics to show - the shared part, in the source's own words.
  if (_reading(rec)) {
    box.appendChild(emptyEl(T.t('Still being read. The topics can be found the moment the words are in.')));
    return;
  }
  if (t.state !== 'ready') {
    // An ingest killed by a server restart, or one that failed: its file is here, so it can be read
    // again. Paid - it is the same speech-to-text call. Its button inside the part, under the words.
    const offer = rec.videoPath && !_srcJobs.has(String(rec.id));
    const why = rec.error || T.t('unknown reason');
    const e = emptyEl(rec.state === 'error'
      ? (rec.intake && rec.intake.alertId ? T.t('This source failed: {why} - its row in Alerts has "retry".', { why }) : T.t('This source failed: {why}', { why }))
      : T.t('No transcript yet.'), offer ? { action: { label: T.t('Transcribe again'), on: (ev) => _transcribeAgain(rec, ev.currentTarget) } } : {});
    const again = offer ? e.querySelector('button') : null;
    if (again) again.title = T.t('Read the words out of this source again - a paid transcription');
    box.appendChild(e);
    return;
  }
  const topics = rec.topics || [];
  if (!topics.length) {
    box.appendChild(emptyEl(T.t('No topics found yet. Press “Find topics” above - one long video usually holds several.')));
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
      const tag = el('span', 'mk-tag ready', used.length === 1 ? T.t('Written') : T.t('Written ×{n}', { n: used.length }));
      tag.title = used.map(u => u.title).join('\n');
      h.appendChild(tag);
    }
    const draft = _draftFor(rec.id, tp.id);
    // The stage is the server's English label (lib/script-drafts.js, _noteDraft below), said in the app's language.
    if (draft) h.appendChild(el('span', 'mk-tag wait', draft.running ? T.t('Draft · writing…') : T.t('Draft · {stage}', { stage: draft.stageLabel ? T.t(draft.stageLabel) : '' })));
    card.appendChild(h);
    card.appendChild(el('p', 'mk-topic-s', tp.summary));
    const f = el('div', 'mk-topic-f');
    const chars = String(tp.text || '').length;
    f.appendChild(el('span', 'mk-topic-name', `${tp.projectName || ''} · ` + T.tn(chars, '{n} char of transcript', '{n} chars of transcript')));
    f.appendChild(el('span', 'sp'));
    const write = el('button', 'u-btn is-main', draft ? T.t('Continue the draft') : T.t('Write a script'));
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

// ONE RENAME, wherever it is typed - the topics header or the source window - and
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
      $('mk-title-saved').textContent = T.t('saved');
      setTimeout(() => { if ($('mk-title-saved')) $('mk-title-saved').textContent = ''; }, 1600);
    }
  } catch (e) { if (_src && String(_src.id) === id) $('mk-title-saved').textContent = e.message; }
}

// ── A source's menu and its window ──────────────────────────────────────────
// Right-click on a card: "change name" and "play", both into the same window - the video on the
// left, the name on the right. "play" starts the video; "change name" puts the caret in the name
// and leaves the video still.
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
  const m = el('div', 'mv3-plus-menu u-menu is-float');
  const item = (label, sub, on, off) => {
    const b = el('button', 'mv3-plus-item u-mi');
    b.type = 'button';
    b.appendChild(el('span', null, label));
    if (sub) b.appendChild(el('small', null, sub));
    b.disabled = !!off;
    b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); on(); });
    m.appendChild(b);
  };
  item(T.t('change name'), T.t('what this source is called everywhere'), () => _openSourceWin(it, false));
  item(T.t('play'), it.media ? T.t('watch it') : T.t('no file to play - it never downloaded'), () => _openSourceWin(it, true), !it.media);
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
    <div class="mk-panel src-panel u-win is-float" role="dialog" aria-modal="true" aria-label="${T.t('Source')}">
      <div class="mk-panel-head u-win-head">
        <span class="mk-panel-t u-win-title" data-f="head"></span>
        <span class="sp"></span>
        <button class="u-btn is-icon is-quiet u-x" type="button" data-x="close" title="${T.t('Close (Esc)')}"></button>
      </div>
      <div class="src-body">
        <div class="src-stage" data-f="stage"></div>
        <aside class="src-side">
          <label class="mk-field"><span>${T.tc('source', 'Name')}</span><input type="text" class="u-in" data-f="name" maxlength="200" spellcheck="false"></label>
          <div class="src-save">
            <button class="u-btn is-main" type="button" data-f="save">${T.t('Save name')}</button>
            <span class="u-status" data-f="st"></span>
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
  if (!it.media) stage.appendChild(el('div', 'src-none', T.t('There is no file for this source - it never downloaded.')));
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
      stage.appendChild(el('div', 'src-none', T.t('This file cannot be played here - its format is not one the window knows.')));
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
  fact(T.t('length'), it.seconds ? J.clock(it.seconds) : '');
  fact(T.t('size'), it.bytes ? J.mb(it.bytes) : '');
  fact(T.t('added'), J.fmtDate(it.addedAt));
  fact(T.t('from'), it.kind === 'youtube' ? (it.url || T.t('a link')) : T.t('a file'));
  fact(T.t('transcript'), t.state === 'ready'
    // "characters" of text - the plain "{n} characters" is the Library's count of people.
    ? ((t.chars || 0) >= 1000 ? T.t('{n}k characters', { n: Math.round(t.chars / 1000) }) : T.tc('text', '{n} characters', { n: t.chars || 0 })) : _stateLine(it));
  fact(T.t('topics'), it.topics ? T.t('{k} of {n} used', { k: it.topicsUsed || 0, n: it.topics }) : '');

  const name = q('name');
  name.value = it.title;
  const doSave = async () => {
    const title = name.value.trim();
    const st = q('st');
    if (!title) { st.textContent = T.t('A name is needed.'); st.className = 'u-status err'; return; }
    if (title === it.title) { st.textContent = T.t('unchanged'); st.className = 'u-status'; return; }
    q('save').disabled = true;
    try {
      const saved = await _renameSource(id, title);
      it = { ...it, title: saved };
      if (_srcWin && _srcWin.ov === ov) {
        q('head').textContent = saved;
        st.textContent = T.t('saved');
        st.className = 'u-status ok';
      }
    } catch (e) {
      if (_srcWin && _srcWin.ov === ov) { st.textContent = e.message; st.className = 'u-status err'; }
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
      label: chars ? T.t('Reading {n}k of transcript…', { n: Math.round(chars / 1000) }) : T.t('Finding topics…') };
  }
  return { key: 'l2-ingest|again', label: T.t('Transcribing again…'), estimateMs: J.EST.ingestLink };
}

// The countdown for the source on screen: its job's row, or its last word, or nothing.
function _reattachSrcJob(rec) {
  const id = String(rec.id);
  const host = $('mk-topics-job');
  const adding = (_sources.find(s => String(s.id) === id) || {}).progress;
  if (adding) { J.sayJob(host, T.t('{words} · {pct}% - follow it in Alerts', { words: adding.words, pct: Math.round(adding.pct * 100) })); return; }
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
  // Paid - a plain answer; the question waits, so a job picked up meanwhile is not started twice.
  if ((rec.topics || []).length && !await ask($('mk-mine'), T.t('Find the topics of this source again?\n\nIt is a paid read of the transcript. The new topics replace these; a "written" mark and a draft stay with a topic only if it comes back the same.'), { yes: T.t('Find again'), stay: true })) return;
  if (_srcJobs.has(id)) return;
  $('mk-mine').disabled = true;
  let run = null;
  try {
    // By the agents' ladder (Admin -> AI settings), as every agent - no model is sent.
    const d = await J.api(`/api/sources/${encodeURIComponent(id)}/topics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    // Its way in was cut off: the server retried its Alerts row - the work is that row's.
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

async function _transcribeAgain(rec, anchor) {
  const id = String(rec.id);
  if (_srcJobs.has(id)) return;
  if (!await ask(anchor, T.t('Transcribe "{name}" again?\n\nIt is a paid speech-to-text read of the whole file.', { name: rec.title }), { yes: T.t('Transcribe'), stay: true })) return;
  if (_srcJobs.has(id)) return;
  try {
    // When it has no topics yet, they are found after the words - by the agents' ladder.
    const d = await J.api(`/api/sources/${encodeURIComponent(id)}/transcribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
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
  _say(T.t('It goes on from where it stopped - follow it in Alerts.'));
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
    ? T.t('from “{name}”', { name: _gen.sourceTitle }) + (_gen.topicSpan ? ' · ' + _gen.topicSpan : '')
    : T.t('without a source');
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

// The narrators open from their field (a gear to the right of "Narrator") - the
// narrators AREA, in place of the generator, with "← Generate script" back to it as it was.
const GEAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
function _narratorsGear() {
  const b = el('button', 'mk-gear u-btn is-icon is-quiet');
  b.type = 'button';
  b.id = 'mk-narrators';
  b.title = T.t('The narrators - how a script is written');
  b.setAttribute('aria-label', T.t('Narrators'));
  b.innerHTML = GEAR_SVG;
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (_hooks.narrators) _hooks.narrators(); });
  return b;
}

function _select(id, values, current) {
  const s = el('select', 'u-in');
  s.id = id;
  for (const v of values) {
    const o = el('option', null, typeof v === 'string' ? v : v.label);
    o.value = typeof v === 'string' ? v : v.value;
    if (v && v.name != null) o.dataset.name = v.name;
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
  // No Language: every script is written in English.
  // Box 1 holds Tone,
  // Narrator and the hook count (static, beside these); the number of lines is box 2's list, filled here once the limits
  // are read.
  box.appendChild(_ctl(T.t('Tone'), _select('mk-c-tone', _reg.tones, s.tone || d.tone)));
  const nar = _select('mk-c-narrator', [NEUTRAL], 'neutral');
  box.appendChild(_ctl(T.t('Narrator'), nar, _narratorsGear()));
  const sc = $('mk-c-scenes');
  sc.textContent = '';
  for (let n = _reg.scenes.min; n <= _reg.scenes.max; n++) {
    const o = el('option', null, T.tn(n, '{n} line', '{n} lines'));
    o.value = String(n);
    sc.appendChild(o);
  }
  sc.value = String(Math.min(_reg.scenes.max, Math.max(_reg.scenes.min, parseInt(s.scenes, 10) || _reg.scenes.default)));
  sc.title = T.t('How many lines the script has, the hook the first; the scenarios store needs at least {n}', { n: _reg.minLines });
  // No model chosen: the AGENTS' LADDER writes, at effort medium - the gear says which step is asked first.
  $('mk-ai').title = _aiTitle();
  for (const n of box.querySelectorAll('select,input')) n.addEventListener('change', _queueDraft);
  // A narrator has ONE voice: no reading to pin; a draft that names one is simply the narrator's.
  await _paintNarrators(s.narratorId || 'neutral', s.narratorName);
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
  const values = [NEUTRAL];
  for (const n of list) values.push({ value: n.id, label: n.ready ? n.name : T.t('{name} - not read', { name: n.name }), name: n.name });
  let pick = String(cur || 'neutral').split('#')[0];
  const note = $('mk-nar-note');
  note.hidden = true;
  if (!values.some(v => v.value === pick) && pick !== 'neutral') {
    const name = wantName || _narName(sel.selectedOptions[0]) || T.t('the narrator');
    values.push({ value: pick, label: T.t('{name} - deleted', { name }), name });
    note.hidden = false;
    note.textContent = T.t('{name}, the narrator this was written with, has been deleted. Pick another - written as it is, the server refuses a narrator it does not have.', { name });
  }
  sel.textContent = '';
  for (const v of values) { const o = el('option', null, v.label); o.value = v.value; if (v.name != null) o.dataset.name = v.name; sel.appendChild(o); }
  sel.value = pick;
}

// Neutral is the generator's own voice. An option keeps the narrator's NAME apart from its label ("Azazin - not read",
// in the app's language): the name is what a draft remembers the narrator by.
const NEUTRAL = { value: 'neutral', label: T.t('Neutral'), name: 'Neutral' };
const _narName = (o) => (!o ? '' : o.dataset.name != null ? o.dataset.name : o.textContent.replace(/ - (?:not read|deleted)$/, ''));

// The gear right of "Write hooks" (there is no model to choose): Admin -> AI settings, where the agents' ladder that
// writes is ordered. The way there saves the draft first and carries the way back: AI settings shows "← back" to this
// generator, on this draft.
function _aiTitle() {
  const first = (_reg && _reg.ladder && _reg.ladder[0]) || null;
  const effort = (_reg && _reg.effort) || 'medium';
  return first
    ? T.t('AI settings - the agents\' ladder writes, {model} asked first; the next step only when one refuses or is down. Every stage here at effort {effort}.', { model: first.model, effort })
    : T.t('AI settings - the agents\' ladder writes; the next step only when one refuses or is down. Every stage here at effort {effort}.', { effort });
}
async function _toAiSettings() {
  if (_gen) { try { await _saveDraft(); } catch (x) { /* the way there is not held up by a save */ } }
  const back = '/library?shelf=scenarios&make=1' + (_gen && _gen.draftId ? '&draft=' + encodeURIComponent(_gen.draftId) : '');
  location.href = '/admin?back=' + encodeURIComponent(back) + '#ai';
}

const _controlsReady = () => !!$('mk-c-tone');

function _opts() {
  if (!_controlsReady()) return {};
  const nar = $('mk-c-narrator');
  const narratorId = String(nar.value).split('#')[0];
  return {
    scenes: parseInt($('mk-c-scenes').value, 10),
    tone: $('mk-c-tone').value,
    narratorId,
    // The name alone, not the option's label ("Azazin — not read"): it is what the draft remembers
    // the narrator by once the narrator itself may be gone.
    narratorName: _narName(nar.selectedOptions[0]),
    // What to advertise in two paragraphs - empty, no ad.
    advertise: $('mk-ad') ? $('mk-ad').value.trim() : '',
    // How many hooks a press writes.
    hookCount: HT.hookCount($('mk-hook-n') && $('mk-hook-n').value),
    // Not sent as a choice - the ladder's first step and the effort, for the countdown's key only.
    model: (_reg && _reg.ladder && _reg.ladder[0] && _reg.ladder[0].model) || '',
    effort: (_reg && _reg.effort) || 'medium',
  };
}

// Sent with every generation, so the server can write the answer into the draft (the keeper).
const _draftKey = () => (_gen ? { draftId: _gen.draftId || '', sourceId: _gen.sourceId, topicId: _gen.topicId } : {});

// TWO buttons: the hooks' in box 1 - "Write hooks",
// "Write again" once a batch is there - and the script's in box 2 - "Write scenario", "Write again" once it is
// written. Box 2 shows once a hook
// is chosen; a draft opened with a hook, a script or an ad shows it at once.
function _paintGo() {
  if (!_built) return;
  const written = !!(_gen && _gen.paragraphs && _gen.paragraphs.length);
  const hooks = !!(_gen && (_gen.hooks || []).length);
  const busy = _busy();
  const go = $('mk-go');
  go.textContent = _stage === 'hooks' ? T.t('Writing hooks…') : hooks ? T.t('Write again') : T.t('Write hooks');
  go.disabled = busy;
  go.classList.toggle('primary', !hooks);
  go.classList.toggle('is-main', !hooks);
  const wr = $('mk-write');
  // On two lines, in a taller button: "Write / scenario".
  wr.textContent = _stage === 'script' ? T.t('Writing\nthe script…') : written ? T.t('Write\nagain') : T.t('Write\nscenario');
  wr.disabled = busy || !String((_gen && _gen.hook) || '').trim();
  // Blue while there is no script - and again when box 2 holds another hook than the script's first line.
  const other = written && String((_gen && _gen.hook) || '').trim() !== String(_gen.paragraphs[0] || '').trim();
  wr.classList.toggle('primary', !written || other);
  wr.classList.toggle('is-main', !written || other);
  $('mk-box2').hidden = !(_gen && _gen.box2);
  $('mk-hook').readOnly = busy;
  $('mk-hook-stage').hidden = !hooks && _stage !== 'hooks';
  _paintFold();
  $('mk-save-stage').hidden = !written;
  $('mk-script-stage').hidden = !written;
  // Only a stage that RUNS locks the script. Hooks waiting to be picked do not: a person who
  // likes none of them keeps the script they have, and saves it.
  $('mk-save').disabled = busy;
  $('mk-discard').hidden = !(_gen && _gen.draftId);
  document.querySelectorAll('#mk-scenes .mk-scene-rw, #mk-hook-list .mk-hook-use').forEach(b => { b.disabled = busy; });
  // "remake" only for a hook whose type is one of the forty.
  document.querySelectorAll('#mk-hook-list .mk-hook-remake').forEach(b => { b.disabled = busy || !b.dataset.type; });
  $('mk-hook-n').disabled = busy;
  if (busy) _hideFragBtn();
}

// Once a hook is picked - or a script is written - the whole batch of hooks folds up into one bar, as wide as the
// fields, glued under box 1, "▸ 7 hooks"; a press opens them under it and box 2 moves down; a pick folds them again, new
// hooks come
// open. Before any pick they are open, with no bar.
let _hooksOpen = false;
function _paintFold() {
  const n = ((_gen && _gen.hooks) || []).length;
  const written = !!(_gen && (_gen.paragraphs || []).length);
  const foldable = !!n && (written || !!(_gen && _gen.box2)) && _stage !== 'hooks';
  const open = !foldable || _hooksOpen;
  const f = $('mk-hooks-fold');
  f.hidden = !foldable;
  f.textContent = (open ? '▾ ' : '▸ ') + T.tn(n, '{n} hook', '{n} hooks');
  f.title = open ? T.t('Fold the hooks away') : T.t('Show the hooks - pick another');
  $('mk-hook-list').hidden = !open;
  $('mk-box1').classList.toggle('glued', foldable);
}

// The row whose words are the hook in box 2 is gold - whichever way the two came to match.
function _markUsed() {
  const h = String((_gen && _gen.hook) || '').trim();
  document.querySelectorAll('#mk-hook-list .mk-hook').forEach((r) => {
    const t = r.querySelector('.mk-hook-t');
    r.classList.toggle('used', !!h && !!t && t.value.trim() === h);
  });
}

// Five unless chosen otherwise; the last choice is what a new draft starts with.
const _COUNT_KEY = 'ugc.make.hookCount';
function _lastCount() {
  try { return HT.hookCount(localStorage.getItem(_COUNT_KEY)); } catch (e) { return HT.HOOK_COUNT.default; }
}
function _setStage(s) { _stage = s; _paintGo(); }
const _busy = () => _stage === 'hooks' || _stage === 'script' || _stage === 'working';
// Hooks on show wait to be used - else the form is idle.
const _pickOrIdle = () => ($('mk-hook-list').querySelector('.mk-hook') ? 'pick' : 'idle');

function _clearForm() {
  $('mk-hook-list').textContent = '';
  $('mk-hook').value = '';
  $('mk-scenes').textContent = '';
  $('mk-save-status').textContent = '';
  $('mk-save-status').className = 'lib-status';
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
    hook: _gen.hook || '',
    hookType: _gen.hookType || '',
    hooks: _gen.hooks || [],
    paragraphs: _gen.paragraphs || [],
    title: $('mk-title').value,
    settings: {
      tone: o.tone, scenes: o.scenes,
      narratorId: o.narratorId, narratorName: o.narratorName, advertise: o.advertise, hookCount: o.hookCount,
    },
    save: { gender: $('mk-gender').value, vertical: $('mk-vertical').value, product: $('mk-product').value },
  };
}

async function _saveDraft(o) {
  clearTimeout(_saveT);
  _saveT = null;
  if (!_gen) return;
  // A form with nothing in it is not a draft yet: turning a dropdown on a blank form would make an empty
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
  return !!(($('mk-topic') && $('mk-topic').value.trim()) || (_gen && _gen.hook)
    || ($('mk-title') && $('mk-title').value.trim()) || (_gen && ((_gen.hooks || []).length || (_gen.paragraphs || []).length)));
}

// The drafts list kept as the server has it after a save, so a topic card painted next says "draft"
// and a stage's reattach finds it - the list is otherwise read only now and then.
function _noteDraft(dr) {
  if (!dr) return;
  // "hooks written" before "hook chosen" - lib/script-drafts.js stageOf says the same.
  const stage = (dr.paragraphs || []).length ? 'script written' : dr.hook ? 'hook chosen' : (dr.hooks || []).length ? 'hooks written' : 'topic only';
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
  if (!await ask($('mk-discard'), T.t('Discard this draft? What was generated into it is lost.'), { yes: T.t('Discard'), danger: true, stay: true })) return;
  if (!_gen || !_gen.draftId) return;
  // A save still waiting would land after the delete and bring the draft back.
  clearTimeout(_saveT);
  _saveT = null;
  try {
    await J.api('/api/scriptgen/drafts/' + encodeURIComponent(_gen.draftId), { method: 'DELETE' });
    _gen = null;
    // On the shelf the list is read again, and its first scenario is on the right.
    if (_embedded) { if (_hooks.discarded) await _hooks.discarded(); return; }
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
    // The hook the script is written from: one of the hooks, used (and maybe edited) - there is no field of one's own.
    hook: (full && full.hook) || '',
    // Its type - the script is carried the way that opening works.
    hookType: (full && full.hookType) || '',
    paragraphs: (full && full.paragraphs) || [],
  };
  _paintFrom();
  $('mk-topic').value = full ? (full.topic || full.topicTitle || '') : (topic ? topic.title : '');
  $('mk-title').value = (full && full.title) || '';
  $('mk-gender').value = saved.gender || 'male';
  $('mk-vertical').value = saved.vertical || '';
  $('mk-product').value = saved.product || '';
  $('mk-ad').value = (full && full.settings && full.settings.advertise) || '';
  // Box 2 holds the hook; it shows at once for a draft that has one, a script or an ad. The hooks of a written
  // draft open folded.
  $('mk-hook').value = _gen.hook;
  _gen.box2 = !!(_gen.hook.trim() || _gen.paragraphs.length || $('mk-ad').value.trim());
  // Folded when a hook is chosen or a script written; open while there is still one to pick.
  _hooksOpen = !(_gen.hook.trim() || _gen.paragraphs.length);
  $('mk-hook-n').value = String(full && full.settings && full.settings.hookCount
    ? HT.hookCount(full.settings.hookCount) : _lastCount());
  _showForm();
  try { await _buildControls(full ? full.settings : null); }
  catch (e) { J.sayJob($('mk-job'), T.t('the model list could not be read: {why}', { why: e.message }), true); }
  _showHooks();
  if (_gen.paragraphs.length) _renderScenes();
  _setStage(_pickOrIdle());
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
  } catch (e) { _say(T.t('That draft could not be opened: {why}', { why: e.message }), 'err'); return false; }
  let src = null;
  let topic = null;
  if (d.sourceId) {
    try { src = (await J.api('/api/sources/' + encodeURIComponent(d.sourceId))).source; } catch (e) { src = null; }
    topic = src && d.topicId ? (src.topics || []).find(t => String(t.id) === String(d.topicId)) || null : null;
  }
  let lost = '';
  if (d.sourceId && (!src || (d.topicId && !topic))) {
    lost = !src ? T.t('Its source is gone - this draft carries on without a source.')
      : T.t('Its topic did not come back when the topics were found again - this draft carries on without a source.');
    d.sourceId = ''; d.topicId = ''; d.sourceTitle = ''; d.topicTitle = '';
    src = null; topic = null;
  }
  _src = src;
  _paintSources();
  await _enterScript({ draft: d, source: src, topic });
  if (topic) { _gen.topicSpan = `${J.clock(topic.start)}–${J.clock(topic.end)}`; _paintFrom(); }
  if (lost) {
    await _saveDraft();
    _say(lost, 'err');
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
// A row per hook: "use hook" on the left writes the script from it,
// its text is edited in place (kept in the draft), its kind on the right. The one used is marked, and stays until the
// script lands - a script that did not come is one press away again.
// "remake" right of "use hook" writes the row again in its own type; the type on the right by its NAME
// (public/js/library/hook-types.js), its description on hover. A kind that is not one of the forty is shown
// as it is, with no description and no remake.
function _renderHooks(hooks) {
  const box = $('mk-hook-list');
  box.textContent = '';
  _hideTip();
  hooks.forEach((h, i) => {
    const type = HT.hookType(h.type || h.kind);
    const row = el('div', 'mk-hook');
    // Blue, as the main buttons are, so it is easy to see.
    const use = el('button', 'u-btn is-s is-main mk-hook-use', T.t('Use hook'));
    use.type = 'button';
    use.title = T.t('Put this hook into the box below - the script is written from it there');
    use.disabled = _busy();
    const ta = el('textarea', 'mk-hook-t');
    ta.rows = 1;
    ta.spellcheck = false;
    ta.value = h.text;
    // Fitted to its text by the stylesheet (field-sizing) - a height measured by script while the list is folded
    // comes out as nothing.
    ta.addEventListener('input', () => { _gen.hooks[i] = { ..._gen.hooks[i], text: ta.value }; _markUsed(); _queueDraft(); });
    // No script is written yet: the hook goes into box 2 - a field like the dropdowns', below them - where it can be
    // edited, and "Write scenario" writes from it.
    use.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text || _busy()) return;
      _gen.hooks[i] = { ..._gen.hooks[i], text };
      _gen.hook = text;
      _gen.hookType = type ? type.id : '';
      _gen.box2 = true;
      _hooksOpen = false;               // the batch folds under box 1
      $('mk-hook').value = text;
      _markUsed();
      _paintGo();
      $('mk-box2').scrollIntoView({ block: 'nearest' });
      // Saved at once, so the draft's row in the list says "hook chosen".
      _saveDraft().then(() => { if (_embedded && _hooks.draftsChanged) _hooks.draftsChanged(); });
    });
    const remake = el('button', 'u-btn is-s mk-hook-remake', T.t('Remake'));
    remake.type = 'button';
    remake.dataset.type = type ? type.id : '';
    // A type's name and description are said in the app's language; the writer is given them in English.
    remake.title = type ? T.t('Write this hook again - another {type} on the same topic', { type: T.t(type.name).toLowerCase() })
      : T.t('This hook has no type to write it again in');
    remake.disabled = _busy() || !type;
    remake.addEventListener('click', () => _remakeHook(i, type, ta, row, remake));
    const k = el('span', 'mk-hook-k' + (type ? ' typed' : ''), type ? T.t(type.name) : (h.type || h.kind || ''));
    if (type) {
      k.addEventListener('mouseenter', () => _showTip(k, type));
      k.addEventListener('mouseleave', _hideTip);
    }
    row.append(use, remake, ta, k);
    box.appendChild(row);
  });
  _markUsed();
  _paintFold();
}

// One hook again, of its own type, by the topic - the row's
// text replaced, a hand edit too. The other rows go with it, so it does not read like them. While it is written
// every hook button waits (one stage at a time per draft); a cancel leaves the row as it was.
async function _remakeHook(i, type, ta, row, btn) {
  if (!type || _busy()) return;
  const topic = $('mk-topic').value.trim();
  if (!topic) { J.sayJob($('mk-job'), T.t('Describe the topic first.'), true); return; }
  const gen = _gen;
  _setStage('working');
  row.classList.add('remaking');
  btn.textContent = T.t('Remaking…');
  ta.readOnly = true;
  const o = _opts();
  const others = (_gen.hooks || []).filter((_, j) => j !== i).map(x => x.text);
  await _runStage('/api/scriptgen/hooks/remake', { ...o, topic, index: i, type: type.id, text: ta.value.trim(), others },
    _TIMING.remake(o, i), async (r) => {
      _putRemade(r);
      await _saveDraft();
    });
  if (_gen === gen) {
    if ((_gen.hooks || []).length) _renderHooks(_gen.hooks);
    _setStage(_pickOrIdle());
  }
}

// A remade hook into its row - while the row still holds a hook of that type.
function _putRemade(r) {
  const h = (_gen.hooks || [])[r.index];
  if (!h || !r.text || (HT.hookType(h.type || h.kind) || {}).id !== r.type) return false;
  // Box 2 keeps its own copy of the hook: a row written again leaves it as it is.
  _gen.hooks[r.index] = { type: r.type, text: r.text };
  return true;
}

// The hook type's description, beside its name - the page's own small box, at once (not the browser's, a second
// later). Above the name, or below it when there is no room above; inside the window.
let _tipEl = null;
function _hideTip() { if (_tipEl) { _tipEl.remove(); _tipEl = null; } }
function _showTip(anchor, type) {
  _hideTip();
  const t = el('div', 'mk-tip');
  t.append(el('b', '', T.t(type.name)), el('span', '', T.t(type.about)));
  document.body.appendChild(t);
  const r = anchor.getBoundingClientRect();
  const w = t.offsetWidth, h = t.offsetHeight;
  const x = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
  const y = r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6;
  t.style.left = x + 'px';
  t.style.top = y + 'px';
  _tipEl = t;
}

// The draft's hooks, beside a script too (folded, _paintFold). A hook typed by hand, with no hooks
// beside it, is box 2's - no row of its own.
function _showHooks() { _renderHooks(_gen.hooks || []); }

const _TIMING = {
  // 1-10 hooks: each count its own measured time.
  hooks: (o) => {
    const n = HT.hookCount(o.hookCount);
    return { key: `l2-hooks|${o.model}|${o.effort}|${n}`, label: T.tn(n, 'Writing {n} hook…', 'Writing {n} hooks…'), estimateMs: J.EST.hooks(n) };
  },
  remake: (o, i) => ({ key: `l2-remake|${o.model}|${o.effort}`, label: T.t('Writing hook {n} again…', { n: i + 1 }), estimateMs: J.EST.remake }),
  script: (o) => ({ key: `l2-script|${o.model}|${o.effort}|${o.scenes}`, label: T.tn(o.scenes, 'Writing {n} paragraph…', 'Writing {n} paragraphs…'), estimateMs: J.EST.script(o.scenes) }),
  rewrite: (o, i) => ({ key: `l2-rewrite|${o.model}|${o.effort}`, label: T.t('Rewriting paragraph {n}…', { n: i + 1 }), estimateMs: J.EST.rewrite }),
};

// Starts a stage on the server and follows it. A draft that is already being written into is not
// started twice: the server says so (409), and the page follows the job that is running instead.
async function _runStage(path, body, timing, onResult) {
  const gen = _gen;
  if (!(await _ensureDraft())) { J.sayJob($('mk-job'), T.t('The draft could not be saved, so nothing was started.'), true); return false; }
  const send = { ...body, ..._draftKey() };
  const what = path.split('/').pop();              // hooks | remake | script | rewrite
  let jobId;
  try {
    jobId = (await J.api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(send) })).jobId;
  } catch (e) {
    if (e.status === 409 && e.data && e.data.jobId) {
      J.sayJob($('mk-job'), T.t('This draft is already being written - following that instead.'));
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
  if (_embedded && _hooks.draftsChanged) _hooks.draftsChanged();     // its row says "writing…"
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
      // Cancelled: not an error. The form goes back to what it showed before the press -
      // the hooks it had, the script it had - since the server kept nothing of this stage.
      // Painted from the form itself, never read back from the server: nothing of the stage was kept,
      // and a reload would put the draft's copy over edits still waiting out their pause.
      rec.rows.forEach(r => r.detach());
      if (here()) {
        _sayBriefly(T.t('canceled - what was already sent is paid for'));
        if ((_gen.hooks || []).length) _renderHooks(_gen.hooks);
        if ((_gen.paragraphs || []).length) _renderScenes();
        // A stage this form did not start has no caller to set the stage back.
        if (_gen !== gen || !onResult) _setStage(_pickOrIdle());
      }
      return 'cancelled';
    }
    const last = rec.rows.length - 1;
    rec.rows.forEach((r, i) => (i === last && here() ? r.fail(e.message) : r.detach()));
    // A stage nobody started from this form has no caller to put the buttons back.
    if (here() && (_gen !== gen || !onResult)) _setStage(_pickOrIdle());
    return false;
  } finally {
    if (_following.get(draftId) === rec) _following.delete(draftId);
    await _readDrafts();
    if (_built) _paintSources();
    if (_embedded && _hooks.draftsChanged) _hooks.draftsChanged();
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
    // New hooks leave the chosen one in box 2.
    _gen.hooks = res.hooks;
    _hooksOpen = true;
    _renderHooks(_gen.hooks);
  } else if (what === 'remake' && res.text) {
    if (_putRemade(res)) _renderHooks(_gen.hooks);
  } else if (what === 'script' && Array.isArray(res.paragraphs)) {
    _gen.paragraphs = res.paragraphs;
    _hooksOpen = false;
    if (!$('mk-title').value.trim()) $('mk-title').value = res.title || '';
    _renderScenes();
  } else if (what === 'rewrite' && res.paragraph && res.index < (_gen.paragraphs || []).length) {
    _gen.paragraphs[res.index] = _spliced(res, _gen.paragraphs[res.index]);
    _renderScenes();
  } else { await _reloadDraftInto(); return; }
  await _saveDraft();
  _setStage(_pickOrIdle());
}

// A countdown row for a followed stage, in the form as it is now. Its timing comes from what the
// server says is running when the page did not start it (a reload, another visit).
function _stageRow(rec) {
  const run = rec.run || {};
  const t = run.timing
    || (_TIMING[run.what] ? _TIMING[run.what](run, run.index || 0)
      : { key: 'l2-stage', label: T.t('Still writing…'), estimateMs: J.EST.script(15) });
  const row = J.startJob($('mk-job'), { ...t, startedAt: run.startedAt || Date.now(), onCancel: () => _cancelStage(rec) });
  rec.rows.push(row);
  return row;
}

// The ✕ beside the countdown: the server stops the job and frees the
// draft; the poll sees it canceled and _followStage puts the form back. A job that ended meanwhile
// lands as usual - the cross came too late, and says nothing.
async function _cancelStage(rec) {
  if (rec.cancelling) return;
  rec.cancelling = true;
  try { await J.cancelJob('/api/scriptgen/jobs', rec.jobId); }
  catch (e) {
    rec.cancelling = false;
    const row = rec.rows[rec.rows.length - 1];
    if (row) row.say(T.t('could not cancel: {why}', { why: e.message }));
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
    _gen.hook = d.hook || '';
    _gen.hookType = d.hookType || '';
    $('mk-hook').value = _gen.hook;
    if (_gen.hook.trim() || _gen.paragraphs.length) _gen.box2 = true;
    if (d.title && !$('mk-title').value.trim()) $('mk-title').value = d.title;
    _showHooks();
    if (_gen.paragraphs.length) _renderScenes();
    _setStage(_pickOrIdle());
  } catch (e) { _setStage('idle'); }
}

// Box 1's button: hooks - as many as the list beside it says; "Write again" once a batch is there. The
// script is box 2's button.
async function _runGo() {
  if (!_controlsReady()) { J.sayJob($('mk-job'), T.t('the model list is not loaded yet'), true); return; }
  _writeHooks();
}

async function _writeHooks() {
  const topic = $('mk-topic').value.trim();
  if (!topic) { J.sayJob($('mk-job'), T.t('Describe the topic first.'), true); return; }
  const gen = _gen;
  _setStage('hooks');
  $('mk-hook-list').textContent = '';
  const o = _opts();
  const ok = await _runStage('/api/scriptgen/hooks', { ...o, topic }, _TIMING.hooks(o), async (r) => {
    // The chosen hook stays in box 2 until another is picked.
    _gen.hooks = r.hooks || [];
    _hooksOpen = true;
    _renderHooks(_gen.hooks);
    await _saveDraft();
  });
  if (_gen === gen) _setStage(ok ? _pickOrIdle() : (_gen.hooks.length ? (_renderHooks(_gen.hooks), 'pick') : 'idle'));
}

async function _runScript() {
  const topic = $('mk-topic').value.trim();
  const hook = String(_gen.hook || '').trim();
  if (!topic) { J.sayJob($('mk-job'), T.t('Describe the topic first.'), true); _setStage(_pickOrIdle()); return; }
  if (!hook) { J.sayJob($('mk-job'), T.t('Pick a hook first.'), true); _setStage(_pickOrIdle()); return; }
  const gen = _gen;
  _setStage('script');
  const o = _opts();
  // With its type: the script is carried the way that opening works.
  const body = { ...o, topic, hook, hookType: _gen.hookType || '' };
  await _runStage('/api/scriptgen/script', body, _TIMING.script(o), async (r) => {
    _gen.paragraphs = r.paragraphs || [];
    _hooksOpen = false;
    if (!$('mk-title').value.trim()) $('mk-title').value = r.title || topic.slice(0, 60);
    _renderScenes();
    await _saveDraft();
    if (r.asked && r.paragraphs && r.paragraphs.length !== r.asked) {
      J.sayJob($('mk-job'), T.t('Note: {got} paragraphs came back, {asked} were asked for.', { got: r.paragraphs.length, asked: r.asked }));
    }
  });
  // A script that did not come leaves everything as it was - "Write scenario" is a press away again.
  if (_gen === gen) _setStage(_pickOrIdle());
}

// A fragment's answer into the paragraph as it is NOW: in place of the words it was written for; when those are gone
// (typed over meanwhile), the paragraph the server made.
function _spliced(r, cur) {
  if (r.was == null || r.fragment == null) return r.paragraph;
  const at = String(cur || '').indexOf(r.was);
  return at < 0 ? r.paragraph : cur.slice(0, at) + r.fragment + cur.slice(at + r.was.length);
}

function _renderScenes() {
  _hideFragBtn();
  const box = $('mk-scenes');
  box.textContent = '';
  const list = (_gen && _gen.paragraphs) || [];
  list.forEach((text, i) => {
    const row = el('div', 'mk-scene' + (i === 0 ? ' hook' : ''));
    // Paragraph one is the hook, and says so instead of saying "1".
    row.appendChild(el('div', 'mk-scene-n' + (i === 0 ? ' is-hook' : ''), i === 0 ? T.t('hook') : String(i + 1)));
    const ta = el('textarea', 'mk-scene-t u-area is-dark');
    ta.rows = 2;
    ta.value = text;
    const acts = el('div', 'mk-scene-a');
    const secs = el('div', 'mk-scene-secs', T.t('{n}s', { n: J.spokenSeconds(text) }));
    acts.appendChild(secs);
    const fit = () => { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
    ta.addEventListener('input', () => {
      _gen.paragraphs[i] = ta.value;
      // Editing the first paragraph edits the hook: "Write again" writes from what is on screen - box 2 says the same.
      if (i === 0) { _gen.hook = ta.value; $('mk-hook').value = ta.value; _markUsed(); }
      secs.textContent = T.t('{n}s', { n: J.spokenSeconds(ta.value) });
      fit();
      _queueDraft();
    });
    setTimeout(fit, 0);
    if (i > 0) {
      const rw = el('button', 'mk-scene-rw u-btn is-s', T.t('Rewrite'));
      rw.type = 'button';
      rw.title = T.t('Rewrite this paragraph from a different angle - or select some of its words to rewrite only them');
      rw.addEventListener('click', () => _rewrite(i, rw));
      acts.appendChild(rw);
      _wireFragment(ta, i);
    }
    row.appendChild(ta);
    row.appendChild(acts);
    box.appendChild(row);
  });
  _paintGo();
}

// `fragment`: { text, start } - only those words of the paragraph are written again.
async function _rewrite(index, btn, fragment) {
  if (!_gen || _busy()) return;
  const was = btn ? btn.textContent : '';
  if (btn) btn.textContent = '…';
  const gen = _gen;
  _setStage('working');
  const o = _opts();
  const t = _TIMING.rewrite(o, index);
  await _runStage('/api/scriptgen/rewrite',
    { ...o, topic: $('mk-topic').value.trim(), script: _gen.paragraphs, index, ...(fragment ? { fragment } : {}) },
    fragment ? { ...t, key: t.key + '|fragment', label: T.t('Rewriting a fragment of paragraph {n}…', { n: index + 1 }) } : t,
    async (r) => {
      _gen.paragraphs[index] = r.paragraph ? _spliced(r, _gen.paragraphs[index]) : _gen.paragraphs[index];
      _renderScenes();
      await _saveDraft();
    });
  if (btn && btn.isConnected) btn.textContent = was;
  if (_gen === gen) _setStage('idle');
}

// ── "rewrite fragment": a piece of a paragraph selected ──
// Words selected in a paragraph's text (not the hook's) bring a small button beside the selection; pressed, only those
// words are written again, in the narrator's voice. It is a layer of its own (Escape takes it away) and goes when the
// selection does, when the text is typed into or the script scrolls.
let _frag = null;          // { btn, layer, index, start, end, text }

function _hideFragBtn() {
  if (!_frag) return;
  const f = _frag;
  _frag = null;
  f.btn.remove();
  Layers.close(f.layer);
}

function _fragFrom(ta, index, ev) {
  if (_busy()) { _hideFragBtn(); return; }
  // Whole words: a selection that cut into a word takes the rest of it.
  const W = /[\p{L}\p{N}'’-]/u;
  let start = ta.selectionStart;
  let end = ta.selectionEnd;
  while (start > 0 && end > start && W.test(ta.value[start - 1]) && W.test(ta.value[start])) start--;
  while (end < ta.value.length && end > start && W.test(ta.value[end]) && W.test(ta.value[end - 1])) end++;
  const text = ta.value.slice(start, end);
  if (end <= start || text.trim().length < 2 || text.trim() === ta.value.trim()) { _hideFragBtn(); return; }
  _hideFragBtn();
  const btn = el('button', 'u-btn is-s mk-frag-btn', T.t('Rewrite fragment'));
  btn.type = 'button';
  btn.title = T.t('Write only the selected words again, in the narrator\'s voice - the rest of the paragraph stays as it is');
  // Pressed without taking the focus: the selection - and the textarea's own blur - stay as they are.
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    const f = _frag;
    _hideFragBtn();
    if (f) _rewrite(f.index, null, { text: f.text, start: f.start });
  });
  document.body.appendChild(btn);
  // Beside the press that ended the selection; by the keyboard, at the paragraph's top right.
  const r = ta.getBoundingClientRect();
  const x = ev && ev.clientX ? ev.clientX + 8 : r.right - 130;
  const y = ev && ev.clientY ? ev.clientY + 12 : r.top - 4;
  btn.style.left = Math.max(8, Math.min(window.innerWidth - 150, x)) + 'px';
  btn.style.top = Math.max(8, Math.min(window.innerHeight - 40, y)) + 'px';
  _frag = { btn, layer: Layers.open(btn, { name: 'rewrite fragment', modal: false, onEsc: _hideFragBtn }), index, start, end, text };
}

function _wireFragment(ta, index) {
  ta.addEventListener('mouseup', (e) => setTimeout(() => _fragFrom(ta, index, e), 0));
  ta.addEventListener('keyup', (e) => { if (e.shiftKey || e.key === 'Shift') _fragFrom(ta, index, null); });
  ta.addEventListener('input', _hideFragBtn);
  ta.addEventListener('blur', () => setTimeout(() => { if (_frag && document.activeElement !== ta) _hideFragBtn(); }, 150));
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
  st.textContent = T.t('saving…');
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
        narratorId: o.narratorId, tone: o.tone, advertise: o.advertise,
        sourceId: _gen.sourceId, topicId: _gen.topicId,
        draftId: _gen.draftId,
      }),
    });
    // The draft became the scenario and is gone; the topic is marked written. The layout stays - the
    // next topic is one press away - and the scenario is one press away on the shelf.
    clearTimeout(_saveT);
    _saveT = null;
    _gen = null;
    // On the shelf the new scenario is selected in the list, in the draft's place.
    if (_embedded) {
      const n0 = (d.scenario.lines || []).length;
      if (_hooks.counts) _hooks.counts();
      if (_hooks.saved) await _hooks.saved(d.scenario.id, T.tn(n0, 'Saved “{name}” - {n} line.', 'Saved “{name}” - {n} lines.', { name: d.scenario.title }));
      return;
    }
    await Promise.all([_readDrafts(), _readSources()]);
    _paintSources();
    if (_src) { await _refreshSource(); _showTopics(); } else await _enterScript({});
    const n = (d.scenario.lines || []).length;
    _say(T.tn(n, 'Saved “{name}” - {n} line, on the Scenarios shelf.', 'Saved “{name}” - {n} lines, on the Scenarios shelf.', { name: d.scenario.title }), 'ok', d.scenario.id);
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
  // The layout's line is not on the shelf: the page's status line says it there.
  if (_embedded) { if (_hooks.status && text) _hooks.status(text, kind); return; }
  const box = $('mk-said');
  if (!box) return;
  box.textContent = '';
  box.hidden = !text;
  if (!text) return;
  box.className = 'mk-said' + (kind ? ' ' + kind : '');
  box.appendChild(el('span', null, text));
  if (scenarioId && _hooks.openScenario) {
    const a = el('button', 'u-btn is-s', T.t('Open'));
    a.type = 'button';
    a.addEventListener('click', () => _hooks.openScenario(scenarioId));
    box.appendChild(a);
  }
  const x = el('button', 'mk-said-x u-btn is-s is-icon is-quiet u-x', '');
  x.type = 'button';
  x.addEventListener('click', () => _say(''));
  box.appendChild(x);
}

// ── Adding a source ─────────────────────────────────────────────────────────
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

const ADD_NOTE = [T.t('A horizontal video becomes a source: it is downloaded - one at a time, in the order added - or copied, transcribed and its topics found, all of it in Alerts, so this window lets go at once.'),
  T.t('A vertical or square one is asked about: onto Uploads in Media, or a source after all. A sound without a picture - in development. Links are read without a login: a video a site shows only to signed-in people - add it as a file. The transcription and the topics are paid calls.')];
function _openAddSource() {
  if (_addWin) return;
  const ov = el('div', 'mk-ov');
  ov.innerHTML = `
    <div class="mk-panel u-win is-float" role="dialog" aria-modal="true">
      <div class="mk-panel-head u-win-head"><span class="mk-panel-t u-win-title">${T.t('Add a source')}</span><span class="sp"></span>
        <button class="u-btn is-icon is-quiet u-x" type="button" data-x="close" title="${T.t('Close (Esc)')}"></button></div>
      <div class="mk-panel-body">
        <div class="mk-choice u-tabs">
          <button class="mk-choice-btn u-tab cur" type="button" data-route="link">${T.t('From a link')}</button>
          <button class="mk-choice-btn u-tab" type="button" data-route="file">${T.t('From a file')}</button>
          <button class="mk-choice-btn u-tab" type="button" data-route="lib">${T.t('From the Library')}</button>
        </div>
        <section class="mk-route" data-r="link">
          <label class="mk-field"><span>${T.t('Link to a single video')}</span>
            <input type="text" class="u-in" data-f="url" placeholder="https://www.youtube.com/watch?v=…"></label>
          <button class="u-btn is-main" type="button" data-go="link">${T.t('Add')}</button>
        </section>
        <section class="mk-route" data-r="file" hidden>
          <label class="mk-field"><span>${T.t('Video file')}</span><input type="file" data-f="file" accept="video/*"></label>
          <label class="mk-field"><span>${T.t('Title')} <em>${T.t('optional - the file name is used otherwise')}</em></span>
            <input type="text" class="u-in" data-f="title" placeholder="${T.t('What this source is')}"></label>
          <button class="u-btn is-main" type="button" data-go="file">${T.t('Add')}</button>
        </section>
        <section class="mk-route" data-r="lib" hidden>
          <span class="mk-lib-head">${T.t('REFERENCES · YouTube · Videos')}</span>
          <div class="mk-lib" data-f="lib"></div>
        </section>
        <p class="mk-pnote u-status is-line" data-f="note"></p>
        <div class="mk-adds-say u-status" data-f="said" hidden></div>
        <div class="mk-adds" data-f="adds"></div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const q = (s) => ov.querySelector(s);
  const f = (name) => q(`[data-f="${name}"]`);
  // The long note is ONE line - the one about money, the whole under the pointer.
  f('note').textContent = T.t('The transcription and the topics are paid calls.');
  f('note').title = ADD_NOTE.join(' ');
  const route = (r) => {
    ov.querySelectorAll('.mk-choice-btn').forEach(b => b.classList.toggle('cur', b.dataset.route === r));
    ov.querySelectorAll('.mk-route').forEach(s => { s.hidden = s.dataset.r !== r; });
    if (r === 'lib') _paintLib();
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

// ── From the Library ── REFERENCES -> YouTube -> Videos, the same list as highlights' "from the Library" (GET
// /api/references/youtube): a downloaded one is a source already - here among the sources; one kept as a tile is added by its
// link, the way "From a link" adds it (downloaded, heard, its topics found - paid), and its tile becomes the downloaded video.
const _mmss = (s) => { const t = Math.max(0, Math.round(+s || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
async function _paintLib() {
  if (!_addWin) return;
  const box = _addWin.f('lib');
  box.textContent = '';
  // Reading, nothing there, did not load - the shared parts, as rows; a failed read is not "nothing
  // there": "did not load" with Try again, the reason in the corner.
  box.appendChild(loadingEl(T.t('reading…'), { line: true }));
  let items = [];
  try { items = (await J.api('/api/references/youtube')).items || []; }
  catch (e) {
    if (!_addWin || _addWin.f('lib') !== box) return;
    box.textContent = '';
    box.appendChild(failedEl(T.t('YouTube videos'), () => _paintLib(), { line: true }));
    showError(T.t('YouTube videos did not load: {why}', { why: e.message }));
    return;
  }
  if (!_addWin || _addWin.f('lib') !== box) return;
  box.textContent = '';
  if (!items.length) { box.appendChild(emptyEl(T.t('Nothing there yet - send YouTube links to the Telegram bot, or add a video here by a link.'), { line: true })); return; }
  for (const it of items) {
    const row = el('div', 'mk-lib-row');
    if (it.thumb) { const im = el('img'); im.src = it.thumb; im.alt = ''; im.loading = 'lazy'; row.appendChild(im); }
    const t = el('div', 'mk-lib-t');
    t.appendChild(el('b', null, it.title || T.t('video')));
    t.appendChild(el('small', null, _mmss(it.seconds) + ' · ' + (it.type === 'source'
      ? T.t('a source already') + (it.topics ? ' · ' + T.tn(it.topics, '{n} topic', '{n} topics') : '') : T.t('not downloaded'))));
    row.appendChild(t);
    if (it.type === 'remote') {
      const b = el('button', 'u-btn is-s', T.t('Add'));   // plain - one gold per route
      b.type = 'button';
      b.title = T.t('Downloaded, heard and its topics found - the hearing and the topics are paid. Its tile becomes the downloaded video.');
      b.addEventListener('click', async () => {
        // A source is heard on Replicate and its topics found by an agent - without their keys, the popup.
        if (!allow('sources', b)) return;
        b.disabled = true;
        _addSay('');
        try {
          const d = await _post('/api/sources/add/link', { url: it.link });
          b.textContent = T.t('added');
          _track(d.read);
        } catch (e) { b.disabled = false; _addSay(e.message, true); }
      });
      row.appendChild(b);
    }
    box.appendChild(row);
  }
}

function _addSay(text, err) {
  _addSaid = text ? { text, err: !!err } : null;
  _paintAdds();
}

async function _addLink(input) {
  const url = input.value.trim();
  if (!url) { _addSay(T.t('Paste a link first.'), true); return; }
  if (!allow('sources', input)) return;
  _addSay('');
  try {
    const d = await _post('/api/sources/add/link', { url });
    input.value = '';
    _track(d.read);
  } catch (e) { _addSay(e.message, true); }
}

async function _addFile(input, titleIn) {
  const file = input.files && input.files[0];
  if (!file) { _addSay(T.t('Pick a file first.'), true); return; }
  if (!allow('sources', input)) return;
  // The app's own window says where the file lies; the server copies it from there itself, so leaving the page
  // cuts nothing off. A browser tab cannot say.
  const pathOf = window.ugcWindow && window.ugcWindow.pathOf;
  let where = '';
  try { where = typeof pathOf === 'function' ? String(pathOf(file) || '') : ''; } catch (e) { where = ''; }
  if (!where) { _addSay(T.t('Adding a file works in the app\'s own window - it hands the file over. Here, add it by a link.'), true); return; }
  _addSay('');
  try {
    const d = await _post('/api/sources/add/file', { path: where, title: titleIn.value.trim() });
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
      catch (e) { fresh = { ...r, state: 'error', error: e.status === 404 ? T.t('lost - add it again') : e.message }; }
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
  line.appendChild(el('div', 'mk-addl-t', r.title || r.url || T.t('a file')));
  const say = (text, err) => { const s = el('div', 'mk-addl-s u-status' + (err ? ' err' : ''), text); if (err) line.classList.add('err'); line.appendChild(s); };
  const acts = el('div', 'mk-addl-acts');
  const btn = (label, title, on, cls) => {
    // the answers are plain buttons - the window's gold is each route's own "Add"
    const b = el('button', 'u-btn is-s' + (cls === 'primary' ? ' primary' : cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (title) b.title = title;
    if (on) b.addEventListener('click', on); else b.disabled = true;
    acts.appendChild(b);
    return b;
  };
  if (r.state === 'reading') say(r.step || T.t('reading…'));
  else if (r.state === 'ask') {
    const a = r.ask || {};
    if (a.kind === 'unknown') {
      say(a.seconds ? T.t('The site did not say what this is ({time}) - a video, or a sound?', { time: J.clock(a.seconds) })
        : T.t('The site did not say what this is - a video, or a sound?'));
      btn(T.t('A video with topics - a source'), T.t('Downloaded, transcribed and its topics found, in Alerts'), () => _answer(r, 'source'), 'primary');
      btn(T.t('A video - onto Uploads'), T.t('Downloaded onto Uploads in Media, nothing read out of it'), () => _answer(r, 'uploads'));
      btn(T.t('A sound - in development'), T.t('A sound without a picture cannot be added yet'));
    } else {
      say(a.kind === 'square' ? T.t('A square video ({dims}). It goes onto Uploads in Media - unless it has topics to write from.', { dims: _dims(a) })
        : T.t('A vertical video ({dims}). It goes onto Uploads in Media - unless it has topics to write from.', { dims: _dims(a) }));
      btn(T.t('Onto Uploads'), T.t('Downloaded onto Uploads in Media, nothing read out of it'), () => _answer(r, 'uploads'), 'primary');
      btn(T.t('It has topics - add it as a source'), T.t('Yes, this vertical video is a source: downloaded, transcribed and its topics found, in Alerts'), () => _answer(r, 'source'));
    }
  } else if (r.state === 'uploads') {
    const lj = r.link || null;
    const item = (lj && lj.items && lj.items[0]) || r.item || null;
    if (lj && lj.state === 'error') say(lj.error || T.t('it did not come'), true);
    else if (lj && lj.state === 'stopped') say(T.t('stopped'));
    else if ((lj && lj.state === 'done') || r.landed) {
      say(T.t('On Uploads in Media.'));
      if (item && item.id) btn(T.t('Show'), T.t('The clip on the Media shelf'), () => _showOnMedia(item.id));
    } else say((lj ? lj.step : r.step) || T.t('onto Uploads…'));
  } else if (r.state === 'audio') say(r.step || T.t('Audio only - in development.'));
  else if (r.state === 'error') say(r.error || T.t('it failed'), true);
  if (acts.childNodes.length) line.appendChild(acts);
  // A line that has ended is let go of by its cross; a question is let go of too (nothing was downloaded).
  if (r.state === 'ask' || _addSettled(r)) {
    const x = el('button', 'mk-x u-onpic is-del u-x', '');
    x.type = 'button';
    x.title = r.state === 'ask' ? T.t('Let go of it - nothing was downloaded') : T.t('Take this line away');
    x.addEventListener('click', () => { if (r.state === 'ask') _answer(r, 'drop'); else { _adds.delete(r.id); _paintAdds(); } });
    line.appendChild(x);
  }
  return line;
}

function _showOnMedia(itemId) {
  const href = '/library?shelf=media&kind=uploads&sel=' + encodeURIComponent(itemId);
  _closeAddSource();
  const ask = new CustomEvent('ugc:goto', { detail: { href }, cancelable: true });
  if (window.dispatchEvent(ask)) location.href = href;
}
