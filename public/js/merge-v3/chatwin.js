/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the window that makes things by being talked to.

   ONE SHELL, TWO WINDOWS. Pictures and Animate are the same object: three columns,
   a thread that belongs to the project, a row of reference slots above the input,
   and a library down the right. What differs between them is DATA - which table of
   models, which slots, which endpoint, what a finished thing looks like in a bubble
   and which buttons sit under it. Not structure.

   So the structure lives here once, and each window is a spec. The alternative was a
   second copy of eleven hundred lines, where every fix has to be found twice and the
   second copy is where it quietly is not made.

   ── What the shell owns ─────────────────────────────────────────────────────
   The chrome. The thread and its scrolling manners. The attachment row. The hover
   peek. The masonry column. The lock. And - the part worth having in one place -
   THE CHOREOGRAPHY OF A SEND:

     lock everything that describes the job -> put the person's turn up -> raise one
     bubble that rewrites its own line as the work moves -> ask the writer -> submit ->
     poll until nothing is pending -> put the agent's turns up -> make the result the
     new reference -> unlock.

   Every step of that is identical for a picture and for a clip. Only the endpoints
   differ, and those are three functions on the spec.

   ── What a spec owns ────────────────────────────────────────────────────────
     title, cls, kind          what it is called, its modifier class, its chat kind
     left(host, api)           build the left column; called again when the choice
                               changes or the attachment count does
     slots(api)                the reference row's shape: [{kind,max,accept,label}]
     placeholder, emptyText    the words in the empty window
     think(text, refs, api)    the writer, or null for a window that has none
     submit(payload, api)      -> [id] ; one call per attempt is the spec's business
     feed(api)                 -> [record] for this project, newest first
     cats(api) / shelf(cat)    the right column when it is showing the library
     result(g, api)            -> the node a finished record draws as, or null
     facts(g)                  -> [[label, value]] for the folded technical half
     acts(g, api)              -> [button]
     upload(files, api)        bringing one in from the disk
     done(g) / pending(g)      reading a record's state

   ── The api handed to a spec ────────────────────────────────────────────────
   Everything a spec is allowed to do to the window, and nothing else: attach,
   detach, atts, project, trackId, peek, note, repaint, say, thumbOf, el.
   ════════════════════════════════════════════════════════════════════════════ */

import { startInlineProgress, lockControls } from '../progress.js';
import { askDelete, closeAsk, note } from './ask.js';
import * as Store from './store.js';

export const POLL_MS = 4000;

// Ten, and the row shows all ten as empty places from the start. A row that grows as it is
// filled never TELLS anybody it can be filled - and the whole point of it standing there empty
// is that attaching is discoverable without being explained.
const MAX_ATTS = 10;

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export const ratioOf = (ar) => {
  const p = String(ar || '9:16').split(':');
  return (+p[0] || 1) / (+p[1] || 1);
};

export const money = (v) => '$' + (+(+v).toFixed(4));
export const thumbOf = (p, v) => '/api/thumb?src=' + encodeURIComponent(p) + '&v=' + (v || 'card');

// A library record carries its size; a shape is what the column needs to lay it out. Without
// one a square is the safest guess - it is wrong by less than anything else.
export function arOf(i) {
  const w = +(i.w || (i.meta || {}).w || 0);
  const h = +(i.h || (i.meta || {}).h || 0);
  return (w > 0 && h > 0) ? (w + ':' + h) : '1:1';
}

// Whether a path is a moving picture. Used in three places - the tile, the peek, the
// attachment cell - and each of them draws a different element for it.
export const isVid = (p) => /\.(mp4|mov|webm|mkv)(\?|$)/i.test(String(p || ''));

// ── The one live window ─────────────────────────────────────────────────────
// One at a time, deliberately: both are full-screen and opening the second over the first
// would leave two threads polling the same project behind one another.
let _open = null;
let _thread = [];
let _shelf = [];
let _timer = 0;
let _made = false;

export const current = () => _open;

// ── Hover peek ──────────────────────────────────────────────────────────────
let _peek = null;

export function peekShow(src, anchor) {
  peekHide();
  const box = el('div', 'mv3-ig-peek');
  // A clip peeks as a clip. A poster frame would say what it is of and not what it does, and
  // what it does is the only thing worth looking at twice.
  const m = document.createElement(isVid(src) ? 'video' : 'img');
  m.src = src;
  if (isVid(src)) { m.autoplay = true; m.loop = true; m.muted = true; m.playsInline = true; }
  box.appendChild(m);
  document.body.appendChild(box);
  _peek = box;
  const r = anchor.getBoundingClientRect();
  // To the left of what is hovered, which for the strip is the only side with room, and clamped
  // so something near the bottom does not open off the screen.
  const w = 400, h = Math.min(520, window.innerHeight - 40);
  box.style.width = w + 'px';
  box.style.maxHeight = h + 'px';
  box.style.left = Math.max(8, r.left - w - 12) + 'px';
  box.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top - 40)) + 'px';
}

export function peekHide() {
  if (_peek) { try { _peek.remove(); } catch (e) {} _peek = null; }
}

