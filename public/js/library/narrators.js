// LIBRARY — the narrators window: "Narrators" in the Scenarios header (phase E6, the owner
// 2026-09-29; a temporary place until the owner names the final one).
//
// A narrator is HOW a script is written: samples of an author's writing in, a description of the
// voice out ("a reading"), and the generator's form picks one (js/library/make.js). What Library 2
// kept on a shelf of its own and a dialog is one window here, in three columns: the narrators - ONE
// ROW ALWAYS SELECTED, as on every Library shelf, with "+ New narrator" opening a name field right in
// the list (prompt() throws in the app's Electron) - then the selected one's samples, then its voice,
// a page per reading.
//
// TWO PAID CALLS, and they belong to the narrator, not to the window: transcribing a file into a
// sample, and reading the voice. While one runs, that narrator's buttons are locked and every other
// narrator is free; closing the window leaves it running, and it does NOT open the window again
// when it lands (Library 2 did). Its last line - "1234 words from 8 min", or what went wrong - stays
// with the narrator and is there the next time it is shown. Errors are said inside the window.
//
// Whatever changes the list of voices - a narrator made or deleted, a reading added or dropped - is
// announced as `lib:narrators`, and the generator's form rebuilds its narrator list and nothing else.

import * as J from './jobs.js';
import * as Layers from '../layers.js';

const el = J.el;

let _win = null;           // { ov, layer, q } while the window is open
let _list = [];            // narrator summaries
let _minWords = 500;
let _sel = '';             // the selected narrator's id
let _rec = null;           // the selected one, whole: { narrator, readings, words, minWords }
let _readIdx = 0;
let _seq = 0;              // an answer about a narrator no longer shown is dropped
let _nameBox = null;       // the new-narrator field: { row, layer }
let _adding = false;       // "Add text" on its way - a second press must not store it twice
const _typed = new Map();  // narratorId -> text pasted and not added yet
// narratorId -> { kind: 'sample'|'analyse', jobId, startedAt, key, label, estimateMs, step, row, last }
// `last` is { text, err } - the line a finished job leaves behind.
const _jobs = new Map();

const PROFILE_ROWS = [
  ['summary', 'Who this voice is'], ['sentences', 'Sentences'], ['rhythm', 'Rhythm'],
  ['address', 'Address'], ['register', 'Register'], ['imagery', 'Imagery'],
  ['humour', 'Humour'], ['openings', 'Openings'], ['endings', 'Endings'], ['stance', 'Stance'],
];

const _announce = () => document.dispatchEvent(new CustomEvent('lib:narrators'));
// Busy from the press - the upload of a file comes before its job has a number - to the last line.
const _running = (id) => { const j = _jobs.get(String(id)); return !!(j && j.busy); };

// ── The window ──────────────────────────────────────────────────────────────
const HTML = `
  <div class="mk-panel nr-panel" role="dialog" aria-modal="true" aria-label="Narrators">
    <div class="mk-panel-head">
      <span class="mk-panel-t">Narrators</span>
      <span class="mk-note">how a script is written — writing by an author in, a voice out</span>
      <span class="sp"></span>
      <button class="lib-btn" type="button" data-x="close" title="Close (Esc)">✕</button>
    </div>
    <div class="nr-said" data-f="said" hidden></div>
    <div class="nr-body">
      <aside class="nr-list-col">
        <button class="mk-add nr-new" type="button" data-f="new" title="Make a narrator - a name first, samples after">+ New narrator</button>
        <div class="nr-list" data-f="list"></div>
      </aside>
      <section class="nr-col">
        <div class="nr-col-h">Samples <em>— writing by this author</em><span class="sp"></span><span class="nr-words" data-f="words"></span></div>
        <div class="nr-samples" data-f="samples"></div>
        <div class="nr-add">
          <textarea data-f="text" rows="4" placeholder="Paste writing by this author…"></textarea>
          <div class="nr-add-row">
            <button class="lib-btn" type="button" data-f="addtext">Add text</button>
            <span class="sp"></span>
            <input type="file" data-f="file" accept="video/*,audio/*">
            <button class="lib-btn" type="button" data-f="addfile" title="Transcribe the file and keep its words as a sample - a paid call">Transcribe a file</button>
          </div>
          <p class="mk-pnote">A video or audio file is transcribed - a paid call - and its words become the sample.</p>
          <div class="mk-job" data-f="sjob" hidden></div>
        </div>
      </section>
      <section class="nr-col">
        <div class="nr-col-h">The voice <em>— as a model will be told it</em></div>
        <div class="nr-profile" data-f="profile"></div>
        <div class="nr-foot">
          <div class="mk-job" data-f="vjob" hidden></div>
          <button class="lib-btn primary" type="button" data-f="analyse" title="Read the voice out of the samples - a paid call">Read the voice</button>
        </div>
      </section>
    </div>
  </div>`;

