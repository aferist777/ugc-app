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

import { onProjectChange, patchProject, adoptProject, currentProject } from './projects.js';
import { thumbImg } from './chars.js';
import { speakLines, tagLines, renderClip, cancelClip, videoState } from './api.js';
import { startProgress } from './progress.js';
import { openMixPopup } from './mix-popup.js';

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

// A clip is only this fragment's clip while everything it was made from still holds: the
// FIRST FRAME it animates, the words, and the read it was lipsynced to. A lipsync is that
// one picture moving, so swapping the frame leaves the clip belonging to the old one.
//
// Clips are kept per frame rather than overwritten, which is why this searches instead of
// reading a single slot: going back to a frame that already has its clip shows that clip
// again, and nobody pays twice for the same second of video.
//
// The motion preset and the quality are recorded on a clip too, but they are deliberately
// NOT part of this: a rendered fragment stays rendered, and re-doing one with new motion
// is the card's own button.
const _clipsOf = (l) => {
  const list = (l.video || {})[_variant()];
  return (Array.isArray(list) ? list : (list ? [list] : [])).filter(c => c && c.path);
};
// The variant this fragment is SET to: the stored pick while it still animates the frame
// in use, otherwise the newest take of that frame. Browsing the variants is what moves
// the pick, and picking one from another frame moves the FRAME with it — a clip and the
// still shown beside it must not describe different pictures.
const _pickedClip = (l) => {
  const clips = _clipsOf(l);
  if (!clips.length) return null;
  const frame = String(l.frameId || '');
  const picked = clips.find(c => c.id === String(((l.pick || {})[_variant()]) || ''));
  if (picked && String(picked.fromFrame || '') === frame) return picked;
  const mine = clips.filter(c => String(c.fromFrame || '') === frame);
  return mine.length ? mine[mine.length - 1] : null;
};
// …and whether that clip still holds: same words, same read. A clip of words since
// rewritten is not this fragment's clip, however good it looked.
const _freshClip = (l) => {
  const c = _pickedClip(l);
  if (!c) return null;
  const take = (l.audio || {})[_variant()];
  if (c.said !== _showText(l)) return null;
  if (c.fromAudio && take && take.path && c.fromAudio !== take.path) return null;
  return c;
};

// ── a read the lipsync will not take ────────────────────────────────────────
// Kling caps the audio it will animate. A fragment past that cap is not a failure to report
// after the fact — it cannot be rendered at all, and the only cure is to split the sentence.
// So it is marked here, where the words are, rather than in the render report.
const _ceiling = () => {
  const q = (_kit.qualities || []).find(x => x.id === (((_project || {}).video || {}).quality));
  return (q && q.maxAudioSec) || 15;
};
const _tooLong = (l) => {
  const t = _freshTake(l);
  return !!(t && t.dur > _ceiling());
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
  // Both counters count only what is still TRUE, not what merely exists: an edited line
  // is not voiced whatever mp3 is on disk, and a clip made from a read that has since
  // been redone is not a clip of this fragment.
  const count = (kind) => _lines.filter(l => (kind === 'audio' ? _freshTake(l) : _freshClip(l))).length;
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
const _renderingLines = new Set();
// The task each rendering line is waiting on, so a cancel can name it - the server refuses a
// cancel that does not match, which is what stops a late click from killing a newer render.
const _renderTask = new Map();
// Lines whose wait the user has called off. The follower checks this on its next turn and
// stands down quietly instead of reporting "the render stopped without a clip".
const _cancelled = new Set();

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
    // Too long to lipsync: the button still plays, but it goes red and says what to do about
    // it. The instruction is stepwise on purpose — "split the fragment" is not an action
    // anybody can find on this screen without being told where to press.
    if (_tooLong(ln)) {
      b.classList.add('danger-solid');
      b.title = `This read is ${take.dur.toFixed(1)}s and the model takes ${_ceiling()}s at most.\n`
        + '1. Hover the gap under this card and press +\n'
        + '2. Move the tail of the sentence into the new fragment\n'
        + '3. Voice both halves — the old take matches neither of them any more';
    } else {
      b.title = `Play the ${v} take · click again to stop`;
    }
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
  if (_frozenLine(i)) { b.disabled = true; b.title = 'This fragment is busy'; return b; }
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
  if (_frozenLine(i)) { b.disabled = true; b.title = 'This fragment is busy'; return b; }
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
  const existing = acts.querySelector('.sv3-frag-tag-ctl, .sv3-frag-vid-ctl');

  // The bottom button follows the stage the work has reached: while the read is the job
  // it places tags, and once the Video section is open it renders THIS fragment's clip.
  // One slot, because the two never matter at the same time.
  if (((_project || {}).stage) === 'video') {
    const btn = _videoCtl(i, ln);
    if (existing) existing.replaceWith(btn); else acts.appendChild(btn);
    return;
  }

  // Tagging only means anything while tags are switched on for the project, and only
  // in the tagged view: the plain read carries no tags, so there is nothing to place
  // or repair there. Same reasoning as the red outline on a broken card.
  const tagsOn = !!(((_project || {}).voice || {}).tagsOn);
  const wanted = tagsOn && _variant() === 'tagged' && (!ln.tagged || _broken(ln));
  if (wanted && existing) existing.replaceWith(_tagCtl(i, ln));
  else if (wanted) acts.appendChild(_tagCtl(i, ln));
  else if (existing) existing.remove();
}

