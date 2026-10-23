// LIBRARY — the narrators: "Narrators" beside "New scenario" on the Scenarios shelf, an AREA in place of the
// scenario list (phase V28.2, the owner 2026-10-12: "кнопка будет открывать не попап, а вместо поля сценариев будет
// отображаться интерфейс настроек и чтений нарраторов"); the gear by the generator's Narrator field leads here too.
// js/library/main.js shows and hides it, as it does the making areas.
//
// A narrator is HOW a script is written: samples of an author's writing in, and out of them ONE VOICE and the author's
// own words and phrases (phase V38, the owner 2026-10-23: "нужен один нарратор у которого пополняется его фразы и
// словарь"). Three columns: the narrators - ONE ROW ALWAYS SELECTED, as on every Library shelf, with "+ New narrator"
// opening a name field right in the list (prompt() throws in the app's Electron) - then the selected one's samples (each
// says whether it has been read), then the right column under three crumbs, the last one open remembered:
//   the voice      its lines by field, each corrected in place or deleted (✕ twice); lines the last reading added say
//                  "new" - the app only ever ADDS to the voice (the owner's (д15), (д17));
//   vocabulary     a TABLE: the word · what it stands for · when he says it · examples · the original (pale) - the owner's
//   phrases        (д3): "не сплошным текстом а таблицей"; the phrases' table has its kind and place. A dot switches an
//                  entry on or off (off: kept, not told to the writer), cells are corrected in place, "+ example" adds
//                  one, ✕ twice deletes, the "+" row at the bottom types a new one. What the last reading PROPOSED lies
//                  above in pale rows with ✓ / ✕, and "keep all".
// "Read new samples" at the column's foot reads only the samples not read yet - the voice added to, words and phrases
// proposed, new examples to the entries there are.
//
// TWO PAID KINDS OF WORK, and they belong to the narrator, not to the area: transcribing a file or a link into a sample,
// and reading the new samples. While one runs, that narrator's buttons are locked and every other narrator is free. The
// area is built the first time it is shown and only HIDDEN after that, so a job goes on when it is left and its row is
// where it was on the way back; it does NOT bring the area back when it lands (Library 2 did). Its last line - "1234
// words from 8 min", or what went wrong - stays with the narrator and is there the next time it is shown. A reading
// started before a reload is followed again when the narrator is shown. Errors are said inside the area.
//
// Whatever changes the list of voices - a narrator made or deleted, a voice read - is announced as `lib:narrators`,
// and the generator's form rebuilds its narrator list and nothing else.

import * as J from './jobs.js';
import * as Layers from '../layers.js';

const el = J.el;

let _win = null;           // { host, q } once the area is built - it is only hidden after that
let _list = [];            // narrator summaries
let _minWords = 500;
let _sel = '';             // the selected narrator's id
let _rec = null;           // the selected one: { narrator, words, minWords, reading }
let _seq = 0;              // an answer about a narrator no longer shown is dropped
let _nameBox = null;       // the new-narrator field: { row, layer }
let _adding = false;       // "Add text" on its way - a second press must not store it twice
const _typed = new Map();  // narratorId -> text pasted and not added yet
// narratorId -> { kind: 'sample'|'read', jobId, startedAt, key, label, estimateMs, step, row, last }
// `last` is { text, err } - the line a finished job leaves behind.
const _jobs = new Map();

// The right column's crumb, remembered on this computer.
const LS_VIEW = 'lib_nr_view';
const VIEWS = ['voice', 'vocabulary', 'phrases'];
let _view = (() => { try { const v = localStorage.getItem(LS_VIEW); return VIEWS.includes(v) ? v : 'voice'; } catch (e) { return 'voice'; } })();

const VOICE_ROWS = [
  ['summary', 'Who this voice is'], ['sentences', 'Sentences'], ['rhythm', 'Rhythm'],
  ['address', 'Address'], ['register', 'Register'], ['imagery', 'Imagery'],
  ['humour', 'Humour'], ['openings', 'Openings'], ['endings', 'Endings'], ['stance', 'Stance'],
  ['signature_moves', 'Signature moves'], ['never_does', 'Never does'],
];
const KINDS = [['signature', 'signature'], ['idiom', 'turn of phrase']];
const PLACES = [['anywhere', 'anywhere'], ['opening', 'opening'], ['ending', 'ending']];