// ── The lock ────────────────────────────────────────────────────────────────
// WHAT IS FROZEN WHILE SOMETHING IS BEING MADE, and what is not.
//
// Frozen: everything that would describe a DIFFERENT job from the one already sent - the model,
// its settings, the count, the writer, attaching and detaching, and sending again.
//
// Not frozen: typing, and looking. A sentence half-written when the button was pressed is a
// sentence somebody is still thinking about, and taking the keyboard away to finish a job they
// already asked for is rude.
function _setLocked(on) {
  if (!_open) return;
  _open.locked = !!on;
  _open.box.classList.toggle('is-locked', !!on);
}

// ── The attachment row ──────────────────────────────────────────────────────
// The lock is NOT read here on purpose. It belongs at the entrances - the click on a tile, the
// buttons on a finished thing, the crosses - and putting it in the mechanism refused the
// window's own attaching of the result it had just made, which happens while the lock is still
// on. A guard in the wrong place looks like the right one right up until it stops something it
// was never aimed at.
function _attach(path, name, kind) {
  if (!path || !_open) return;
  if (_open.atts.some(a => a.path === path)) return;      // twice is not more reference
  const k = kind || (isVid(path) ? 'video' : 'image');
  // A SLOT IS A PLACE WITH AN APPETITE. The model says what it takes and how many of each; a
  // second clip handed to a model that wants one would be dropped by the submit anyway, and
  // silently. Refused here instead, where the row can show why.
  const slots = _open.slots || [];
  const room = slots.filter(s => s.kind === k).reduce((n, s) => n + (s.max || 1), 0)
    || (slots.length ? 0 : MAX_ATTS);
  if (_open.atts.filter(a => a.kind === k).length >= room) return;
  if (_open.atts.length >= MAX_ATTS) return;
  _open.atts.push({ path, name: name || '', kind: k });
  _paintAtts();
}

function _detach(path) {
  if (!_open) return;
  _open.atts = _open.atts.filter(a => a.path !== path);
  _paintAtts();
  _paintStrip();
}

function _paintAtts() {
  const host = _open.atts_;
  host.textContent = '';
  // ASKED FOR FIRST, DRAWN SECOND. The row IS the model's input list, so it cannot be drawn
  // before the model has been asked what it takes - and the left column, which is what changes
  // the answer, is repainted at the end of this rather than the start.
  _open.slots = _open.spec.slots ? _open.spec.slots(_api()) : null;
  const slots = _open.slots || [];
  const n = _open.atts.length;

  _open.atts.forEach((a, i) => {
    const cell = el('div', 'mv3-ig-att' + (a.kind === 'video' ? ' is-vid' : ''));
    const img = document.createElement('img');
    img.src = thumbOf(a.path, 'strip');
    img.loading = 'lazy';
    img.decoding = 'async';
    cell.appendChild(img);
    // The NUMBER is the point of the row rather than decoration: with more than one reference a
    // message has to be able to say which is which, and "the second one" needs a visible second.
    cell.appendChild(el('span', 'n', String(i + 1)));
    const x = el('button', 'x', '✕');
    x.type = 'button';
    x.title = 'Not this one';
    x.addEventListener('click', () => { if (!_open.locked) _detach(a.path); });
    cell.appendChild(x);
    // What a spec wants to hang on an attachment - the trimmer on a motion clip is the one
    // that exists. Given the cell so it can put its own control wherever it likes.
    if (_open.spec.attExtra) _open.spec.attExtra(cell, a, _api());
    cell.addEventListener('mouseenter', () => peekShow(a.kind === 'video' ? a.path : thumbOf(a.path, 'main'), cell));
    cell.addEventListener('mouseleave', peekHide);
    host.appendChild(cell);
  });

  // THE EMPTY PLACES ARE THE INVITATION, and here they also SAY WHAT GOES IN THEM. A window
  // whose model wants a picture and a clip has two different holes to fill, and a row of ten
  // identical plus signs would not be telling anybody that.
  const want = [];
  for (const s of slots) {
    const have = _open.atts.filter(a => a.kind === s.kind).length;
    for (let i = have; i < (s.max || 1); i++) want.push(s);
  }
  // NO DEAD GROUND when the model has said what it wants. Nine dimmed squares beside the two
  // real holes would be nine places that look like they might take something.
  const spare = slots.length ? 0 : MAX_ATTS - n;
  want.forEach((s, i) => {
    const slot = el('button', 'mv3-ig-att-slot is-' + s.kind, s.kind === 'video' ? '▶' : '+');
    slot.type = 'button';
    slot.title = s.label + (s.hint ? ' — ' + s.hint : '');
    slot.addEventListener('click', () => { if (!_open.locked) _pick(s.accept || 'image/*'); });
    host.appendChild(slot);
  });
  for (let i = 0; i < spare; i++) {
    const slot = el('button', 'mv3-ig-att-slot is-spare', '+');
    slot.type = 'button';
    slot.disabled = !!slots.length;
    if (!slots.length && i === 0) slot.title = 'Attach - from this computer, or by clicking one on the right';
    slot.addEventListener('click', () => { if (!_open.locked) _pick('image/*'); });
    host.appendChild(slot);
  }

  // Said once, quietly, and only when it can matter. With two or more references a message that
  // does not say which is which leaves the model to guess.
  if (n >= 2) host.appendChild(el('span', 'mv3-ig-att-note', 'Say which one you mean by its number.'));

  _paintLeft();
}

function _pick(accept) {
  _open.file.accept = accept;
  _open.file.click();
}

