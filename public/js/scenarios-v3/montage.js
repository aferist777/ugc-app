// Scenarios v3 — the Montage column: a gated stack of sections.
//
//   Voice-over   voice, the tag switch, the mood, and the batch read
//   Video        motion and rendering — shut and locked until the read exists
//
// The order is not a preference. A clip's length IS the length of its voice track and
// the lipsync takes that audio as an input, so nothing about video can be decided
// before the read exists. Video therefore stays disabled rather than merely empty.
//
// Phase scope: the shell, the settings and the gate. Tagging and TTS land next.

import { patchProject, adoptProject, onProjectSaved } from './projects.js';
import { flushFragments, setFragmentsLocked, markLineVoicing } from './fragments.js';
import { listMoods, tagLines, speakLines } from './api.js';
import { onModeChange, openColumn } from './shell.js';

const $ = id => document.getElementById(id);

let _proj  = null;
let _moods = [];
let _role  = '';        // what the casting director is told it is
let _saveT = null;

// ── persistence ─────────────────────────────────────────────────────────────
// The voice settings belong to the project, like the mix workspace does.
function _queueSave() {
  clearTimeout(_saveT);
  _saveT = setTimeout(async () => {
    if (!_proj) return;
    try { await patchProject({ voice: _proj.voice }); }
    catch (e) { console.error('[sv3] voice save failed', e); }
  }, 400);
}

const _status = (t) => { const n = $('sv3-mt-status'); if (n) n.textContent = t || ''; };

// A line is out of step when it carries a tagged take whose words no longer match the
// plain ones — edited after the tags were placed. Computed, never stored.
const _words = (t) => String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
const _brokenIdx = () => ((_proj && _proj.lines) || [])
  .map((l, i) => (l.tagged && _words(l.tagged) !== _words(l.text) ? i : -1))
  .filter(i => i >= 0);

// Which lines still need a read: no take for the variant on show, or one whose words
// have moved on. A take remembers what it said, so this needs no bookkeeping.
const _variantNow = () => ((((_proj || {}).voice || {}).variant === 'tagged') ? 'tagged' : 'plain');
const _unvoicedIdx = () => {
  const v = _variantNow();
  return ((_proj && _proj.lines) || []).map((l, i) => {
    const txt = v === 'tagged' ? (l.tagged || '') : (l.text || '');
    if (!txt.trim()) return -1;                    // nothing to say
    const t = (l.audio || {})[v];
    return (!t || !t.path || t.said !== txt) ? i : -1;
  }).filter(i => i >= 0);
};

// ── sections ────────────────────────────────────────────────────────────────
// One section open at a time. The rule lives here rather than in the click handlers so
// that every way in obeys it: the two headers, the auto-open on entering Montage, and
// the Next step button. Clicking the open one still folds it, leaving both shut.
const SECTIONS = ['sv3-mt-voice', 'sv3-mt-video'];
function _toggleSec(id, open) {
  const sec = $(id);
  if (!sec || sec.classList.contains('is-locked')) return;
  const opening = open === undefined ? sec.classList.contains('is-shut') : !!open;
  sec.classList.toggle('is-shut', !opening);
  if (!opening) return;
  // The others fold directly: being locked stops a section from OPENING, not from
  // getting out of the way.
  SECTIONS.forEach(other => {
    if (other === id) return;
    const n = $(other);
    if (n) n.classList.add('is-shut');
  });
}

// Video opens up only once every fragment that has a frame also has a take of the
// variant it is set to. Anything less and the render would have nothing to lipsync.
function _syncVideoGate() {
  const sec = $('sv3-mt-video');
  const head = $('sv3-mt-video-head');
  const badge = $('sv3-mt-video-badge');
  if (!sec || !head) return;

  const lines = (_proj && _proj.lines) || [];
  // the take is a project setting now, not a per-line one
  const v = (((_proj || {}).voice || {}).variant === 'tagged') ? 'tagged' : 'plain';
  const withFrame = lines.filter(l => l.frameId);
  const voiced = withFrame.filter(l => (l.audio || {})[v]);
  const ready = withFrame.length > 0 && voiced.length === withFrame.length;

  sec.classList.toggle('is-locked', !ready);
  head.disabled = !ready;
  if (!ready) sec.classList.add('is-shut');
  if (badge) {
    badge.textContent = ready ? 'ready'
      : withFrame.length ? `${voiced.length}/${withFrame.length} voiced` : 'no frames yet';
  }
}