const _announce = () => document.dispatchEvent(new CustomEvent('lib:narrators'));
// Busy from the press - the upload of a file comes before its job has a number - to the last line.
const _running = (id) => { const j = _jobs.get(String(id)); return !!(j && j.busy); };
const _post = (url, body, method) => J.api(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const _nurl = (id, rest) => `/api/narrators/${encodeURIComponent(id)}${rest || ''}`;

// ── The area ────────────────────────────────────────────────────────────────
const HTML = `
    <div class="mk-panel-head">
      <span class="mk-panel-t">Narrators</span>
      <span class="mk-note">how a script is written — writing by an author in; his voice, his words and phrases out</span>
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
          <div class="nr-add-row">
            <input type="text" class="nr-url" data-f="url" placeholder="…or a link - YouTube, TikTok, Instagram">
            <button class="lib-btn" type="button" data-f="addlink" title="Fetch the video's sound, transcribe it and keep its words as a sample - a paid call">Transcribe a link</button>
          </div>
          <div class="nr-add-row">
            <select class="nr-url nr-src-pick" data-f="src"><option value="">…or a source of the Library</option></select>
            <button class="lib-btn" type="button" data-f="addsrc" title="Its words were heard when it came in - they become the sample, for nothing">Add the source</button>
          </div>
          <p class="mk-pnote">A video or audio file - or a link, of which only the sound is fetched, without a login - is
            transcribed (a paid call), and its words become the sample. A source of the Library was heard when it came in:
            its words become the sample for nothing.</p>
          <div class="mk-job" data-f="sjob" hidden></div>
        </div>
      </section>
      <section class="nr-col nr-right">
        <div class="nr-crumbs" data-f="crumbs"></div>
        <div class="nr-view" data-f="view"></div>
        <div class="nr-foot">
          <div class="mk-job" data-f="vjob" hidden></div>
          <div class="nr-foot-row">
            <span class="nr-foot-note" data-f="readnote"></span>
            <button class="lib-btn primary" type="button" data-f="read" title="Read the samples not read yet - the voice is added to, new words and phrases are proposed - a paid call">Read new samples</button>
          </div>
        </div>
      </section>
    </div>`;

function _build() {
  if (_win) return;
  const host = document.getElementById('lib-narrators');
  host.innerHTML = HTML;
  const q = (name) => host.querySelector(`[data-f="${name}"]`);
  _win = { host, q };

  q('new').addEventListener('click', _askName);
  q('addtext').addEventListener('click', _addText);
  q('addfile').addEventListener('click', _addFile);
  q('addlink').addEventListener('click', _addLink);
  q('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); _addLink(); } });
  q('read').addEventListener('click', _read);
  q('addsrc').addEventListener('click', _addSource);
  q('text').addEventListener('input', () => { if (_sel) _typed.set(_sel, q('text').value); });
}

/** Show the area on the narrator that was selected last (the first one the first time), read again. */
export async function open() {
  _build();
  await _readList();
  if (!_list.some(n => String(n.id) === _sel)) _sel = _list[0] ? String(_list[0].id) : '';
  _paintList();
  await _show();
}

/** The area hidden: a name being typed for a new narrator is let go; the jobs run on. */
export function close() {
  _closeName();
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
  if (_running(it.id)) return ['run', _jobs.get(String(it.id)).kind === 'read' ? 'reading…' : 'transcribing…'];
  if (!it.ready) return ['wait', it.enough ? 'not read yet' : `needs ${_minWords}+ words`];
  if (it.unread) return ['wait', it.unread === 1 ? '1 new sample' : `${it.unread} new samples`];
  if (it.pending) return ['wait', `${it.pending} proposed`];
  return ['ready', 'voice read'];
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
    const bits = [it.samples + (it.samples === 1 ? ' sample' : ' samples'), it.words + ' words'];
    if (it.vocabulary) bits.push(it.vocabulary + (it.vocabulary === 1 ? ' word' : ' words') + ' of his');
    if (it.phrases) bits.push(it.phrases + (it.phrases === 1 ? ' phrase' : ' phrases'));
    main.appendChild(el('div', 'nr-row-s', bits.join(' · ')));
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

// The name of a new narrator, typed into the list itself. Enter makes it; Escape (its own layer) or
// leaving the area lets it go; "+" again only puts the cursor back in it.
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
      const d = await _post('/api/narrators', { name });
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
  const lines = [`Delete the narrator "${it.name}"?`, '', 'Its samples, its voice, its words and phrases go with it, and that cannot be undone.'];
  if (n) lines.push('', `${n === 1 ? 'One draft was' : `${n} drafts were`} written with it - ${n === 1 ? 'it keeps its' : 'they keep their'} text, and the form will ask for another narrator.`);
  if (!confirm(lines.join('\n'))) return;
  try {
    await J.api(_nurl(it.id), { method: 'DELETE' });
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
async function _show() {
  if (!_win) return;
  const my = ++_seq;
  const q = _win.q;
  if (!_sel) {
    _blank();
    return;
  }
  // Another narrator: the columns are emptied and locked until its own arrive, so nothing on screen
  // acts on a narrator it does not belong to.
  if (!_rec || String(_rec.narrator.id) !== _sel) _blank();
  let d;
  try { d = await J.api(_nurl(_sel)); }
  catch (e) { if (my === _seq) { _blank(); _say(e.message, true); } return; }
  if (my !== _seq || !_win) return;
  _rec = d;
  _paintWords();
  q('text').value = _typed.get(_sel) || '';
  _paintSamples();
  _paintRight();
  _paintJob();
  _paintLocks();
  _paintSources();
  // A reading started before this page was opened (a reload, another window): followed again, at its real age.
  if (d.reading && d.reading.jobId && !_running(_sel)) _follow(String(_sel), d.reading.jobId, d.reading.startedAt);
}

function _paintWords() {
  if (!_win || !_rec) return;
  const n = _rec.narrator;
  const unread = (n.samples || []).filter(s => !s.readAt).length;
  _win.q('words').textContent = [
    `${_rec.words} words`, !_hasVoice(n) && _rec.words < _rec.minWords ? `needs ${_rec.minWords}` : '',
    unread ? `${unread} not read` : '',
  ].filter(Boolean).join(' · ');
}

function _blank() {
  _rec = null;
  if (!_win) return;
  for (const k of ['samples', 'view', 'crumbs', 'words', 'readnote']) _win.q(k).textContent = '';
  _win.q('text').value = '';
  for (const k of ['sjob', 'vjob']) J.clearJob(_win.q(k));
  _paintLocks();
}

const _hasVoice = (n) => !!(n && n.voice && VOICE_ROWS.some(([k]) => (n.voice[k] || []).length));
const _unread = () => ((_rec && _rec.narrator.samples) || []).filter(s => !s.readAt);

function _paintLocks() {
  if (!_win) return;
  const q = _win.q;
  const none = !_sel || !_rec;
  const busy = !none && _running(_sel);
  for (const k of ['addfile', 'file', 'addlink', 'url', 'addsrc', 'src']) q(k).disabled = none || busy;
  for (const k of ['addtext', 'text']) q(k).disabled = none || busy || _adding;
  const unread = none ? [] : _unread();
  const words = unread.reduce((s, x) => s + (x.words || 0), 0);
  const first = !none && !_hasVoice(_rec.narrator);
  const short = first && words < ((_rec && _rec.minWords) || _minWords);
  q('read').disabled = none || busy || !unread.length || short;
  q('read').textContent = unread.length > 1 ? `Read new samples · ${unread.length}` : 'Read new samples';
  q('readnote').textContent = none || busy ? '' : !unread.length ? ((_rec.narrator.samples || []).length ? 'every sample has been read' : 'add a sample first')
    : short ? `${words} words to read - at least ${_rec.minWords} the first time` : '';
  _win.host.querySelectorAll('.nr-sample .nr-x').forEach(b => { b.disabled = busy; });
}

function _paintSamples() {
  const box = _win.q('samples');
  box.textContent = '';
  const owner = String(_rec.narrator.id);
  const samples = (_rec.narrator.samples || []);
  if (!samples.length) { box.appendChild(el('div', 'mk-empty', 'No samples yet.')); return; }
  samples.forEach((s, i) => {
    const card = el('div', 'nr-sample' + (s.readAt ? '' : ' unread'));
    const h = el('div', 'nr-sample-h');
    const name = el('b', null, s.label || (s.kind === 'file' ? 'a file' : s.kind === 'link' ? 'a link' : s.kind === 'source' ? 'a source' : 'pasted text'));
    if (s.url) name.title = s.url;
    h.appendChild(name);
    h.appendChild(el('span', null, `${s.words} words`));
    // (V38) Read or not: "Read new samples" reads only the ones that are not, so none is paid for twice.
    const tag = el('span', 'mk-tag ' + (s.readAt ? 'ready' : 'wait'), s.readAt ? 'read' : 'not read');
    tag.title = s.readAt ? 'Read into the voice - it is not read again' : 'Not read yet - "Read new samples" reads it';
    h.appendChild(tag);
    const x = el('button', 'nr-x', '✕');
    x.type = 'button';
    x.title = 'Remove this sample';
    x.addEventListener('click', () => _removeSample(owner, i, s));
    h.appendChild(x);
    card.appendChild(h);
    const text = String(s.text || '');
    card.appendChild(el('p', 'nr-sample-p', text.slice(0, 220) + ((s.chars || text.length) > 220 ? '…' : '')));
    box.appendChild(card);
  });
}

async function _removeSample(id, i, s) {
  const said = s && s.readAt ? 'What was read from it stays in the voice, the words and the phrases.' : 'It has not been read yet.';
  if (id !== _sel || _running(id) || !confirm(`Remove this sample? ${said}`)) return;
  try {
    await J.api(_nurl(id, `/samples/${i}`), { method: 'DELETE' });
    await _readList();
    _paintList();
    await _show();
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
    await _post(_nurl(id, '/samples'), { text, label: 'pasted text' });
    _typed.delete(id);
    if (_win) _win.q('text').value = '';
    if (_win) J.clearJob(_win.q('sjob'));
    await _readList();
    _paintList();
    if (_sel === id) await _show();
  } catch (e) { if (_win) J.sayJob(_win.q('sjob'), e.message, true); }
  finally { _adding = false; _paintLocks(); }
}

// (phase V38, block D5) The sources of the Library whose words were heard - read whenever a narrator is shown. One that is
// a sample of this narrator already says so; the server refuses it anyway (by its words too).
async function _paintSources() {
  if (!_win || !_rec) return;
  const sel = _win.q('src');
  const keep = sel.value;
  let list = [];
  try { list = (await J.api('/api/sources')).sources || []; } catch (e) { return; }
  if (!_rec) return;
  const mine = new Set((_rec.narrator.samples || []).map(s => String(s.sourceId || '')).filter(Boolean));
  sel.textContent = '';
  const first = el('option', null, '…or a source of the Library');
  first.value = '';
  sel.appendChild(first);
  for (const s of list) {
    const t = s.transcript || {};
    if (t.state !== 'ready' || !t.chars) continue;
    const o = el('option', null, `${s.title}${s.seconds ? ' · ' + J.clock(s.seconds) : ''}${mine.has(String(s.id)) ? ' - a sample already' : ''}`);
    o.value = String(s.id);
    o.disabled = mine.has(String(s.id));
    sel.appendChild(o);
  }
  if ([...sel.options].some(o => o.value === keep && !o.disabled)) sel.value = keep;
}

async function _addSource() {
  const id = _rec ? String(_rec.narrator.id) : '';
  if (!id || id !== _sel || _running(id)) return;
  const sel = _win.q('src');
  const sourceId = sel.value;
  if (!sourceId) { J.sayJob(_win.q('sjob'), 'Choose a source first.', true); return; }
  const btn = _win.q('addsrc');
  btn.disabled = true;
  try {
    const d = await _post(_nurl(id, '/samples/source'), { sourceId });
    sel.value = '';
    await _readList();
    _paintList();
    if (_sel === id) await _show();
    if (_win && _sel === id) J.sayJob(_win.q('sjob'), `Added · ${d.words} words, not read yet`);
  } catch (e) { J.sayJob(_win.q('sjob'), e.message, true); }
  finally { btn.disabled = false; _paintLocks(); }
}

// ── The right column: the voice, the vocabulary, the phrases ────────────────
// Changes come back as the whole narrator; the newest one is kept (an older answer arriving late is not painted over a
// newer one). A cell's own save does not repaint the column - the cursor may be in the next cell already.
function _take(n) {
  if (!_rec || !n || String(n.id) !== String(_rec.narrator.id)) return false;
  if (String(n.updatedAt || '') < String(_rec.narrator.updatedAt || '')) return false;
  _rec.narrator = n;
  return true;
}

function _paintRight() {
  if (!_win || !_rec) return;
  _paintCrumbs();
  const box = _win.q('view');
  box.textContent = '';
  box.className = 'nr-view nr-view-' + _view;
  if (_view === 'voice') _paintVoice(box);
  else _paintSet(box, _view);
}

function _paintCrumbs() {
  const box = _win.q('crumbs');
  box.textContent = '';
  const n = _rec.narrator;
  VIEWS.forEach((v, i) => {
    if (i) box.appendChild(el('span', 'nr-crumb-sep', '/'));
    const list = n[v] || [];
    const pend = ((n.pending || {})[v] || []).length;
    const b = el('button', 'nr-crumb' + (_view === v ? ' is-on' : ''));
    b.type = 'button';
    b.appendChild(el('span', null, v === 'voice' ? 'the voice' : v));
    if (v !== 'voice') b.appendChild(el('span', 'nr-crumb-n', ' · ' + list.length));
    if (pend) b.appendChild(el('span', 'nr-crumb-p', ' +' + pend));
    b.title = v === 'voice' ? 'How he writes - as a model will be told it'
      : (v === 'vocabulary' ? 'His words - what he says instead of the plain word' : 'His signature lines and turns of phrase')
        + (pend ? ` · ${pend} proposed by the last reading, waiting for a tick` : '');
    b.addEventListener('click', () => {
      if (_view === v) return;
      _view = v;
      try { localStorage.setItem(LS_VIEW, v); } catch (e) { /* remembered only where it can be */ }
      _paintRight();
    });
    box.appendChild(b);
  });
}

// A press arms a ✕ ("really?" for three seconds); the second press within them does it (the owner's (д3): twice).
function _twice(btn, act) {
  const label = btn.textContent;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.classList.contains('armed')) { btn.classList.remove('armed'); clearTimeout(btn._t); btn.textContent = label; act(); return; }
    btn.classList.add('armed');
    btn.textContent = 'really?';
    btn._t = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = label; }, 3000);
  });
}