// Why the last render of this fragment failed, or '' when nothing went wrong. Kept on
// the line by both the server and the page, so it survives a reload.
const _clipError = (l) => String(((l || {}).render || {}).error || '');

// ── what a render would be made of ──────────────────────────────────────────
// The motion catalogue, so the card can show the prompt that will actually be sent
// rather than the preset's name. Fetched once; a failure just leaves the panel thinner.
let _kit = { presets: [], qualities: [] };
export function primeMotionKit(kit) { if (kit) _kit = kit; }

// Everything that goes into one render, in the order it matters. Also what DIFFERS from
// the take on show, which is the whole reason to look: change the motion preset and this
// says so, on every fragment, before any credits are spent.
function _renderPlan(l) {
  const v = _variant();
  const vid = (_project || {}).video || {};
  const preset = _kit.presets.find(p => p.id === vid.preset) || null;
  const qual   = _kit.qualities.find(q => q.id === vid.quality) || null;
  const take   = (l.audio || {})[v] || {};
  const clip   = _freshClip(l);

  const diffs = [];
  if (clip) {
    if (clip.preset && vid.preset && clip.preset !== vid.preset) {
      const was = _kit.presets.find(p => p.id === clip.preset);
      diffs.push(`motion ${(was && was.label) || clip.preset} → ${(preset && preset.label) || vid.preset}`);
    }
    if (clip.quality && vid.quality && clip.quality !== vid.quality) {
      diffs.push(`quality ${clip.quality} → ${vid.quality}`);
    }
  }
  return {
    model: 'Kling AI Avatar',
    quality: vid.quality || '',
    price: qual ? qual.pricePerSec : 0,
    presetLabel: (preset && preset.label) || vid.preset || '',
    prompt: (preset && preset.prompt) || '',
    variant: v,
    dur: take.dur || 0,
    frame: String(l.frameId || ''),
    hasClip: !!clip,
    diffs,
  };
}

let _cardEl = null;
function _closeCard() { if (_cardEl) { _cardEl.remove(); _cardEl = null; } }

// A panel rather than a title attribute: the motion prompt is two lines of prose, and a
// native tooltip would arrive late, unstyled and — on some platforms — cut short.
function _openPlanCard(anchor, i) {
  _closeCard();
  const l = _lines[i];
  if (!l) return;
  const p = _renderPlan(l);
  const blocked = _clipBlocker(l);
  const err = _clipError(l);

  const el = document.createElement('div');
  el.className = 'sv3-plan';
  const row = (k, v2, cls) => `<div class="sv3-plan-row${cls ? ' ' + cls : ''}">`
    + `<b>${k}</b><span>${v2}</span></div>`;
  let html = '';
  if (err) html += row('Failed', err, 'err');
  if (p.diffs.length) html += row('Differs from this take', p.diffs.join(' · '), 'warn');
  else if (p.hasClip) html += row('This take', 'was made with exactly these settings', 'muted');
  html += row('Model', `${p.model}${p.quality ? ' · ' + p.quality : ''}`);
  html += row('Motion', p.presetLabel || '—');
  if (p.prompt) html += `<div class="sv3-plan-prompt">${p.prompt}</div>`;
  html += row('Read', `${p.variant}${p.dur ? ' · ' + p.dur.toFixed(1) + 's' : ''}`);
  html += row('Frame', p.frame ? 'the one this fragment uses' : 'none chosen yet');
  if (p.price && p.dur) html += row('Cost', `about $${(p.price * p.dur).toFixed(2)}`);
  if (blocked) html += row('Cannot render', blocked, 'err');
  el.innerHTML = html;
  document.body.appendChild(el);
  _cardEl = el;

  // to the LEFT of the button: the column sits at the right edge of the page
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.round(Math.max(8, a.left - w - 8)) + 'px';
  el.style.top  = Math.round(Math.min(Math.max(8, a.top - 4), Math.max(8, window.innerHeight - h - 8))) + 'px';
}