// Only ElevenLabs for now. The picker exists because everything below it belongs to
// the chosen service, so a second provider will bring its own fields rather than
// quietly reusing these.
const PROVIDERS = [{ id: 'elevenlabs', label: 'elevenlabs' }];

function _fillProvider() {
  const sel = $('sv3-mt-provider');
  if (!sel) return;
  const v = _proj ? _proj.voice : null;
  sel.textContent = '';
  PROVIDERS.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label;
    sel.appendChild(o);
  });
  sel.value = (v && v.provider) || 'elevenlabs';
  sel.disabled = PROVIDERS.length < 2;
  sel.title = PROVIDERS.length < 2
    ? 'ElevenLabs is the only voice service wired up so far'
    : 'Which service speaks the lines. Everything below belongs to it.';
}

// ── voice section ───────────────────────────────────────────────────────────
function _fillVoices() {
  const sel = $('sv3-mt-voice-sel');
  if (!sel) return;
  const v = _proj ? _proj.voice : null;
  const cast = (_proj && _proj.casting) || {};
  sel.textContent = '';

  // The character's own voice is the default. Until the voice library lands there is
  // nothing else to offer, so the list states where the voice comes from rather than
  // pretending to be a chooser.
  const fromChar = cast.voiceName || cast.voice || '';
  const o = document.createElement('option');
  o.value = '';
  o.textContent = fromChar ? `${fromChar} — from the character` : 'from the character';
  sel.appendChild(o);
  if (v && v.voiceId) {
    const own = document.createElement('option');
    own.value = v.voiceId;
    own.textContent = v.voiceName || v.voiceId;
    sel.appendChild(own);
  }
  sel.value = (v && v.voiceId) || '';
  sel.title = fromChar
    ? 'Taken from the cast character; the gear opens the voice library later'
    : 'This character has no voice saved yet — set one in the Character tab';
}

function _fillMoods() {
  const sel = $('sv3-mt-mood');
  if (!sel) return;
  const v = _proj ? _proj.voice : null;
  sel.textContent = '';
  _moods.forEach(m => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label;
    // the brief is the interesting part: it is what the casting director is told
    o.title = [m.note, m.brief, 'Tags: ' + m.tags.join(', ')].filter(Boolean).join('\n\n');
    sel.appendChild(o);
  });
  const want = (v && v.mood) || '';
  sel.value = _moods.some(m => m.id === want) ? want : ((_moods[0] || {}).id || '');
  if (v && _moods.length) v.mood = sel.value;
}

