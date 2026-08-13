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
import { flushFragments, setFragmentsLocked, markLineVoicing, renderLine,
         primeMotionKit, pickVariant } from './fragments.js';
import { listMoods, listMotionKit, tagLines, speakLines, saveReel, reelAudio, reelMerge } from './api.js';
import { onModeChange, openColumn } from './shell.js';
import { openReelPopup } from './reel-popup.js';
import { openVoicePopup } from './voice-popup.js';

const $ = id => document.getElementById(id);

let _proj  = null;
let _moods = [];
let _role  = '';        // what the casting director is told it is
let _saveT = null;

// ── persistence ─────────────────────────────────────────────────────────────
// The voice settings belong to the project, like the mix workspace does.
// Only the fields the user actually changed go up. Sending all of them would let one
// window write back another's settings from its own stale copy: two tabs on the same
// project, and a click on the quality dropdown in the second undoes the tags checkbox
// ticked in the first.
const _pendingSave = new Set();
function _queueSave(...fields) {
  fields.forEach(f => _pendingSave.add(f));
  clearTimeout(_saveT);
  _saveT = setTimeout(async () => {
    if (!_proj || !_pendingSave.size) return;
    const body = {};
    _pendingSave.forEach(f => { body[f] = _proj[f]; });
    _pendingSave.clear();
    try { await patchProject(body); }
    catch (e) { console.error('[sv3] montage save failed', e); }
  }, 400);
}

// Send whatever is still on the 400ms timer, now. Leaving the project is one of the
// moments where "it will save in a moment" is not good enough.
export async function flushMontage() {
  if (!_proj || !_pendingSave.size) return;
  clearTimeout(_saveT);
  const body = {};
  _pendingSave.forEach(f => { body[f] = _proj[f]; });
  _pendingSave.clear();
  try { await patchProject(body); }
  catch (e) { console.error('[sv3] montage flush failed', e); }
}

// Which section the work has reached. Written only where the user actually decides to
// move — a header click, Save in the mix popup, or Next step — never from a repaint,
// which would let the page argue with itself about where it is.
function _setStage(stage) {
  if (!_proj || _proj.stage === stage) return;
  _proj.stage = stage;
  _queueSave('stage');
}

const _status = (t) => { const n = $('sv3-mt-status'); if (n) n.textContent = t || ''; };
// The video section has its own line: a render report and a voicing report are about
// different work, and one overwriting the other loses the answer the user was reading.
const _vstatus = (t) => { const n = $('sv3-mt-video-status'); if (n) n.textContent = t || ''; };

let _rendering = false;
let _stoppingR = false;   // Stop pressed: finish the clip in flight, start no more
let _rDone  = 0;
let _rTotal = 0;

// A line is out of step when it carries a tagged take whose words no longer match the
// plain ones — edited after the tags were placed. Computed, never stored.
const _words = (t) => String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
const _brokenIdx = () => ((_proj && _proj.lines) || [])
  .map((l, i) => (l.tagged && _words(l.tagged) !== _words(l.text) ? i : -1))
  .filter(i => i >= 0);