// Render this one fragment. The twin of `gen` on the other border: the batch in Montage
// does the same work for everything at once, this does it for the line in front of you.
function _videoCtl(i, ln) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sv3-btn sv3-frag-vid-ctl';
  b.textContent = 'video';

  if (_renderingLines.has(i)) { b.textContent = '…'; b.disabled = true; b.title = 'Rendering this clip'; return b; }

  // Hovering says what a render would be made of — the model, the motion prompt itself,
  // the read, the cost, and what differs from the take on show. A disabled button fires no
  // mouse events, so those paths keep a plain title as their fallback.
  b.addEventListener('mouseenter', () => _openPlanCard(b, i));
  b.addEventListener('mouseleave', _closeCard);

  const err = _clipError(ln);
  const blocked = _clipBlocker(ln);
  // A failure shows in red and says what went wrong on hover. Pressing it again retries
  // — either as-is, if the trouble was on their side, or after fixing what it names.
  if (err) b.classList.add('danger-solid');
  else b.classList.add('primary');

  // Only THIS fragment being busy stops it. Another fragment rendering is no reason to
  // refuse: the user may start as many by hand as they like, one per fragment.
  if (blocked || _frozenLine(i)) {
    b.disabled = true;
    b.title = err ? `${err}\n(also: ${blocked || 'this fragment is already rendering'})`
                  : (blocked || 'This fragment is already rendering');
    return b;
  }
  // No title here on purpose: the hover panel above says all of this and more, and two
  // tooltips over one button is just noise.
  b.addEventListener('click', (e) => { e.stopPropagation(); _closeCard(); renderLine(i); });
  return b;
}