/** Open the window on the narrator that was selected last (the first one the first time). */
export async function open() {
  if (_win) return;
  const ov = el('div', 'mk-ov nr-ov');
  ov.innerHTML = HTML;
  document.body.appendChild(ov);
  const q = (name) => ov.querySelector(`[data-f="${name}"]`);
  ov.querySelector('[data-x="close"]').addEventListener('click', close);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  const layer = Layers.open(ov, { name: 'narrators', onEsc: close });
  _win = { ov, layer, q };

  q('new').addEventListener('click', _askName);
  q('addtext').addEventListener('click', _addText);
  q('addfile').addEventListener('click', _addFile);
  q('analyse').addEventListener('click', _analyse);
  q('text').addEventListener('input', () => { if (_sel) _typed.set(_sel, q('text').value); });

  await _readList();
  if (!_win) return;
  if (!_list.some(n => String(n.id) === _sel)) _sel = _list[0] ? String(_list[0].id) : '';
  _paintList();
  await _show();
}

function close() {
  if (!_win) return;
  _closeName();
  const w = _win;
  _win = null;
  _seq++;
  // The rows go; the jobs behind them run on and keep their last line for next time.
  for (const j of _jobs.values()) { if (j.row) { j.row.detach(); j.row = null; } }
  w.ov.remove();
  Layers.close(w.layer);
}

function _say(text, isError) {
  if (!_win) return;
  const box = _win.q('said');
  box.textContent = '';
  box.hidden = !text;
  if (!text) return;
  box.className = 'nr-said' + (isError ? ' err' : '');
  box.appendChild(el('span', null, text));
  const x = el('button', 'mk-said-x', '✕');
  x.type = 'button';
  x.addEventListener('click', () => _say(''));
  box.appendChild(x);
}

// ── The list ────────────────────────────────────────────────────────────────
async function _readList() {
  try {
    const d = await J.api('/api/narrators');
    _list = d.narrators || [];
    _minWords = d.minWords || _minWords;
  } catch (e) { _say(e.message, true); }
}

function _tag(it) {
  if (_running(it.id)) return ['run', _jobs.get(String(it.id)).kind === 'analyse' ? 'reading…' : 'transcribing…'];
  if (it.readings > 1) return ['ready', `${it.readings} readings`];
  if (it.ready) return ['ready', 'voice read'];
  if (!it.enough) return ['wait', `needs ${_minWords}+ words`];
  return ['wait', 'not read yet'];
}