// A text corrected in place: pressed, it takes the cursor; Enter or leaving it saves, Escape puts it back. `save(text)`
// answers the narrator; a refusal is said and the text put back.
function _editable(node, value, save, { placeholder = '', multiline = false } = {}) {
  node.classList.add('nr-ed');
  node.textContent = value || '';
  if (placeholder) node.dataset.ph = placeholder;
  node.tabIndex = 0;
  let was = value || '';
  const begin = () => {
    if (node.isContentEditable) return;
    node.contentEditable = 'plaintext-only';
    node.focus();
    const r = document.createRange();
    r.selectNodeContents(node);
    r.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  };
  node.addEventListener('click', begin);
  node.addEventListener('keydown', (e) => {
    if (!node.isContentEditable) { if (e.key === 'Enter') { e.preventDefault(); begin(); } return; }
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) { e.preventDefault(); node.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); node.textContent = was; node.blur(); }
  });
  node.addEventListener('blur', async () => {
    if (!node.isContentEditable) return;
    node.contentEditable = 'false';
    const now = node.textContent.replace(/\s+/g, ' ').trim();
    node.textContent = now;
    if (now === was.trim()) return;
    node.classList.add('saving');
    try {
      const n = await save(now);
      was = now;
      _take(n);
    } catch (e) {
      node.textContent = was;
      _say(e.message, true);
    } finally { node.classList.remove('saving'); }
  });
}

