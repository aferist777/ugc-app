// LIBRARY — the narrators: "Narrators" beside "New scenario" on the Scenarios shelf, an AREA in place of the
// scenario list (phase V28.2, the owner 2026-10-12: "кнопка будет открывать не попап, а вместо поля сценариев будет
// отображаться интерфейс настроек и чтений нарраторов"); the gear by the generator's Narrator field leads here too.
// js/library/main.js shows and hides it, as it does the making areas.
//
// A narrator is HOW a script is written: samples of an author's writing in, and out of them ONE VOICE (phase V38, the
// owner 2026-10-23: "the voice должен обновляться если нужно, но только дополняться"). Three columns: the narrators - ONE
// ROW ALWAYS SELECTED, as on every Library shelf, with "+ New narrator" opening a name field right in the list (prompt()
// throws in the app's Electron) - then the selected one's samples (each says whether it has been read; a source of the
// Library is one for nothing), then the voice: its lines by field, each corrected in place or deleted (✕ twice), the
// lines the last reading added saying "new" - the app only ever ADDS to it (the owner's (д15), (д17)). "Read new samples"
// at the column's foot reads only the samples not read yet. (V38's vocabulary and phrases under crumbs beside the voice
// were taken out by the owner, V38.1: "для самого нарратора убираем новые крошки".)
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
import { twoPress } from '../really.js';

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

const VOICE_ROWS = [
  ['summary', 'Who this voice is'], ['sentences', 'Sentences'], ['rhythm', 'Rhythm'],
  ['address', 'Address'], ['register', 'Register'], ['imagery', 'Imagery'],
  ['humour', 'Humour'], ['openings', 'Openings'], ['endings', 'Endings'], ['stance', 'Stance'],
  ['signature_moves', 'Signature moves'], ['never_does', 'Never does'],
];

const _announce = () => document.dispatchEvent(new CustomEvent('lib:narrators'));
// Busy from the press - the upload of a file comes before its job has a number - to the last line.
const _running = (id) => { const j = _jobs.get(String(id)); return !!(j && j.busy); };
const _post = (url, body, method) => J.api(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const _nurl = (id, rest) => `/api/narrators/${encodeURIComponent(id)}${rest || ''}`;

// ── The area ────────────────────────────────────────────────────────────────
const HTML = `
    <div class="mk-panel-head">
      <span class="mk-panel-t">Narrators</span>
      <span class="mk-note">how a script is written — writing by an author in, a voice out</span>
    </div>
    <div class="nr-said" data-f="said" hidden></div>
    <div class="nr-body">
      <aside class="nr-list-col">
        <button class="mk-add nr-new u-btn is-s" type="button" data-f="new" title="Make a narrator - a name first, samples after">+ New narrator</button>
        <div class="nr-list" data-f="list"></div>
      </aside>
      <section class="nr-col">
        <div class="nr-col-h">Samples <em>— writing by this author</em><span class="sp"></span><span class="nr-words" data-f="words"></span></div>
        <div class="nr-samples" data-f="samples"></div>
        <div class="nr-add">
          <textarea data-f="text" rows="4" placeholder="Paste writing by this author…"></textarea>
          <div class="nr-add-row">
            <button class="u-btn is-s" type="button" data-f="addtext">Add text</button>
            <span class="sp"></span>
            <input type="file" data-f="file" accept="video/*,audio/*">
            <button class="u-btn is-s" type="button" data-f="addfile" title="Transcribe the file and keep its words as a sample - a paid call">Transcribe a file</button>
          </div>
          <div class="nr-add-row">
            <input type="text" class="nr-url" data-f="url" placeholder="…or a link - YouTube, TikTok, Instagram">
            <button class="u-btn is-s" type="button" data-f="addlink" title="Fetch the video's sound, transcribe it and keep its words as a sample - a paid call">Transcribe a link</button>
          </div>
          <div class="nr-add-row">
            <select class="nr-url nr-src-pick" data-f="src"><option value="">…or a source of the Library</option></select>
            <button class="u-btn is-s" type="button" data-f="addsrc" title="Its words were heard when it came in - they become the sample, for nothing">Add the source</button>
          </div>
          <p class="mk-pnote">A video or audio file - or a link, of which only the sound is fetched, without a login - is
            transcribed (a paid call), and its words become the sample. A source of the Library was heard when it came in:
            its words become the sample for nothing.</p>
          <div class="mk-job" data-f="sjob" hidden></div>
        </div>
      </section>
      <section class="nr-col nr-right">
        <div class="nr-col-h">The voice <em>— as a model will be told it</em></div>
        <div class="nr-view" data-f="view"></div>
        <div class="nr-foot">
          <div class="mk-job" data-f="vjob" hidden></div>
          <div class="nr-foot-row">
            <span class="nr-foot-note" data-f="readnote"></span>
            <button class="u-btn is-main" type="button" data-f="read" title="Read the samples not read yet - only what is new is added to the voice - a paid call">Read new samples</button>
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
  const x = el('button', 'mk-said-x u-btn is-s is-icon is-quiet u-x', '');
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
    main.appendChild(el('div', 'nr-row-s', [it.samples + (it.samples === 1 ? ' sample' : ' samples'), it.words + ' words'].join(' · ')));
    row.appendChild(main);
    const [kind, text] = _tag(it);
    row.appendChild(el('span', 'mk-tag ' + (kind === 'run' ? 'wait' : kind), text));
    const x = el('button', 'nr-x u-btn is-s is-icon is-quiet is-del u-x', '');
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
  const lines = [`Delete the narrator "${it.name}"?`, '', 'Its samples and its voice go with it, and that cannot be undone.'];
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
  for (const k of ['samples', 'view', 'words', 'readnote']) _win.q(k).textContent = '';
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
    const x = el('button', 'nr-x u-btn is-s is-icon is-quiet is-del u-x', '');
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
  const said = s && s.readAt ? 'What was read from it stays in the voice.' : 'It has not been read yet.';
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

// ── The right column: the voice ────────────────────────────────────────────
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
  const box = _win.q('view');
  box.textContent = '';
  _paintVoice(box);
}

// A press arms a ✕ ("Really?" for three seconds); the second press within them does it - js/really.js (phase V73 block 2).
function _twice(btn, act) {
  twoPress(btn, { go: (e) => { e.stopPropagation(); act(); } });
}

// A text corrected in place: pressed, it takes the cursor; Enter or leaving it saves, Escape puts it back. `save(text)`
// answers the narrator; a refusal is said and the text put back.
function _editable(node, value, save, { multiline = false } = {}) {
  node.classList.add('nr-ed');
  node.textContent = value || '';
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
      ? 'Not read yet. Press “Read new samples” - the voice is read out of the samples.'
      : 'Not read yet. Add samples, then press “Read new samples”.'));
    return;
  }
  const last = n.lastRead || {};
  if (last.at) {
    const head = el('div', 'nr-voice-h');
    head.appendChild(el('span', 'nr-voice-at', ['last read ' + J.fmtDate(last.at), last.model].filter(Boolean).join(' · ')));
    box.appendChild(head);
  }
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
      const x = el('button', 'nr-x u-btn is-s is-icon is-quiet is-del u-x', '');
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
  if (done) _announce();
}

// A reading the page did not start (a reload): its row back at its real age, its landing as usual.
function _follow(id, jobId, startedAt) {
  const words = _unread().reduce((s, x) => s + (x.words || 0), 0);
  _start(id, 'read', jobId, { ..._readTiming(words), startedAt: startedAt || Date.now() }).then((done) => { if (done) _announce(); });
}