// ── The left column ─────────────────────────────────────────────────────────
// Rebuilt rather than patched: what it offers depends on what is attached - a model that only
// edits is impossible with nothing attached, and one that only draws is impossible with
// something - so the honest thing is to ask the spec again.
function _paintLeft() {
  if (!_open) return;
  _open.spec.left(_open.left, _api());
}

// ── The thread ──────────────────────────────────────────────────────────────
async function _loadThread() {
  if (!_open) return;
  const d = await fetch('/api/mv3/chat?project=' + encodeURIComponent(_open.project)
    + '&kind=' + encodeURIComponent(_open.spec.kind)).then(r => r.json()).catch(() => null);
  if (!d || !d.success || !_open) return;
  _thread = d.items || [];
  _paintThread();
}

// Only when the reader was already at the bottom. Pulling somebody back down while they are
// reading something older is the rudest thing a thread can do.
function _atEnd() {
  const t = _open.thread_;
  return t.scrollTop + t.clientHeight >= t.scrollHeight - 40;
}

function _paintThread() {
  if (!_open) return;
  const host = _open.thread_;
  const wasAtEnd = _atEnd();
  host.textContent = '';

  if (!_thread.length && !_open.busy) {
    host.appendChild(el('div', 'mv3-ig-empty', _open.spec.emptyText));
  }
  for (const m of _thread) {
    // A generation this window is CURRENTLY waiting on already has a cloud - the busy bubble
    // below. The thread folds in any generation that has no turn of its own, so without this
    // the record landing on the server puts a second cloud beside the first, and both sit there
    // saying the same thing about the same job until it arrives.
    if (m.loose && _open.waiting.includes(m.genId)) continue;
    host.appendChild(_bubble(m));
  }
  if (_open.busy) host.appendChild(_open.busy);
  if (wasAtEnd) host.scrollTop = host.scrollHeight;
}

function _bubble(m) {
  const b = el('div', 'mv3-ig-msg is-' + (m.role === 'user' ? 'user' : 'agent'));
  if (m.text) b.appendChild(el('div', 'mv3-ig-text', m.text));

  // What the message was pointing at, when it was pointing at something - numbered the same way
  // the row above the input numbered them, because that is what the words refer to.
  if ((m.refs || []).length && m.role === 'user') {
    const row = el('div', 'mv3-ig-msg-refs');
    m.refs.forEach((p, i) => {
      const c = el('div', 'mv3-ig-msg-ref' + (isVid(p) ? ' is-vid' : ''));
      const img = document.createElement('img');
      img.src = thumbOf(p, 'strip');
      img.loading = 'lazy'; img.decoding = 'async';
      c.appendChild(img);
      c.appendChild(el('span', 'n', String(i + 1)));
      c.addEventListener('mouseenter', () => peekShow(isVid(p) ? p : thumbOf(p, 'main'), c));
      c.addEventListener('mouseleave', peekHide);
      row.appendChild(c);
    });
    b.appendChild(row);
  }

  const g = m.gen;
  if (g) {
    if (_open.spec.done(g)) {
      const fig = el('div', 'mv3-ig-shot-wrap');
      const node = _open.spec.result(g, _api());
      if (node) fig.appendChild(node);
      const acts = el('div', 'mv3-ig-acts');
      for (const btn of _open.spec.acts(g, _api())) acts.appendChild(btn);
      fig.appendChild(acts);
      b.appendChild(fig);
    } else if (_open.spec.pending(g)) {
      const ghost = el('div', 'mv3-ig-shot is-busy');
      ghost.style.aspectRatio = String(g.aspect || '9:16').replace(':', '/');
      b.appendChild(ghost);
      b.appendChild(el('div', 'mv3-ig-note', _open.spec.waitWord || 'still working on this one…'));
    } else {
      b.appendChild(el('div', 'mv3-ig-bad', g.error || 'nothing came back'));
    }
    b.appendChild(_facts(m, g));
  }
  return b;
}

// The technical half, folded away. Brief above and everything underneath - including what was
// actually sent, which is the only way a thing that came out wrong can be argued with.
function _facts(m, g) {
  const wrap = el('div', 'mv3-ig-more');
  const btn = el('button', 'mv3-ig-more-b', 'read more');
  btn.type = 'button';
  const body = el('div', 'mv3-ig-more-body');
  body.hidden = true;

  const rows = _open.spec.facts(g).slice();
  // Said by the shell rather than by each spec, because it is the same fact either way and it
  // is the whole reason the writer is allowed to touch anything.
  if (g.said && g.prompt && g.said !== g.prompt) rows.push(['sent as', g.prompt]);
  else if (m.sent && m.sent !== m.text) rows.push(['sent as', m.sent]);

  for (const [k, v] of rows) {
    if (!v) continue;
    const r = el('div', 'mv3-ig-more-row');
    r.appendChild(el('span', 'k', k));
    r.appendChild(el('span', 'v', String(v)));
    body.appendChild(r);
  }

  btn.addEventListener('click', () => {
    body.hidden = !body.hidden;
    btn.textContent = body.hidden ? 'read more' : 'less';
  });
  wrap.appendChild(btn);
  wrap.appendChild(body);
  return wrap;
}

// Everything this thread has finished, for a viewer that can be paged through.
export const finished = () => _thread.filter(x => x.gen && _open.spec.done(x.gen)).map(x => x.gen);