function _paintVoice(box) {
  const n = _rec.narrator;
  if (!_hasVoice(n)) {
    box.appendChild(el('div', 'mk-empty', (n.samples || []).length
      ? 'Not read yet. Press “Read new samples” - the voice, his words and his phrases are read out of the samples.'
      : 'Not read yet. Add samples, then press “Read new samples”.'));
    return;
  }
  const last = n.lastRead || {};
  const head = el('div', 'nr-voice-h');
  head.appendChild(el('span', null, 'As a model will be told it'));
  if (last.at) head.appendChild(el('span', 'nr-voice-at', ['last read ' + J.fmtDate(last.at), last.model].filter(Boolean).join(' · ')));
  box.appendChild(head);
  const owner = String(n.id);
  for (const [key, label] of VOICE_ROWS) {
    const lines = n.voice[key] || [];
    if (!lines.length) continue;
    const row = el('div', 'nr-prof-row');
    row.appendChild(el('div', 'nr-prof-k', label));
    for (const l of lines) {
      const line = el('div', 'nr-vline');
      const t = el('div', 'nr-vline-t');
      _editable(t, l.text, async (text) => (await _post(_nurl(owner, `/voice/${encodeURIComponent(l.id)}`), { text }, 'PATCH')).narrator, { multiline: true });
      line.appendChild(t);
      // What the last reading added - when it was not the first.
      if (!last.first && last.id && l.by === last.id) line.appendChild(el('span', 'nr-new-tag', 'new'));
      const x = el('button', 'nr-x', '✕');
      x.type = 'button';
      x.title = 'Delete this line of the voice';
      _twice(x, async () => {
        try {
          const d = await J.api(_nurl(owner, `/voice/${encodeURIComponent(l.id)}`), { method: 'DELETE' });
          if (_take(d.narrator)) _paintRight();
          _announce();
        } catch (e) { _say(e.message, true); }
      });
      line.appendChild(x);
      row.appendChild(line);
    }
    box.appendChild(row);
  }
}

