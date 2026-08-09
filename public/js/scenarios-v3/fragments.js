// Scenarios v3 — the Fragments column: one card per line of the open project.
//
//   [n] [ mix 3:4 ] [ the full line, editable ] [ video 3:4 ]
//
// Both media fields are the same size and 3:4, and they only ever hold a
// THUMBNAIL — never the full asset. They stay empty until the mix and video
// phases fill them; the video's first-frame poster and its click-to-play popup
// are deliberately left for the generation phase.
//
// Editing a line writes to the PROJECT only. The scenario in the library keeps
// the wording it was saved with.

import { onProjectChange, patchProject, adoptProject } from './projects.js';
import { thumbImg } from './chars.js';
import { speakLines, tagLines } from './api.js';

const SAVE_WAIT = 600;

const $ = id => document.getElementById(id);

let _project = null;
let _lines   = [];
let _saveT   = null;
let _saving  = false;
let _reSave  = false;
let _dirty   = false;
let _filter  = 'all';
let _locked  = false;   // a batch read is running: the words it reads may not move

// ── which take is on show ───────────────────────────────────────────────────
// One switch for the whole project, in the voice settings. Per line it could drift,
// and two cards showing different takes of the same read means nothing.
const _variant = () => (((_project || {}).voice || {}).variant === 'tagged' ? 'tagged' : 'plain');

// The words with every [tag] removed and the spacing made irrelevant. The same
// comparison the tagging pass uses as its guard.
const _words = (t) => String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

// A line is BROKEN when it has a tagged take whose words no longer match the plain
// ones — the text was edited after the tags were placed. Computed, never stored: a
// stored flag would one day disagree with the fact.
const _broken = (l) => !!(l.tagged && _words(l.tagged) !== _words(l.text));
// The words of the take on show: the tagged string when that variant is up, the plain
// one otherwise.
const _showText = (l) => (_variant() === 'tagged' ? (l.tagged || '') : (l.text || ''));

// A take is STALE when the words it was made from are no longer the words on the line.
// The take itself remembers what it said, so this is a comparison, not a flag that has
// to be maintained — and a stale take counts as no take at all.
const _freshTake = (l) => {
  const t = (l.audio || {})[_variant()];
  return (t && t.path && t.said === _showText(l)) ? t : null;
};

// A line whose words a caller still needs to save before re-tagging against them.
export const flushFragments = () => _flush();

function _status(text, kind) {
  const n = $('sv3-frag-status');
  if (!n) return;
  n.textContent = text || '';
  n.className = 'sv3-status' + (kind ? ' ' + kind : '');
}

// Two counters in the column header: how much is voiced and how much is rendered.
// Both read the take of the variant each line is SET to, never the other one — so a
// project half-voiced in plain does not report itself finished because the tagged
// takes happen to exist.
function _renderProgress() {
  const n = $('sv3-frag-prog');
  if (!n) return;
  n.textContent = '';
  if (!_lines.length) { _syncHeader(); return; }
  const v = _variant();
  // audio counts only FRESH takes; an edited line is not voiced, whatever file exists
  const count = (kind) => _lines.filter(l => (kind === 'audio' ? _freshTake(l) : (l[kind] || {})[v])).length;
  [['voice', count('audio')], ['video', count('video')]].forEach(([label, done]) => {
    const p = document.createElement('span');
    p.className = 'sv3-frag-progit' + (done === _lines.length ? ' full' : '');
    p.textContent = `${label} ${done}/${_lines.length}`;
    p.title = `${done} of ${_lines.length} fragments have their ${label} for the ${v} take`;
    n.appendChild(p);
  });
  // the third counter only appears when there is something wrong to report
  const broken = _lines.filter(_broken).length;
  if (broken) {
    const p = document.createElement('span');
    p.className = 'sv3-frag-progit bad';
    p.textContent = `${broken} changed`;
    p.title = `${broken} fragment${broken === 1 ? ' was' : 's were'} edited after their tags were placed,`
      + ' so the tagged take no longer matches the words';
    n.appendChild(p);
  }
  _syncHeader();
}