function _renderVoice() {
  const v = _proj ? _proj.voice : null;
  const on = !!(v && v.tagsOn);

  const chk = $('sv3-mt-tags-on');
  if (chk) chk.checked = on;

  // The switch is really a model switch: tags are a v3 feature, and v2 would read
  // them out loud as words.
  const note = $('sv3-mt-model-note');
  if (note) {
    note.textContent = on
      ? 'ElevenLabs v3 — tags are performed'
      : 'ElevenLabs v2 — no tags, plain read';
  }

  // With tags off there is no mood, no tagging and no variant to choose: hide that
  // apparatus rather than leaving a row of dead controls asking to be understood.
  const moodFld = $('sv3-mt-mood-fld');
  if (moodFld) moodFld.hidden = !on;

  const mood = $('sv3-mt-mood');
  if (mood) mood.disabled = !on || !_moods.length;

  const mnote = $('sv3-mt-mood-note');
  if (mnote) {
    const m = _moods.find(x => x.id === (v && v.mood));
    mnote.textContent = (on && m) ? m.note : '';
    mnote.hidden = !on;
  }

  const tag = $('sv3-mt-tag');
  const tagWrap = $('sv3-mt-tag-wrap');
  const lines = (_proj && _proj.lines) || [];
  const hasText = lines.some(l => (l.text || '').trim());
  if (tag) tag.disabled = _tagging || !on || !_moods.length || !hasText;
  if (tagWrap) {
    tagWrap.title = !on ? 'Turn voice tags on first'
      : !hasText ? 'This project has no lines yet'
      : 'Read the whole script and insert tags — the words never change';
  }

  // The ONE variant switch. Always on screen; it just cannot move to tagged while
  // there is no tagged take to move to. It drives three things at once: what the
  // cards show, what Voice all produces, and which take the counters read.
  const batch = $('sv3-mt-batch');
  const cap = $('sv3-mt-batch-cap');
  const pill = $('sv3-mt-batch-pill');
  const anyTagged = lines.some(l => (l.tagged || '').trim());
  const canTag = on && anyTagged;
  if (v && !canTag) v.variant = 'plain';       // nothing to show but the plain read
  if (batch) {
    batch.checked = !!(v && v.variant === 'tagged');
    batch.disabled = !canTag;
  }
  if (cap) cap.textContent = (v && v.variant === 'tagged') ? 'tagged' : 'plain';
  if (pill) {
    pill.title = canTag
      ? 'Which take the cards show, Voice all produces and the counters read'
      : (on ? 'Insert tags first — there is no tagged take yet'
            : 'Turn voice tags on to get a tagged take');
  }

  // Blue always points at the next step: Insert until the tags exist, then Voice all.
  if (tag) tag.classList.toggle('primary', on && !anyTagged);

  // While any fragment is out of step, this button repairs instead of voicing: voicing
  // a stale take would read the wrong words aloud.
  const broken = _brokenIdx();
  const all = $('sv3-mt-voiceall');
  const allWrap = $('sv3-mt-voiceall-wrap');
  const waiting = on && !anyTagged;            // tags asked for but not placed yet
  // Three jobs, one button, and the label always names the next step:
  //   tags out of step -> repair      unvoiced lines -> read them      done -> move on
  const unvoiced = _unvoicedIdx();
  const done = hasText && !broken.length && !waiting && !unvoiced.length;
  if (all) {
    // A fourth job while the batch runs: it is the way to call the batch off, and it
    // counts the reads that have come back so the wait is not a blind one.
    all.textContent = _fixing ? 'Fixing…'
      : _voicing ? (_stopping ? 'Stopping…' : `Stop (${_vDone}/${_vTotal})`)
      : broken.length ? `Fix tags (${broken.length})`
      : done ? 'Next step: Video'
      : `Voice all (${unvoiced.length})`;
    all.disabled = _fixing || (_voicing ? _stopping : (!hasText || (waiting && !broken.length)));
    all.classList.toggle('danger-solid', _voicing);
    all.classList.toggle('primary', !_voicing);
  }
  if (allWrap) {
    allWrap.title = _voicing
        ? 'Stop after the fragment being read now — every read already delivered is kept'
      : !hasText ? 'This project has no lines yet'
      : broken.length ? 'Re-tag the fragments whose words changed. The whole script goes in'
                        + ' for context, so the new tags match what the approved lines do.'
      : waiting ? 'Insert the tags first, or turn voice tags off'
      : done ? 'Every fragment is read — fold this away and open Video'
      : `Read the ${unvoiced.length} fragment${unvoiced.length === 1 ? '' : 's'} that still need it.`
        + ' Already-voiced lines are left alone — spends ElevenLabs credits';
  }

  // Nothing that feeds a read may move while the batch is running — not the provider,
  // the mood, the tag switch or the variant. Stop is the only live control left.
  if (_voicing) {
    ['sv3-mt-provider', 'sv3-mt-voice-sel', 'sv3-mt-voice-gear', 'sv3-mt-tags-on',
     'sv3-mt-mood', 'sv3-mt-mood-gear', 'sv3-mt-tag'].forEach(id => {
      const el = $(id);
      if (el) el.disabled = true;
    });
    if (batch) batch.disabled = true;
  }
}

// Read the whole script and fill in the tagged copy of every line. The server owns
// the write, so the answer replaces the page's project wholesale rather than being
// merged into a copy the Fragments column may already be editing.
let _tagging = false;
let _fixing  = false;
let _voicing = false;
let _stopping = false;   // Stop was pressed: finish the read in flight, send no more
let _vDone   = 0;        // reads that came back this run
let _vTotal  = 0;        // reads the run set out to make