// The table of one set. Its columns: the dot, the word or phrase (with how many saved scripts it went into), what it
// stands for, [kind and place], when, the examples, the original, the ✕.
function _paintSet(box, list) {
  const n = _rec.narrator;
  const owner = String(n.id);
  const phrases = list === 'phrases';
  const pend = (n.pending || {})[list] || [];
  if (pend.length) box.appendChild(_pendingBlock(owner, list, pend));
  const t = el('table', 'nr-table' + (phrases ? ' phrases' : ''));
  const head = el('tr');
  const cols = ['', phrases ? 'phrase' : 'word', 'meaning', ...(phrases ? ['kind · place'] : []), 'when & how', 'examples', 'original', ''];
  for (const c of cols) head.appendChild(el('th', null, c));
  const thead = el('thead');
  thead.appendChild(head);
  t.appendChild(thead);
  const body = el('tbody');
  for (const e of n[list] || []) body.appendChild(_entryRow(owner, list, e));
  body.appendChild(_addRow(owner, list));
  t.appendChild(body);
  box.appendChild(t);
  if (!(n[list] || []).length && !pend.length) {
    box.appendChild(el('p', 'mk-pnote', phrases
      ? 'No phrases yet. “Read new samples” proposes his signature lines and turns of phrase, or type one in the row above. Typed in Russian, it is put into English and the Russian kept beside it.'
      : 'No words yet. “Read new samples” proposes his words, or type one in the row above. Typed in Russian, it is put into English and the Russian kept beside it.'));
  }
}