async function _tagOne(i) {
  if (!_project || _frozenLine(i) || _taggingLines.has(i)) return;
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
  if (!_project || _frozenLine(i) || _voicingLines.has(i)) return;
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

// ── rendering one fragment's clip ───────────────────────────────────────────
// A render belongs to the SERVER: the task is started, a watcher files it, and the page
// merely follows. That is what makes the working state survive a reload — it is read
// back from the project's own record of the task, not from anything held in memory here.
const _renderStart = new Map();   // idx -> when its task started, for the countdown
const _progress    = new Map();   // idx -> the overlay handle currently on that card

// A BATCH freezes the whole column: it walks every fragment, so anything moving anywhere
// could land under a read or a render it did not belong to.
const _frozen = () => _locked;
// A hand-started render freezes only its own fragment. Its words, its frame and its read
// must hold still — but nothing about fragment 3 constrains fragment 7, so any number of
// them can run at once and only the one already going refuses to start again.
const _frozenLine = (i) => _locked || _renderingLines.has(i);

// Why this fragment cannot be rendered, or '' when it can.
function _clipBlocker(l) {
  const v = _variant();
  if (!l.frameId) return 'this fragment has no first frame yet';
  if (!_freshTake(l)) return `no ${v} read for these words yet`;
  const take = (l.audio || {})[v];
  const q = ((_project || {}).video || {}).quality;
  const ceiling = q === '1080p' ? 15 : 15;
  if (take.dur > ceiling) {
    return `the read is ${take.dur.toFixed(1)}s and the model takes ${ceiling}s at most`;
  }
  return '';
}

export async function renderLine(i) {
  if (!_project || _renderingLines.has(i)) return { skipped: 'already rendering' };
  const id = _project.id;
  const blocked = _clipBlocker(_lines[i] || {});
  if (blocked) { _status(`fragment ${i + 1}: ${blocked}`, 'err'); return { skipped: blocked }; }

  // Which take the fragment shows RIGHT NOW. Noted before anything moves, because that is
  // how the answer is told apart from what was already there.
  const beforeId = (_pickedClip(_lines[i] || {}) || {}).id || '';

  // A retry clears the last failure first, so the red outline goes away the moment the
  // new attempt starts rather than lingering next to a working spinner.
  if (_lines[i]) _lines[i].render = null;
  if (_project.lines && _project.lines[i]) _project.lines[i].render = null;

  // Blur the card before the request goes out: uploading the still and the read takes a
  // few seconds of its own, and a dead-looking card during them invites a second click.
  _renderStart.set(i, Date.now());
  _renderingLines.add(i);
  _render();
  try {
    const started = await renderClip(id, i);
    if (started.taskId) _renderTask.set(i, started.taskId);
    if (started.skipped) {
      _renderingLines.delete(i); _renderStart.delete(i);
      _status(`fragment ${i + 1}: ${started.skipped}`, 'err');
      _render();
      return { skipped: started.skipped };
    }
    return await _followLine(i, beforeId);
  } catch (e) {
    const p = _progress.get(i);
    if (p) p.fail('Render failed: ' + e.message);
    _renderingLines.delete(i); _renderStart.delete(i);
    _status(`fragment ${i + 1} failed: ${e.message}`, 'err');
    _renderProgress();
    return { error: e.message };
  }
}

// Follow one line until its clip is filed or the render gives up. Polling the small
// state endpoint rather than the whole project, which carries the entire mix workspace.
//
// `beforeId` is the clip the fragment was showing when the render started, and it is what
// makes re-rendering work at all: the state endpoint answers with whichever clip the
// fragment is set to, so a fragment that already had one would otherwise be declared
// finished on the first poll — five seconds in, with the old take reported as the new one.
async function _followLine(i, beforeId) {
  const id = _project.id;
  const was = String(beforeId || '');
  // Twelve minutes, matching the server's watcher. Twenty was cover for a failure being
  // misread as "still pending" - with kie's answer read properly both outcomes arrive quickly,
  // and the fragment now offers its own Cancel long before this.
  const WAIT_MS = 12 * 60 * 1000;
  const t0 = Date.now();
  let odd = 0;             // observations of "neither running nor finished"
  while (Date.now() - t0 < WAIT_MS) {
    await new Promise(r => setTimeout(r, 5000));
    // Called off while we were asleep. The card has already been put back by _cancelDone, so
    // there is nothing to report - and reporting anything would contradict it.
    if (_cancelled.has(i)) { _cancelled.delete(i); return { skipped: 'cancelled' }; }
    if (!_project || String(_project.id) !== String(id)) { _renderingLines.delete(i); return { error: 'the project was closed' }; }
    let st = null;
    try { st = await videoState(id); } catch (e) { continue; }   // a blip is not a failure
    const row = (st.lines || []).find(r => r.n === i);
    if (!row) return _clipDone(i, null, 'the fragment went away');
    if (row.error) return _clipDone(i, null, row.error);
    // The task first: the watcher writes the clip and clears the task in ONE patch, so
    // "still running" is always the truth, and a clip alongside it is the previous take.
    if (row.rendering) { odd = 0; continue; }
    if (row.clip && row.clip.id !== was) return _clipDone(i, { variant: st.variant, clip: row.clip }, '');
    // Neither running nor finished. The watcher writes the clip and clears the task in
    // one go, so this should not happen — but reporting a paid render as failed on a
    // single odd reading would be worse than waiting one more turn to be sure.
    if (++odd >= 2) return _clipDone(i, null, 'the render stopped without a clip');
  }
  return _clipDone(i, null, 'still rendering after 12 minutes');
}

// Stop waiting on one fragment. Not "stop the render": kie.ai offers no cancel for a job in
// flight, so if the clip does arrive it is already paid for and the server will file it on the
// next attempt. What this buys back is the card - and the Render all button with it.
async function _cancelLine(i) {
  const taskId = _renderTask.get(i) || ((_lines[i] || {}).render || {}).taskId || '';
  if (!_project || !taskId || taskId === 'failed') {
    _status(`fragment ${i + 1}: there is no render to call off`, 'err');
    return;
  }
  try {
    await cancelClip(_project.id, i, taskId);
  } catch (e) {
    // A 409 means the fragment is on a newer render than the one this overlay belongs to.
    _status(`fragment ${i + 1}: ${e.message}`, 'err');
    return;
  }
  _cancelled.add(i);
  _cancelDone(i);
}

// The card, put back the way it was. Deliberately NOT _clipDone: that stamps a failure on the
// line and outlines it in red, and a render the user called off is not a failed one.
function _cancelDone(i) {
  const p = _progress.get(i);
  if (p) p.detach();                       // no timing recorded: an abandoned wait is not a duration
  _progress.delete(i);
  _renderingLines.delete(i);
  _renderStart.delete(i);
  _renderTask.delete(i);
  if (_lines[i]) _lines[i].render = null;
  if (_project && _project.lines && _project.lines[i]) _project.lines[i].render = null;
  _render();
  _status(`fragment ${i + 1}: stopped waiting - render it again whenever you like`);
  if (_project) adoptProject(_project);    // the Video section counts what is left to render
}

function _clipDone(i, got, err) {
  const p = _progress.get(i);
  if (got) {
    // Write the clip onto the page's copy rather than refetching the project: the whole
    // mix workspace would come with it, and the caret in another card would be lost.
    // A new VARIANT on the end, and the fragment is set to it — the server filed it the
    // same way. Earlier takes stay browsable whatever frame they came from.
    const put = (line) => {
      if (!line) return;
      const prev = Array.isArray((line.video || {})[got.variant]) ? line.video[got.variant] : [];
      const rest = prev.filter(c => c.id !== got.clip.id);
      line.video = { ...(line.video || {}), [got.variant]: [...rest, got.clip] };
      line.pick = { ...(line.pick || {}), [got.variant]: got.clip.id };
      line.render = null;
    };
    put(_lines[i]);
    if (_project && _project.lines) put(_project.lines[i]);
    if (p) p.finish();                      // records the timing, so the next ETA is real
  } else {
    // The failure is kept ON THE LINE, not in a dismissable overlay: the card outlines
    // itself in red and its button carries the message, which survives a reload because
    // the server wrote the same error onto its own copy.
    if (p) p.detach();
    const stamp = { taskId: 'failed', error: String(err || 'render failed') };
    if (_lines[i]) _lines[i].render = stamp;
    if (_project && _project.lines && _project.lines[i]) _project.lines[i].render = stamp;
  }
  _progress.delete(i);
  _renderingLines.delete(i);
  _renderStart.delete(i);
  _renderTask.delete(i);
  _render();
  _status(got ? `fragment ${i + 1} rendered` : `fragment ${i + 1}: ${err}`, got ? 'ok' : 'err');
  // Tell the other columns: the Video section counts what is left to render, and after a
  // single-card render nothing else would repaint its button.
  if (_project) adoptProject(_project);
  return got ? { ok: true } : { error: err };
}

// A render started before this page existed — or before the last restart. The project
// remembers the task, so the working state and its countdown are picked back up.
function _resumeRenders() {
  (_lines || []).forEach((l, i) => {
    const r = l && l.render;
    if (!r || !r.taskId || r.error) return;
    if (_renderingLines.has(i)) return;
    _renderStart.set(i, Date.parse(r.startedAt) || Date.now());
    _renderTask.set(i, r.taskId);          // so its Cancel can name the task it is waiting on
    _renderingLines.add(i);
    // Same reason as on a fresh render: the take on show is the PREVIOUS one, and the
    // answer is whatever replaces it.
    _followLine(i, (_pickedClip(l) || {}).id || '');
  });
}

// A media field: a tag, and either a thumbnail or an empty placeholder.
// onPick makes the field a chooser (used for the mix slot). `opts.busy` puts the field
// to work instead of showing a placeholder, and `opts.badge` labels what it holds — a
// clip's length, so the cell says more than "there is something here".
function _media(tag, fullPath, onPick, opts) {
  const o = opts || {};
  const box = document.createElement('div');
  box.className = 'sv3-frag-media' + (onPick ? ' pickable' : '') + (o.busy ? ' is-busy' : '');

  const t = document.createElement('div');
  t.className = 'sv3-frag-mtag';
  t.textContent = tag;
  box.appendChild(t);

  if (o.busy) {
    const sp = document.createElement('div');
    sp.className = 'sv3-frag-mspin';
    box.appendChild(sp);
    box.title = 'Rendering this fragment…';
  } else if (fullPath) {
    box.appendChild(thumbImg(fullPath, null, { noFit: true }));   // thumbnail only
  } else {
    const ph = document.createElement('div');
    ph.className = 'sv3-frag-mph';
    ph.textContent = '+';
    box.appendChild(ph);
  }
  if (o.badge) {
    const b = document.createElement('div');
    b.className = 'sv3-frag-mdur';
    b.textContent = o.badge;
    box.appendChild(b);
  }
  if (onPick) {
    box.title = o.pickTitle || 'Pick a first frame for this fragment';
    box.addEventListener('click', (e) => { e.stopPropagation(); onPick(box); });
  }
  return box;
}

// ── splitting a fragment ────────────────────────────────────────────────────
// A thin gap between cards that opens on hover, with a + in it. Borrowed from the v2 page,
// delay included: without it the strip jumps open under a mouse merely passing through.
//
// This is the only cure for a read the lipsync will not take, so it has to be findable from
// the card that has the problem — hence the instruction on that card's red play button.
function _insStrip(at) {
  const el = document.createElement('div');
  el.className = 'sv3-frag-ins';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sv3-frag-insbtn';
  b.textContent = '+';
  b.title = at ? 'Add a fragment here — for the tail of a sentence that is too long'
               : 'Add a fragment at the top';
  b.addEventListener('click', (e) => { e.stopPropagation(); _insertLine(at); });
  el.appendChild(b);
  return el;
}

// An inserted fragment has to be removable, or one stray click leaves a phantom line in the
// script for good. Only while it is EMPTY though — no words, no read, no clip — so this can
// never throw away work. A fragment with anything in it is deleted by emptying it first.
const _removable = (l) => !String(l.text || '').trim() && !String(l.tagged || '').trim()
  && !(l.audio || {}).plain && !(l.audio || {}).tagged
  && !_clipsOf(l).length;

function _delCtl(i) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sv3-frag-del';
  b.textContent = '✕';
  b.title = 'Remove this empty fragment';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_frozen()) return;
    _lines.splice(i, 1);
    _dirty = true;
    _flush();
    _render();
    _status(`fragment ${i + 1} removed`, 'ok');
  });
  return b;
}