function _paintList() {
  if (!_win) return;
  const box = _win.q('list');
  const keep = _nameBox ? _nameBox.row : null;
  // The name field stays where it is - taking a focused input out of the page drops the focus, and
  // this repaints when any narrator's job lands, in the middle of typing.
  const focused = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('nr-row')
    ? document.activeElement.dataset.id : '';
  for (const n of [...box.children]) if (n !== keep) n.remove();
  if (keep && keep.parentNode !== box) box.prepend(keep);
  if (!_list.length && !keep) {
    box.appendChild(el('div', 'mk-src-empty', 'No narrators yet. A narrator is HOW a script is written - make one out of writing by an author you want to sound like.'));
    return;
  }
  for (const it of _list) {
    const row = el('div', 'nr-row' + (String(it.id) === _sel ? ' cur' : ''));
    row.tabIndex = 0;
    row.dataset.id = String(it.id);
    const main = el('div', 'nr-row-main');
    main.appendChild(el('div', 'nr-row-t', it.name));
    main.appendChild(el('div', 'nr-row-s', [it.samples + (it.samples === 1 ? ' sample' : ' samples'), it.words + ' words'].join(' · ')));
    row.appendChild(main);
    const [kind, text] = _tag(it);
    row.appendChild(el('span', 'mk-tag ' + (kind === 'run' ? 'wait' : kind), text));
    const x = el('button', 'nr-x', '✕');
    x.type = 'button';
    x.title = 'Delete this narrator';
    x.disabled = _running(it.id);
    x.addEventListener('click', (e) => { e.stopPropagation(); _delete(it); });
    row.appendChild(x);
    const pick = () => { if (String(it.id) !== _sel) { _sel = String(it.id); _paintList(); } _show(); };
    row.addEventListener('click', pick);
    // The row's own keys only: Enter on its ✕ is the ✕'s.
    row.addEventListener('keydown', (e) => { if (e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(); } });
    box.appendChild(row);
  }
  if (focused) { const r = box.querySelector(`.nr-row[data-id="${CSS.escape(focused)}"]`); if (r) r.focus(); }
}

// The name of a new narrator, typed into the list itself. Enter makes it; Escape - its own layer,
// so the window stays - or pressing "+" again lets it go.
function _askName() {
  if (!_win) return;
  if (_nameBox) { _nameBox.input.focus(); return; }
  const row = el('div', 'nr-name');
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Name, then Enter';
  input.maxLength = 80;
  input.spellcheck = false;
  const err = el('div', 'nr-name-err');
  row.append(input, err);
  const layer = Layers.open(row, { name: 'new narrator', modal: false, onEsc: _closeName });
  _nameBox = { row, input, layer, busy: false };
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = input.value.trim();
    if (!name) { err.textContent = 'Give it a name.'; return; }
    if (_nameBox.busy) return;
    _nameBox.busy = true;
    err.textContent = '';
    try {
      const d = await J.api('/api/narrators', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      _closeName();
      _sel = String(d.narrator.id);
      await _readList();
      _paintList();
      await _show();
      _announce();
    } catch (x) {
      if (_nameBox) { _nameBox.busy = false; err.textContent = x.message; }
    }
  });
  _paintList();
  input.focus();
}

function _closeName() {
  if (!_nameBox) return;
  const b = _nameBox;
  _nameBox = null;
  b.row.remove();
  Layers.close(b.layer);
}

async function _delete(it) {
  if (_running(it.id)) return;
  // Drafts that were written with it: they keep their text, and the form will ask for another.
  let n = 0;
  try {
    const d = await J.api('/api/scriptgen/drafts');
    n = (d.drafts || []).filter(x => String(x.narratorId || '') === String(it.id)).length;
  } catch (e) { /* the count is a courtesy */ }
  const lines = [`Delete the narrator "${it.name}"?`, '', 'Its samples and readings go with it, and that cannot be undone.'];
  if (n) lines.push('', `${n === 1 ? 'One draft was' : `${n} drafts were`} written with it - ${n === 1 ? 'it keeps its' : 'they keep their'} text, and the form will ask for another narrator.`);
  if (!confirm(lines.join('\n'))) return;
  try {
    await J.api('/api/narrators/' + encodeURIComponent(it.id), { method: 'DELETE' });
    _typed.delete(String(it.id));
    _jobs.delete(String(it.id));
    if (String(it.id) === _sel) _sel = '';
    await _readList();
    if (!_list.some(x => String(x.id) === _sel)) _sel = _list[0] ? String(_list[0].id) : '';
    _paintList();
    await _show();
    _announce();
  } catch (e) { _say(e.message, true); }
}