function _cell(cls) { return el('td', cls); }

function _entryRow(owner, list, e) {
  const phrases = list === 'phrases';
  const base = _nurl(owner, `/${list}/${encodeURIComponent(e.id)}`);
  const patch = async (body) => (await _post(base, body, 'PATCH')).narrator;
  const tr = el('tr', e.on ? '' : 'off');
  // The dot: told to the writer, or kept and not told.
  const dc = _cell('nr-dot-c');
  const dot = el('button', 'nr-dot' + (e.on ? ' on' : ''));
  dot.type = 'button';
  dot.title = e.on ? 'On - the writer is given it. Press to keep it but not give it' : 'Off - kept, not given to the writer. Press to give it again';
  dot.addEventListener('click', async () => {
    try { if (_take(await patch({ on: !e.on }))) _paintRight(); _announce(); } catch (x) { _say(x.message, true); }
  });
  dc.appendChild(dot);
  tr.appendChild(dc);
  const tc = _cell('nr-t-c');
  const tt = el('div', 'nr-t');
  _editable(tt, e.text, (text) => patch({ text }));
  tc.appendChild(tt);
  if (e.uses) {
    const u = el('div', 'nr-uses', `in ${e.uses} ${e.uses === 1 ? 'script' : 'scripts'}`);
    u.title = 'How many saved scripts it went into' + (e.lastUsedAt ? ' - last on ' + J.fmtDate(e.lastUsedAt) : '');
    tc.appendChild(u);
  }
  tr.appendChild(tc);
  const mc = _cell();
  const mt = el('div');
  _editable(mt, e.meaning, (meaning) => patch({ meaning }), { placeholder: phrases ? 'what it says' : 'instead of…' });
  mc.appendChild(mt);
  tr.appendChild(mc);
  if (phrases) {
    const kc = _cell('nr-kind-c');
    for (const [field, opts] of [['kind', KINDS], ['place', PLACES]]) {
      const s = el('select', 'nr-sel');
      for (const [v, label] of opts) { const o = el('option', null, label); o.value = v; s.appendChild(o); }
      s.value = e[field];
      s.title = field === 'kind' ? 'A signature line of his, or a turn of phrase he favours' : 'Where it goes: anywhere, opening a piece (never before the hook), or closing one';
      s.addEventListener('change', async () => {
        try { _take(await patch({ [field]: s.value })); } catch (x) { s.value = e[field]; _say(x.message, true); }
      });
      kc.appendChild(s);
    }
    tr.appendChild(kc);
  }
  const wc = _cell();
  const wt = el('div');
  _editable(wt, e.when, (when) => patch({ when }), { placeholder: 'when he says it', multiline: true });
  wc.appendChild(wt);
  tr.appendChild(wc);
  tr.appendChild(_examplesCell(owner, list, e));
  const sc = _cell('nr-src-c');
  const st = el('div');
  _editable(st, e.source, (source) => patch({ source }), { placeholder: '—' });
  st.title = 'The original, as he says it - for you only, never sent to the writer';
  sc.appendChild(st);
  tr.appendChild(sc);
  const xc = _cell('nr-x-c');
  const x = el('button', 'nr-x', '✕');
  x.type = 'button';
  x.title = phrases ? 'Delete this phrase' : 'Delete this word';
  _twice(x, async () => {
    try {
      const d = await J.api(base, { method: 'DELETE' });
      if (_take(d.narrator)) _paintRight();
      _announce();
    } catch (err) { _say(err.message, true); }
  });
  xc.appendChild(x);
  tr.appendChild(xc);
  return tr;
}

function _examplesCell(owner, list, e) {
  const c = _cell('nr-ex-c');
  const base = _nurl(owner, `/${list}/${encodeURIComponent(e.id)}/examples`);
  (e.examples || []).forEach((x, i) => {
    const row = el('div', 'nr-ex');
    const t = el('div', 'nr-ex-t');
    _editable(t, x.text, async (text) => (await _post(`${base}/${i}`, { text }, 'PATCH')).narrator, { multiline: true });
    if (x.source) t.title = x.source;
    row.appendChild(t);
    const del = el('button', 'nr-x', '✕');
    del.type = 'button';
    del.title = 'Delete this example';
    _twice(del, async () => {
      try { const d = await J.api(`${base}/${i}`, { method: 'DELETE' }); if (_take(d.narrator)) _paintRight(); }
      catch (err) { _say(err.message, true); }
    });
    row.appendChild(del);
    c.appendChild(row);
  });
  // "+ example": a line of its own, Enter adds it.
  const add = el('button', 'nr-ex-add', '+ example');
  add.type = 'button';
  add.addEventListener('click', () => {
    add.hidden = true;
    const input = el('input', 'nr-in');
    input.type = 'text';
    input.placeholder = 'An example, then Enter';
    c.appendChild(input);
    input.focus();
    const done = () => { input.remove(); add.hidden = false; };
    input.addEventListener('keydown', async (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); done(); return; }
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const text = input.value.trim();
      if (!text) { done(); return; }
      input.disabled = true;
      try { const d = await _post(base, { text }); if (_take(d.narrator)) _paintRight(); }
      catch (err) { input.disabled = false; _say(err.message, true); }
    });
    input.addEventListener('blur', () => { if (!input.value.trim() && !input.disabled) done(); });
  });
  c.appendChild(add);
  return c;
}