// The filter is a toggle and it is only clickable while there is something to filter
// to. Repairing lives on Voice all in the Montage column, which becomes Fix tags for
// as long as any fragment is out of step.
function _syncHeader() {
  const broken = _lines.filter(_broken).length;
  const fil = $('sv3-frag-filter');
  if (!fil) return;
  if (!broken && _filter === 'error') _filter = 'all';
  fil.disabled = !broken;
  fil.classList.toggle('is-on', _filter === 'error');
  fil.textContent = broken
    ? (_filter === 'error' ? `showing broken (${broken})` : `only broken (${broken})`)
    : 'only broken';
  fil.title = broken
    ? 'Show only the fragments whose words changed after their tags were placed'
    : 'Nothing is out of step';
}

// ── the line's own audio ────────────────────────────────────────────────────
// One control, two jobs: it plays the take on show, or voices this line when that
// take does not exist yet. Two buttons for one thing would just be clutter.
let _playing = null;      // the <audio> currently sounding, so a second click stops it
const _voicingLines = new Set();
const _taggingLines = new Set();

function _stopPlaying() {
  if (!_playing) return;
  try { _playing.el.pause(); } catch (e) {}
  const btn = _playing.btn;
  _playing = null;
  if (btn && btn.isConnected) btn.classList.remove('is-playing'), btn.textContent = btn.dataset.idle;
}

function _audioCtl(i, ln) {
  const v = _variant();
  const take = _freshTake(ln);
  const stale = !take && !!(ln.audio || {})[v];   // a file exists but says the old words
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sv3-btn sv3-frag-audio';   // no `sm`: the acts column sizes both buttons

  if (_voicingLines.has(i)) {
    b.textContent = '…';
    b.disabled = true;
    b.title = 'Voicing this line';
    return b;
  }

  if (take) {
    b.dataset.idle = take.dur ? `▶ ${take.dur.toFixed(1)}s` : '▶';
    b.textContent = b.dataset.idle;
    b.title = `Play the ${v} take · click again to stop`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasThis = _playing && _playing.btn === b;
      _stopPlaying();
      if (wasThis) return;
      const el = new Audio(take.path);
      _playing = { el, btn: b };
      b.classList.add('is-playing');
      b.textContent = '■ stop';
      el.addEventListener('ended', _stopPlaying);
      el.addEventListener('error', () => { _stopPlaying(); _status('could not play that take', 'err'); });
      el.play().catch(() => { _stopPlaying(); _status('could not play that take', 'err'); });
    });
    return b;
  }

  b.dataset.idle = 'gen';
  b.textContent = 'gen';
  b.classList.add('primary');
  // a batch read is already voicing the column: a second request would race it
  if (_locked) { b.disabled = true; b.title = 'A batch read is running'; return b; }
  b.title = stale
    ? 'The words changed after this line was voiced — generate the read again'
    : `No ${v} take for this line yet — generate it on its own`;
  b.addEventListener('click', (e) => { e.stopPropagation(); _voiceOne(i); });
  return b;
}

// The twin of `gen`, on the other border. It runs the SAME full-script pass — the
// casting director still reads everything, including the tags its neighbours already
// carry — and only this line's answer is applied.
function _tagCtl(i, ln) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sv3-btn sv3-frag-tag-ctl';
  if (_taggingLines.has(i)) { b.textContent = '…'; b.disabled = true; return b; }
  b.textContent = 'tag';
  b.classList.add('primary');
  if (_locked) { b.disabled = true; b.title = 'A batch read is running'; return b; }
  b.title = _broken(ln)
    ? 'The words changed after the tags were placed — mark this line up again'
    : 'Place tags on this line only, matching what the other lines already do';
  b.addEventListener('click', (e) => { e.stopPropagation(); _tagOne(i); });
  return b;
}