// ── The selected narrator ───────────────────────────────────────────────────
async function _show(showReading) {
  if (!_win) return;
  const my = ++_seq;
  const q = _win.q;
  if (!_sel) {
    _rec = null;
    q('samples').textContent = '';
    q('profile').textContent = '';
    q('words').textContent = '';
    q('text').value = '';
    _paintLocks();
    J.clearJob(q('sjob'));
    J.clearJob(q('vjob'));
    return;
  }
  // Another narrator: the columns are emptied and locked until its own arrive, so nothing on screen
  // acts on a narrator it does not belong to.
  if (!_rec || String(_rec.narrator.id) !== _sel) _blank();
  let d;
  try { d = await J.api('/api/narrators/' + encodeURIComponent(_sel)); }
  catch (e) { if (my === _seq) { _blank(); _say(e.message, true); } return; }
  if (my !== _seq || !_win) return;
  _rec = d;
  const reads = d.readings || [];
  // Newest first after a reading lands; otherwise where the pager was.
  _readIdx = showReading != null ? Math.min(showReading, Math.max(0, reads.length - 1)) : Math.max(0, reads.length - 1);
  q('words').textContent = [
    `${d.words} words`, d.words < d.minWords ? `needs ${d.minWords}` : '',
    reads.length ? (reads.length === 1 ? '1 reading' : `${reads.length} readings`) : 'not read',
  ].filter(Boolean).join(' · ');
  q('text').value = _typed.get(_sel) || '';
  _paintSamples();
  _paintProfile();
  _paintJob();
  _paintLocks();
}

function _blank() {
  _rec = null;
  if (!_win) return;
  for (const k of ['samples', 'profile', 'words']) _win.q(k).textContent = '';
  _win.q('text').value = '';
  for (const k of ['sjob', 'vjob']) J.clearJob(_win.q(k));
  _paintLocks();
}

function _paintLocks() {
  if (!_win) return;
  const q = _win.q;
  const none = !_sel || !_rec;
  const busy = !none && _running(_sel);
  const reads = (_rec && _rec.readings) || [];
  for (const k of ['addfile', 'file']) q(k).disabled = none || busy;
  for (const k of ['addtext', 'text']) q(k).disabled = none || busy || _adding;
  q('analyse').disabled = none || busy || !_rec || _rec.words < _rec.minWords;
  q('analyse').textContent = reads.length ? 'Read the voice again' : 'Read the voice';
  _win.ov.querySelectorAll('.nr-sample .nr-x, .nr-pager-x').forEach(b => { b.disabled = busy; });
}

function _paintSamples() {
  const box = _win.q('samples');
  box.textContent = '';
  const owner = String(_rec.narrator.id);
  const samples = (_rec.narrator.samples || []);
  if (!samples.length) { box.appendChild(el('div', 'mk-empty', 'No samples yet.')); return; }
  samples.forEach((s, i) => {
    const card = el('div', 'nr-sample');
    const h = el('div', 'nr-sample-h');
    h.appendChild(el('b', null, s.label || (s.kind === 'file' ? 'a file' : 'pasted text')));
    h.appendChild(el('span', null, `${s.words} words`));
    const x = el('button', 'nr-x', '✕');
    x.type = 'button';
    x.title = 'Remove this sample';
    x.addEventListener('click', () => _removeSample(owner, i));
    h.appendChild(x);
    card.appendChild(h);
    const text = String(s.text || '');
    card.appendChild(el('p', 'nr-sample-p', text.slice(0, 220) + (text.length > 220 ? '…' : '')));
    box.appendChild(card);
  });
}