// The "+" row: typed and Enter (or "+") adds it. In Russian, the server puts it into English first (a moment, cents).
function _addRow(owner, list) {
  const phrases = list === 'phrases';
  const tr = el('tr', 'nr-add-tr');
  tr.appendChild(_cell('nr-dot-c'));
  const f = {};
  const input = (key, ph) => { const i = el('input', 'nr-in'); i.type = 'text'; i.placeholder = ph; f[key] = i; const c = _cell(); c.appendChild(i); return c; };
  tr.appendChild(input('text', phrases ? '+ a phrase…' : '+ a word…'));
  tr.appendChild(input('meaning', phrases ? 'what it says' : 'instead of…'));
  if (phrases) {
    const kc = _cell('nr-kind-c');
    for (const [field, opts] of [['kind', KINDS], ['place', PLACES]]) {
      const s = el('select', 'nr-sel');
      for (const [v, label] of opts) { const o = el('option', null, label); o.value = v; s.appendChild(o); }
      f[field] = s;
      kc.appendChild(s);
    }
    tr.appendChild(kc);
  }
  tr.appendChild(input('when', 'when he says it'));
  tr.appendChild(input('example', 'an example'));
  const said = _cell('nr-src-c nr-add-said');
  tr.appendChild(said);
  const bc = _cell('nr-x-c');
  const go = el('button', 'nr-plus', '+');
  go.type = 'button';
  go.title = phrases ? 'Add the phrase' : 'Add the word';
  bc.appendChild(go);
  tr.appendChild(bc);
  const add = async () => {
    const body = {};
    for (const [k, node] of Object.entries(f)) body[k] = node.value.trim();
    if (!body.text) { f.text.focus(); return; }
    for (const node of Object.values(f)) node.disabled = true;
    go.disabled = true;
    said.textContent = /(?!\p{Script=Latin})\p{L}/u.test(Object.values(body).join(' ')) ? 'into English…' : '';
    try {
      const d = await _post(_nurl(owner, '/' + list), body);
      if (_take(d.narrator)) _paintRight();
      _announce();
      const again = _win && _win.q('view').querySelector('.nr-add-tr .nr-in');
      if (again) again.focus();
    } catch (e) {
      for (const node of Object.values(f)) node.disabled = false;
      go.disabled = false;
      said.textContent = '';
      _say(e.message, true);
    }
  };
  for (const node of Object.values(f)) {
    if (node.tagName === 'INPUT') node.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  }
  go.addEventListener('click', add);
  return tr;
}

// What the last reading proposed, in pale rows: ✓ keeps one, ✕ drops it (and it is not proposed again), and all at once.
function _pendingBlock(owner, list, pend) {
  const phrases = list === 'phrases';
  const box = el('div', 'nr-pend');
  const h = el('div', 'nr-pend-h');
  h.appendChild(el('span', null, `${pend.length} proposed by the last reading`));
  h.appendChild(el('span', 'sp'));
  const act = async (pid, what) => {
    try {
      const d = await _post(_nurl(owner, `/pending/${list}/${encodeURIComponent(pid)}/${what}`));
      if (_take(d.narrator)) _paintRight();
      await _readList();
      _paintList();
      _announce();
    } catch (e) { _say(e.message, true); }
  };
  const all = el('button', 'lib-btn', 'keep all');
  all.type = 'button';
  all.addEventListener('click', () => act('all', 'keep'));
  const none = el('button', 'lib-btn', 'drop all');
  none.type = 'button';
  none.title = 'Drop every proposal - none of them is proposed again';
  _twice(none, () => act('all', 'drop'));
  h.append(all, none);
  box.appendChild(h);
  const t = el('table', 'nr-table nr-pend-t' + (phrases ? ' phrases' : ''));
  const body = el('tbody');
  for (const p of pend) {
    const tr = el('tr');
    const ok = el('button', 'nr-ok', '✓');
    ok.type = 'button';
    ok.title = 'Keep it';
    ok.addEventListener('click', () => act(p.id, 'keep'));
    const no = el('button', 'nr-x', '✕');
    no.type = 'button';
    no.title = 'Drop it - it is not proposed again';
    no.addEventListener('click', () => act(p.id, 'drop'));
    const c0 = _cell('nr-dot-c');
    c0.appendChild(ok);
    tr.appendChild(c0);
    tr.appendChild(el('td', 'nr-t-c', p.text));
    tr.appendChild(el('td', null, p.meaning));
    if (phrases) tr.appendChild(el('td', 'nr-kind-c', [p.kind === 'signature' ? 'signature' : 'turn of phrase', p.place].join(' · ')));
    tr.appendChild(el('td', null, p.when));
    tr.appendChild(el('td', 'nr-ex-c', (p.examples || []).map(x => x.text).join(' / ')));
    tr.appendChild(el('td', 'nr-src-c', p.source));
    const cx = _cell('nr-x-c');
    cx.appendChild(no);
    tr.appendChild(cx);
    body.appendChild(tr);
  }
  t.appendChild(body);
  box.appendChild(t);
  return box;
}