// The new line inherits the FRAME of the one above it: a sentence split in two is almost
// always the same shot, and leaving the frame empty would make the halves look unrelated.
// Nothing else is copied — no words, no take, no clip.
function _insertLine(at) {
  if (_frozen() || !_project) return;
  const above = _lines[at - 1] || _lines[at] || {};
  _lines.splice(at, 0, {
    text: '', tagged: '', frameId: String(above.frameId || ''),
    audio: {}, video: {}, pick: {}, render: null,
  });
  _dirty = true;
  _flush();
  _render();
  _status(`fragment ${at + 1} added — move the tail of the sentence into it`, 'ok');
  // Put the caret in it: the next thing to happen is always typing or pasting.
  const card = ($('sv3-frags').querySelectorAll('.sv3-frag')[at]);
  const text = card && card.querySelector('.sv3-frag-text');
  if (text) text.focus();
}

// The video cell: working, the chosen variant's poster, or empty. Clicking a poster opens
// the viewer; the list itself stays stills-only. When the fragment has variants it also
// carries their count and, on hover, arrows to page through them — including to takes made
// from another frame, which is why paging moves the frame too.
function _clipCell(i, ln) {
  if (_renderingLines.has(i)) return _media('video', '', null, { busy: true });
  const clip = _freshClip(ln);
  const all = _clipsOf(ln);
  // Arrows also matter with a single variant that is NOT on show — it belongs to another
  // frame, and paging to it is the only way back to it from here.
  const browsable = all.length > 1 || (all.length === 1 && !clip);

  const cell = _media('video', clip ? (clip.thumb || '') : '', clip ? () => _openClipViewer(i) : null, {
    badge: clip && clip.dur ? `${clip.dur.toFixed(1)}s` : '',
    pickTitle: 'Play this clip · page the takes with the arrows',
  });
  if (!browsable) return cell;

  const n = document.createElement('div');
  n.className = 'sv3-frag-mcount';
  n.textContent = String(all.length);
  n.title = `${all.length} take${all.length === 1 ? '' : 's'} of this fragment`;
  cell.appendChild(n);

  [['prev', '‹', -1], ['next', '›', 1]].forEach(([cls, glyph, d]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-frag-marrow ' + cls;
    b.textContent = glyph;
    b.title = d < 0 ? 'Previous take' : 'Next take';
    // the cell itself opens the viewer, so an arrow must not count as clicking it
    b.addEventListener('click', (e) => { e.stopPropagation(); _stepVariant(i, d); });
    cell.appendChild(b);
  });
  return cell;
}