function _paintProfile() {
  const box = _win.q('profile');
  box.textContent = '';
  const reads = _rec.readings || [];
  if (!reads.length) { box.appendChild(el('div', 'mk-empty', 'Not read yet. Add samples, then press “Read the voice”.')); return; }
  if (_readIdx >= reads.length) _readIdx = reads.length - 1;
  const cur = reads[_readIdx];
  const owner = String(_rec.narrator.id);
  // The pager: the readings are several descriptions of one voice, all in use - a script gets one
  // of them at random - and reading them is how you tell whether one is worth keeping.
  const pager = el('div', 'nr-pager');
  const prev = el('button', 'nr-pager-b', '‹');
  prev.type = 'button';
  prev.disabled = _readIdx <= 0;
  prev.addEventListener('click', () => { _readIdx--; _paintProfile(); _paintLocks(); });
  const next = el('button', 'nr-pager-b', '›');
  next.type = 'button';
  next.disabled = _readIdx >= reads.length - 1;
  next.addEventListener('click', () => { _readIdx++; _paintProfile(); _paintLocks(); });
  const del = el('button', 'nr-x nr-pager-x', '✕');
  del.type = 'button';
  del.title = 'Delete this reading - the samples stay';
  del.addEventListener('click', () => _removeReading(owner, cur));
  pager.append(prev, el('span', 'nr-pager-t', [`Reading ${_readIdx + 1} of ${reads.length}`, J.fmtDate(cur.at), cur.model].filter(Boolean).join(' · ')), next,
    el('span', 'nr-pager-n', reads.length > 1 ? 'a script gets one at random' : ''), del);
  box.appendChild(pager);
  const p = cur.profile;
  if (!p || !p.summary) { box.appendChild(el('div', 'mk-empty', 'This reading came back empty.')); return; }
  for (const [key, label] of PROFILE_ROWS) {
    const v = String(p[key] || '').trim();
    if (!v) continue;
    const row = el('div', 'nr-prof-row');
    row.append(el('div', 'nr-prof-k', label), el('div', 'nr-prof-v', v));
    box.appendChild(row);
  }
  for (const [key, label] of [['signature_moves', 'Signature moves'], ['never_does', 'Never does']]) {
    const items = (p[key] || []).filter(Boolean);
    if (!items.length) continue;
    const row = el('div', 'nr-prof-row');
    const ul = el('ul', 'nr-prof-list');
    for (const it of items) ul.appendChild(el('li', null, it));
    row.append(el('div', 'nr-prof-k', label), ul);
    box.appendChild(row);
  }
}

async function _removeSample(id, i) {
  if (id !== _sel || _running(id) || !confirm('Remove this sample? The voice will need reading again to reflect it.')) return;
  try {
    await J.api(`/api/narrators/${encodeURIComponent(id)}/samples/${i}`, { method: 'DELETE' });
    await _readList();
    _paintList();
    await _show(_readIdx);
  } catch (e) { _say(e.message, true); }
}

async function _removeReading(id, cur) {
  if (id !== _sel) return;
  const total = ((_rec && _rec.readings) || []).length;
  if (_running(id) || !confirm(`Delete reading ${_readIdx + 1} of ${total}? The samples it was made from stay, so the voice can be read again.`)) return;
  try {
    await J.api(`/api/narrators/${encodeURIComponent(id)}/readings/${encodeURIComponent(cur.id)}`, { method: 'DELETE' });
    await _readList();
    _paintList();
    await _show(Math.max(0, _readIdx - 1));
    _announce();
  } catch (e) { _say(e.message, true); }
}

async function _addText() {
  const id = _rec ? String(_rec.narrator.id) : '';
  if (!id || id !== _sel || _running(id) || _adding) return;
  const text = _win.q('text').value.trim();
  if (!text) { J.sayJob(_win.q('sjob'), 'Paste some writing first.', true); return; }
  _adding = true;
  _paintLocks();
  try {
    await J.api(`/api/narrators/${encodeURIComponent(id)}/samples`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, label: 'pasted text' }),
    });
    _typed.delete(id);
    if (_win) _win.q('text').value = '';
    if (_win) J.clearJob(_win.q('sjob'));
    await _readList();
    _paintList();
    if (_sel === id) await _show(_readIdx);
  } catch (e) { if (_win) J.sayJob(_win.q('sjob'), e.message, true); }
  finally { _adding = false; _paintLocks(); }
}