// ── A project to belong to ──────────────────────────────────────────────────
// Generating outside a project used to leave a result nothing could be done with: the thread
// had nowhere to file it and the timeline it would go onto did not exist. So the first message
// makes the project rather than asking for one - the person came here to make something, and a
// dialog about naming things is not what they came for.
async function _ensureProject() {
  if (_open.project) return true;
  const today = new Date().toISOString().slice(0, 10);
  // Two projects may not share a name, and this one names itself - so the second one started on
  // the same day would be refused for colliding with the first. Numbered until it is not.
  let d = null;
  for (let n = 1; n <= 40 && !(d && d.success); n++) {
    d = await fetch('/api/mv3/timeline/new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: today + ' - untitled' + (n > 1 ? ' ' + n : ''), kind: Store.BLANK_KIND }),
    }).then(r => r.json()).catch(() => null);
    if (d && !d.success && !/already exists/i.test(String(d.error || ''))) break;
  }
  if (!d || !d.success) throw new Error((d && d.error) || 'could not start a project for this');

  await Store.open(d.key);
  _open.project = d.key;
  _open.projB.textContent = Store.title() || d.key;
  _open.stripProj.textContent = Store.title() || d.key;
  // The lanes of the project that was open when this window opened are gone with it, so the
  // remembered one is dropped rather than pointed at something that no longer exists.
  _open.trackId = '';
  await _loadThread();
  await _loadCats();
  return true;
}

// ── Saying something ────────────────────────────────────────────────────────
// THE CHOREOGRAPHY, and the reason this file exists. Every line of it is the same for a picture
// and for a clip; the three places they differ are calls into the spec.
async function _send() {
  if (_open.locked) return;
  const ta = _open.ta;
  const text = ta.value.trim();
  const refs = _open.atts.map(a => a.path);

  // A model that will not work without a reference says so before anything is spent.
  const missing = (_open.slots || []).find(s =>
    (s.min || 0) > _open.atts.filter(a => a.kind === s.kind).length);
  if (missing) {
    note(_open.go, 'This model needs ' + missing.label + '.', missing.hint || '');
    setTimeout(() => closeAsk(), 3000);
    return;
  }
  if (!text && !_open.spec.promptOptional) {
    ta.focus();
    ta.classList.add('is-bad');
    setTimeout(() => ta.classList.remove('is-bad'), 900);
    return;
  }

  try { await _ensureProject(); }
  catch (err) { note(_open.go, 'Could not start a project.', String(err.message || err).slice(0, 120)); return; }

  const api = _api();
  const unlock = lockControls([_open.go, _open.nBtn, _open.pen, _open.clip,
    ..._open.left.querySelectorAll('button, select, input')]);
  _setLocked(true);
  ta.value = '';
  ta.style.height = 'auto';
  _open.said.textContent = '';

  // The turn goes up before anything is asked of anyone, so the thread reads like a conversation
  // rather than appearing all at once when it is over.
  await fetch('/api/mv3/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: _open.project, kind: _open.spec.kind, role: 'user', text, refs }),
  }).catch(() => {});
  await _loadThread();

  // ── The waiting, shown as what it actually is ────────────────────────────
  // ONE bubble that rewrites its own line as the work moves, rather than a spinner cycling
  // captions on a timer. Every line below is a state this window is genuinely in, which is what
  // makes it worth showing: when something hangs, the line it is stuck on is the diagnosis.
  const busy = el('div', 'mv3-ig-msg is-agent is-busy');
  const ghost = el('div', 'mv3-ig-shot is-busy');
  ghost.style.aspectRatio = String(_open.spec.aspect(api) || '9:16').replace(':', '/');
  busy.appendChild(ghost);
  // A STRIP OF ITS OWN for the countdown to fill. startInlineProgress lays its row out with
  // position:absolute and inset:0 - it was written to cover a lane too short for the full card
  // - so with no positioned box to cover, it anchored to the page and spread across the screen.
  const progHost = el('div', 'mv3-ig-prog');
  busy.appendChild(progHost);
  _open.busy = busy;
  _paintThread();

  const prog = startInlineProgress(progHost, _open.spec.progress(refs.length, api));

  let payload = { text, refs, prompt: text };
  try {
    if (_open.write && _open.spec.think) {
      prog.say(refs.length
        ? 'reading your message and ' + refs.length + (refs.length === 1 ? ' reference…' : ' references…')
        : 'reading your message…');
      const think = await _open.spec.think(text, refs, api);
      // A QUESTION IS A TURN, NOT A FAILURE. It happens when two or more references are attached
      // and the message never says which is which - the model would only guess, and a guess
      // costs the same as an answer.
      if (think && think.ask) {
        prog.detach();
        _open.busy = null;
        _open.waiting = [];
        _setLocked(false);
        await fetch('/api/mv3/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: _open.project, kind: _open.spec.kind, role: 'agent', text: think.ask }),
        }).catch(() => {});
        await _loadThread();
        unlock();
        ta.focus();
        return;
      }
      if (think && think.prompt) {
        payload = { ...payload, ...think };
        if (think.fell) _open.said.textContent = 'sent as typed - ' + think.fell;
        else prog.say('writing the prompt…');
      }
    }
  } catch (err) { /* the words as typed are always a working fallback */ }

  try {
    prog.say(_open.spec.askWord(api));
    const ids = await _open.spec.submit(payload, api);
    if (!ids || !ids.length) throw new Error('the model refused the job');
    // Set on the WAY IN rather than on the way out. By the time this window closes the thing is
    // either on the shelf or on its way to it, and the shelf behind was read before either was
    // true - which is what made a generation look like it had never been saved.
    _made = true;
    prog.say(_open.spec.madeWord(ids.length, api));

    // THE TURN IS WRITTEN WHEN IT LANDS, not when it is asked for. Writing it now would put a
    // second cloud in the thread - the turn's own pending bubble beside this one - both saying
    // the same thing about the same job.
    //
    // Nothing is risked by waiting: if this window closes mid-flight the server still finishes
    // and files the result, and the thread folds in any generation that has no turn of its own,
    // at its own time. It appears in the right place either way.
    _open.waiting = ids;
    let landed = [];
    for (let i = 0; i < 450 && _open; i++) {
      await new Promise(r => setTimeout(r, POLL_MS));
      if (!_open) return;
      await _loadThread();
      await _loadStrip();
      const rows = _thread.filter(x => x.gen && ids.includes(x.gen.id)).map(x => x.gen);
      // A ladder that fell says so while it is still falling: the record carries the reason for
      // as long as it is true, and a wait that explains itself is not the same wait.
      const fell = rows.find(x => _open.spec.pending(x) && x.error);
      if (fell) prog.say(String(fell.error).slice(0, 60) + ' — trying the next…');
      if (rows.length && rows.every(x => !_open.spec.pending(x))) { landed = rows; break; }
    }

    _open.busy = null;
    _open.waiting = [];
    // Now that there is something to show, the turns go up - and the thread reads back exactly
    // as it happened whether or not this window was still open to write them.
    for (const g of landed) {
      await fetch('/api/mv3/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: _open.project, kind: _open.spec.kind, role: 'agent', text: '', genId: g.id, refs }),
      }).catch(() => {});
    }
    await _loadThread();
    const won = landed.filter(x => _open.spec.done(x));
    if (won.length) {
      prog.finish();
      // THE RESULT BECOMES THE REFERENCE. Whatever is said next is almost always about what just
      // arrived. Only for windows that can carry on from their own output - a clip is not a
      // reference a video model takes, so Animate keeps what was already in the row.
      if (_open.spec.resultIsReference) {
        _open.atts = [];
        _attach(_open.spec.pathOf(won[0]), won[0].prompt || '');
      } else {
        _paintAtts();
      }
      // AND THE COLUMN COMES HOME. Something was just made, and this project's own run is where
      // it landed - leaving the picker on whichever library shelf was being browsed hides the
      // thing that was just paid for behind a dropdown.
      if (_open.cat.value) {
        _open.cat.value = '';
        await _loadStrip();
      }
    } else if (landed.length) {
      prog.fail(String(landed[0].error || 'nothing came back').slice(0, 160));
    } else {
      // Out of patience here, but the job is not lost: the server watches it to the end and
      // files it, so it will be in the thread whenever it lands.
      prog.detach();
    }
    _paintThread();
    _paintStrip();
  } catch (err) {
    _open.busy = null;
    _open.waiting = [];
    prog.fail(String((err && err.message) || err).slice(0, 160));
    await _loadThread();
  } finally {
    unlock();
    _setLocked(false);
    ta.focus();
  }
}