// Voice the lines ONE AT A TIME, adopting each answer the moment it lands: the card
// gets its take and both counters move as the batch runs, instead of ten reads landing
// together after a minute of nothing.
//
// Strictly one request in flight, and the next leaves as soon as the previous returns.
// Overlapping them would be quicker and wrong: every answer carries the whole project,
// so two in flight know nothing of each other and the later one erases the take the
// earlier one just delivered.
async function _voiceAll() {
  if (_voicing || !_proj) return;
  const projectId = _proj.id;
  // Fixed at the start. Adopting each answer rewrites what counts as unvoiced, so
  // re-reading the list mid-run would have the batch chase its own tail.
  const idx = _unvoicedIdx();
  if (!idx.length) return;

  _voicing  = true;
  _stopping = false;
  _vDone    = 0;
  _vTotal   = idx.length;
  _renderVoice();

  let ok = 0;
  let skipped = 0;
  const failed = [];
  try {
    await flushFragments();          // never voice words that are not saved yet
    setFragmentsLocked(true);        // and hold them still for as long as this runs
    for (const i of idx) {
      if (_stopping) break;
      _status(`Reading fragment ${i + 1} — ${_vDone} of ${_vTotal} done…`);
      markLineVoicing(i, true);
      try {
        const { project, report } = await speakLines(projectId, [i]);
        if (report.failed.length) { failed.push(i + 1); console.warn('[sv3] voicing', report.failed); }
        else if (report.spoken) ok++;
        else skipped++;              // the server found nothing to say on that line
        markLineVoicing(i, false);
        adoptProject(project);       // the card, the counters and this column follow
      } catch (e) {
        failed.push(i + 1);
        markLineVoicing(i, false);
        console.warn('[sv3] voicing line ' + (i + 1), e);
      }
      _vDone++;
      _renderVoice();
    }
    const bits = [`${ok} voiced`];
    if (skipped) bits.push(`${skipped} had nothing to say`);
    if (failed.length) bits.push(`${failed.length} failed (${failed.join(', ')})`);
    if (_stopping) bits.push(`stopped, ${_vTotal - _vDone} left`);
    _status(bits.join(' · '));
  } catch (e) {
    _status('Voicing failed: ' + e.message);
  } finally {
    _voicing  = false;
    _stopping = false;
    setFragmentsLocked(false);
    _renderVoice();
  }
}

// Re-tag only the fragments that fell out of step. One call for all of them: the arc
// is computed once, and four edited lines do not need four passes over the script.
async function _fixTags(idx) {
  if (_fixing || !_proj) return;
  const projectId = _proj.id;
  _fixing = true;
  _renderVoice();
  _status(`Re-tagging ${idx.length} fragment${idx.length === 1 ? '' : 's'}…`);
  try {
    await flushFragments();          // never re-tag against words that are not saved yet
    const { project, report } = await tagLines(projectId, idx);
    adoptProject(project);
    renderMontage();
    const bits = [`${report.tagged} re-tagged`];
    if (report.rejected.length) bits.push(`${report.rejected.length} rejected`);
    _status(bits.join(' · '));
  } catch (e) {
    _status('Re-tagging failed: ' + e.message);
  } finally {
    _fixing = false;
    _renderVoice();
  }
}

async function _onInsertTags() {
  if (_tagging || !_proj) return;
  const tag = $('sv3-mt-tag');
  const projectId = _proj.id;
  _tagging = true;
  if (tag) tag.disabled = true;
  _status('Reading the script…');
  try {
    const { project, report } = await tagLines(projectId);
    adoptProject(project);           // the server also moved the switch to tagged
    renderMontage();
    // Say what happened rather than just "done": a rejected line is a line the pass
    // tried to rewrite, and a dropped tag is one the mood does not allow.
    const bits = [`${report.tagged} tagged`];
    if (report.plain) bits.push(`${report.plain} left plain`);
    if (report.rejected.length) bits.push(`${report.rejected.length} rejected (wording changed)`);
    if (report.dropped.length) bits.push(`${report.dropped.length} had stray tags removed`);
    _status(bits.join(' · '));
  } catch (e) {
    _status('Tagging failed: ' + e.message);
  } finally {
    _tagging = false;
    _renderVoice();
  }
}