// ── The two paid jobs ───────────────────────────────────────────────────────
// Shown in the column they belong to - a sample under the samples, a reading under the voice - for
// the narrator on screen; the others run unseen and leave their last line.
function _host(kind) { return _win ? _win.q(kind === 'analyse' ? 'vjob' : 'sjob') : null; }

function _paintJob() {
  if (!_win) return;
  for (const k of ['sjob', 'vjob']) J.clearJob(_win.q(k));
  for (const j of _jobs.values()) { if (j.row) { j.row.detach(); j.row = null; } }
  const j = _jobs.get(_sel);
  if (!j) return;
  const host = _host(j.kind);
  if (j.busy) {
    j.row = J.startJob(host, { key: j.key, label: j.label, estimateMs: j.estimateMs, startedAt: j.startedAt });
    if (j.step) j.row.say(j.step);
  } else if (j.last) J.sayJob(host, j.last.text, j.last.err);
}

async function _start(id, kind, url, init, timing) {
  _jobs.set(id, { kind, busy: true, jobId: '', startedAt: Date.now(), ...timing, step: '', row: null, last: null });
  const job = _jobs.get(id);
  _paintList();
  _paintLocks();
  if (_sel === id) _paintJob();
  try {
    const d = await J.api(url, init);
    job.jobId = d.jobId;
    const done = await J.pollJob('/api/narrators/jobs', d.jobId, (s) => {
      if (!s.step) return;
      job.step = s.step;
      if (job.row) job.row.say(s.step);
    });
    if (job.row) job.row.finish();
    job.row = null;
    job.busy = false;
    job.jobId = '';
    job.last = { text: kind === 'analyse' ? `Read · ${done.step || 'done'}` : `Transcribed · ${done.step || 'done'}`, err: false };
    return true;
  } catch (e) {
    if (job.row) job.row.detach();
    job.row = null;
    job.busy = false;
    job.jobId = '';
    job.last = { text: e.message, err: true };
    return false;
  } finally {
    // The narrator may have been deleted meanwhile: then there is nothing to show the line on.
    if (_jobs.get(id) !== job) _jobs.delete(id);
    await _readList();
    _paintList();
    if (_win && _sel === id) await _show(kind === 'analyse' ? undefined : _readIdx);
    else _paintLocks();
  }
}

async function _addFile() {
  const id = _rec ? String(_rec.narrator.id) : '';
  if (!id || id !== _sel || _running(id)) return;
  const input = _win.q('file');
  const file = input.files && input.files[0];
  if (!file) { J.sayJob(_win.q('sjob'), 'Pick a video or audio file first.', true); return; }
  if (!confirm(`Transcribe "${file.name}" (${J.mb(file.size)}) into a sample?\n\nIt is a paid speech-to-text call.`)) return;
  const form = new FormData();
  form.append('file', file);
  input.value = '';
  await _start(id, 'sample', `/api/narrators/${encodeURIComponent(id)}/samples/upload`, { method: 'POST', body: form }, {
    key: `l2-sample|${J.bucket(file.size / 1048576)}mb`, label: `Uploading ${J.mb(file.size)}…`, estimateMs: J.EST.sample(file.size),
  });
}

async function _analyse() {
  const id = _rec ? String(_rec.narrator.id) : '';
  if (!id || id !== _sel || _running(id)) return;
  const words = _rec.words || 0;
  const ok = await _start(id, 'analyse', `/api/narrators/${encodeURIComponent(id)}/analyse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  }, { key: `l2-analyse|${J.bucket(words)}`, label: `Reading ${words} words…`, estimateMs: J.EST.analyse });
  if (ok) _announce();
}