// ── The right column ────────────────────────────────────────────────────────
// Two things wearing one shape. On this project it is the live run of work - what is still being
// made and what failed are part of what there is to see. On any other category it is the
// library, where everything is finished by definition.
async function _loadCats() {
  if (!_open) return;
  const cats = await _open.spec.cats(_api()).catch(() => []);
  if (!_open) return;
  const want = _open.cat.value || '';
  _open.cat.innerHTML = '';
  const mine = document.createElement('option');
  mine.value = ''; mine.textContent = 'this project';
  _open.cat.appendChild(mine);
  for (const c of (cats || [])) {
    if (!c || !c.id) continue;
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.label || c.id;
    _open.cat.appendChild(o);
  }
  _open.cat.value = [..._open.cat.options].some(o => o.value === want) ? want : '';
}

async function _loadStrip() {
  if (!_open) return;
  const items = await _open.spec.shelf(_open.cat.value, _api()).catch(() => []);
  if (!_open) return;
  _shelf = items || [];
  _paintStrip();
}

/**
 * Mixed shapes, stacked in columns.
 *
 * A grid cannot do this: one box for every cell means a 21:9 still is either letterboxed into a
 * tall hole or cropped square, and cropping is exactly what makes a picture impossible to judge.
 * Row spans do not save it either - CSS grid fills row by row, so a short tile beside a tall one
 * leaves a hole under it until the next row starts.
 *
 * So each column is its own stack and the next tile goes into whichever is currently shorter.
 * Exact rather than measured: the columns are the same width, so a tile's height in
 * column-widths is simply h/w, and the running totals can be added up before anything is drawn.
 */