// ── The paid jobs ───────────────────────────────────────────────────────────
// Shown in the column they belong to - a sample under the samples, a reading under the right column - for the narrator
// on screen; the others run unseen and leave their last line.
function _host(kind) { return _win ? _win.q(kind === 'read' ? 'vjob' : 'sjob') : null; }

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

// `start` answers the job's number (a request), or the job is one already running (`jobId`, followed again).
async function _start(id, kind, start, timing) {
  _jobs.set(id, { kind, busy: true, jobId: '', startedAt: Date.now(), ...timing, step: '', row: null, last: null });
  const job = _jobs.get(id);
  _paintList();
  _paintLocks();
  if (_sel === id) _paintJob();
  try {
    job.jobId = typeof start === 'string' ? start : (await start()).jobId;
    const done = await J.pollJob('/api/narrators/jobs', job.jobId, (s) => {
      if (!s.step) return;
      job.step = s.step;
      if (job.row) job.row.say(s.step);
    });
    if (job.row) job.row.finish();
    job.row = null;
    job.busy = false;
    job.jobId = '';
    job.last = { text: kind === 'read' ? `Read · ${done.step || 'done'}` : `Transcribed · ${done.step || 'done'}`, err: false };
    return done;
  } catch (e) {
    if (job.row) job.row.detach();
    job.row = null;
    job.busy = false;
    job.jobId = '';
    job.last = { text: e.message, err: true };
    return null;
  } finally {
    // The narrator may have been deleted meanwhile: then there is nothing to show the line on.
    if (_jobs.get(id) !== job) _jobs.delete(id);
    await _readList();
    _paintList();
    if (_win && _sel === id) await _show();
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
  await _start(id, 'sample', () => J.api(_nurl(id, '/samples/upload'), { method: 'POST', body: form }), {
    key: `l2-sample|${J.bucket(file.size / 1048576)}mb`, label: `Uploading ${J.mb(file.size)}…`, estimateMs: J.EST.sample(file.size),
  });
}

// (phase V27) A link instead of a file: the server fetches only its sound, transcribes it and lets it go.
async function _addLink() {
  const id = _rec ? String(_rec.narrator.id) : '';
  if (!id || id !== _sel || _running(id)) return;
  const input = _win.q('url');
  const url = input.value.trim();
  if (!url) { J.sayJob(_win.q('sjob'), 'Paste a link first.', true); return; }
  if (!confirm('Transcribe the video at this link into a sample?\n\nOnly its sound is fetched. It is a paid speech-to-text call.')) return;
  input.value = '';
  await _start(id, 'sample', () => _post(_nurl(id, '/samples/link'), { url }),
    { key: 'l2-sample|link', label: 'Reading the link…', estimateMs: J.EST.ingestLink });
}

const _readTiming = (words) => ({ key: `l2-read|${J.bucket(words)}`, label: `Reading ${words} words…`, estimateMs: J.EST.analyse });

// (V38) "Read new samples": the ones not read yet - by the agents' ladder (Admin -> AI settings), as every agent.
async function _read() {
  const id = _rec ? String(_rec.narrator.id) : '';
  if (!id || id !== _sel || _running(id)) return;
  const words = _unread().reduce((s, x) => s + (x.words || 0), 0);
  const done = await _start(id, 'read', () => _post(_nurl(id, '/read')), _readTiming(words));
  if (done) {
    // What the reading proposed is where the ticks are: the vocabulary, or the phrases, when the voice has nothing new.
    const a = done.added || {};
    if (_sel === id && _view === 'voice' && !a.voice && (a.vocabulary || a.phrases)) {
      _view = a.vocabulary ? 'vocabulary' : 'phrases';
      _paintRight();
    }
    _announce();
  }
}

// A reading the page did not start (a reload): its row back at its real age, its landing as usual.
function _follow(id, jobId, startedAt) {
  const words = _unread().reduce((s, x) => s + (x.words || 0), 0);
  _start(id, 'read', jobId, { ..._readTiming(words), startedAt: startedAt || Date.now() }).then((done) => { if (done) _announce(); });
}