export function renderMontage() {
  if (!_proj) return;
  _fillProvider();
  _fillVoices();
  _fillMoods();
  _renderVoice();
  _syncVideoGate();
}

// Called when the mix popup saves its frame assignments: the casting work is done,
// so that column folds away and this one takes over with the read.
export function openMontageForVoice() {
  openColumn('montage');            // folds Casting through the shared pairing rule
  _toggleSec('sv3-mt-voice', true);
  renderMontage();
}

// Frames already sitting on the fragments mean the casting work is done, so a project
// opened in that state lands in Montage rather than making the user find it. This runs
// on the MODE change, not on the project change: setMode collapses every workspace
// column after the project is emitted, and would undo it.
function _autoOpen() {
  if (!_proj) return;
  const framed = ((_proj.lines || []).some(l => l.frameId));
  if (framed) openColumn('montage');
}

export function initMontage(onProjectChange) {
  onProjectChange((project) => {
    _proj = project;
    _status('');
    if (project) { renderMontage(); _autoOpen(); }
  });
  onModeChange((mode) => { if (mode === 'workspace') _autoOpen(); });
  // A fragment edit can break a line, which turns Voice all into Fix tags. Repainting
  // this column touches nothing in Fragments, so there is no caret to lose.
  onProjectSaved(() => { if (_proj) { _renderVoice(); _syncVideoGate(); } });

  const vhead = $('sv3-mt-voice-head');
  if (vhead) vhead.addEventListener('click', () => _toggleSec('sv3-mt-voice'));
  const vidhead = $('sv3-mt-video-head');
  if (vidhead) vidhead.addEventListener('click', () => _toggleSec('sv3-mt-video'));

  const chk = $('sv3-mt-tags-on');
  if (chk) chk.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.tagsOn = chk.checked;
    // no tags means the plain read, so the switch cannot stay on tagged
    if (!chk.checked) _proj.voice.variant = 'plain';
    // the cards read the variant too, so they have to hear about it
    _renderVoice(); _queueSave(); adoptProject(_proj);
  });

  const mood = $('sv3-mt-mood');
  if (mood) mood.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.mood = mood.value;
    _renderVoice(); _queueSave();
  });

  const batch = $('sv3-mt-batch');
  if (batch) batch.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.variant = batch.checked ? 'tagged' : 'plain';
    // the cards and both counters read this, so they repaint with it
    _renderVoice(); _queueSave(); adoptProject(_proj);
  });

  const prov = $('sv3-mt-provider');
  if (prov) prov.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.provider = prov.value;
    _queueSave();
  });

  const vsel = $('sv3-mt-voice-sel');
  if (vsel) vsel.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.voiceId = vsel.value;
    _proj.voice.voiceName = vsel.value ? (vsel.selectedOptions[0] || {}).textContent || '' : '';
    _queueSave();
  });

  const tag = $('sv3-mt-tag');
  if (tag) tag.addEventListener('click', _onInsertTags);
  const all = $('sv3-mt-voiceall');
  if (all) all.addEventListener('click', () => {
    // mid-batch this is Stop: the read in flight is paid for, so it is kept, and
    // nothing further is sent
    if (_voicing) {
      _stopping = true;
      _renderVoice();
      _status('Stopping after this fragment…');
      return;
    }
    // one button, two jobs: repair while anything is out of step, otherwise voice
    const broken = _brokenIdx();
    if (broken.length) { _fixTags(broken); return; }
    if (_unvoicedIdx().length) { _voiceAll(); return; }
    // everything is read: this button is now the way forward
    _toggleSec('sv3-mt-voice', false);
    _toggleSec('sv3-mt-video', true);
  });

  return listMoods()
    .then(({ moods, role }) => { _moods = moods || []; _role = role || ''; renderMontage(); })
    .catch(e => { console.error('[sv3] moods', e); });
}