function _paintStrip() {
  if (!_open) return;
  const host = _open.strip;
  const wide = host.clientWidth - 16;
  const cols = wide >= 150 ? 2 : 1;
  const H = new Array(cols).fill(0);
  const boxes = [];
  for (let i = 0; i < cols; i++) boxes.push(el('div', 'mv3-ig-col'));

  // ADDING IS THE OTHER HALF OF POINTING. This column is the library, and a library you can
  // only take from is half a library - the panel behind this window has had a plus tile in the
  // same corner since it was built, and somebody looking at a shelf of pictures reasonably
  // expects to be able to put one on it. What arrives is attached straight away, because
  // bringing a picture in and then having to find it again is two steps for one intention.
  boxes[0].appendChild(_plusTile());
  H[0] += 0.5;

  for (const it of _shelf) {
    let k = 0;
    for (let j = 1; j < cols; j++) if (H[j] < H[k]) k = j;
    H[k] += 1 / ratioOf(it.aspect);
    boxes[k].appendChild(_tile(it));
  }

  host.replaceChildren(...boxes);
  _open.count.textContent = String(_shelf.length);
  if (!_shelf.length) {
    const none = el('div', 'mv3-ig-none', _open.cat.value
      ? 'Nothing in this category.'
      : 'Nothing made in this project yet.');
    // The plus survives an empty shelf - it is the only way in, and an empty column that
    // offers nothing is a dead end rather than an invitation.
    host.replaceChildren(none, _plusTile());
  }
}

// Half a tile tall, dashed, first in the column: the same shape and the same corner the Merge
// library panel uses, so the two read as one gesture rather than two.
function _plusTile() {
  const b = el('button', 'mv3-ig-card is-plus', '+');
  b.type = 'button';
  const kinds = (_open.slots || []).map(x => x.kind);
  b.title = 'Add ' + (kinds.includes('video') ? 'a picture or a clip' : 'a picture')
    + ' from this computer. It goes on the shelf and straight into the row above the message box.';
  b.addEventListener('click', () => {
    if (_open.locked) return;
    _pick((_open.slots || []).map(x => x.accept).filter(Boolean).join(',') || 'image/*');
  });
  return b;
}

function _tile(it) {
  const vid = isVid(it.path);
  const el_ = el('div', 'mv3-ig-card'
    + (it.state === 'pending' ? ' is-busy' : it.state === 'failed' ? ' is-fail' : '')
    + (vid ? ' is-vid' : '')
    + (_open.atts.some(a => a.path === it.path) ? ' on' : ''));
  el_.style.aspectRatio = String(it.aspect || '1:1').replace(':', '/');
  el_.title = it.name || '';

  if (it.state === 'done' && it.path) {
    const img = document.createElement('img');
    // The thumbnail, never the original: a 4K picture would otherwise be decoded at full size to
    // fill a hundred-pixel tile.
    img.src = thumbOf(it.thumb || it.path, 'card');
    img.alt = it.name || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    el_.appendChild(img);
    el_.draggable = true;
    // The same payload the library's own cells carry, so a tile can be dragged onto a lane
    // exactly like anything on the shelf.
    el_.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData(Store.DRAG_TYPE, JSON.stringify({
        libId: it.libId || '', src: it.path, thumb: it.thumb || it.path,
        name: (it.name || '').slice(0, 60), group: vid ? 'birols' : 'images', dur: 0,
      }));
      el_.classList.add('is-dragging');
    });
    el_.addEventListener('dragend', () => el_.classList.remove('is-dragging'));
    el_.addEventListener('mouseenter', () => peekShow(vid ? it.path : thumbOf(it.path, 'main'), el_));
    el_.addEventListener('mouseleave', peekHide);
    // Clicking ATTACHES, and clicking again takes it back off. This column is what there is to
    // point at, and pointing is the whole of what can be done from here.
    el_.addEventListener('click', () => {
      if (_open.locked) return;
      peekHide();
      if (_open.atts.some(a => a.path === it.path)) _detach(it.path);
      else { _attach(it.path, it.name); _paintStrip(); }
    });
  } else if (it.state === 'pending') {
    el_.appendChild(el('span', 'sp', 'making…'));
  } else {
    el_.appendChild(el('span', 'sp', String(it.error || 'failed').slice(0, 70)));
  }
  return el_;
}

// ── What a spec is allowed to do ────────────────────────────────────────────
function _api() {
  return {
    get project() { return _open.project; },
    get trackId() { return _open.trackId; },
    get atts() { return _open.atts.slice(); },
    get thread() { return _thread.slice(); },
    get locked() { return _open.locked; },
    el, thumbOf, money, peekShow, peekHide, isVid, arOf,
    attach: (p, n, k) => _attach(p, n, k),
    detach: (p) => _detach(p),
    repaint: () => { _paintAtts(); _paintStrip(); _paintThread(); },
    strip: () => _loadStrip(),
    say: (t) => { _open.said.textContent = t || ''; },
    made: () => { _made = true; },
    ensureProject: () => _ensureProject(),
    note, closeAsk,
    finished,
  };
}

// ── Bringing one in from the disk ───────────────────────────────────────────
async function _upload(files) {
  if (!_open) return;
  await _open.spec.upload([...(files || [])], _api());
  if (!_open) return;
  // HOME, so the thing just added is visible. Uploads are filed under the PROJECT's own
  // category; left on whichever library shelf was being browsed, a picture brought in from the
  // disk would attach itself and then not be anywhere on screen.
  if (_open.cat.value) _open.cat.value = '';
  await _loadCats();
  await _loadStrip();
}