// The tag button is the optional one, so both the first render and every later refresh
// go through here. It is appended after the read button, which puts it at the bottom of
// the column — the order the two of them are meant to sit in.
function _syncTagCtl(acts, i, ln) {
  // Tagging only means anything while tags are switched on for the project, and only
  // in the tagged view: the plain read carries no tags, so there is nothing to place
  // or repair there. Same reasoning as the red outline on a broken card.
  const tagsOn = !!(((_project || {}).voice || {}).tagsOn);
  const wanted = tagsOn && _variant() === 'tagged' && (!ln.tagged || _broken(ln));
  const existing = acts.querySelector('.sv3-frag-tag-ctl');
  if (wanted && existing) existing.replaceWith(_tagCtl(i, ln));
  else if (wanted) acts.appendChild(_tagCtl(i, ln));
  else if (existing) existing.remove();
}

async function _tagOne(i) {
  if (!_project || _locked || _taggingLines.has(i)) return;
  const id = _project.id;
  _taggingLines.add(i);
  _render();
  _status(`tagging line ${i + 1}…`);
  try {
    await _flush();
    const { project, report } = await tagLines(id, [i]);
    _taggingLines.delete(i);
    adoptProject(project);
    _status(report.rejected.length ? `line ${i + 1} rejected` : `line ${i + 1} tagged`,
            report.rejected.length ? 'err' : 'ok');
  } catch (e) {
    _taggingLines.delete(i);
    _status('tagging failed: ' + e.message, 'err');
    _render();
  }
}

async function _voiceOne(i) {
  if (!_project || _locked || _voicingLines.has(i)) return;
  const id = _project.id;
  _voicingLines.add(i);
  _render();
  _status(`voicing line ${i + 1}…`);
  try {
    await _flush();
    const { project, report } = await speakLines(id, [i]);
    _voicingLines.delete(i);
    adoptProject(project);
    _status(report.failed.length ? `line ${i + 1} failed` : `line ${i + 1} voiced`,
            report.failed.length ? 'err' : 'ok');
    if (report.failed.length) console.warn('[sv3] voicing failure', report.failed);
  } catch (e) {
    _voicingLines.delete(i);
    _status('voicing failed: ' + e.message, 'err');
    _render();
  }
}

// ── the batch read holds the column still ───────────────────────────────────
// While Montage is reading line by line, nothing here may change a line: every read is
// made from the words as saved, and an edit landing mid-batch would put a take next to
// words nobody voiced. Playing a finished take is not a change, so that stays live.
export function setFragmentsLocked(on) {
  const next = !!on;
  if (_locked === next) return;
  _locked = next;
  _render();
}

// Montage drives the batch one line at a time, so it says which card is in flight —
// the same `…` face a single-line read shows.
export function markLineVoicing(i, on) {
  if (on) _voicingLines.add(i); else _voicingLines.delete(i);
  _render();
}

// A media field: a tag, and either a thumbnail or an empty placeholder.
// onPick makes the field a chooser (used for the mix slot).
function _media(tag, fullPath, onPick) {
  const box = document.createElement('div');
  box.className = 'sv3-frag-media' + (onPick ? ' pickable' : '');

  const t = document.createElement('div');
  t.className = 'sv3-frag-mtag';
  t.textContent = tag;
  box.appendChild(t);

  if (fullPath) {
    box.appendChild(thumbImg(fullPath, null, { noFit: true }));   // thumbnail only
  } else {
    const ph = document.createElement('div');
    ph.className = 'sv3-frag-mph';
    ph.textContent = '+';
    box.appendChild(ph);
  }
  if (onPick) {
    box.title = 'Pick a first frame for this fragment';
    box.addEventListener('click', (e) => { e.stopPropagation(); onPick(box); });
  }
  return box;
}

// The approved pool of the open project, in approval order.
function _pool() {
  const mix = (_project && _project.mix) || {};
  const variants = mix.variants || [];
  return (mix.approved || [])
    .filter(id => !(mix.banned || []).includes(id))
    .map(id => variants.find(v => v.id === id))
    .filter(Boolean);
}
const _frameById = (id) => (((_project && _project.mix) || {}).variants || []).find(v => v.id === id) || null;