// Move to another take of this fragment. The pick and the FRAME move together: a variant
// was animated from one still, and leaving the mix cell showing a different one would be
// a lie about what is in the clip.
function _stepVariant(i, delta) {
  if (_frozenLine(i)) return;
  const ln = _lines[i];
  if (!ln) return;
  const all = _clipsOf(ln);
  if (!all.length) return;
  const cur = _pickedClip(ln);
  const at = cur ? all.findIndex(c => c.id === cur.id) : -1;
  const next = all[((at < 0 ? 0 : at + delta) + all.length) % all.length];
  if (!next) return;

  const v = _variant();
  const apply = (line) => {
    if (!line) return;
    line.pick = { ...(line.pick || {}), [v]: next.id };
    line.frameId = String(next.fromFrame || line.frameId || '');
  };
  apply(ln);
  if (_project && _project.lines) apply(_project.lines[i]);
  _dirty = true;
  _flush();
  _render();
  _status(`fragment ${i + 1}: take ${all.indexOf(next) + 1} of ${all.length}`, 'ok');
}

// The viewer: one take at a time, with the takes either side of it and what each was made
// from. Choosing here is the same act as the arrows on the card.
function _openClipViewer(i) {
  const ln = _lines[i];
  if (!ln) return;
  const all = _clipsOf(ln);
  const cur = _pickedClip(ln);
  let at = Math.max(0, all.findIndex(c => cur && c.id === cur.id));

  const ov = document.createElement('div');
  ov.className = 'sv3-clip-ov';
  ov.innerHTML = `
    <button class="sv3-clip-nav prev" type="button" title="Previous take">&#8249;</button>
    <div class="sv3-clip-wrap">
      <video class="sv3-clip-v" controls autoplay playsinline></video>
      <div class="sv3-clip-meta"></div>
    </div>
    <button class="sv3-clip-nav next" type="button" title="Next take">&#8250;</button>`;
  const vid  = ov.querySelector('video');
  const meta = ov.querySelector('.sv3-clip-meta');
  const nav  = [...ov.querySelectorAll('.sv3-clip-nav')];
  nav.forEach(b => { b.hidden = all.length < 2; });

  const paint = () => {
    const c = all[at];
    if (!c) return;
    if (vid.getAttribute('src') !== c.path) { vid.src = c.path; vid.play().catch(() => {}); }
    const bits = [`take ${at + 1} of ${all.length}`];
    if (c.dur) bits.push(`${c.dur.toFixed(1)}s`);
    if (c.quality) bits.push(c.quality);
    if (c.preset) bits.push(c.preset);
    if (c.at) bits.push(new Date(c.at).toLocaleString());
    meta.textContent = bits.join(' · ');
  };
  const step = (d) => {
    at = (at + d + all.length) % all.length;
    paint();
    // choosing in the viewer is choosing for the cut, exactly like the card's arrows
    _stepToId(i, all[at].id);
  };
  ov.querySelector('.prev').addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
  ov.querySelector('.next').addEventListener('click', (e) => { e.stopPropagation(); step(1); });

  const close = () => {
    try { vid.pause(); } catch (e) {}
    ov.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && all.length > 1) step(-1);
    else if (e.key === 'ArrowRight' && all.length > 1) step(1);
  };
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  paint();
}