// ── Open and close ──────────────────────────────────────────────────────────
export function closeChatWindow() {
  if (!_open) return;
  const spec = _open.spec;
  closeAsk();
  peekHide();
  clearInterval(_timer);
  _timer = 0;
  document.removeEventListener('keydown', _open.key, true);
  try { _open.ov.remove(); } catch (e) {}
  _open = null;
  _thread = [];
  _shelf = [];

  // STRAIGHT TO WHERE THE RESULTS WENT. The library panel reads its shelf when it is shown, so
  // one that was already open has not heard about anything made since - which looks exactly like
  // a generation that was never saved. Only after something was actually made: switching the
  // shelf under someone who made nothing would be rearranging their desk for no reason.
  if (_made) {
    _made = false;
    import('./library.js').then(L => L.showGroup(spec.shelfGroup)).catch(() => {});
  }
}

/**
 * @param spec   what this window is - see the header.
 * @param opts   { track, attach: [{path,name,kind}] } - the lane it was opened from, and
 *               anything to put in the reference row before it is first drawn.
 */
// THE STYLESHEET COMES WITH THE WINDOW, not with the page. This module is imported on demand
// and so is the panel behind the gear; a stylesheet sitting in <head> for a window that most
// visits never open is the same waste one level down. Awaited, because a window drawn before
// its rules arrive is a flash of unstyled markup in the middle of the screen.
function _css() {
  return new Promise((resolve) => {
    if (document.getElementById('mv3-ig-css')) return resolve();
    const l = document.createElement('link');
    l.id = 'mv3-ig-css';
    l.rel = 'stylesheet';
    l.href = '/css/mv3-imagen.css';
    l.onload = l.onerror = () => resolve();
    document.head.appendChild(l);
  });
}