// Which lines still need a read: no take for the variant on show, or one whose words
// have moved on. A take remembers what it said, so this needs no bookkeeping.
const _variantNow = () => ((((_proj || {}).voice || {}).variant === 'tagged') ? 'tagged' : 'plain');
const _textOf = (l, v) => (v === 'tagged' ? (l.tagged || '') : (l.text || ''));
// A take counts only while it still says the words on the line. One predicate, used by
// both the batch read and the video gate — they disagreed once, and the gate opened on
// takes that had gone stale.
const _hasFreshTake = (l, v) => {
  const txt = _textOf(l, v);
  const t = (l.audio || {})[v];
  return !!(txt.trim() && t && t.path && t.said === txt);
};
const _unvoicedIdx = () => {
  const v = _variantNow();
  return ((_proj && _proj.lines) || []).map((l, i) => {
    if (!_textOf(l, v).trim()) return -1;          // nothing to say
    return _hasFreshTake(l, v) ? -1 : i;
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
  const v = _variantNow();
  const withFrame = lines.filter(l => l.frameId);
  // FRESH takes, not merely present ones: a clip is lipsynced to specific words, and a
  // take whose line has since been edited would put the wrong read under the picture.
  const voiced = withFrame.filter(l => _hasFreshTake(l, v));
  const ready = withFrame.length > 0 && voiced.length === withFrame.length;

  sec.classList.toggle('is-locked', !ready);
  head.disabled = !ready;
  if (!ready) sec.classList.add('is-shut');
  if (badge) {
    badge.textContent = ready ? 'ready'
      : withFrame.length ? `${voiced.length}/${withFrame.length} voiced` : 'no frames yet';
  }
  // The model belongs to the section: offering it while the section cannot open would
  // invite a choice that has nothing to act on.
  const mod = $('sv3-mt-vmodel');
  if (mod) mod.disabled = !ready || _kit.models.length < 2;
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

// ── video section ───────────────────────────────────────────────────────────
// Three choices and no more: which service lipsyncs, how the character moves, and how
// sharp the clip is. The motion prompt is the model's ONLY lever besides the still and
// the audio, and one preset serves the whole script — the prompt rides along with a
// frame the model can already see, so a per-line rewrite would just restate the picture.
let _kit = { presets: [], models: [], qualities: [] };

// The server normalises `video` onto every project, but a project object assembled on
// the page may not carry it, and a change handler must not be the thing that throws.
function _vid() {
  if (!_proj) return {};
  if (!_proj.video || typeof _proj.video !== 'object') {
    _proj.video = { model: 'kling', preset: _kit.defaultPreset || '', quality: _kit.defaultQuality || '' };
  }
  return _proj.video;
}

function _fillVideo() {
  const vid = _vid();

  const mod = $('sv3-mt-vmodel');
  if (mod) {
    mod.textContent = '';
    _kit.models.forEach(m => {
      const o = document.createElement('option');
      o.value = m.id; o.textContent = m.label;
      mod.appendChild(o);
    });
    mod.value = vid.model || (_kit.models[0] || {}).id || '';
    mod.disabled = _kit.models.length < 2;
    mod.title = _kit.models.length < 2
      ? 'Kling is the only lipsync wired up so far'
      : 'Which service lipsyncs the fragments. Everything below belongs to it.';
  }

  const pre = $('sv3-mt-preset');
  if (pre) {
    pre.textContent = '';
    _kit.presets.forEach(p => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.label;
      pre.appendChild(o);
    });
    pre.value = vid.preset || _kit.defaultPreset || '';
    pre.disabled = !_kit.presets.length;
  }

  const qua = $('sv3-mt-quality');
  if (qua) {
    qua.textContent = '';
    _kit.qualities.forEach(q => {
      const o = document.createElement('option');
      o.value = q.id; o.textContent = q.label;
      qua.appendChild(o);
    });
    qua.value = vid.quality || _kit.defaultQuality || '';
    qua.disabled = !_kit.qualities.length;
  }

  _renderVideo();
}

// The notes carry what the choice actually costs the user: for motion, what the model
// will do; for quality, the money and the ceiling on how long a fragment may be.
function _renderVideo() {
  const vid = _vid();
  const p = _kit.presets.find(x => x.id === vid.preset);
  const q = _kit.qualities.find(x => x.id === vid.quality);

  const pn = $('sv3-mt-preset-note');
  if (pn) pn.textContent = p ? p.note : '';

  const pre = $('sv3-mt-preset');
  // the prompt itself, so what gets sent is never a mystery
  if (pre) pre.title = p ? p.prompt : 'How the character moves while the line is read';

  const qn = $('sv3-mt-quality-note');
  if (qn) {
    if (!q) { qn.textContent = ''; return; }
    // What ten fragments of an average length would come to, using the reads we have.
    const lines = (_proj && _proj.lines) || [];
    const v = _variantNow();
    const secs = lines.map(l => ((l.audio || {})[v] || {}).dur || 0).filter(Boolean);
    const total = secs.reduce((a, b) => a + b, 0);
    qn.textContent = total
      ? `$${q.pricePerSec.toFixed(2)}/s — ${secs.length} read${secs.length === 1 ? '' : 's'}, `
        + `${total.toFixed(1)}s in all, about $${(total * q.pricePerSec).toFixed(2)}`
      : `$${q.pricePerSec.toFixed(2)}/s · a fragment may not exceed ${q.maxAudioSec}s of audio`;
  }
}

// Which fragments still need a clip. A rendered fragment is LEFT ALONE: a clip counts as
// this fragment's clip while the words and the read it was synced to still hold, and
// nothing else. The motion and the quality are recorded on it too, but changing a preset
// does not throw ten paid clips away — re-rendering one is the card's own button.
//
// This is deliberately the same rule the header counter uses. Two notions of "done" is
// how the counter came to say 1/10 while the button still offered to render all ten.
function _unrenderedIdx() {
  const v = _variantNow();
  const q = _kit.qualities.find(x => x.id === _vid().quality);
  const ceiling = q ? q.maxAudioSec : 15;
  return ((_proj && _proj.lines) || []).map((l, i) => {
    if (!l.frameId) return -1;                       // nothing to animate
    if (!_hasFreshTake(l, v)) return -1;             // the read has to be right first
    const take = (l.audio || {})[v];
    if (take.dur > ceiling) return -1;               // the model would refuse it
    // The clip for the frame this fragment is set to NOW. Clips are kept per frame, so
    // this searches: change the frame and the fragment needs a render again, go back and
    // its earlier clip counts once more.
    const list = (l.video || {})[v];
    const clips = Array.isArray(list) ? list : (list ? [list] : []);
    const good = clips.some(c => c && c.path
      && String(c.fromFrame || '') === String(l.frameId || '')
      && c.said === _textOf(l, v)
      && c.fromAudio === take.path);
    return good ? -1 : i;
  }).filter(i => i >= 0);
}
// Fragments the model would refuse outright: the read runs past the ceiling. Counted
// separately so the button can say so instead of quietly leaving them out.
function _tooLongIdx() {
  const v = _variantNow();
  const q = _kit.qualities.find(x => x.id === _vid().quality);
  const ceiling = q ? q.maxAudioSec : 15;
  return ((_proj && _proj.lines) || []).map((l, i) => {
    const take = (l.audio || {})[v];
    return (l.frameId && _hasFreshTake(l, v) && take.dur > ceiling) ? i : -1;
  }).filter(i => i >= 0);
}

// The clips that make up the reel, in fragment order — each fragment's clip for the frame
// it is set to now. The same rule the counters use, so what plays is what they counted.
function _reelClips() {
  const v = _variantNow();
  return ((_proj && _proj.lines) || []).map((l, i) => {
    const list = (l.video || {})[v];
    const clips = (Array.isArray(list) ? list : (list ? [list] : [])).filter(x => x && x.path);
    const picked = clips.find(x => x.id === String(((l.pick || {})[v]) || ''));
    const mine = clips.filter(x => String(x.fromFrame || '') === String(l.frameId || ''));
    const chosen = (picked && String(picked.fromFrame || '') === String(l.frameId || ''))
      ? picked : (mine.length ? mine[mine.length - 1] : null);
    const c = (chosen && chosen.said === _textOf(l, v)) ? chosen : null;
    if (!c) return null;
    // The preview also CHOOSES: it needs every take of the fragment, not just the one in
    // the cut, and which of them is currently in it.
    return { n: i + 1, variants: clips, at: Math.max(0, clips.findIndex(x => x.id === c.id)) };
  }).filter(Boolean);
}

function _renderRenderBtn() {
  const btn = $('sv3-mt-renderall');
  const wrap = $('sv3-mt-renderall-wrap');
  if (!btn) return;
  const left = _unrenderedIdx();
  const long = _tooLongIdx();
  const q = _kit.qualities.find(x => x.id === _vid().quality);
  const reel = _reelClips();

  // A render in flight on ANY fragment, read from the project rather than from this module.
  // `_rendering` only knows about a batch THIS page started, so a reload wiped it and the
  // button came back blue and clickable over a render that was still going - starting a batch
  // on top of it. The marker on the line is the server's, so it survives the reload.
  const busy = ((_proj && _proj.lines) || [])
    .filter(l => l && l.render && l.render.taskId && !l.render.error).length;

  // Nothing left to render is not a dead end: the section's last act is handing the cut
  // on, so the button becomes the way to do that instead of stating the obvious.
  btn.textContent = _rendering ? (_stoppingR ? 'Stopping…' : `Stop (${_rDone}/${_rTotal})`)
    : busy ? (busy === 1 ? 'Rendering a fragment…' : `Rendering ${busy} fragments…`)
    : left.length ? `Render all (${left.length})`
    : reel.length ? 'Save to Merge'
    // Nothing to render AND nothing rendered is not success. It happens on a project whose
    // reads are all past the ceiling, and calling that "every fragment rendered" would be
    // a plain untruth.
    : long.length ? `${long.length} fragment${long.length === 1 ? '' : 's'} too long`
    : 'Nothing to render yet';
  btn.disabled = _rendering ? _stoppingR : (busy > 0 || !(left.length || reel.length));
  btn.title = busy && !_rendering
    ? 'A fragment is rendering. Cancel it on its own card, or wait for it to land.' : '';
  btn.classList.toggle('danger-solid', _rendering);
  // Blue means "you can press this". A disabled blue button over a running render is what made
  // the reload look like an invitation, so the colour goes with the availability.
  btn.classList.toggle('primary', !_rendering && !busy);

  if (wrap) {
    const cost = (q && left.length)
      ? ` About $${(left.reduce((a, i) => a + (((_proj.lines[i].audio || {})[_variantNow()] || {}).dur || 0), 0) * q.pricePerSec).toFixed(2)}.`
      : '';
    wrap.title = _rendering
        ? 'Stop after the clip being rendered now — every clip already delivered is kept'
      : (!left.length && reel.length)
        ? `Watch the ${reel.length} clips as one reel and hand the cut to Merge`
      : (!left.length && !reel.length && long.length)
        ? `Every read here runs past ${q ? q.maxAudioSec : 15}s, which the model will not take.`
          + ' Split those fragments and voice the halves.'
      : (!left.length && !reel.length) ? 'No fragment has a read short enough to lipsync yet'
      : !left.length ? 'Every fragment has a clip made from the read and motion it has now'
      : `Render the ${left.length} fragment${left.length === 1 ? ' that needs' : 's that need'} it.${cost}`
        + (long.length ? ` ${long.length} left out: the read runs past ${q ? q.maxAudioSec : 15}s.` : '');
  }
}

// Up to five clips in flight at once. The render is the slowest thing in the whole
// pipeline and the one worth parallelising — and unlike the read it is safe to overlap:
// a read answered with the WHOLE project, so two in flight erased each other's take,
// whereas a render only starts a task and the server's watcher writes one line each.
//
// Five, not ten: enough to halve a script's wall clock, few enough that Stop still means
// something and a bad preset does not cost ten renders before anyone can look.
const RENDER_POOL = 5;

async function _renderAll() {
  if (_rendering || !_proj) return;
  const projectId = _proj.id;
  const idx = _unrenderedIdx();
  if (!idx.length) return;

  _rendering = true;
  _stoppingR = false;
  _rDone = 0;
  _rTotal = idx.length;
  _renderVoice(); _renderRenderBtn();

  let ok = 0, skipped = 0;
  const failed = [];
  try {
    await flushFragments();
    setFragmentsLocked(true);
    // A worker pool over one shared queue: each worker takes the next fragment the
    // moment its own clip lands, so the pool stays full instead of waiting for the
    // slowest member of a batch.
    const queue = idx.slice();
    const say = () => _vstatus(`Rendering — ${_rDone} done, `
      + `${_rTotal - _rDone - queue.length} in flight, ${queue.length} waiting`);
    const worker = async () => {
      while (!_stoppingR) {
        const i = queue.shift();
        if (i === undefined) return;
        say();
        // One implementation for both ways in: the card's own `video` button and this
        // batch call the same thing, so the blur, the countdown and the resume after a
        // reload cannot behave differently depending on who started the render.
        const r = await renderLine(i);
        if (r.skipped) { skipped++; console.warn('[sv3] render skipped line', i + 1, r.skipped); }
        else if (r.error) failed.push(`${i + 1}: ${r.error}`);
        else ok++;
        _rDone++;
        _renderRenderBtn();
        say();
      }
    };
    await Promise.all(Array.from({ length: Math.min(RENDER_POOL, queue.length) }, worker));
    const bits = [`${ok} rendered`];
    if (skipped) bits.push(`${skipped} skipped`);
    if (failed.length) bits.push(`${failed.length} failed (${failed.join('; ')})`);
    if (_stoppingR) bits.push(`stopped, ${_rTotal - _rDone} left`);
    _vstatus(bits.join(' · '));
  } catch (e) {
    _vstatus('Rendering failed: ' + e.message);
  } finally {
    _rendering = false;
    _stoppingR = false;
    setFragmentsLocked(false);
    _renderVoice(); _renderRenderBtn();
  }
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
  // The server works out at read time whether the cast character actually has a voice, so
  // this can state the fact instead of hoping.
  // Named after the CHARACTER, numbered within that character's saved voices. A raw
  // ElevenLabs id here said nothing about whose voice was about to read the script.
  const cv = (_proj && _proj.castVoice) || {};
  const o = document.createElement('option');
  o.value = '';
  o.textContent = cv.has ? `${cv.character || 'character'} #${cv.index || 1}`
    : (cv.reason ? 'no voice on the character' : 'from the character');
  sel.appendChild(o);
  sel.value = '';
  sel.classList.toggle('is-bad', !cv.has);
  sel.title = cv.has
    ? 'Taken from the cast character; the gear opens the voice library later'
    : (cv.reason || 'This character has no voice saved yet — set one in the Character tab');
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
  // No voice on the cast character means every read would be refused for the same reason.
  // Saying so here costs nothing; finding out by firing ten doomed requests taught nobody
  // anything, because the reason never reached the screen.
  const cv = (_proj && _proj.castVoice) || { has: true };
  const noVoice = !cv.has && !done && !broken.length;
  if (all) {
    // A fourth job while the batch runs: it is the way to call the batch off, and it
    // counts the reads that have come back so the wait is not a blind one.
    all.textContent = _fixing ? 'Fixing…'
      : _voicing ? (_stopping ? 'Stopping…' : `Stop (${_vDone}/${_vTotal})`)
      : broken.length ? `Fix tags (${broken.length})`
      : done ? 'Next step: Video'
      : noVoice ? 'No voice on the character'
      : `Voice all (${unvoiced.length})`;
    all.disabled = _fixing
      || (_voicing ? _stopping : (!hasText || noVoice || (waiting && !broken.length)));
    all.classList.toggle('danger-solid', _voicing);
    all.classList.toggle('primary', !_voicing);
  }
  if (allWrap) {
    allWrap.title = _voicing
        ? 'Stop after the fragment being read now — every read already delivered is kept'
      : !hasText ? 'This project has no lines yet'
      : broken.length ? 'Re-tag the fragments whose words changed. The whole script goes in'
                        + ' for context, so the new tags match what the approved lines do.'
      : noVoice ? cv.reason
      : waiting ? 'Insert the tags first, or turn voice tags off'
      : done ? 'Every fragment is read — fold this away and open Video'
      : `Read the ${unvoiced.length} fragment${unvoiced.length === 1 ? ' that still needs' : 's that still need'} it.`
        + ' Already-voiced lines are left alone — spends ElevenLabs credits';
  }

  // Nothing that feeds a read may move while a batch is running — not the provider, the
  // mood, the tag switch or the variant. That includes while clips render: the variant
  // decides which take a clip is being lipsynced to, and moving it mid-render would have
  // the page looking for the answer under the other take.
  if (_voicing || _rendering) {
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
        if (report.failed.length) {
          failed.push({ n: i + 1, why: String(report.failed[0] && report.failed[0].error || 'refused') });
          console.warn('[sv3] voicing', report.failed);
        }
        else if (report.spoken) ok++;
        else skipped++;              // the server found nothing to say on that line
        markLineVoicing(i, false);
        adoptProject(project);       // the card, the counters and this column follow
      } catch (e) {
        // Keep the REASON, not just the number. A refusal that repeats is systemic — no
        // key, no voice on the character — and firing the rest teaches nothing while
        // spending credits on the ones that would have worked.
        failed.push({ n: i + 1, why: e.message });
        markLineVoicing(i, false);
        console.warn('[sv3] voicing line ' + (i + 1), e);
        const last2 = failed.slice(-2);
        if (last2.length === 2 && last2[0].why === last2[1].why) {
          _status(`Stopped: ${e.message}`);
          break;
        }
      }
      _vDone++;
      _renderVoice();
    }
    const bits = [`${ok} voiced`];
    if (skipped) bits.push(`${skipped} had nothing to say`);
    if (failed.length) {
      // Name the reasons, not the line numbers alone: ten identical refusals are one
      // problem, and it is the message that tells the user what to go and fix.
      const why = [...new Set(failed.map(f => f.why))];
      bits.push(`${failed.length} failed (${failed.map(f => f.n).join(', ')})`);
      bits.push(why.join(' · '));
    }
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
  _fillVideo();
  _renderRenderBtn();
  _syncVideoGate();
}

// Called when the mix popup saves its frame assignments: the casting work is done,
// so that column folds away and this one takes over with the read.
export function openMontageForVoice() {
  openColumn('montage');            // folds Casting through the shared pairing rule
  _toggleSec('sv3-mt-voice', true);
  _setStage('voice');               // new frames mean the read is the work again
  renderMontage();
}

// Frames already sitting on the fragments mean the casting work is done, so a project
// opened in that state lands in Montage rather than making the user find it. This runs
// on the MODE change, not on the project change: setMode collapses every workspace
// column after the project is emitted, and would undo it.
function _autoOpen() {
  if (!_proj) return;
  const framed = ((_proj.lines || []).some(l => l.frameId));
  if (!framed) return;
  openColumn('montage');
  // Land on the section the work had reached. Video may have locked itself again since
  // (a line edited after its read went stale), and a locked section refuses to open, so
  // the read stays up rather than leaving the column blank.
  if (_proj.stage === 'video' && !$('sv3-mt-video').classList.contains('is-locked')) {
    _toggleSec('sv3-mt-video', true);
  }
}

export function initMontage(onProjectChange) {
  onProjectChange((project) => {
    _proj = project;
    _status('');
    if (project) { renderMontage(); _autoOpen(); }
  });
  onModeChange((mode) => { if (mode === 'workspace') _autoOpen(); });
  // A fragment edit can break a line, which turns Voice all into Fix tags, and swapping a
  // first frame leaves that fragment needing a clip again. Both arrive as a save, so
  // everything this column counts is recounted here — the render button included.
  // Repainting this column touches nothing in Fragments, so there is no caret to lose.
  onProjectSaved(() => { if (_proj) { _renderVoice(); _renderRenderBtn(); _syncVideoGate(); } });

  const vhead = $('sv3-mt-voice-head');
  if (vhead) vhead.addEventListener('click', () => {
    _toggleSec('sv3-mt-voice');
    // opening one is a step; folding it is not a step backwards
    if (!$('sv3-mt-voice').classList.contains('is-shut')) _setStage('voice');
  });
  const vidhead = $('sv3-mt-video-head');
  if (vidhead) vidhead.addEventListener('click', () => {
    _toggleSec('sv3-mt-video');
    if (!$('sv3-mt-video').classList.contains('is-shut')) _setStage('video');
  });

  const chk = $('sv3-mt-tags-on');
  if (chk) chk.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.tagsOn = chk.checked;
    // no tags means the plain read, so the switch cannot stay on tagged
    if (!chk.checked) _proj.voice.variant = 'plain';
    // the cards read the variant too, so they have to hear about it
    _renderVoice(); _queueSave('voice'); adoptProject(_proj);
  });

  const mood = $('sv3-mt-mood');
  if (mood) mood.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.mood = mood.value;
    _renderVoice(); _queueSave('voice');
  });

  const batch = $('sv3-mt-batch');
  if (batch) batch.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.variant = batch.checked ? 'tagged' : 'plain';
    // the cards and both counters read this, so they repaint with it
    _renderVoice(); _queueSave('voice'); adoptProject(_proj);
  });

  const prov = $('sv3-mt-provider');
  if (prov) prov.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.provider = prov.value;
    _queueSave('voice');
  });

  const vsel = $('sv3-mt-voice-sel');
  if (vsel) vsel.addEventListener('change', () => {
    if (!_proj) return;
    _proj.voice.voiceId = vsel.value;
    _proj.voice.voiceName = vsel.value ? (vsel.selectedOptions[0] || {}).textContent || '' : '';
    _queueSave('voice');
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
    // everything is read: this button is now the way forward, and the move is remembered
    // so a reload lands on the video work rather than back on the finished read
    _toggleSec('sv3-mt-voice', false);
    _toggleSec('sv3-mt-video', true);
    _setStage('video');
  });

  // The video settings: the motion prompt is the model's only lever, so the page holds
  // the presets themselves rather than just their names.
  const vmodel = $('sv3-mt-vmodel');
  if (vmodel) vmodel.addEventListener('change', () => {
    if (!_proj) return;
    _vid().model = vmodel.value;
    _renderVideo(); _queueSave('video');
  });
  // The gear opens the voice studio. It is about the CAST CHARACTER, not this project:
  // the read always uses the character's voice, so a voice chosen there holds everywhere
  // that character speaks.
  const vgear = $('sv3-mt-voice-gear');
  if (vgear) vgear.addEventListener('click', () => { if (_proj) openVoicePopup({ project: _proj }); });

  const rall = $('sv3-mt-renderall');
  if (rall) rall.addEventListener('click', () => {
    // mid-batch this is Stop: the clip in flight is already paid for, so it is kept
    if (_rendering) {
      _stoppingR = true;
      _renderRenderBtn();
      _vstatus('Stopping after this clip…');
      return;
    }
    if (_unrenderedIdx().length) { _renderAll(); return; }
    // everything is rendered: watch the cut, then hand it on
    const items = _reelClips();
    if (!items.length) return;
    openReelPopup({
      items,
      // Choosing a take in the preview is choosing it everywhere: the cards show the same
      // pick, and Save reads the project rather than this popup's own list.
      onPick: (lineIdx, clipId) => pickVariant(lineIdx, clipId),
      onSave: async (onStep) => {
        await flushFragments();          // a take just chosen must be on disk before this
        const { reel } = await saveReel(_proj.id);
        _proj.reel = reel;
        const clips = (reel && reel.clips) || [];
        const n = clips.length;

        // Merge times a main-track clip by its audio and drops a cell that has none, so
        // every clip's audio is pulled out first. One at a time: it is ffmpeg on the same
        // machine that may still be rendering, and a counter is worth more here than
        // concurrency — the files are cached, so a second run is instant.
        for (let k = 0; k < n; k++) {
          if (onStep) onStep(k + 1, n);
          await reelAudio(_proj.id, clips[k].n);
        }

        const r = await reelMerge(_proj.id);
        // Merge keys a timeline by this project, so re-sending updates that one project rather
        // than making another. The key travels in the URL and nowhere else: Merge reads ?p= and
        // otherwise opens nothing, so there is no preference to write here.
        _vstatus(`Sent ${r.fragments} clip${r.fragments === 1 ? '' : 's'} to Merge · opening…`);
        window.location.href = '/merge?p=' + encodeURIComponent(r.key);
        return `Sent · ${r.fragments} clips — opening Merge…`;
      },
    });
  });

  const preset = $('sv3-mt-preset');
  if (preset) preset.addEventListener('change', () => {
    if (!_proj) return;
    _vid().preset = preset.value;
    _renderVideo(); _queueSave('video');
  });
  const quality = $('sv3-mt-quality');
  if (quality) quality.addEventListener('change', () => {
    if (!_proj) return;
    _vid().quality = quality.value;
    _renderVideo(); _queueSave('video');
  });

  // Both catalogues, then one paint. Either failing leaves its own section empty rather
  // than taking the whole column down with it.
  return Promise.all([
    listMoods().catch(e => { console.error('[sv3] moods', e); return { moods: [], role: '' }; }),
    listMotionKit().catch(e => { console.error('[sv3] motion presets', e); return null; }),
  ]).then(([m, kit]) => {
    _moods = m.moods || [];
    _role  = m.role || '';
    if (kit) { _kit = kit; primeMotionKit(kit); }
    renderMontage();
  });
}