// Choose a take from outside this column — the reel preview lets the cut be assembled
// there, and the cards have to agree with it. Same act as the arrows on a card.
export function pickVariant(i, id) {
  _stepToId(i, id);
  _render();
}

// Set the pick to a known id, without re-rendering the column out from under an open
// viewer: the cards catch up when it closes, and the header counters follow now.
function _stepToId(i, id) {
  const v = _variant();
  const ln = _lines[i];
  const clip = _clipsOf(ln).find(c => c.id === id);
  if (!clip) return;
  const apply = (line) => {
    if (!line) return;
    line.pick = { ...(line.pick || {}), [v]: id };
    line.frameId = String(clip.fromFrame || line.frameId || '');
  };
  apply(ln);
  if (_project && _project.lines) apply(_project.lines[i]);
  _dirty = true;
  _flush();
  _renderProgress();
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
  // Running out of frames is the common reason for opening this list, so the way to make
  // more sits right in it. It opens Build mix in add-only mode: the new frames join the
  // pool and every fragment keeps the frame it has, because a clip belongs to one frame
  // and a reshuffle here would silently unrender paid work.
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'sv3-frag-pickclear';
  add.textContent = 'add';
  add.title = 'Build more first frames — the ones already chosen stay put';
  add.addEventListener('click', () => {
    _closePick();
    const proj = currentProject();
    if (!proj) return;
    openMixPopup({
      project: proj,
      keepAssignments: true,
      // the pool grew, so every column that reads it repaints
      onSaved: () => { const p = currentProject(); if (p) adoptProject(p); },
    });
  });
  el.appendChild(add);
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
  // The overlays are about to lose their hosts. Detaching first stops their timers
  // WITHOUT recording a duration — the renders themselves are still running, and each
  // one is re-attached below with its real start time.
  _progress.forEach(p => p.detach());
  _progress.clear();
  box.textContent = '';
  // With no strips between them the cards have to keep themselves apart.
  box.classList.toggle('no-ins', _filter !== 'all' || _frozen());

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
    // Two reasons for a red card, and they read the same because they mean the same
    // thing: this fragment needs attention. The tagged-take outline belongs to the
    // tagged view only — in plain the words are fine — while a failed render is a fact
    // in either view.
    card.className = 'sv3-frag'
      + ((broken && v === 'tagged') || _clipError(ln) || _tooLong(ln) ? ' is-broken' : '');

    const n = document.createElement('div');
    n.className = 'sv3-frag-n';
    n.textContent = String(i + 1);

    const text = document.createElement('div');
    text.className = 'sv3-frag-text' + (_frozenLine(i) ? ' is-locked' : '');
    text.contentEditable = _frozenLine(i) ? 'false' : 'true';
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
      _media('mix', frame ? frame.path : '', _frozenLine(i) ? null : (anchor) => _openPick(anchor, i)),
      text,
      acts,
      // The clip shows as its POSTER frame, never as ten <video> tags decoding at once.
      // Clicking it plays the clip; a stale one is not shown at all, because the cell is
      // how the user reads "this fragment is done".
      _clipCell(i, ln),
    ];
    // The gap ABOVE each card, so every position between fragments is reachable — including
    // the very top. Only while the whole list is on show: inserting "between" a filtered list
    // would put the new fragment somewhere the user cannot see.
    if (_filter === 'all' && !_frozen()) box.appendChild(_insStrip(i));
    card.append(...kids);
    // an empty fragment can be taken back out; one with anything in it cannot
    if (_removable(ln) && !_frozen()) card.appendChild(_delCtl(i));
    box.appendChild(card);

    // A render in flight takes the whole card: its contents go behind a blur with a
    // spinner, a bar and a countdown that learns from the last runs. startedAt is what
    // makes it honest after a reload — the bar resumes where the job actually is.
    if (_renderingLines.has(i)) {
      const q = ((_project || {}).video || {}).quality || '';
      const dur = ((ln.audio || {})[v] || {}).dur || 0;
      _progress.set(i, startProgress(card, {
        label: `Rendering the clip${q ? ' · ' + q : ''}`,
        startedAt: _renderStart.get(i) || Date.now(),
        // The overlay decides WHEN to offer this - once the wait is past what this kind of
        // render usually takes. Before that there is nothing wrong to escape from.
        onCancel: () => _cancelLine(i),
        // Until this machine has timed a render of its own, guess from the read: kling
        // took about 25x the audio length in the runs we have seen, and a 45s default
        // would hit zero three minutes early — which reads as a job that failed.
        estimateMs: Math.max(90000, Math.round(dur * 25000)),
      }));
    }
  });

  // …and the gap after the last one, so a fragment can be added at the end too.
  if (_filter === 'all' && !_frozen() && _lines.length) box.appendChild(_insStrip(_lines.length));
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
  if (_frozenLine(+e.target.dataset.idx)) return;   // frozen; a drop could still fire this
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

  card.classList.toggle('is-broken',
    (_broken(ln) && _variant() === 'tagged') || !!_clipError(ln) || _tooLong(ln));
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
    // A render started before this page loaded is still the server's job. Pick it back
    // up so the card shows it working, with a countdown from when it really began.
    _resumeRenders();
    _render();
  });

  const fil = $('sv3-frag-filter');
  if (fil) fil.addEventListener('click', () => {
    _filter = _filter === 'error' ? 'all' : 'error';
    _render();
  });

  _render();
}