export async function openChatWindow(spec, opts) {
  closeChatWindow();
  await _css();
  const o = opts || {};

  const ov = el('div', 'mv3-x-ov mv3-ig-ov');
  const box = el('div', 'mv3-ig ' + (spec.cls || ''));
  // So a press in here says WHERE it was in the activity log (js/audit-client.js reads the
  // nearest data-audit-scope). From the spec, because one shell serves two windows and a
  // fixed name would file every Animate click under Pictures.
  box.dataset.auditScope = spec.title;

  // ── head ──
  const head = el('div', 'mv3-ig-head');
  head.appendChild(el('h3', null, spec.title));
  const proj = el('span', 'mv3-ig-proj');
  proj.innerHTML = 'for <b></b>';
  const projB = proj.querySelector('b');
  projB.textContent = Store.title() || (Store.key() ? Store.key() : 'no project');
  head.appendChild(proj);
  head.appendChild(el('span', 'sp'));

  // CLEARING THE THREAD IS SAFE, and worth saying so on the button: what was said goes, the
  // results stay. They are in the library and on the strip either way - a conversation is notes
  // about work, not the work.
  const wipe = el('button', 'mv3-ig-gear', '⌫');
  wipe.type = 'button';
  wipe.title = 'Clear this conversation. Everything made stays in the library and on the right.';
  wipe.addEventListener('click', () => askDelete(wipe, 'Clear this conversation?',
    'Everything made stays — in the library and in the column on the right. Only what was said goes.',
    async () => {
      await fetch('/api/mv3/chat?project=' + encodeURIComponent(_open.project)
        + '&kind=' + encodeURIComponent(spec.kind), { method: 'DELETE' }).catch(() => {});
      _open.atts = [];
      _paintAtts();
      await _loadThread();
    }));
  head.appendChild(wipe);

  const gear = el('button', 'mv3-ig-gear', '⚙');
  gear.type = 'button';
  gear.title = 'Models and ladders — which aggregator serves what, and in what order';
  // IMPORTED ON THE FIRST PRESS, not with the page - the panel is one most visits never open,
  // and it carries its own stylesheet as well as its own markup. Both arrive together, here.
  gear.addEventListener('click', async () => {
    gear.disabled = true;
    try {
      const G = await import('./gear.js');
      await G.openGear();
    } catch (err) {
      note(gear, 'Could not open the settings.', String((err && err.message) || err).slice(0, 120));
    } finally {
      gear.disabled = false;
    }
  });
  head.appendChild(gear);
  const x = el('button', 'mv3-x-close', '✕');
  x.type = 'button';
  x.addEventListener('click', () => closeChatWindow());
  head.appendChild(x);
  box.appendChild(head);

  const body = el('div', 'mv3-ig-body');

  // ── left: what to make it with ──
  const set = el('div', 'mv3-ig-set');
  const left = el('div', 'mv3-ig-scroll');
  set.appendChild(left);
  // OUTSIDE what the spec owns. A spec builds its column by emptying the host first, so a node
  // put inside it is detached the moment the panel is built - and api.say() would then be
  // writing into something no longer on the page, which is a message that silently never
  // appears. This one belongs to the shell, so the shell keeps it out of reach.
  const said = el('div', 'mv3-ig-said');
  set.appendChild(said);
  body.appendChild(set);

  // ── middle: the conversation ──
  const chat = el('div', 'mv3-ig-chat');
  const thread_ = el('div', 'mv3-ig-thread');
  chat.appendChild(thread_);
  const atts_ = el('div', 'mv3-ig-atts');
  chat.appendChild(atts_);

  // Built before the row that uses it: an empty place in the attachment row opens it too, and
  // it has to exist by the time that row is first painted.
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.multiple = true;
  file.hidden = true;
  file.addEventListener('change', () => { _upload(file.files); file.value = ''; });
  chat.appendChild(file);

  const bar = el('div', 'mv3-ig-bar');
  const clip = el('button', 'mv3-ig-clip', '+');
  clip.type = 'button';
  clip.title = 'Attach from this computer';
  clip.addEventListener('click', () => _pick(file.accept));
  bar.appendChild(clip);

  const ta = document.createElement('textarea');
  ta.className = 'mv3-ig-say';
  ta.rows = 1;
  ta.placeholder = spec.placeholder;
  bar.appendChild(ta);

  // THE WRITER. On, the message is rewritten into the shape the chosen model wants before it is
  // sent - the models do not want the same sentence, and nobody should have to hold a dozen rule
  // sets in their head to type one. Off, the words go exactly as typed, which is what you want
  // when comparing models or when you already know what you are doing.
  const pen = el('button', 'pen', '✎');
  pen.type = 'button';
  if (spec.think) bar.appendChild(pen);

  const nBtn = el('button', 'n', '×1');
  nBtn.type = 'button';
  nBtn.title = 'How many to make at once. Each is its own attempt.';
  if (spec.counts) bar.appendChild(nBtn);

  const go = el('button', 'b', 'Send');
  go.type = 'button';
  bar.appendChild(go);
  chat.appendChild(bar);
  body.appendChild(chat);

  // ── right: everything there is to point at ──
  const stripBox = el('div', 'mv3-ig-strip');
  const sHead = el('div', 'mv3-ig-strip-head');
  const stripProj = el('span', 'p', Store.title() || 'no project');
  sHead.appendChild(stripProj);
  const count = el('span', 'n', '0');
  sHead.appendChild(count);
  stripBox.appendChild(sHead);
  const cat = document.createElement('select');
  cat.className = 'mv3-ig-cat';
  stripBox.appendChild(cat);
  const strip = el('div', 'mv3-ig-strip-list');
  stripBox.appendChild(strip);
  body.appendChild(stripBox);

  box.appendChild(body);
  ov.appendChild(box);
  document.body.appendChild(ov);

  const key = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); closeChatWindow(); } };
  document.addEventListener('keydown', key, true);
  ov.addEventListener('mousedown', (ev) => { if (ev.target === ov) closeChatWindow(); });

  _open = {
    spec, ov, box, key, left, said, ta, go, nBtn, clip, pen, file,
    thread_, atts_, strip, count, cat, projB, stripProj,
    trackId: (o.track && o.track.id) || '',
    project: Store.key() || '',
    n: 1, atts: [], slots: null, busy: null, locked: false,
    // The generations this window is watching right now. Their turns are drawn by the busy
    // bubble instead, so the thread must not draw them a second time.
    waiting: [],
    write: spec.think ? spec.writeDefault !== false : false,
  };
  _thread = [];
  _shelf = [];

  // Whatever the caller wants in the row before it is first drawn - the picture an Animate
  // button was pressed on, most of the time.
  for (const a of (o.attach || [])) {
    if (a && a.path) _open.atts.push({ path: a.path, name: a.name || '', kind: a.kind || (isVid(a.path) ? 'video' : 'image') });
  }

  cat.addEventListener('change', () => _loadStrip());
  nBtn.addEventListener('click', () => {
    _open.n = _open.n === 1 ? 2 : _open.n === 2 ? 4 : 1;
    nBtn.textContent = '×' + _open.n;
    _paintLeft();
  });
  const paintPen = () => {
    pen.classList.toggle('on', _open.write);
    pen.title = _open.write
      ? 'The writer is on: your message is rewritten into the shape this model wants. Click to send your words exactly as typed.'
      : 'Sending your words exactly as typed. Click to let the writer shape them for this model.';
  };
  pen.addEventListener('click', () => {
    _open.write = !_open.write;
    paintPen();
    if (spec.remember) spec.remember(_api());
  });
  paintPen();

  go.addEventListener('click', () => _send());
  // Enter sends, shift+Enter breaks the line - the way every message box works, and the reason
  // this is a textarea and not an input.
  ta.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); _send(); }
  });
  // It grows with what is typed, up to a point past which the thread would have nowhere left.
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
  });
  // A file dropped anywhere on this window is an attachment.
  box.addEventListener('dragover', (ev) => {
    if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
  });
  box.addEventListener('drop', (ev) => {
    if (!ev.dataTransfer || !ev.dataTransfer.files || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    _upload(ev.dataTransfer.files);
  });

  _paintAtts();
  _paintThread();
  _paintStrip();
  ta.focus();

  await _loadCats();
  await _loadThread();
  await _loadStrip();

  // Something started elsewhere - another tab, an earlier visit that was closed - lands in this
  // thread too, because the server is the one watching it. So it is re-read while anything is
  // unfinished, rather than only while this window is generating.
  _timer = setInterval(() => {
    if (!_open) { clearInterval(_timer); return; }
    if (_shelf.some(x => x.state === 'pending')) { _loadThread(); _loadStrip(); }
  }, POLL_MS * 2);

  return _api();
}

// The count the ×N button is showing, for a spec that submits that many.
export const attempts = () => (_open ? _open.n : 1);