// Flyout of approved frames, anchored to the slot that opened it.
let _pickFly = null;
function _closePick() { if (_pickFly) { _pickFly.remove(); _pickFly = null; } }

function _openPick(anchor, idx) {
  _closePick();
  const pool = _pool();
  const el = document.createElement('div');
  el.className = 'sv3-frag-pick';
  if (!pool.length) {
    const e = document.createElement('div');
    e.className = 'sv3-frag-pickempty';
    e.textContent = 'No approved frames yet — build them in Build mix.';
    el.appendChild(e);
  }
  pool.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-frag-pickit' + (_lines[idx] && _lines[idx].frameId === v.id ? ' on' : '');
    b.appendChild(thumbImg(v.path, null, { noFit: true }));
    b.addEventListener('click', () => {
      _lines[idx].frameId = v.id;
      _closePick(); _dirty = true; _flush(); _render();
    });
    el.appendChild(b);
  });
  // clearing the choice
  if (_lines[idx] && _lines[idx].frameId) {
    const clr = document.createElement('button');
    clr.type = 'button';
    clr.className = 'sv3-frag-pickclear';
    clr.textContent = 'clear';
    clr.addEventListener('click', () => {
      _lines[idx].frameId = '';
      _closePick(); _dirty = true; _flush(); _render();
    });
    el.appendChild(clr);
  }
  document.body.appendChild(el);
  _pickFly = el;

  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(a.right + 8, Math.max(8, window.innerWidth - w - 8));
  let top  = Math.min(Math.max(a.top, 8), Math.max(8, window.innerHeight - h - 8));
  el.style.left = Math.round(left) + 'px';
  el.style.top  = Math.round(top) + 'px';
  setTimeout(() => {
    document.addEventListener('click', function once(ev) {
      if (el.contains(ev.target)) return;
      _closePick(); document.removeEventListener('click', once);
    });
  }, 0);
}

function _render() {
  const box = $('sv3-frags');
  if (!box) return;
  _stopPlaying();          // the buttons are about to be replaced
  box.textContent = '';

  if (!_project) {
    _renderProgress();
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'Open a project to see its fragments.';
    box.appendChild(e);
    return;
  }
  if (!_lines.length) {
    _renderProgress();
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'This project has no lines.';
    box.appendChild(e);
    return;
  }

  _renderProgress();
  const v = _variant();
  _lines.forEach((ln, i) => {
    const broken = _broken(ln);
    if (_filter === 'error' && !broken) return;

    const card = document.createElement('div');
    // the red outline belongs to the tagged view: in plain the words are fine, it is
    // the tagged take that went stale
    card.className = 'sv3-frag' + (broken && v === 'tagged' ? ' is-broken' : '');

    const n = document.createElement('div');
    n.className = 'sv3-frag-n';
    n.textContent = String(i + 1);

    const text = document.createElement('div');
    text.className = 'sv3-frag-text' + (_locked ? ' is-locked' : '');
    text.contentEditable = _locked ? 'false' : 'true';
    text.spellcheck = false;
    text.dataset.idx = String(i);
    // Editable in BOTH views. In the tagged one the tags are painted so the eye can
    // separate them from the words; typing over them is the user's business.
    const showTagged = v === 'tagged' && ln.tagged;
    if (showTagged) _paintTags(text, ln.tagged);
    else text.textContent = ln.text || '';
    text.addEventListener('input', _onEdit);

    // The two controls get a column of their own, next to the text and never over it:
    // inside the contentEditable they would become part of the text and land in what
    // gets saved, and on top of it they would hide words.
    const acts = document.createElement('div');
    acts.className = 'sv3-frag-acts';
    acts.appendChild(_audioCtl(i, ln));
    _syncTagCtl(acts, i, ln);

    const frame = ln.frameId ? _frameById(ln.frameId) : null;
    const kids = [
      n,
      // picking a frame is an edit too, so it goes quiet with the rest
      _media('mix', frame ? frame.path : '', _locked ? null : (anchor) => _openPick(anchor, i)),
      text,
      acts,
      _media('video', (ln.video || {})[v] ? ln.video[v].path : ''),
    ];
    card.append(...kids);
    box.appendChild(card);
  });
}

// Paint the tagged take: words as text, [tags] in their own colour. Kept as plain
// text nodes plus one span per tag so reading `textContent` back returns exactly the
// tagged string, which is what the edit handler saves.
function _paintTags(host, tagged) {
  host.textContent = '';
  String(tagged).split(/(\[[^\]]*\])/).forEach(part => {
    if (!part) return;
    if (part.startsWith('[') && part.endsWith(']')) {
      const s = document.createElement('span');
      s.className = 'sv3-frag-tag';
      s.textContent = part;
      host.appendChild(s);
    } else host.appendChild(document.createTextNode(part));
  });
}

function _onEdit(e) {
  if (_locked) return;              // frozen for a batch read; a drop could still fire this
  const i = +e.target.dataset.idx;
  if (!Number.isInteger(i) || !_lines[i]) return;
  const typed = e.target.textContent || '';
  if (_variant() === 'tagged' && _lines[i].tagged) {
    // Edited in the tagged view: that string IS the tagged take, and the plain one is
    // derived from it by dropping the tags. Both stay in step with no extra work.
    _lines[i].tagged = typed;
    _lines[i].text = typed.replace(/\[[^\]]*\]/g, ' ').replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.!?;:])/g, '$1').trim();
  } else {
    // Edited in the plain view: the tagged take cannot be derived back — placing tags
    // is the casting director's job — so it is left alone and the line shows up as
    // changed until it is re-tagged.
    _lines[i].text = typed;
  }
  clearTimeout(_saveT);
  _dirty = true;
  _status('editing…');
  _saveT = setTimeout(_flush, SAVE_WAIT);
  _renderProgress();                      // the broken count follows the typing
  _refreshTabs(e.target, i);              // and so do this card's two tabs
}

// Swap the two buttons on ONE card without touching its text. A full re-render would
// rebuild the box the caret is sitting in, so typing cannot trigger one — but the
// buttons still have to keep up: a keystroke can make a read stale or a line broken.
function _refreshTabs(textEl, i) {
  const card = textEl.closest('.sv3-frag');
  const acts = card && card.querySelector('.sv3-frag-acts');
  const ln = _lines[i];
  if (!acts || !ln) return;

  const audio = acts.querySelector('.sv3-frag-audio');
  if (audio) audio.replaceWith(_audioCtl(i, ln));

  _syncTagCtl(acts, i, ln);

  card.classList.toggle('is-broken', _broken(ln) && _variant() === 'tagged');
}

async function _flush() {
  if (!_project || !_dirty) return;
  if (_saving) { _reSave = true; return; }
  _saving = true;
  _dirty  = false;
  const id = _project.id;
  try {
    // send the WHOLE line, not a two-field summary: the takes and the tagged text
    // live here too, and rebuilding the array from two keys would erase them
    await patchProject({ lines: _lines.map(l => ({ ...l })) });
    if (_project && String(_project.id) === String(id)) _status('saved', 'ok');
  } catch (e) {
    _dirty = true;   // keep it pending so the next flush retries
    _status('save failed: ' + e.message, 'err');
  } finally {
    _saving = false;
    if (_reSave) { _reSave = false; _flush(); }
  }
}

export function initFragments() {
  onProjectChange((project) => {
    clearTimeout(_saveT);
    _dirty = false;
    _project = project;
    _lines = project ? (project.lines || []).map(l => ({ ...l })) : [];
    // a filter showing only broken lines is meaningless once none are left
    if (_filter === 'error' && !_lines.some(_broken)) _filter = 'all';
    _status('');
    _render();
  });

  const fil = $('sv3-frag-filter');
  if (fil) fil.addEventListener('click', () => {
    _filter = _filter === 'error' ? 'all' : 'error';
    _render();
  });

  _render();
}
