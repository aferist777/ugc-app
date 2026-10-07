/* ════════════════════════════════════════════════════════════════════════════
   MERGE — making clips, as a conversation, IN THE LIBRARY PANEL (phase V3, docs/local-app/PLAN.md "Фаза V").

   The pictures chat's shell (chat-shell.js) with its own description: "LIBRARY / generate video" in the panel's
   header, its own crumb, buttons and box, its own conversation (kind 'clip'). The server is phase V2
   (routes/mv3-video.js): a press writes the turn, a record and an Alerts row for each clip asked for, and the
   work - the writer, the references hosted, the aggregator asked, the clip fetched and filed on the B-roll shelf
   in the project's category - goes on behind it.

   What is this chat's own (the owner, 2026-10-05):
   - ONE dropdown of every model, each its own line with its price; the chosen model shows ITS OWN parameters
     (duration, quality, shape, sound, Grok's mode, how Seedance reads the pictures, Kling's orientation) and the
     price of this send; the aggregator beside it with its own rate - the cheapest with a working key by default.
   - A line ABOVE THE THREAD says what the chosen model does and what to attach.
   - Kling motion control's VIDEO has no writer - Kling gets its own prompt. With the writer off the box IS that prompt
     (empty: the standard one); with it on the box says what to take from which picture, and the first frame is drawn
     before the video (phase V17).
   - (phase V13, the owner 2026-10-07) No right column: every "+" of the attachment zone opens the picker on its place
     (chat-pick.js) - the Library's shelves of that kind and this computer. A clip that lands is not put in the zone by
     itself - it is one press on it there, under "made in this project".
   - (phase V7) Clips and sounds are references too: from this project's clips, B-roll, Uploads, the Sounds shelf, this
     computer or a lane of the timeline; each goes as the PART of it the person chose (vtrim.js), the first seconds
     the model takes by default, and the price follows that part.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { openViewer } from '../library/viewer.js';
import { createChat, el, money, json, stored, keep, thumbOf, refCell } from './chat-shell.js';
import { openTrim, closeTrim } from './vtrim.js';
import { openCatalog } from './vcatalog.js';
import { openHelp, closeHelp } from './vhelp.js';
import { stepCard } from './vsteps.js';
import { note, askDelete } from './ask.js';
import { startInlineProgress } from '../progress.js';

const LS_LAST = 'mv3_vc_last_v1';         // { model, agg: { <model>: agg }, params: { <model>: {...} } }
const SHOW_ATTS = 9;                       // the old row's places at most (the zone grows instead - phase V6)
const MAX_PICS = 30;                       // pictures at most, whatever a model says (Seedance 2.5 takes 30)
const MAX_ATTS = 50;                       // everything attached at most - pictures, clips and sounds

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function VIDEOS(ctx) {
  let _table = null;
  let _err = '';
  let _set = null;
  const _last = stored(LS_LAST, {});
  _last.agg = _last.agg || {};
  _last.params = _last.params || {};
  const _remember = () => keep(LS_LAST, _last);

  const models = () => (_table ? _table.models : []);
  const model = () => models().find(m => m.id === (_set && _set.model.value)) || models().find(m => m.usable) || models()[0] || null;
  const recOf = (m, agg) => (m ? (m.records.find(r => r.agg === agg) || null) : null);
  function rec() {
    const m = model();
    if (!m) return null;
    return recOf(m, _set && _set.agg.value) || recOf(m, _last.agg[m.id]) || recOf(m, m.defaultAgg) || m.records[0];
  }
  const params = () => { const m = model(); return (m && _last.params[m.id]) || {}; };
  function setParam(k, v) {
    const m = model();
    if (!m) return;
    _last.params[m.id] = Object.assign({}, _last.params[m.id] || {}, { [k]: v });
    _remember();
  }
  const isMC = () => (model() || {}).family === 'kmc';
  // (phase V17, the owner 2026-10-08) Kling motion control STEP BY STEP: with the writer on, the person's pictures (the
  // character - and a place, clothes or a thing, said in the box from which) and a still of the clip go to the writer and
  // a picture model first; the first frame is drawn, and Kling moves it with the clip from that moment.
  const _mcSteps = () => isMC() && ctx.writing();
  // As many pictures as the picture model takes beside the still (nano-banana-2: 14 references, one is the still).
  const _frameRoom = () => {
    const ps = ((_table && _table.frame && _table.frame.providers) || []).filter(p => p.usable);
    return Math.max(1, Math.min(13, (ps.length ? Math.max(...ps.map(p => p.maxRefs || 2)) : 14) - 1));
  };
  // (phase V16, the owner 2026-10-07) Seedance's pictures as FRAMES - "pictures are": 'frame' the first frame, 'fl' the first
  // and the last. The zone's pictures are then those places alone, both required; beside a clip or a sound they go as
  // references (Seedance takes frames OR references - kie, Replicate and ByteDance all say so), and the prompt names
  // them. The writer writes the animation from the frames, with the words or without - the server says in its first
  // sentence that the clip starts exactly on the first frame (and ends exactly on the last).
  const _asOf = () => { const m = model(); return m && m.family === 'seedance' && !_skill ? (params().picturesAs || 'refs') : 'refs'; };
  const _framesMode = () => _asOf() === 'frame' || _asOf() === 'fl';
  function _frameSlots() {
    const s = [{ key: 'first', label: 'first frame', kind: 'frame-first', role: '', min: 1, max: 1, required: true, hint: 'The video starts exactly on this picture' }];
    if (_asOf() === 'fl') s.push({ key: 'last', label: 'last frame', kind: 'frame-last', role: '', min: 1, max: 1, required: true, hint: 'The video ends exactly on this picture' });
    return s;
  }
  const _frameKeys = () => _frameSlots().map(s => s.key);
  const _onlyFrames = () => 'In this mode only the ' + (_asOf() === 'fl' ? 'first and last frames go' : 'first frame goes');
  // (phase V15, the owner 2026-10-07) The column's STORYBOARD: ticked, under Seedance, with the writer, without a recipe
  // (a recipe decides its own steps) and not with frames (the sheet goes as a reference). ">" writes its sheet's
  // prompt, and every paid step waits for its press on its message.
  const _boardOn = () => { const m = model(); return !!params().storyboard && !!m && m.family === 'seedance' && !_skill && ctx.writing() && !_framesMode(); };
  // The catalog's recipe in use (phase V5) - kept with the draft, per project, until its cross.
  let _skill = null;
  // What is attached, by kind (phase V6: the zone has pictures, clips and sounds).
  const _kind = (a) => (a && (a.kind === 'video' || a.kind === 'audio') ? a.kind : 'image');
  const _pics = () => ctx.atts().filter(a => _kind(a) === 'image');
  const _clips = () => ctx.atts().filter(a => _kind(a) === 'video');
  const _sounds = () => ctx.atts().filter(a => _kind(a) === 'audio');
  // The seconds of a clip or a sound that go - its part.
  const _span = (a) => Math.max(0, (+a.out || 0) - (+a.in || 0));
  const _s = (v) => (+v).toFixed(1).replace(/\.0$/, '') + ' s';

  // ── The part of a clip or a sound that goes (phase V7) ────────────────────
  // How long it may be on the chosen model: Seedance takes clips of 2-15 s (2.5: 2-30) and all of them together that
  // much at most, the sounds likewise; Kling motion control follows 3-30 s of the moves - 10 s when the character keeps
  // the picture's orientation. `max` is what is left for THIS one beside the others of its kind.
  function _spanRule(a) {
    const r = rec(), m = model();
    if (!r || !m) return null;
    const L = r.limits || {};
    const k = _kind(a);
    const others = ctx.atts().filter(x => x !== a && x.path !== a.path && _kind(x) === k).reduce((s, x) => s + _span(x), 0);
    if (k === 'video') {
      if (!(L.videos > 0)) return null;
      if (m.family === 'kmc') {
        const img = params().orientation === 'image';
        const cap = img ? (L.videoSecsImage || 10) : (L.videoSecs || 30);
        return { min: r.duration.min || 3, max: cap, all: cap,
          why: m.label + ' follows ' + (r.duration.min || 3) + '-' + cap + ' s of the moves' + (img ? ' when the character keeps the picture\'s orientation' : '') + ' - and is billed by them.' };
      }
      const [lo, hi] = L.clipSecs || [2, 15];
      const all = L.videoSecs || hi;
      return { min: lo, max: Math.min(hi, Math.max(0, all - others)), all,
        why: m.label + ' takes clips of ' + lo + '-' + hi + ' s, ' + all + ' s in all' + (r.agg === 'kie' ? ' - kie bills their seconds too.' : '.') };
    }
    if (k === 'audio') {
      if (!(L.audios > 0)) return null;
      const all = L.audioSecs || 15;
      return { min: 0.5, max: Math.max(0, all - others), all, why: m.label + ' takes ' + all + ' s of sound in all.' };
    }
    return null;
  }
  // Why a clip or a sound cannot go as it is ('' when it can) - the cell turns red and the send says it.
  function _spanWrong(a) {
    const k = _kind(a), m = model();
    const what = k === 'video' ? 'clip' : 'sound';
    if (!(+a.dur > 0)) return 'its length is not known yet - is the file whole?';
    const rule = _spanRule(a);
    if (!rule) return ((m && m.label) || 'This model') + ' takes no ' + what + 's.';
    const span = _span(a);
    if (!(span > 0)) return 'no part of it is chosen - press its seconds';
    if (+a.dur < rule.min - 0.05) return 'it is ' + _s(a.dur) + ' - ' + m.label + ' needs a ' + what + ' of at least ' + _s(rule.min);
    if (span < rule.min - 0.05) return 'the part is ' + _s(span) + ' - ' + m.label + ' needs at least ' + _s(rule.min) + ' - press its seconds';
    if (span > rule.max + 0.05) {
      return rule.max < (rule.all || 0) - 0.05
        ? 'with the other ' + what + 's it is more than ' + _s(rule.all) + ' in all - shorten one'
        : 'the part is ' + _s(span) + ' - ' + m.label + ' takes ' + _s(rule.max) + ' - press its seconds';
    }
    return '';
  }
  // What the zone's cell says of it (the shell asks): red with the reason, or gold seconds when only a part goes; a picture
  // beyond the frames' places dimmed, with the reason (phase V16).
  function _attState(a) {
    if (_kind(a) === 'image') {
      return _framesMode() && !_frameKeys().includes(a.slot) ? { off: _onlyFrames() + ' - take this one off, or set "pictures are" to references' } : null;
    }
    const bad = _spanWrong(a);
    if (bad) return { bad };
    return (+a.dur > _span(a) + 0.05) ? { cut: true } : null;
  }

  // A clip or a sound attached: its length measured when the shelf did not know it, then the part that goes - the one
  // it came with (a lane of the timeline), else the first seconds the model takes ("17.3 s → the first 15 s go").
  async function _onAttach(a) {
    const k = _kind(a);
    if (k === 'image') return;
    let dur = +a.dur || 0;
    const key0 = ctx.key();
    // Measured when the shelf did not know its length - and a clip's file taken as a sound, which may have none.
    if (!dur || (k === 'audio' && /\.(mp4|mov|m4v|webm|mkv|avi)(\?|$)/i.test(a.path))) {
      const d = await json('/api/media/probe?src=' + encodeURIComponent(a.path));
      // (review V7) Another project opened meanwhile: its own attachment of the same file is not this one.
      if (ctx.key() !== key0) return;
      if (d && d.success && +d.duration > 0) dur = Math.round(+d.duration * 100) / 100;
      if (d && d.success && ((k === 'video' && !(d.w > 0)) || (k === 'audio' && !d.audio))) {
        ctx.detach(a.path);
        ctx.say('Not attached: it has no ' + (k === 'video' ? 'picture' : 'sound') + ' in it.');
        return;
      }
    }
    const now = ctx.atts().find(x => x.path === a.path);
    if (!now) return;
    if (!dur) { ctx.setAtt(a.path, { dur: '' }); return; }
    const rule = _spanRule(now);
    if (rule && rule.max < rule.min - 0.05) {
      ctx.detach(a.path);
      ctx.say(rule.why + ' ' + _s(rule.all - rule.max) + ' of it ' + (rule.all - rule.max === 1 ? 'is' : 'are') + ' taken - shorten one first.');
      return;
    }
    let from = +now.in >= 0 && +now.out > +now.in ? Math.max(0, Math.min(+now.in, dur)) : 0;
    let to = +now.out > from ? Math.min(+now.out, dur) : dur;
    if (rule) {
      if (to - from > rule.max) to = from + rule.max;
      if (to - from < rule.min && dur >= rule.min) { to = Math.min(dur, from + rule.min); from = Math.max(0, to - rule.min); }
    }
    ctx.setAtt(a.path, { dur, in: Math.round(from * 100) / 100, out: Math.round(to * 100) / 100 });
    // (phase V17, the owner 2026-10-08) Kling motion control: the clip opens on its first frame's slider at once.
    if (k === 'video' && isMC()) { setTimeout(() => _autoStill(a.path), 150); return; }
    if (dur > to - from + 0.05) {
      ctx.say(_s(dur) + ' → ' + (from ? _s(to - from) + ' from ' + _s(from) : 'the first ' + _s(to - from)) + ' go - press its seconds to choose another part.');
    }
  }
  function _autoStill(path) {
    const a = ctx.atts().find(x => x.path === path);
    const ui = ctx.ui();
    if (!a || !isMC() || !ui) return;
    _trimFor(a, ui.atts.querySelector('.mv3-ig-att[data-path="' + CSS.escape(path) + '"]'));
  }

  // The part chosen by hand: the clip (or the sound) in a panel over the zone, its window within what the model takes.
  // The attachment whose part window is open - the window goes with it when it is taken off (review V7).
  let _trimPath = '';
  function _trimFor(a, cell) {
    const dur = +a.dur || 0;
    if (!dur) { ctx.say('Its length is not known - it cannot be cut.'); return; }
    const k = _kind(a);
    const rule = _spanRule(a) || { min: 0.5, max: dur, why: '' };
    // (phase V17) Under Kling motion control the part starts on the first frame, picked on a slider.
    const still = isMC() && k === 'video';
    openTrim({
      anchor: cell, kind: k, src: a.path, poster: a.poster ? thumbOf(a.poster, 'main') : '', dur,
      from: +a.in || 0, to: +a.out || Math.min(dur, rule.max),
      min: Math.min(rule.min, dur), max: Math.max(Math.min(rule.min, dur), rule.max),
      title: a.name || (k === 'audio' ? 'the sound' : 'the clip'),
      why: (still ? (ctx.writing() ? 'Pick the moment your character is seen best: the first frame is drawn from it, and the moves go from there. '
        : 'Pick the moment the moves start from. ') : '') + rule.why,
      still,
      onStill: (url) => ctx.setAtt(a.path, { still: url }),
      onChange: (f, t) => ctx.setAtt(a.path, { in: f, out: t }),
      onClose: () => { if (_trimPath === a.path) _trimPath = ''; },
    });
    // Set once the window is open: opening closed the one before, whose own close cleared it.
    _trimPath = a.path;
  }

  const _takes = (k) => {
    const r = rec();
    if (!r) return false;
    const L = r.limits || {};
    return k === 'video' ? L.videos > 0 : k === 'audio' ? L.audios > 0 : L.images > 0;
  };

  // A clip or a sound kept with a draft that has left the library since (deleted on its shelf): it goes from the zone,
  // in words - a picture does the same when its miniature does not load (the shell). One that MOVED is followed.
  async function _dropGone() {
    const list = ctx.atts().filter(a => _kind(a) !== 'image');
    if (!list.length) return;
    const k = ctx.key();
    const gone = [];
    await Promise.all(list.map(async (a) => {
      const r = await fetch('/api/media/probe?src=' + encodeURIComponent(a.path)).catch(() => null);
      if (r && r.status === 404) gone.push(a);
    }));
    if (ctx.key() !== k || !gone.length) return;
    for (const a of gone) ctx.detach(a.path);
    ctx.say(gone.length === 1 ? 'A ' + (_kind(gone[0]) === 'video' ? 'clip' : 'sound') + ' of the zone is not in the library any more.'
      : gone.length + ' clips and sounds of the zone are not in the library any more.');
  }

  // A clip let go over the zone from a lane of the timeline (timeline-b.js): the part of its file the timeline plays.
  window.addEventListener('mv3:clip-out', (ev) => {
    const d = ev.detail || {};
    if (!ctx.shown() || !d.src) return;
    const k = d.kind === 'audio' ? 'audio' : 'video';
    if (!_takes(k)) { ctx.say(((model() || {}).label || 'This model') + ' takes no ' + (k === 'video' ? 'clips' : 'sounds') + '.'); return; }
    const was = ctx.atts().find(x => x.path === d.src);
    if (was) {
      // (review V7) One place per file: a clip's sound twin let go over the sounds is not the clip attached already.
      if (_kind(was) !== k) { ctx.say('This file is attached already as a ' + (_kind(was) === 'video' ? 'clip' : 'sound') + ' - one place per file.'); return; }
      // Attached already: the part the timeline plays replaces the one it had.
      ctx.setAtt(d.src, { in: d.in, out: d.out });
      return;
    }
    ctx.attach(d.src, d.name || '', { kind: k, poster: k === 'video' ? d.thumb || '' : '', dur: +d.srcDur || 0, in: d.in, out: d.out });
  });

  // ── The rates ─────────────────────────────────────────────────────────────
  // The aggregator's table, read through the chosen parameters - the server prices the same way
  // (lib/video-models.js price); the first real record of a model says what was really taken.
  function _perSec(r, res) {
    const rate = (r.rates || {})[res];
    return Array.isArray(rate) ? rate[0] : (rate == null ? null : rate);
  }
  function priceNow() { return priceOf(rec()); }
  // A record's price for the parameters as they are - the chosen one's, or the fallback rung's (which may not
  // make this resolution at all: then it is skipped, and says so).
  // `media`: a card's own attachments (what it was written with) - else what is in the zone now.
  function priceOf(r, media) {
    if (!r) return null;
    const p = params();
    if (p.resolution && !r.resolutions.includes(p.resolution)) return { none: true, cannot: p.resolution };
    const res = p.resolution || r.resDef;
    // (phase V7) With a reference clip a rate's second figure is the one asked (lib/video-models.js price), and the
    // clip's seconds count: Kling is billed by the seconds of the moves, kie's Seedance by the clip's AND the video's.
    const clips = media ? media.filter(x => x && x.kind === 'video') : (_takes('video') ? _clips() : []);
    // Kling follows ONE clip - the first; Seedance's clips count together.
    const vidIn = r.duration.fromClip ? _span(clips[0] || {}) : clips.reduce((s, a) => s + _span(a), 0);
    const rate = (r.rates || {})[res];
    const per = Array.isArray(rate) ? rate[clips.length ? 1 : 0] : (rate == null ? null : rate);
    if (per == null) return { none: true, res };
    if (r.duration.fromClip) {
      const cap = p.orientation === 'image' ? (r.limits.videoSecsImage || 10) : (r.limits.videoSecs || 30);
      const secs = vidIn ? Math.min(vidIn, cap) : 0;
      return { per, res, fromClip: true, secs, usd: secs ? per * secs : null };
    }
    const out = clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max);
    const withIn = r.agg === 'kie' && (model() || {}).family === 'seedance' && clips.length > 0;
    const secs = withIn ? out + vidIn : out;
    return { per, res, secs, out, vidIn: withIn ? vidIn : 0, usd: per * secs };
  }
  function _modelLine(m) {
    const r = recOf(m, m.defaultAgg) || m.records[0];
    if (!r) return m.label;
    const t = r.tenSeconds || {};
    if (r.duration.fromClip) return m.label + ' · ' + money(_perSec(r, r.resDef)) + ' / s of clip';
    return m.label + (t.usd != null ? ' · ≈' + money(t.usd) + ' / 10 s' : '');
  }

  async function load() {
    if (_table) { paint(); return; }
    const d = await json('/api/mv3/video/matrix');
    if (d && d.success) { _table = d; _err = ''; } else _err = (d && d.error) || 'could not read the models';
    paint();
    ctx.paintAtts();
  }

  function _row(host, label, ctl, cls) {
    const r = el('div', 'mv3-ig-row' + (cls ? ' ' + cls : ''));
    const l = el('label', null, label);
    if (ctl.id) l.htmlFor = ctl.id;
    r.append(l, ctl);
    host.appendChild(r);
    return r;
  }
  function _select(id, title, opts, value, onChange) {
    const s = document.createElement('select');
    if (id) s.id = id;
    s.title = title || '';
    for (const o of opts) {
      const e = document.createElement('option');
      e.value = o.value; e.textContent = o.text;
      if (o.disabled) { e.disabled = true; e.title = o.title || ''; }
      s.appendChild(e);
    }
    if (value != null && opts.some(o => o.value === String(value) && !o.disabled)) s.value = String(value);
    if (onChange) s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function paint() {
    const ui = ctx.ui();
    if (!ui) return;
    const host = ui.left;
    if (!_table || !models().length) {
      host.textContent = '';
      host.appendChild(el('div', 'mv3-ig-fall', _err || 'reading the models…'));
      _set = null;
      ctx.banner('');
      return;
    }
    if (!_set) {
      host.textContent = '';
      const mSel = _select('mv3-vc-model', 'The model - each its own price', models().map(m => ({
        value: m.id, text: _modelLine(m), disabled: !m.usable, title: m.why,
      })), _last.model, (v) => { _last.model = v; _recipeParams(v); _remember(); _paintModel(); ctx.paintAtts(); });
      _row(host, 'model', mSel);
      // What the chosen model does and what to attach - under its dropdown (phase V6, the owner: the line above the
      // thread is the recipe's now).
      const brief = el('div', 'mv3-vc-brief');
      host.appendChild(brief);
      const aSel = document.createElement('select');
      aSel.id = 'mv3-vc-agg';
      aSel.title = 'Who is asked';
      aSel.addEventListener('change', () => { const m = model(); if (m) { _last.agg[m.id] = aSel.value; _remember(); } _paintParams(); ctx.paintAtts(); });
      _row(host, 'aggregator', aSel, 'is-prov');
      const box = el('div', 'mv3-vc-params');
      host.appendChild(box);
      // (phase V15) The writer, the storyboard and 中文 - the switches of how the message goes.
      const sw = el('div', 'mv3-vc-switches');
      host.appendChild(sw);
      const cost = el('div', 'mv3-ig-cost');
      const fall = el('div', 'mv3-ig-fall');
      host.append(cost, fall);
      _set = { model: mSel, brief, agg: aSel, box, sw, cost, fall };
      // The prompt field typed in last - the almanac's note lands there (the chat's box, or a card's prompt).
      if (!ui.root.dataset.vcFocus) {
        ui.root.dataset.vcFocus = '1';
        ui.root.addEventListener('focusin', (e) => {
          const t = e.target;
          if (t && t.matches && t.matches('textarea.mv3-ig-say, textarea.vc-prompt-ta:not(.is-board)')) _lastField = t;
        });
      }
    }
    _paintModel();
  }

  // The switches (phase V15, the owner 2026-10-07): the writer - it was the pen in the bar - and 中文, one box for every
  // send and every card (it was on each card).
  const _zhOn = () => { const m = model(); return !!params().zh && !!m && (m.langs || []).includes('zh'); };
  function _paintSwitches() {
    if (!_set) return;
    const m = model();
    const box = _set.sw;
    box.textContent = '';
    if (!m) return;
    // (phase V15) The storyboard, under the writer: its sheet's prompt is the writer's, so ticking it switches the writer on
    // - and (phase V17.1, the owner 2026-10-08) holds it on while it is ticked.
    const bWhy = m.family !== 'seedance' ? 'A storyboard is drawn for Seedance - pick a Seedance model'
      : _skill ? 'A recipe decides its own steps - a two-step recipe draws its storyboard on its card'
        : _framesMode() ? 'The storyboard goes to the video as a reference picture - not with frames: set "pictures are" to references'
        : !(_table && _table.r2) ? 'The storyboard goes to the video as a picture, from a public link - set R2 on Admin → API keys' : '';
    const held = !bWhy && _boardOn();
    // (phase V16, the owner) The writer is a checkbox like the storyboard and 中文 - on by default.
    const wr = el('label', 'mv3-vc-check' + (held ? ' is-held' : ''));
    const wcb = document.createElement('input');
    wcb.type = 'checkbox';
    wcb.checked = ctx.writing();
    wcb.disabled = held;
    wcb.addEventListener('change', () => ctx.setWriting(wcb.checked));
    wr.append(wcb, el('span', null, 'writer'));
    // (phase V17) Under Kling motion control the writer writes the first frame's picture prompt.
    wr.title = held ? 'The storyboard is written by the writer - untick the storyboard first'
      : isMC() ? 'On: the writer reads your pictures and the still of the clip and writes the first frame\'s prompt - you see the prompt, then the picture, then the video, each paid step by its own press. Off: one picture and the clip go straight to Kling.'
        : 'The writer - a prompt engineer - writes the prompt this model wants from your message and attachments. Off: your words go as typed (translated into English when they are not).';
    box.appendChild(wr);
    const sb = el('label', 'mv3-vc-check' + (bWhy ? ' is-off' : ''));
    const scb = document.createElement('input');
    scb.type = 'checkbox';
    scb.checked = !bWhy && _boardOn();
    scb.disabled = !!bWhy;
    scb.addEventListener('change', () => {
      setParam('storyboard', scb.checked);
      if (scb.checked && !ctx.writing()) ctx.setWriting(true);
      _paintSwitches();
      _paintPrice();
      ctx.paintAtts();
    });
    sb.append(scb, el('span', null, 'storyboard'));
    sb.title = bWhy || 'A storyboard first: the writer turns your message and pictures into the prompt of a sheet of numbered panels - nothing is paid at ">". On its message "draw the storyboard" draws the sheet (4K), "write the video" writes the video with it among the pictures and "make the video" makes it - each paid step by its own press. While it is ticked the writer stays on.';
    box.appendChild(sb);
    const zhOk = (m.langs || []).includes('zh');
    const zh = el('label', 'mv3-vc-check' + (zhOk ? '' : ' is-off'));
    const zcb = document.createElement('input');
    zcb.type = 'checkbox';
    zcb.checked = _zhOn();
    zcb.disabled = !zhOk;
    zcb.addEventListener('change', () => { setParam('zh', zcb.checked); _paintPrice(); });
    zh.append(zcb, el('span', null, '中文'));
    zh.title = zhOk ? 'Send the prompt in Chinese (Seedance): it is translated just before it goes - the references and every quoted line stay as they are, and if the translation fails, the English goes. Every send and every card of this model.'
      : m.label + ' reads English only';
    box.appendChild(zh);
  }

  function _paintModel() {
    if (!_set) return;
    const m = model();
    if (!m) return;
    if (_set.model.value !== m.id) _set.model.value = m.id;
    _set.agg.innerHTML = '';
    for (const r of m.records) {
      const o = document.createElement('option');
      o.value = r.agg;
      const per = _perSec(r, r.resDef);
      // The reason already names the aggregator ("kie.ai - no key ...").
      o.textContent = r.usable ? r.aggLabel + (per != null ? ' · ' + money(per) + '/s' : '') : (r.why || r.aggLabel + ' - cannot be asked');
      o.disabled = !r.usable;
      _set.agg.appendChild(o);
    }
    const want = recOf(m, _last.agg[m.id]) && recOf(m, _last.agg[m.id]).usable ? _last.agg[m.id] : m.defaultAgg;
    if (want) _set.agg.value = want;
    _set.agg.disabled = m.records.filter(r => r.usable).length < 2;
    // (phase V17, the owner 2026-10-08) Kling's prompt is put in by the server - the box holds no standard text any more;
    // one an older draft left there goes. The box's hint is painted with the model's settings.
    const std = _table.standardPrompt || '';
    if (std && ctx.text() === std) ctx.setText('');
    _set.brief.textContent = m.brief;
    _paintParams();
    _paintRecipe();
    // Under Kling motion control a recipe only lays out what to attach (its video has no writer), and the box comes back.
    _paintFoot();
  }

  function _paintParams() {
    if (!_set) return;
    const m = model(), r = rec();
    const box = _set.box;
    box.textContent = '';
    if (!m || !r) return;
    const p = params();
    const n = _pics().length;
    const fam = m.family;
    // (phase V7) Beside a clip or a sound Seedance's pictures are references - frames go only on their own.
    const mixed = _takes('video') && _clips().length + _sounds().length > 0;
    if (!r.duration.fromClip) {
      const opts = [];
      for (let s = r.duration.min; s <= r.duration.max; s++) opts.push({ value: String(s), text: s + ' s' });
      _row(box, 'length', _select('mv3-vc-dur', 'How long the clip is', opts, clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max),
        (v) => { setParam('duration', +v); _paintPrice(); }));
    }
    _row(box, 'quality', _select('mv3-vc-res', 'Resolution', r.resolutions.map(x => ({ value: x, text: x })),
      r.resolutions.includes(p.resolution) ? p.resolution : r.resDef, (v) => { setParam('resolution', v); _paintPrice(); }));
    // The shape: with a picture Grok takes the picture's, and Seedance's frames take theirs.
    if (r.aspects && r.aspects.length) {
      const fmt = (Store.timeline() || {}).format || '9:16';
      // Frames on their own make the clip in their shape; beside a clip or a sound they go as references.
      const fixed = n > 0 && (fam === 'grok' || (fam === 'seedance' && _framesMode() && !mixed));
      const sel = _select('mv3-vc-ar', 'Shape', r.aspects.map(a => ({ value: a, text: a + (a === fmt ? ' •' : '') })),
        r.aspects.includes(p.aspect) ? p.aspect : (r.aspects.includes(fmt) ? fmt : r.aspects[0]), (v) => setParam('aspect', v));
      sel.disabled = fixed;
      if (fixed) sel.title = 'The clip takes the shape of the picture';
      _row(box, 'shape', sel);
    }
    if (r.extra && r.extra.mode) {
      _row(box, 'mode', _select('mv3-vc-mode', 'How Grok plays it', r.extra.mode.map(x => ({
        value: x, text: x, disabled: x === 'spicy' && n > 0, title: 'spicy only from words - an outside picture plays it normal',
      })), p.mode || 'normal', (v) => setParam('mode', v)));
    }
    if (fam === 'seedance') {
      // (phase V7.4, the owner's answer 4) With a clip attached the sound can be the CLIP's: Seedance makes none, and the
      // clip's part is laid under the video when it lands.
      const withClip = _takes('video') && _clips().length > 0;
      const opts = [{ value: 'on', text: withClip ? 'the model\'s sound' : 'with sound' }];
      if (withClip) opts.push({ value: 'clip', text: 'the clip\'s sound' });
      opts.push({ value: 'off', text: 'silent' });
      const now = withClip && p.sound === 'clip' ? 'clip' : (p.sound === 'clip' || p.audio !== false ? 'on' : 'off');
      const sel = _select('mv3-vc-audio', withClip ? 'Seedance makes its own sound - or the first clip\'s sound is laid under the video when it lands' : 'Seedance makes its own sound',
        opts, now, (v) => { setParam('audio', v === 'on'); setParam('sound', v === 'clip' ? 'clip' : ''); });
      _row(box, 'sound', sel);
      if (!_skill) {
        // (phase V16) Chosen first, even before a picture: the zone lays out the frames' places for it.
        _row(box, 'pictures are', _select('mv3-vc-as', 'What the pictures are for: references the video uses, or the frame it starts on (and the one it ends on)', [
          { value: 'refs', text: 'references' },
          { value: 'frame', text: 'the first frame' },
          { value: 'fl', text: 'first and last frames' },
        ], _asOf(), (v) => { setParam('picturesAs', v); ctx.reslot(); _paintParams(); }));
      }
    }
    if (fam === 'kmc') {
      _row(box, 'orientation', _select('mv3-vc-or', 'Which way the character faces', [
        { value: 'video', text: 'as in the clip (up to 30 s)' }, { value: 'image', text: 'as on the picture (up to 10 s)' },
      ], p.orientation || 'video', (v) => { setParam('orientation', v); ctx.paintAtts(); }));
      // The clip's sound: Replicate's Kling keeps it itself; on kie it is laid under the video when it lands (V7.4).
      _row(box, 'sound', _select('mv3-vc-keep', r.keepSound ? 'The clip\'s own sound - Kling keeps it' : 'The clip\'s own sound - laid under the video when it lands',
        [{ value: 'on', text: 'keep the clip\'s sound' }, { value: 'off', text: 'silent' }],
        p.keepSound === false ? 'off' : 'on', (v) => setParam('keepSound', v === 'on')));
    }
    // (phase V16) With frames the words may be left out - the writer decides the motion from the frames. (phase V17) Under
    // Kling the box says what it is for: with the writer, what to take from which picture; without it, Kling's prompt.
    ctx.placeholder(isMC()
      ? (ctx.writing() ? 'What to take from which picture - "the character from 1, the place from 2, the hat from 3 on her head" - or nothing, and the writer works it out. Kling gets its own prompt.'
        : 'The prompt Kling gets, in English - empty, the standard one')
      : _framesMode() ? 'What happens from the first frame' + (_asOf() === 'fl' ? ' to the last' : '') + ' - or leave it empty, and the writer decides' : '');
    _paintSwitches();
    _paintPrice();
  }

  function _paintPrice() {
    if (!_set) return;
    const r = rec();
    const pr = priceNow();
    const box = _set.cost;
    const many = ctx.n();
    if (!r || !pr || pr.none) {
      box.className = 'mv3-ig-cost is-unknown';
      box.innerHTML = '<b>&mdash;</b><span>no published price for this one</span>';
    } else if (pr.fromClip) {
      box.className = 'mv3-ig-cost';
      box.innerHTML = pr.usd != null
        ? '<b>≈' + money(pr.usd) + '</b><span>at most · ' + _s(pr.secs) + ' of your clip × ' + money(pr.per) + '/s · ' + pr.res + ' · ' + r.aggLabel
          + (many > 1 ? ' · ' + money(pr.usd * many) + ' for ' + many : '') + '</span>'
        : '<b>≈' + money(pr.per) + '</b><span>per second of your clip · ' + pr.res + ' · ' + r.aggLabel + '</span>';
    } else {
      box.className = 'mv3-ig-cost';
      box.innerHTML = '<b>≈' + money(pr.usd) + '</b><span>per clip · ' + (pr.vidIn ? pr.out + ' s + ' + _s(pr.vidIn) + ' of the clips' : pr.secs + ' s')
        + ' · ' + pr.res + ' · ' + r.aggLabel + (many > 1 ? ' · ' + money(pr.usd * many) + ' for ' + many : '') + '</span>';
    }
    // (phase V15) The storyboard first: what the sheet costs now, and the video's price for later - its own press.
    if (_boardOn() && pr && !pr.none && !pr.fromClip) {
      const sp = _sheetPrice(_pics().filter(a => a.role !== 'storyboard').length);
      box.className = 'mv3-ig-cost';
      box.textContent = '';
      box.append(el('b', null, sp.usd != null ? '≈' + money(sp.usd) : '—'),
        el('span', null, 'the storyboard first · ' + sp.words + ' · then, by its own press, the video ≈' + money(pr.usd * many)));
    }
    // (phase V17) Kling step by step: the first frame first, and the video after it - each by its own press.
    if (_mcSteps() && pr && !pr.none) {
      const fi = _table && _table.frame;
      const fp = fi && (fi.providers || []).find(p => p.usable);
      box.className = 'mv3-ig-cost';
      box.textContent = '';
      box.append(el('b', null, fp && fp.price != null ? '≈' + money(fp.price) : '—'),
        el('span', null, 'the first frame first' + (fi ? ' · ' + fi.quality + ' · ' + fi.label : '') + ' · then, by its own press, the video '
          + (pr.usd != null ? '≈' + money(pr.usd * many) : '≈' + money(pr.per) + ' per second of the clip')));
    }
    const notes = [];
    if (r && r.priceNote) notes.push(r.priceNote);
    if (r && r.agg === 'kie' && model() && model().id === 'grok15') notes.push("kie's rate for Grok 1.5 looks like a mistake - the first real clip will show");
    if (r && r.duration.fromClip) notes.push('the most it costs: billed by the seconds that come back');
    // The fallback rung, with its own price (PLAN V-B): asked only when the chosen one turns the clip down.
    const other = r && model() ? model().records.find(x => x.agg !== r.agg && x.usable) : null;
    if (other && !(_table && _table.fake)) {
      const po = priceOf(other);
      notes.push('if ' + r.aggLabel + ' turns it down: ' + other.aggLabel + ' '
        + (!po || po.cannot ? '- skipped, it does not make ' + ((po && po.cannot) || 'this')
          : po.none ? '(no published price)' : po.fromClip ? '≈' + money(po.per) + '/s' : '≈' + money(po.usd)));
    }
    if (_table && _table.fake) notes.push('FAKE aggregator - nothing is paid');
    _set.fall.textContent = notes.join(' · ');
    _last.model = (model() || {}).id || _last.model;
    _remember();
    _freshenCards();
    _freshenRequest();
  }

  // ── The catalog and its recipe (phase V5; placed by phase V6) ─────────────
  // The recipe in use stands on the line above the thread (the owner, 2026-10-06): its name - pressed, the catalog
  // opens on it -, "edited", what it wants attached, and a cross. The recipe is the writer's: with the pen off it is not
  // sent, and under Kling motion control (whose video has no writer) it only lays out what to attach.
  const _edited = (s) => !!s && (s.orig != null ? s.text !== s.orig : !!s.edited);
  function _paintRecipe() {
    // The row over the box held the catalog and the recipe until V6; both moved (the crumb, the line above).
    const over = ctx.over();
    if (over) over.hidden = true;
    const box = ctx.bannerBox();
    if (!box) return;
    box.textContent = '';
    box.hidden = !_skill;
    if (!_skill) return;
    // A two-step recipe is Seedance's (review V8): under another model it stands dimmed and says so. Under Kling motion
    // control a recipe only lays out what to attach (phase V7.3) - it stands, and says so.
    const seed = !_skill.twoStep || (model() || {}).family === 'seedance';
    // A recipe whose places need more than this model takes stands dimmed too, and says so (review V7).
    const tooMuch = seed ? _recipeOver() : '';
    box.className = 'mv3-ig-banner mv3-vc-recipe' + (seed && !tooMuch ? '' : ' is-off');
    box.appendChild(el('span', 'k', 'recipe'));
    const t = el('button', 't', _skill.title);
    t.type = 'button';
    t.title = 'Open it in the catalog';
    t.addEventListener('click', _openCat);
    box.appendChild(t);
    if (_edited(_skill)) box.appendChild(el('i', null, 'edited'));
    if (_skill.twoStep) box.appendChild(el('span', 'needs', '2 steps - a storyboard, then the video'));
    box.appendChild(el('span', 'sp'));
    if (!seed) box.appendChild(el('span', 'why', 'two steps are made by Seedance - pick a Seedance model'));
    else if (tooMuch) box.appendChild(el('span', 'why', 'it does not fit ' + ((model() || {}).label || 'this model') + ': ' + tooMuch));
    else if (isMC()) box.appendChild(el('span', 'why', 'under Kling a recipe only lays out what to attach'));
    const x = el('button', 'x', '×');
    x.type = 'button';
    x.title = 'Stop using this recipe';
    x.addEventListener('click', () => { _skill = null; _wantRecipe = false; ctx.reslot(); ctx.saveDraft(); _paintRecipe(); _paintFoot(); });
    box.appendChild(x);
  }
  // The catalog opens on the recipe in use when there is one (the owner, 2026-10-06), with the chat's own edits.
  async function _openCat() {
    if (!_table) await load();
    const m = model(), r = rec();
    if (!_table) return;
    openCatalog({ matrix: _table, model: m ? m.id : '', agg: r ? r.agg : '', onUse: _onUse, recipe: _skill });
  }
  // A recipe's settings follow it to another model the person picks while it is in use (phase V7.5: the dancer's
  // "the clip's sound" chosen under Kling is Seedance's too) - only what the person has not set on that model.
  function _recipeParams(modelId) {
    const sp = _skill && _skill.params;
    if (!sp || !modelId) return;
    const cur = _last.params[modelId] || {};
    const add = {};
    for (const [k, v] of Object.entries(sp)) if (!(k in cur)) add[k] = v;
    if (Object.keys(add).length) _last.params[modelId] = Object.assign({}, cur, add);
  }

  // `use` in the catalog: its model, the settings it suggests, its recipe.
  function _onUse(u) {
    if (!u || !u.model) return;
    _last.model = u.model;
    _last.params[u.model] = Object.assign({}, _last.params[u.model] || {}, u.params || {});
    _remember();
    const was = _skill;
    _skill = u.skill ? {
      id: u.skill.id, kind: u.skill.kind, title: u.skill.title, v: u.skill.v,
      text: u.skill.text, orig: u.skill.orig != null ? u.skill.orig : u.skill.text, slots: u.skill.slots || [],
      twoStep: !!u.skill.twoStep,
      // (phase V7.5) The settings it suggests, for every model of its list the person goes on to (`_recipeParams`).
      params: Object.assign({}, u.params || {}),
      // What was written in the places of the same recipe stays (matched by each place's own words).
      vals: was && was.id === u.skill.id && was.kind === u.skill.kind ? (was.vals || []) : [],
    } : null;
    _wantRecipe = true;
    if (_set) { _set.model.value = u.model; _paintModel(); }
    // What was attached before finds the recipe's slots.
    ctx.reslot();
    ctx.saveDraft();
    _paintRecipe();
    _cardEls = null;
    _paintFoot();
  }

  // A two-step recipe's video takes its storyboard as one more picture, after the card's own (phase V8): one place fewer
  // - Seedance's alone, the only family that makes one (review V8: under Grok the seat took its one place) - and the
  // sheet is drawn WITH the card's pictures, which nano-banana-2 takes up to 14 of.
  const _seat = () => ((_skill && _skill.twoStep && (model() || {}).family === 'seedance')
    // (phase V15) The column's storyboard keeps its sheet's place: the sheet goes to the video as one more picture.
    || _boardOn() ? 1 : 0);
  // (phase V15) What a sheet of the column's storyboard costs: the first aggregator that draws from this many pictures.
  function _sheetPrice(n) {
    const info = _table && _table.board;
    if (!info) return { usd: null, words: 'the storyboard engine is not in this program' };
    const p = (info.providers || []).find(x => x.usable && (!n || (x.maxRefs || 1) >= n));
    if (!p) return { usd: null, words: ((info.providers || []).find(x => x.why) || {}).why || (info.label + ' cannot take ' + n + ' pictures') };
    return { usd: p.price, words: info.quality + ' · ' + info.label + ' · ' + p.label };
  }
  const _boardCap = () => {
    const ps = ((_table && _table.board && _table.board.providers) || []).filter(p => p.usable);
    return ps.length ? Math.max(...ps.map(p => p.maxRefs || 1)) : 14;
  };
  const _picRoom = (r) => {
    if (_mcSteps()) return _frameRoom();
    const n = Math.max(0, ((r && r.limits.images) || 0) - _seat());
    return _seat() ? Math.min(n, _boardCap()) : n;
  };
  function _room() {
    const r = rec();
    if (!r) return SHOW_ATTS;
    return Math.min(SHOW_ATTS, _picRoom(r));
  }

  // ── The attachment zone (phase V6, the owner 2026-10-06) ──────────────────
  // Pictures | clips | sounds, each as many as the model takes on the chosen aggregator - the shell grows them one
  // place at a time. With a recipe each part holds the recipe's slots of its kind, each cell wearing its name. A clip
  // or a sound shows the seconds of it that go (phase V7); pressed, the part is chosen.
  const GENERIC = ['picture', 'pictures', 'clip', 'clips', 'sound', 'sounds'];
  const _partOf = (k) => (k === 'video' || k === 'audio' ? k : 'image');
  function _slotsOf(kind) {
    if (kind === 'image' && _framesMode()) return _frameSlots();
    if (!_skill) return null;
    const seen = new Map();
    const uniq = (k) => { const n = (seen.get(k) || 0) + 1; seen.set(k, n); return n === 1 ? k : k + '-' + n; };
    return (_skill.slots || []).filter(s => _partOf(s.kind) === kind).map(s => ({
      key: uniq(String(s.key || s.kind)), role: s.role || '', kind: s.kind,
      label: String(GENERIC.includes(s.key) ? (s.role || s.key) : s.key).replace(/[-_]+/g, ' '),
      min: Math.max(0, +s.min || 0), max: Math.max(1, +s.max || 1, +s.min || 0), required: !!s.required, hint: s.hint || '',
    }));
  }
  function _zone() {
    const r = rec(), m = model();
    const lim = r ? r.limits : { images: 0, videos: 0, audios: 0 };
    const who = (m && m.label) || 'This model';
    // (phase V16) Frames: their places alone; beside a clip or a sound they go as references - said over the zone.
    const frames = _framesMode();
    const asRefs = frames && ctx.anyAtt(a => a.kind === 'video' || a.kind === 'audio');
    return { parts: [
      { kind: 'image', word: 'pictures', one: 'picture', room: frames ? _frameSlots().length : Math.min(MAX_PICS, r ? _picRoom(r) : 0), slots: _slotsOf('image'),
        full: frames ? _onlyFrames() + ' - set "pictures are" to references for more pictures.'
          : _mcSteps() ? 'Up to ' + _frameRoom() + ' pictures - the still of the clip is the picture model\'s other reference.'
          : _seat() ? 'Room for ' + (r ? _picRoom(r) : 0) + ' - the storyboard goes to the video as one more picture, and it is drawn with these.' : '',
        note: asRefs ? 'go as references - may not match exactly' : '',
        noteLong: asRefs ? 'With a clip or a sound Seedance takes the frames as references: the video aims at them, but may not start and end on them exactly. Without clips and sounds they are the model\'s own frames.' : '',
        otherLabel: frames ? 'not sent' : '',
        none: who + ' takes no pictures.', other: frames ? _onlyFrames() + ' - take it off, or set "pictures are" to references' : 'Another picture for the writer to use - anything the recipe did not ask for' },
      { kind: 'video', word: 'clips', one: 'clip', room: lim.videos || 0, slots: _slotsOf('video'),
        none: who + ' takes no clips.', other: 'Another clip for the writer to use - anything the recipe did not ask for' },
      { kind: 'audio', word: 'sounds', one: 'sound', room: lim.audios || 0, slots: _slotsOf('audio'),
        none: who + ' takes no sounds.', other: 'Another sound for the writer to use - anything the recipe did not ask for' },
    ] };
  }
  // ── Where attachments come from (phase V13: the picker, chat-pick.js) ─────
  // Each kind its own shelves; an item is { path, name, sub, cat, thumb, big, poster, aspect, dur, src }.
  const _gone = (d) => ({ items: [], cats: [], why: (d && d.error) || 'the shelf could not be read' });
  const _shape = (w, h) => (w > 0 && h > 0 ? w + ':' + h : '');
  const _pic = (path, name, sub, x) => Object.assign({ path, name: name || '', sub: sub || '',
    thumb: thumbOf(path, 'strip'), big: thumbOf(path, 'main') }, x || {});
  const _clip = (path, poster, name, x) => Object.assign({ path, src: path, poster: poster || '', name: name || '',
    thumb: poster ? thumbOf(poster, 'strip') : '' }, x || {});
  // A character's sheet, then its looks, one character after another.
  async function _people() {
    const [c, l] = await Promise.all([json('/api/library/shelf/characters'), json('/api/library/shelf/looks')]);
    if (!c || !c.success) return _gone(c);
    const chars = c.items || [];
    const looks = (l && l.success) ? l.items || [] : [];
    const out = [];
    for (const ch of chars) {
      out.push(_pic(ch.media, ch.name, 'character', { aspect: '16:9' }));
      for (const lk of looks.filter(x => (x.meta || {}).charId === ch.id)) out.push(_pic(lk.media, lk.name, ch.name + ' · look'));
    }
    for (const lk of looks.filter(x => !chars.some(ch => ch.id === (x.meta || {}).charId))) out.push(_pic(lk.media, lk.name, 'look'));
    return { items: out.filter(x => x.path) };
  }
  async function _flat(kind, aspect) {
    const d = await json('/api/library/shelf/' + kind);
    if (!d || !d.success) return _gone(d);
    return { items: (d.items || []).filter(i => i && i.media).map(i => _pic(i.media, i.name, '', { aspect })) };
  }
  // A media shelf with its categories: Images, B-roll, Uploads, Sounds - read whole, its categories chosen in the window.
  async function _media(filter, map) {
    const d = await json('/api/library/shelf/media?filter=' + filter);
    if (!d || !d.success) return _gone(d);
    const cats = (d.cats || []).filter(c => c && c.id);
    const nameOf = new Map(cats.map(c => [c.id, c.name || '']));
    return { cats, items: (d.items || []).filter(i => i && i.media).map(i => {
      const m = i.meta || {};
      return Object.assign(map(i, m), { cat: m.categoryId || '', sub: nameOf.get(m.categoryId || '__uncat__') || '' });
    }) };
  }
  // The clips this chat made in this project.
  async function _made() {
    const k = ctx.key();
    if (!k) return { items: [], why: 'No project is open yet - nothing has been made in it.' };
    const d = await json('/api/mv3/video/feed?project=' + encodeURIComponent(k));
    if (!d || !d.success) return _gone(d);
    return { items: (d.items || []).filter(g => g && g.state === 'done' && g.videoPath).map(g => _clip(g.videoPath, g.posterPath,
      String(g.said || g.prompt || '').slice(0, 80), { aspect: _shape(g.w, g.h) || (g.params || {}).aspect || '', dur: +g.duration || 0 })) };
  }
  // Suno's tracks stay on the Music shelf and are offered as sounds from there (their length is measured when one is
  // attached - the shelf does not know it).
  async function _music() {
    const d = await json('/api/library/shelf/music');
    if (!d || !d.success) return _gone(d);
    return { items: (d.items || []).filter(i => i && i.media && (i.meta || {}).onDisk !== false)
      .map(i => ({ path: i.media, src: i.media, name: i.name || '', sub: 'Suno', dur: 0 })) };
  }
  // (phase V15, the owner 2026-10-07) The Library's saved voices - our own demo of each - among the sounds: listened to
  // in the picker, attached as a sound whose role is "voice" and whose name is the voice's. Nothing is attached by
  // itself with a character: whose voice it is, the person says in the message.
  async function _voices() {
    const d = await json('/api/library/shelf/voices');
    if (!d || !d.success) return _gone(d);
    return { items: (d.items || []).filter(i => i && i.media).map(i => {
      const m = i.meta || {};
      const L = m.labels || {};
      const looks = [L.gender, L.age, L.accent, L.descriptive].filter(Boolean).map(v => String(v).replace(/_/g, ' ')).join(' · ');
      const whose = (m.characters || []).map(c => c.name + (c.gold ? ' ★' : '')).join(', ');
      return { path: i.media, src: i.media, name: i.name || '', dur: +m.dur || 0, role: 'voice', label: i.name || '',
        sub: [looks, whose ? 'voice of ' + whose : ''].filter(Boolean).join(' · ') };
    }) };
  }
  const SOURCES = {
    image: [
      { id: 'people', label: 'characters & looks', load: _people },
      { id: 'environments', label: 'environments', load: () => _flat('environments', '3:2') },
      { id: 'lookbooks', label: 'lookbooks', load: () => _flat('lookbooks', '1:1') },
      { id: 'images', label: 'Images', load: () => _media('images', (i, m) => _pic(i.media, i.name, '', { aspect: _shape(m.w, m.h) })) },
    ],
    video: [
      { id: 'made', label: 'made in this project', load: _made, empty: 'No clips made in this project yet.' },
      { id: 'birols', label: 'B-roll', load: () => _media('birols', (i, m) => _clip(i.media, i.thumb, i.name, { aspect: _shape(m.w, m.h), dur: +i.dur || 0 })) },
      { id: 'uploads', label: 'Uploads', load: () => _media('uploads', (i, m) => _clip(i.media, i.thumb, i.name, { aspect: _shape(m.w, m.h), dur: +i.dur || 0 })) },
    ],
    audio: [
      { id: 'sounds', label: 'Sounds', load: () => _media('sounds', (i) => ({ path: i.media, src: i.media, name: i.name || '', dur: +i.dur || 0 })) },
      { id: 'music', label: 'music (Suno)', load: _music },
      { id: 'voices', label: 'voices', load: _voices, empty: 'No saved voices yet - they are kept on the Library\'s Voices shelf.' },
    ],
  };
  // Where the picker opens: a recipe's slot of pictures by what it is for (the owner) - a person on the characters and
  // looks, a place on the environments, clothes on the lookbooks, anything else on Images; else ('') where this kind
  // was last taken from - the picker remembers -, the first time `FIRST`.
  function _startFor(kind, s) {
    if (kind !== 'image' || !s || !s.key) return '';
    return s.role === 'person' ? 'people' : s.role === 'location' ? 'environments' : s.role === 'outfit' ? 'lookbooks' : 'images';
  }
  // Uploads first for clips: it is where clips from this computer go.
  const FIRST = { image: 'images', video: 'uploads', audio: 'sounds' };
  // (phase V15) Where a thing in the zone is on the shelves, by its folder - the picker opens there, on it (a clip made
  // here is on B-roll too: this project's own first).
  function _sourceOf(path, kind) {
    const at = (dir) => String(path || '').startsWith('/media/' + dir + '/');
    if (kind === 'image') return at('characters') || at('looks') ? ['people'] : at('locations') ? ['environments'] : at('lookbooks') ? ['lookbooks'] : at('images') ? ['images'] : [];
    if (kind === 'video') return at('birols') ? ['made', 'birols'] : at('uploads') ? ['uploads'] : [];
    return at('sounds') ? ['sounds'] : at('audio') ? ['music'] : at('voice') ? ['voices'] : [];
  }
  // ── The almanac - the prompt reference (phase V14; V15: at the foot of the column, vhelp.js) ──
  // One for the whole chat (the owner, 2026-10-07): a tip pressed there is copied, and the note says so on the prompt
  // field typed in last - the chat's box, or the prompt of a card.
  const _helpNote = () => (isMC() ? 'Kling motion control: the camera follows your clip - a camera tip may not take.' : '');
  let _lastField = null;
  const _seen = (e) => !!(e && e.isConnected && e.offsetParent !== null);
  function _fieldForHelp() {
    if (_seen(_lastField)) return _lastField;
    const ui = ctx.ui();
    if (ui && _seen(ui.ta)) return ui.ta;
    // A recipe in use: the box is hidden - the newest card's prompt.
    const cards = ui ? [...ui.thread.querySelectorAll('textarea.vc-prompt-ta:not(.is-board)')] : [];
    return cards[cards.length - 1] || null;
  }
  function _almanacBtn() {
    const b = el('button', 'mv3-vc-almanac', 'almanac');
    b.type = 'button';
    b.title = 'The prompt reference - camera moves and more: press a tip to copy it, then paste it into your prompt';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); openHelp({ anchor: b, field: _fieldForHelp, note: _helpNote }); });
    return b;
  }

  // What cannot go into the zone at all, said on its tile: a clip or a sound shorter than the model takes (one longer
  // goes, and only its part is sent).
  function _pickWhy(it, kind) {
    if (kind === 'image' || !(+it.dur > 0)) return '';
    const rule = _spanRule({ kind, path: it.path });
    const m = model();
    if (!rule || !m || +it.dur >= rule.min - 0.05) return '';
    return _s(it.dur) + ' - ' + m.label + ' needs at least ' + _s(rule.min);
  }
  // (review V7) What a recipe's places must hold beyond what the chosen model takes ('' when it fits): flat-flythrough's
  // plan and two renders under Kling with the writer off, which takes one picture (with it on, the first frame takes up
  // to 13 - V17).
  function _recipeOver() {
    if (!_skill || !_applies()) return '';
    const r = rec(), m = model();
    if (!r || !m) return '';
    const L = r.limits || {};
    const need = { image: 0, video: 0, audio: 0 };
    for (const s of _skill.slots || []) if (s && s.required && +s.min > 0) need[_partOf(s.kind)] += +s.min;
    const room = { image: _picRoom(r), video: L.videos || 0, audio: L.audios || 0 };
    for (const k of ['image', 'video', 'audio']) {
      if (need[k] > room[k]) return 'it needs ' + need[k] + ' ' + REF_WORD[k] + (need[k] === 1 ? '' : 's') + ', and ' + m.label + ' takes ' + (room[k] || 'none');
    }
    return '';
  }

  // Whether the recipe in use applies under the chosen model: a two-step one is Seedance's. One that does not stands
  // dimmed, and asks nothing of the send (review V7).
  const _applies = () => !!_skill && (!_skill.twoStep || (model() || {}).family === 'seedance');

  // The recipe's first slot that is not filled as far as it must be - the send waits for it.
  function _missing() {
    if (_framesMode()) {
      for (const s of _frameSlots()) if (!_pics().some(a => a.slot === s.key)) return Object.assign({ part: 'image', have: 0, frame: true }, s);
      return null;
    }
    if (!_skill || !_applies()) return null;
    const atts = ctx.atts();
    for (const kind of ['image', 'video', 'audio']) {
      for (const s of (_slotsOf(kind) || [])) {
        if (!s.required || !s.min) continue;
        const have = atts.filter(a => _kind(a) === kind && a.slot === s.key).length;
        if (have < s.min) return Object.assign({ part: kind, have }, s);
      }
    }
    return null;
  }

  function _ready() {
    if (!_table) return ['No video models.', _err || 'reading the models…'];
    const m = model(), r = rec();
    if (!m || !m.usable) return ['Not available now.', (m && m.why) || 'no model can be asked'];
    if (!r || !r.usable) return [(r ? r.aggLabel : 'That aggregator') + ' cannot be asked.', (r && r.why) || ''];
    // (phase V15) An empty numbered place: the numbers in the prompt would move under it.
    const hole = ctx.holeWhy();
    if (hole) return hole;
    // (review V7) A recipe whose places must hold more than this model takes cannot be filled here - said plainly, rather
    // than blinking a place that can never be filled.
    const over = _recipeOver();
    if (over) return ['The recipe does not fit ' + m.label + '.', over + ' - pick another model, or stop using the recipe with the × on its line.'];
    // A recipe's cell that must be filled and is not: nothing is asked, the cell blinks (phase V6).
    const miss = _missing();
    if (miss && miss.frame) {
      ctx.flash(miss.part, miss.key);
      return ['The ' + miss.label + ' is empty.', miss.hint + ' - press its place, then a picture.'];
    }
    // (phase V16) A picture beyond the frames' places does not go - it stands dimmed with the reason.
    if (_framesMode() && _pics().some(a => !_frameKeys().includes(a.slot))) {
      return [_onlyFrames() + '.', 'Take the other pictures off, or set "pictures are" to references.'];
    }
    if (miss) {
      ctx.flash(miss.part, miss.key);
      const what = miss.part === 'video' ? 'clip' : miss.part === 'audio' ? 'sound' : 'picture';
      return ['The recipe needs ' + (miss.min - miss.have) + ' more ' + (miss.label && miss.label !== what ? miss.label + ' ' : '') + what + (miss.min - miss.have === 1 ? '' : 's') + '.',
        miss.hint || 'Press its place, then a ' + what + ' on the right or a file.'];
    }
    const n = _pics().length;
    const L = r.limits || {};
    // (phase V7.3) Kling motion control: ONE picture - the person and the place - and ONE clip - the moves; the box is
    // its prompt, in English (translated when not), up to its limit. (phase V17) With the writer on: the person's pictures
    // - the character, and whatever else they want taken from where - and the clip; the first frame is drawn from them.
    if (isMC()) {
      const secs = (r.duration.min || 3) + '-' + (params().orientation === 'image' ? (L.videoSecsImage || 10) : (L.videoSecs || 30)) + ' s';
      if (_mcSteps()) {
        if (n < 1 || _clips().length !== 1) {
          return ['Kling needs your character and a clip.', 'Pictures: your character - and a place, clothes or a thing if you like (say in the box what to take from which); the clip: the moves (' + secs + ').'];
        }
        const fi = _table.frame;
        if (!fi || !(fi.providers || []).some(p => p.usable)) return ['The first frame cannot be drawn.', ((fi && (fi.providers || []).find(p => p.why)) || {}).why || 'no picture model can be asked'];
      } else {
        if (n !== 1 || _clips().length !== 1) return ['Kling needs one picture and one clip.', 'The picture is the person and the place, the clip the moves (' + secs + ').'];
        const words = String(ctx.text() || '').trim();
        if (r.promptMax && words.length > r.promptMax) return ['The prompt is too long.', m.label + ' takes ' + r.promptMax + ' characters - this one is ' + words.length + '.'];
      }
    }
    if (r.needs && r.needs.images && n < r.needs.images) return ['It needs a picture.', m.label + ' on ' + r.aggLabel + ' starts from one.'];
    if (n > _picRoom(r)) {
      return ['Too many pictures.', _seat() ? 'Room for ' + _picRoom(r) + ': the storyboard goes to ' + m.label + ' as one more picture, and it is drawn with these.'
        : _mcSteps() ? 'Up to ' + _picRoom(r) + ' - the still of the clip is the picture model\'s other reference.'
          : m.label + ' on ' + r.aggLabel + ' takes ' + (L.images || 0) + '.'];
    }
    // (phase V7) Clips and sounds: as many as the model takes, each with a part it takes.
    const vi = _clips(), au = _sounds();
    if (vi.length > (L.videos || 0)) return ['Too many clips.', m.label + ' on ' + r.aggLabel + ' takes ' + (L.videos ? L.videos : 'no clips') + '.'];
    if (au.length > (L.audios || 0)) return ['Too many sounds.', m.label + ' on ' + r.aggLabel + ' takes ' + (L.audios ? L.audios : 'no sounds') + '.'];
    if (L.total && n + vi.length + au.length + _seat() > L.total) return ['Too many attachments.', m.label + ' takes ' + L.total + ' files in all.'];
    const wrong = vi.concat(au).map(a => [a, _spanWrong(a)]).find(x => x[1]);
    if (wrong) {
      const a = wrong[0];
      const k = _kind(a);
      return [(k === 'video' ? 'Clip ' : 'Sound ') + (ctx.atts().filter(x => _kind(x) === k).indexOf(a) + 1) + ' cannot go like this.', wrong[1] + '.'];
    }
    if (au.length && !n && !vi.length) return ['A sound goes beside a picture or a clip.', m.label + ' takes sounds as references to something it sees.'];
    // A two-step video always sends a picture - its storyboard (review V8).
    const any = n + vi.length + au.length;
    if ((any || _seat()) && !_table.r2) return ['Attachments need R2.', (_seat() ? 'The storyboard goes to the video as a picture - ' : 'The models read what is attached ') + 'from a public link: set R2 on Admin → API keys.'];
    return '';
  }

  const _ownRole = (a) => a.role === 'voice' || a.role === 'storyboard';
  // `cardMedia`: a card's own attachments - what it is made with decides whether the clip's sound can go (V7.4).
  function _body(cardMedia) {
    const m = model(), r = rec();
    const p = params();
    const fam = m.family;
    // (phase V15) The column's storyboard is drawn from the pictures - an older sheet among them is not one of them (the
    // new sheet takes its place when it lands).
    const boarding = _boardOn();
    const atts = ctx.atts().filter(a => !(boarding && _kind(a) === 'image' && a.role === 'storyboard'));
    // What each picture is for: its place says - a recipe's slot (its role - person, product... - or a frame), or a frame's
    // place (phase V16: "pictures are" lays them out in the zone; beside a clip or a sound the server sends them as
    // references, and the prompt names them).
    const slots = new Map(['image', 'video', 'audio'].flatMap(k => (_slotsOf(k) || []).map(s => [k + ':' + s.key, s])));
    const role = (a) => {
      const s = a.slot ? slots.get(_kind(a) + ':' + a.slot) : null;
      return s ? (/^frame-/.test(s.kind) ? s.kind : s.role) : '';
    };
    const fmt = (Store.timeline() || {}).format || '9:16';
    // (phase V7.4) Seedance's sound from the clip: its own off, the first clip's part laid under when it lands - only
    // while a clip goes with it (remembered otherwise, and the model's own sound stands in).
    const clipSound = fam === 'seedance' && p.sound === 'clip'
      && (cardMedia ? cardMedia.some(a => a && a.kind === 'video') : atts.some(a => _kind(a) === 'video'));
    return {
      model: m.id, agg: r.agg,
      // (phase V15) The column's 中文: the written prompt goes in Chinese (Seedance; the server checks the model too).
      zh: _zhOn(),
      // (phase V15) The column's storyboard: the sheet is written and drawn, and it stops there.
      storyboard: boarding || undefined,
      // (phase V16, the owner) The writer stops for a look: its prompt comes back as a message of its own, and the video is
      // made from there - "make the video". Under Kling motion control the writer writes the first frame instead (V17).
      review: !boarding && ctx.writing() && !isMC() ? true : undefined,
      params: {
        duration: r.duration.fromClip ? undefined : clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max),
        resolution: r.resolutions.includes(p.resolution) ? p.resolution : r.resDef,
        aspect: (r.aspects || []).includes(p.aspect) ? p.aspect : ((r.aspects || []).includes(fmt) ? fmt : (r.aspects || [])[0]),
        audio: clipSound ? false : (p.sound === 'clip' || p.audio !== false), sound: clipSound ? 'clip' : '',
        mode: p.mode || 'normal', orientation: p.orientation || 'video', keepSound: p.keepSound !== false,
      },
      media: atts.map((a) => Object.assign({
        // (phase V15) A thing that says what it is for - a voice, a storyboard - goes as that; otherwise its place decides
        // (phase V16: a message's attachments put back into the zone keep nothing of their old places - a first frame put
        // back under "references" is a reference).
        path: a.path, kind: _kind(a), role: _ownRole(a) ? a.role : role(a),
        label: (_ownRole(a) && a.label) || ((a.slot && slots.get(_kind(a) + ':' + a.slot)) || {}).label || '',
      // (phase V7) A clip or a sound goes as its part - the server prepares just that.
      }, _kind(a) !== 'image' ? { in: +a.in || 0, out: +a.out || 0 } : {})),
      // The catalog's recipe, as it was left (the server keeps it only when the writer will use it).
      skill: _skill ? { id: _skill.id, kind: _skill.kind, title: _skill.title, v: _skill.v, edited: _edited(_skill), text: _skill.text } : undefined,
    };
  }

  // ── The step-by-step builder (phase V6, the owner 2026-10-06) ─────────────
  // A recipe chosen, the chat is a BUILDER: there is no input line - the person writes in the cards. At the foot of the
  // thread stands the recipe's REQUEST, its places [like this] framed in gold - dashed while a place still holds the
  // recipe's example, solid once it is the person's - with the rest of the recipe folded under it (unfolded, it is
  // edited right there); the press under it sends the request to the writer alone (POST /write). The writer's answer
  // is a PROMPT CARD the person edits; the press under that makes the video (POST /card/:id/make). The foot holds the
  // one step that comes next: this recipe's prompt card not made yet, or the request again - filled in as it was left,
  // for the next variant. The plain chat, without a recipe, stays one press (the owner).
  const GAP_RE = /\[([^\[\]\n]{1,600})\]/g;
  const REF_WORD = { image: 'picture', video: 'clip', audio: 'sound' };
  const REF_KIND = { picture: 'image', clip: 'video', sound: 'audio' };
  // The writer's neutral references as the person reads and writes them: {{image:1}} <-> [picture 1].
  const toShown = (p) => String(p || '').replace(/\{\{\s*(image|video|audio)\s*:\s*(\d+)\s*\}\}/gi, (a, k, n) => '[' + REF_WORD[k.toLowerCase()] + ' ' + (+n) + ']');
  const toNeutral = (p) => String(p || '').replace(/\[(picture|clip|sound) (\d+)\]/gi, (a, k, n) => '{{' + REF_KIND[k.toLowerCase()] + ':' + n + '}}');
  let _wantRecipe = false;      // "change the values" pressed, or the recipe just chosen: the request shows though cards of it stand
  let _cardEls = null;          // the foot's request while it shows
  let _writingNow = false;
  const _live = new Map();      // card id -> its controls, while it waits to be made (price and button follow the column)
  const _cardN = new Map();     // card id -> how many clips it makes
  const _patchT = new Map();

  // The recipe's text as the builder reads it: the request (its first paragraph) and the rest.
  function _split(text) {
    const t = String(text || '').replace(/\r\n/g, '\n');
    const m = /\n[ \t]*\n/.exec(t);
    return m ? { head: t.slice(0, m.index).trim(), body: t.slice(m.index).trim() } : { head: t.trim(), body: '' };
  }
  const _gaps = (head) => [...String(head || '').matchAll(GAP_RE)].map(m => m[1]);
  // A place that only says how long and what shape the clip is - "[Total length 15 seconds, vertical 9:16.]": those are
  // the column's settings, so the code fills it from them (grey, not a place to write in).
  const SIZE_WORDS = /\b(total|length|duration|long|about|around|in|of|a|the|and|sec|secs|second|seconds|s|vertical|horizontal|square|portrait|landscape|aspect|ratio|format|frame|clip)\b/gi;
  const _isSize = (g) => /\d/.test(g) && !String(g).replace(/\d+(\.\d+)?\s*:\s*\d+/g, ' ').replace(/\d+(\.\d+)?/g, ' ')
    .replace(SIZE_WORDS, ' ').replace(/[\s.,;:!?()'"\-–—]+/g, '');
  function _sizeWords() {
    const r = rec(), p = params();
    if (!r) return '';
    const secs = r.duration.fromClip ? 0 : clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max);
    const fmt = (Store.timeline() || {}).format || '9:16';
    const ar = (r.aspects || []).includes(p.aspect) ? p.aspect : ((r.aspects || []).includes(fmt) ? fmt : (r.aspects || [])[0]);
    const shape = !ar ? '' : ar === '9:16' ? 'vertical 9:16' : ar === '16:9' ? 'horizontal 16:9' : ar === '1:1' ? 'square 1:1' : 'shape ' + ar;
    return [secs ? secs + ' seconds' : '', shape].filter(Boolean).join(', ') + '.';
  }
  // What the person wrote in each place, kept by the place's own words: a request changed in the popup keeps what still
  // fits it.
  function _syncVals(head) {
    const gaps = _gaps(head);
    const old = Array.isArray(_skill.vals) ? _skill.vals : [];
    const used = new Set();
    _skill.vals = gaps.map((ex, i) => {
      if (old[i] && old[i].ex === ex) { used.add(i); return old[i]; }
      const j = old.findIndex((o, k) => o && o.ex === ex && !used.has(k));
      if (j >= 0) { used.add(j); return old[j]; }
      return { ex, v: null };
    });
  }
  const _valOf = (i) => (_skill && _skill.vals && _skill.vals[i] && _skill.vals[i].v) || null;
  const _familyOf = (id) => ((models().find(m => m.id === id) || {}).family || '');
  const _labelOf = (id) => ((models().find(m => m.id === id) || {}).label || id || '');
  const _where = (key) => ({
    page: 'merge', href: '/merge?p=' + encodeURIComponent(key) + '&open=videos',
    label: 'Merge · ' + (Store.title() || 'project') + ' · videos', spot: { key, view: 'videos' },
  });
  const _post = (url, body, method) => json(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // This recipe's prompt cards in the thread. The request stands at the foot only while there is none - or when
  // "change the values" asks for it: brought back by itself under a made card, it read as the recipe said twice (the
  // owner, 2026-10-06). The card itself is the step that comes next.
  const _recipeCards = () => (_skill ? ctx.thread().filter(m => m.card && m.card.type === 'prompt' && m.card.recipe && m.card.recipe.id === _skill.id) : []);
  // "change the values": the request again, under the card that waits.
  function _changeLink() {
    const change = el('button', 'vc-link', 'change the values');
    change.type = 'button';
    change.title = 'The request again, under this card, to fill in otherwise';
    change.addEventListener('click', () => { _wantRecipe = true; _paintFoot(); });
    return change;
  }

  // The foot: the request, or nothing while this recipe's prompt card waits. `quiet` - laid during a paint of the thread.
  function _paintFoot(quiet) {
    const foot = ctx.foot();
    if (!foot) return;
    // Kling motion control's recipe only lays out what to attach (the owner's answer 5, phase V7): no request, no cards.
    const builder = !!_skill && !isMC();
    ctx.bar(!builder);
    const show = builder && (_wantRecipe || !_recipeCards().length);
    const key = _skill ? [_skill.kind, _skill.id, _split(_skill.text).head].join('|') : '';
    if (!show) {
      _cardEls = null;
      if (foot.childNodes.length) { foot.textContent = ''; if (!quiet) ctx.footChanged(); }
      return;
    }
    if (_cardEls && _cardEls.key === key && foot.contains(_cardEls.box)) { _freshenRequest(); return; }
    foot.textContent = '';
    foot.appendChild(_requestCard(key));
    if (!quiet) ctx.footChanged();
  }

  function _requestCard(key) {
    const { head, body } = _split(_skill.text);
    _syncVals(head);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-request');
    const h = el('div', 'vc-card-h');
    h.append(el('span', 'k', 'recipe'), el('span', 't', _skill.title));
    box.appendChild(h);
    const req = el('div', 'vc-req');
    const places = [];
    let last = 0;
    let i = 0;
    for (const m of head.matchAll(GAP_RE)) {
      if (m.index > last) req.appendChild(document.createTextNode(head.slice(last, m.index)));
      req.appendChild(_place(i, m[1], places));
      last = m.index + m[0].length;
      i++;
    }
    if (last < head.length) req.appendChild(document.createTextNode(head.slice(last)));
    box.appendChild(req);
    if (places.some(p => !p.auto)) {
      box.appendChild(el('div', 'vc-card-note', 'Write your own over the places in gold - until you do, they hold the recipe\'s example, and it goes as it is.'));
    }
    // The rest of the recipe: folded; unfolded, edited right here (the owner).
    let bodyTa = null;
    let back = null;
    if (body) {
      const fold = el('button', 'vc-fold', 'the whole recipe ▸');
      fold.type = 'button';
      bodyTa = document.createElement('textarea');
      bodyTa.className = 'vc-req-body';
      bodyTa.hidden = true;
      bodyTa.spellcheck = false;
      bodyTa.value = body;
      back = el('button', 'vc-link vc-back', 'back to the original');
      back.type = 'button';
      back.hidden = !_edited(_skill);
      const grow = () => { bodyTa.style.height = 'auto'; bodyTa.style.height = Math.min(520, bodyTa.scrollHeight + 2) + 'px'; };
      fold.addEventListener('click', () => {
        bodyTa.hidden = !bodyTa.hidden;
        fold.textContent = bodyTa.hidden ? 'the whole recipe ▸' : 'the whole recipe ▾';
        if (!bodyTa.hidden) grow();
      });
      bodyTa.addEventListener('input', () => {
        _skill.text = _split(_skill.text).head + '\n\n' + bodyTa.value;
        back.hidden = !_edited(_skill);
        grow();
        _paintRecipe();
        ctx.saveDraft();
      });
      back.addEventListener('click', () => {
        const was = _split(_skill.text).head;
        _skill.text = _skill.orig;
        ctx.saveDraft();
        _paintRecipe();
        if (_split(_skill.orig).head !== was) { _cardEls = null; _paintFoot(); return; }
        bodyTa.value = _split(_skill.orig).body;
        back.hidden = true;
        grow();
      });
      const row = el('div', 'vc-fold-row');
      row.append(fold, back);
      box.append(row, bodyTa);
    }
    const acts = el('div', 'vc-card-acts');
    const go = el('button', 'mv3-c-btn vc-go', _skill.twoStep ? 'write the prompts' : 'write the prompt');
    go.type = 'button';
    const why = el('span', 'vc-card-why');
    go.addEventListener('click', () => _write(go));
    acts.append(go, why);
    box.appendChild(acts);
    _cardEls = { key, box, places, go, why };
    _freshenRequest();
    return box;
  }

  // One place of the request: the person's words, or the recipe's example until they write over it.
  function _place(i, ex, places) {
    if (_isSize(ex)) {
      const sp = el('span', 'vc-place is-auto', _sizeWords());
      sp.title = 'The length and the shape on the left - the recipe said: ' + ex;
      places.push({ i, auto: true, el: sp });
      return sp;
    }
    const v = _valOf(i);
    const sp = el('span', 'vc-place ' + (v ? 'is-changed' : 'is-example'), v || ex);
    sp.contentEditable = 'plaintext-only';
    sp.tabIndex = 0;
    sp.dataset.i = String(i);
    const paint = () => {
      const mine = !!_valOf(i);
      sp.classList.toggle('is-changed', mine);
      sp.classList.toggle('is-example', !mine);
      sp.title = mine ? 'Yours - the recipe\'s example was: ' + ex : 'The recipe\'s example - write your own over it';
    };
    paint();
    // An example is taken whole at the first press: typing replaces it.
    sp.addEventListener('focus', () => {
      if (_valOf(i)) return;
      setTimeout(() => { if (document.activeElement === sp) window.getSelection().selectAllChildren(sp); }, 0);
    });
    sp.addEventListener('input', () => {
      const t = sp.textContent.replace(/\s+/g, ' ').trim();
      _skill.vals[i] = { ex, v: t && t !== ex ? t : null };
      paint();
      ctx.saveDraft();
    });
    sp.addEventListener('blur', () => {
      if (sp.textContent.trim()) return;
      sp.textContent = ex;
      _skill.vals[i] = { ex, v: null };
      paint();
      ctx.saveDraft();
    });
    // Enter goes on to the next place - a place is one line. A tick later: the rest of the key's own events land in
    // THIS place first, and would otherwise collapse the next place's example taken whole.
    sp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = places.find(p => p.i > i && !p.auto);
      setTimeout(() => { if (next) next.el.focus(); else sp.blur(); }, 0);
    });
    places.push({ i, auto: false, el: sp });
    return sp;
  }

  // What follows the column: the length and shape place, and whether the request can go.
  function _freshenRequest() {
    if (!_cardEls) return;
    for (const p of _cardEls.places) if (p.auto) p.el.textContent = _sizeWords();
    const m = model();
    const mc = isMC();
    _cardEls.go.disabled = mc || _writingNow;
    const two = !!(_skill && _skill.twoStep);
    _cardEls.why.textContent = mc ? 'A recipe is not written for Kling motion control - pick another model on the left.'
      : two && m && m.family !== 'seedance' ? 'A two-step recipe is made by Seedance - pick a Seedance model on the left.'
        : two && m ? 'The writer writes the storyboard\'s prompt and the video\'s for ' + m.label + ' - you read and edit both before anything is made.'
          : m ? 'The writer turns it into a prompt for ' + m.label + ' - you read it and edit it before anything is made.' : '';
  }

  async function _write(btn) {
    if (_writingNow || !_skill) return;
    if (isMC()) { note(btn, 'Not for Kling.', 'A recipe is not written for Kling motion control - pick another model on the left.'); return; }
    if (_skill.twoStep && (model() || {}).family !== 'seedance') { note(btn, 'Seedance makes this one.', 'A two-step recipe - a storyboard, then the video from it - is made by Seedance: pick it on the left.'); return; }
    const why = _ready();
    if (why) { note(btn, why[0], why[1]); return; }
    _writingNow = true;
    btn.disabled = true;
    try {
      let key;
      try { key = await ctx.ensureProject(); }
      catch (e) { note(btn, 'Could not start a project.', String(e.message || e).slice(0, 120)); return; }
      const { head, body } = _split(_skill.text);
      const values = _gaps(head).map((ex, i) => (_isSize(ex) ? _sizeWords() : _valOf(i)));
      const b = _body();
      const d = await _post('/api/mv3/video/write', {
        project: key, model: b.model, agg: b.agg, params: b.params,
        recipe: { id: _skill.id, kind: _skill.kind, title: _skill.title, v: _skill.v, edited: _edited(_skill) },
        head, values, body, media: b.media, twoStep: !!_skill.twoStep,
      });
      if (!d || !d.success) {
        const at = _cardEls && _cardEls.go && _cardEls.go.isConnected ? _cardEls.go : btn;
        note(at, 'Not sent.', (d && d.error) || 'the server did not answer');
        return;
      }
      _wantRecipe = false;
      await ctx.reload(true);
    } finally {
      _writingNow = false;
      if (btn.isConnected) btn.disabled = isMC();
      _freshenRequest();
    }
  }

  // ── The cards in the thread ──
  // (phase V16) A working message is drawn anew only when it first has something written - or fails without it: from
  // then on its steps, their variants, its clips and its prices are painted in place (_paintStory, _paintReview), never
  // under the typing.
  const _cardSig = (m) => {
    const c = m.card;
    const B = c.board || {};
    // (phase V17) A first frame's card is written when its picture's prompt is: Kling's own is put in at its start.
    const has = B.kind === 'frame' ? (B.versions || []).length || B.prompt
      : (c.versions || []).length || c.prompt || (B.versions || []).length || B.prompt;
    return [c.type, c.plain ? 'plain' : c.board ? (B.kind || 'two') : 'one', has ? 'v' : (c.state || '') + ':' + (c.error || '')].join(':');
  };
  const _busy = (thread) => thread.some(m => (m.card && (m.card.type === 'prompt' || m.card.type === 'board') && m.card.state === 'writing')
    || (m.boards || []).some(g => g.state === 'pending'));

  // (phase V16, the owner 2026-10-07) Every working message is a SUB-PROJECT (vsteps.js): its steps paged at its top, the
  // variants of the step shown at its foot - the chat does not grow with every attempt. The plain chat's message and a
  // one-step recipe's are "prompt" then "video"; one with a picture first - the column's storyboard, a two-step recipe -
  // has four, and Kling's first frame (V17) three: its prompt, the picture, the video.
  function _cardBubble(m, progs) {
    const c = m.card;
    if (c.type === 'recipe') return _sentRequest(m);
    if (c.type === 'board' || c.board) return _storyCard(m, progs);
    return _reviewCard(m, progs);
  }

  // ── The attempts of a card (the owner, 2026-10-06: a made card is made again from its own field) ──
  // Every make is one: when, how many, the sheet it followed and its clips. A card made before attempts were kept has
  // its clips as the first. (phase V16) Every clip of every attempt is a variant of the message's "video" step.
  function _triesOf(m) {
    const c = m.card;
    const byId = new Map((m.gens || []).map(g => [g.id, g]));
    const sends = Array.isArray(c.sends) && c.sends.length ? c.sends
      : ((m.genIds || []).length ? [{ at: (c.sent || {}).at || '', n: (c.sent || {}).n || 1, zh: !!(c.sent || {}).zh,
          boardId: (c.board || {}).chosen || '', genIds: m.genIds }] : []);
    return sends.map(s => Object.assign({}, s, { gens: (s.genIds || []).map(id => byId.get(id)).filter(Boolean) }));
  }

  // The prices and the presses of the working messages follow the column.
  function _freshenCards() {
    for (const [id, l] of _live) {
      if (!l.el.isConnected) { _forget(id); continue; }
      _freshenOne(id, l);
    }
  }
  // A message leaving the live ones takes its countdowns with it (review V8): each is an interval of its own.
  function _forget(id) {
    const l = _live.get(id);
    if (l && l.steps) l.steps.destroy();
    _live.delete(id);
  }
  function _freshenOne(id, l) {
    if (l.story) _freshenStory(id, l);
    else _freshenReview(id, l);
  }

  // Whether a card can go to the model chosen now - the card's own attachments are the server's to check.
  function _readyFor(m) {
    if (!_table) return ['No video models.', _err || 'reading the models…'];
    const mm = model(), r = rec();
    if (!mm || !mm.usable) return ['Not available now.', (mm && mm.why) || 'no model can be asked'];
    if (!r || !r.usable) return [(r ? r.aggLabel : 'That aggregator') + ' cannot be asked.', (r && r.why) || ''];
    // A two-step card always sends a picture - its storyboard (review V8).
    if (((m.media || []).length || m.card.board) && !_table.r2) return ['Attachments need R2.', (m.card.board ? 'The ' + (m.card.board.kind === 'frame' ? 'picture' : 'storyboard') + ' goes to the video as a picture - ' : 'The models read pictures ') + 'from a public link: set R2 on Admin → API keys.'];
    return '';
  }

  async function _make(m, go) {
    const l = _live.get(m.id);
    if (!l || go.disabled) return;
    const mm = model();
    // (phase V16) A message makes from the variant shown - written for its own model.
    if (mm && mm.family !== _familyOf(l.vmodel || m.card.model)) {
      if (l.kind === 'swap') { note(go, 'Kling makes it.', 'A first frame\'s video is made by Kling motion control - pick it on the left.'); return; }
      if (l.story) { note(go, 'Seedance makes it.', 'A video that follows a storyboard is made by Seedance - pick a Seedance model on the left.'); return; }
      return _rewrite(m, go);
    }
    // (phase V17) Kling's first frame has no prompt field: Kling's own prompt is the card's.
    const prompt = l.kind === 'swap' ? String(m.card.prompt || (_table && _table.standardPrompt) || '').trim() : toNeutral(l.ta.value).trim();
    if (!prompt) { note(go, 'The prompt is empty.', 'Write what the clip shows, or write it again.'); return; }
    const why = _readyFor(m);
    if (why) { note(go, why[0], why[1]); return; }
    // A two-step recipe's video and Kling's first frame's follow the sheet (the picture) shown on their second step.
    const follows = l.kind === 'recipe' || l.kind === 'swap';
    const sheet = follows ? _chosenSheet(l) : null;
    if (follows && !sheet) {
      if ((l.m.boards || []).some(g => g.state === 'pending')) note(go, 'The ' + l.W + ' is being drawn.', 'The video follows it - make it when it has landed.');
      else note(go, 'The ' + l.W + ' first.', 'Draw the ' + l.W + ' - the video follows the one shown on its step.');
      return;
    }
    go.disabled = true;
    try {
      clearTimeout(_patchT.get(l.patchKey || m.id));
      _patchT.delete(l.patchKey || m.id);
      const b = _body(m.media || []);
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/make', {
        project: m.project, prompt, n: _cardN.get(m.id) || 1, model: b.model, agg: b.agg, params: b.params, where: _where(m.project),
        // (phase V16) The column storyboard's video follows the sheet its prompt variant was written with; the others the
        // one shown.
        boardId: l.kind === 'column' ? (l.boardId || undefined) : sheet ? sheet.id : undefined,
        zh: _zhOn(),
        ver: l.ver || undefined,
      });
      if (!d || !d.success) { note(go, 'Not made.', (d && d.error) || 'the server did not answer'); return; }
      _cardN.delete(m.id);
      await ctx.reload(true);
    } finally {
      if (go.isConnected) go.disabled = false;
    }
  }

  async function _rewrite(m, btn) {
    // (phase V17) Under Kling the writer writes the first frame's prompt - nothing else.
    const frameCard = !!(m.card.board && m.card.board.kind === 'frame');
    if (isMC() && !frameCard) { note(btn, 'No writer here.', 'Under Kling motion control the writer writes only the first frame - pick another model on the left.'); return; }
    if (frameCard && !isMC()) { note(btn, 'Kling makes this one.', 'The first frame is Kling motion control\'s - pick it on the left.'); return; }
    const why = _readyFor(m);
    if (why) { note(btn, why[0], why[1]); return; }
    btn.disabled = true;
    try {
      const b = _body(m.media || []);
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/rewrite', { project: m.project, model: b.model, agg: b.agg, params: b.params });
      if (!d || !d.success) { note(btn, 'Not written.', (d && d.error) || 'the server did not answer'); return; }
      await ctx.reload(true);
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }
  // "again - a copy" (the owner, 2026-10-06): a recipe's message that was made, copied into a new one to change and make
  // apart from it.
  function _copyLink(m) {
    const again = el('button', 'vc-link', 'again - a copy');
    again.type = 'button';
    again.title = 'A new message with this prompt, to change and make apart from this one';
    again.addEventListener('click', async () => {
      if (again.disabled) return;
      again.disabled = true;
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/again', { project: m.project });
      if (again.isConnected) again.disabled = false;
      if (!d || !d.success) { note(again, 'Not copied.', (d && d.error) || 'the server did not answer'); return; }
      ctx.reload(true);
    });
    return again;
  }
  // The recipe's own presses on its message: its request again, to fill in otherwise, while the recipe is in use.
  const _ownRecipe = (c) => !!(_skill && c.recipe && c.recipe.id === _skill.id);

  // What the storyboard - or Kling's first frame, drawn at 2K from the clip's still and every picture of the person
  // (V17) - costs, and whether it can be drawn.
  function _boardPrice(l) {
    if (!_table) return { ok: false, text: 'reading the prices…' };
    const frame = l.kind === 'swap';
    const info = frame ? _table.frame : _table.board;
    if (!info) return { ok: false, text: 'the picture engine is not in this program' };
    // The sheet always goes to the video as a picture (review V8): without R2 it would be bought for nothing.
    if (!_table.r2) return { ok: false, text: 'the ' + l.W + ' goes to the video as a picture - set R2 on Admin → API keys' };
    const pics = (l.m.media || []).filter(x => x.kind === 'image').length;
    const n = frame ? pics + 1 : pics;
    const p = (info.providers || []).find(x => x.usable && (!n || (x.maxRefs || 1) >= n));
    if (!p) return { ok: false, text: ((info.providers || []).find(x => x.why) || {}).why || (info.label + ' cannot take ' + n + ' pictures') };
    return { ok: true, text: (p.price != null ? '≈' + money(p.price) + ' · ' : '') + info.quality + ' · ' + info.label + ' · ' + p.label };
  }
  // The sheets the video can follow: landed, and still on the Images shelf (the server says `gone` - review V8).
  const _boardOk = (g) => !!(g && g.state === 'done' && g.imagePath && !g.gone);
  // ONE PRESS, ONE SHEET (review V8): the button stays shut from the press until the thread has been read with the new
  // sheet in it, whatever repaints meanwhile, and the second click of a double click is not a press. `two`: { bta - the
  // prompt field shown, frame, range - the first frame's moment, busy }; without a field the card's own prompt is drawn.
  async function _drawBoard(m, two, btn, e) {
    if (btn.disabled || two.busy || (e && e.detail > 1)) return;
    two.busy = true;
    btn.disabled = true;
    try {
      clearTimeout(_patchT.get('b:' + m.id));
      _patchT.delete('b:' + m.id);
      // (phase V17) A moment just moved is written before the picture is drawn from it.
      const live = _live.get(m.id);
      if (live && live.atSave) { await live.atSave; live.atSave = null; }
      // Kling's first frame: its prompt in the neutral references, and the moment of the clip it is drawn from.
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/board', {
        project: m.project, where: _where(m.project),
        board: two.bta ? (two.frame ? toNeutral(two.bta.value) : two.bta.value) : undefined,
        at: two.frame && two.range ? +two.range.value : undefined,
      });
      if (!d || !d.success) { note(btn, 'Not drawn.', (d && d.error) || 'the server did not answer'); return; }
      // Read in place - the new countdown is on this message, not at the end of the thread.
      await ctx.reload();
    } finally {
      two.busy = false;
      if (btn.isConnected) btn.disabled = false;
      const l = _live.get(m.id);
      if (l) _freshenOne(m.id, l);
    }
  }
  // A sheet: a press shows the card's sheets large, hovering shows it bigger.
  function _boardThumb(g, all, W) {
    const word = W || 'storyboard';
    const t = el('button', 'vc-board');
    t.type = 'button';
    t.dataset.id = g.id;
    const img = document.createElement('img');
    img.src = '/api/thumb?src=' + encodeURIComponent(g.imagePath) + '&v=strip';
    img.loading = 'lazy'; img.decoding = 'async'; img.alt = word;
    // Gone from the shelf since it was read: said, and never followed (the server says so too at the next read).
    img.addEventListener('error', () => { t.classList.add('is-gone'); t.title = 'Not on the Images shelf any more'; }, { once: true });
    t.appendChild(img);
    t.title = 'The ' + word + ' · press: large';
    t.addEventListener('mouseenter', () => ctx.peekShow('/api/thumb?src=' + encodeURIComponent(g.imagePath) + '&v=main', t));
    t.addEventListener('mouseleave', ctx.peekHide);
    const list = (all && all.length ? all : [g]);
    t.addEventListener('click', () => openViewer(list.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: word })),
      Math.max(0, list.findIndex(x => x.id === g.id))));
    return t;
  }
  // A sheet still being drawn: its countdown in the person's words (the asking's stage first), and the cross.
  function _boardWords(g, W) {
    if (g.stage) return g.stage + '…';
    if (g.error) return String(g.error).slice(0, 60) + ' — trying the next…';
    return 'drawing the ' + (W || 'storyboard') + '…';
  }
  function _boardBusy(g, progs, key, W) {
    const cell = el('div', 'vc-board is-busy');
    const bar = el('div', 'mv3-ig-prog');
    cell.appendChild(bar);
    progs.set(key, startInlineProgress(bar, {
      label: _boardWords(g, W), key: W === 'picture' ? 'mv3-frame' : 'mv3-board', estimateMs: W === 'picture' ? 60000 : 90000, startedAt: Date.parse(g.at) || 0,
      onCancel: g.alertId ? async () => { await json('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', { method: 'POST' }); ctx.reload(); } : null,
    }));
    return cell;
  }
  // Every working message as the thread is read: its steps and their variants painted again in place.
  function _freshenLive(thread) {
    for (const [id, l] of _live) {
      if (!l.el.isConnected) { _forget(id); continue; }
      const now = thread.find(x => x.id === id);
      if (now) l.m = now;
      if (l.story) _paintStory(id, l);
      else _paintReview(id, l);
    }
  }

  // ── A message with a picture first (phases V15, V8, V17; a sub-project since V16 - the owner 2026-10-07) ──
  // Three kinds, one shape. The column's storyboard (`column`): ">" writes the sheet's prompt alone, and every paid step
  // waits for its press (the owner, V16 answer 5) - "draw the storyboard", "write the video" (the video's prompt from the
  // same words with the sheet shown among the pictures), "make the video". A two-step recipe (`recipe`, V8): its writer
  // wrote both prompts at once, the sheet is drawn by its press, and the video follows the sheet shown. Kling's first
  // frame (`swap`, V17 - V7.6's recipe before it): the writer's prompt for a picture of the person's character in the pose
  // of the clip's still, drawn by its press; then Kling moves the picture shown with the part of the clip from that
  // moment, by its own prompt. Their steps: the first prompt (every writing a variant) · the sheet, or the picture (every
  // one drawn a variant - the one shown is the one the video follows) · the video prompt (every writing a variant; not
  // Kling's) · the video (the clips). A recipe's message and Kling's open on their first step; the column's steps grow as
  // the work goes.
  const _kindOf = (c) => (c.type === 'board' ? 'column' : c.board && c.board.kind === 'frame' ? 'swap' : 'recipe');
  function _storyCard(m, progs) {
    const c = m.card;
    _forget(m.id);
    const kind = _kindOf(c);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-prompt is-board is-steps is-' + c.state);
    const h = el('div', 'vc-card-h');
    // (phase V17) Kling's first frame of the plain chat is the person's message, not a recipe.
    const own = kind === 'swap' && c.plain;
    if (kind === 'column') h.append(el('span', 'k', 'storyboard'), el('span', 't', _words(c.text).slice(0, 90) || 'from the attachments alone'));
    else if (own) h.append(el('span', 'k', 'video'), el('span', 't', _words(c.text).slice(0, 90) || 'from your pictures'));
    else h.append(el('span', 'k', 'recipe'), el('span', 't', (c.recipe && c.recipe.title) || ''));
    if (c.model) h.appendChild(el('span', 'm', 'for ' + _labelOf(c.model) + (kind === 'column' ? '' : own ? ' · the first frame, then the video' : ' · 2 steps')));
    box.appendChild(h);
    const B = c.board || {};
    if (!((B.versions || []).length || B.prompt)) {
      // Nothing written yet: the writer at work, or why not.
      if (c.state === 'writing') {
        const strip = el('div', 'mv3-ig-prog');
        box.appendChild(strip);
        progs.set('w:' + m.id, startInlineProgress(strip, {
          label: kind === 'column' ? 'writing the storyboard prompt…' : kind === 'swap' ? 'writing the first frame\'s prompt…' : 'writing the prompts…',
          key: kind === 'column' ? 'mv3-board-writer' : 'mv3-video-writer',
          estimateMs: kind === 'column' ? 20000 : 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
        }));
        return box;
      }
      box.appendChild(el('div', 'mv3-ig-bad', c.error || 'it was not written'));
      const acts = el('div', 'vc-card-acts');
      const again = el('button', 'mv3-c-btn vc-go', 'write it again');
      again.type = 'button';
      again.addEventListener('click', () => _rewrite(m, again));
      acts.appendChild(again);
      if ((kind === 'column' || own) && (m.media || []).length) acts.appendChild(_backLink(m));
      if (_ownRecipe(c)) acts.appendChild(_changeLink());
      box.appendChild(acts);
      return box;
    }
    const steps = stepCard(m.id);
    box.append(...steps.parts);
    const l = { m, el: box, steps, story: true, kind, W: kind === 'swap' ? 'picture' : 'storyboard', ta: null, go: null, price: null, save: null,
                bta: null, range: null, drawGo: null, drawPrice: null, ver: '', vmodel: '', boardId: '', patchKey: '' };
    _live.set(m.id, l);
    _paintStory(m.id, l);
    return box;
  }
  // The sheet the video follows: the one shown on its step when it has landed, else the one the card chose, else the
  // newest that landed.
  function _chosenSheet(l) {
    const done = (l.m.boards || []).filter(_boardOk);
    const chosen = (l.m.card.board || {}).chosen;
    return done.find(g => g.id === l.steps.shown('board')) || done.find(g => g.id === chosen) || done[done.length - 1] || null;
  }
  function _paintStory(id, l) {
    const m = l.m, c = m.card, B = c.board || {};
    const kind = l.kind;
    const patch = (b) => _post('/api/mv3/video/card/' + encodeURIComponent(m.id), Object.assign({ project: m.project }, b), 'PATCH');
    const writing = c.state === 'writing';
    // A card written before its prompts had variants has its one prompt and no list: that one is its only variant (`b0`,
    // `v0` - edited as the card's own).
    const bv = (B.versions || []).length ? B.versions : [{ id: 'b0', prompt: B.prompt, aspect: B.aspect, edited: !!B.edited }];
    const bvars = bv.map(v => ({ key: v.id, sig: '', v }));
    if (writing && (kind === 'recipe' || c.writing === 'board')) bvars.push({ key: 'writing', sig: 'writing', writing: true });
    const sheets = (m.boards || []).map(g => ({ key: g.id, sig: g.state + ':' + (g.imagePath || '') + ':' + (g.error || '') + ':' + (g.gone ? 1 : 0), g }));
    const vv = (c.versions || []).length ? c.versions : (c.prompt ? [{ id: 'v0', prompt: c.prompt, model: c.model, boardId: '' }] : []);
    const vvars = vv.map(v => ({ key: v.id, sig: (v.model || '') + ':' + (v.boardId || ''), v }));
    if (writing && (kind === 'recipe' || c.writing === 'video')) vvars.push({ key: 'writing', sig: 'writing', writing: true });
    const clips = _triesOf(m).flatMap((t, i) => t.gens.map(g => ({ key: g.id, sig: g.state + ':' + (g.videoPath || '') + ':' + (g.error || ''), g, t, n: i + 1 })));
    const say = (x) => { const p = x && x.g && x.g.state === 'pending' ? l.steps.progs.get(x.g.id) : null; if (p) p.say(x.t ? ctx.stageWords(x.g) : _boardWords(x.g, l.W)); };
    // (phase V17) Kling's first frame: the writer's variants of its prompt, the moment of the clip with them.
    const first = kind === 'swap' ? {
      key: 'picture-prompt', title: 'first frame prompt', word: 'variant', pick: B.cur || 'b0', variants: bvars,
      note: (x) => (!x ? '' : x.writing ? 'being written' : '"draw the picture" draws this one'),
      body: (x, b, progs) => _momentStep(m, l, x, b, progs),
      acts: (x, a) => _boardPromptActs(m, l, x, a),
      page: (x) => { if (x && x.v && (B.versions || []).length && x.key !== B.cur) patch({ bcur: x.key }); },
      freshen: () => _freshenStory(id, l),
    } : {
      key: 'board-prompt', title: 'storyboard prompt', word: 'variant', pick: B.cur || 'b0', variants: bvars,
      note: (x) => (!x ? '' : x.writing ? 'being written' : '"draw the storyboard" draws this one'),
      body: (x, b, progs) => _boardPromptStep(m, l, x, b, progs),
      acts: (x, a) => _boardPromptActs(m, l, x, a),
      page: (x) => { if (x && x.v && (B.versions || []).length && x.key !== B.cur) patch({ bcur: x.key }); },
      freshen: () => _freshenStory(id, l),
    };
    const steps = [first];
    // The sheets: on a recipe's message from the start, so its steps never move under the person; on the column's once
    // one is drawn.
    if (sheets.length || kind !== 'column') {
      steps.push({
        key: 'board', title: kind === 'swap' ? 'first frame' : 'storyboard', word: kind === 'swap' ? 'picture' : 'sheet', pick: B.chosen, variants: sheets,
        note: (x) => (!x ? '' : x.g.state === 'pending' ? 'being drawn' : !_boardOk(x.g) ? (x.g.gone ? 'not on the Images shelf any more' : 'not drawn')
          : 'the video follows this one'),
        body: (x, b, progs) => _sheetStep(m, l, x, b, progs),
        acts: (x, a) => _sheetActs(m, l, x, a),
        // The sheet paged to - when it has landed - is the one chosen.
        page: (x) => { if (x && _boardOk(x.g) && x.key !== B.chosen) patch({ chosen: x.key }); },
        freshen: (x) => { say(x); _freshenStory(id, l); },
      });
    }
    // (phase V17) Kling's prompt is its own, put in by the server: the video is made from the first frame's step.
    if (vvars.length && kind !== 'swap') {
      steps.push({
        key: 'prompt', title: 'video prompt', word: 'variant', pick: c.cur || 'v0', variants: vvars,
        // The sheet a recipe's video follows is shown with its prompt: another one paged to on its step draws this anew.
        sig: () => (kind === 'column' ? '' : (_chosenSheet(l) || {}).id || ''),
        note: (x) => (!x ? '' : x.writing ? 'being written' : '"make the video" sends this one'),
        body: (x, b, progs) => _videoPromptStep(m, l, x, b, progs),
        acts: (x, a) => _videoPromptActs(m, l, x, a),
        page: (x) => { if (x && x.v && (c.versions || []).length && x.key !== c.cur) patch({ cur: x.key }); },
        freshen: () => _freshenStory(id, l),
      });
    }
    if (clips.length) {
      steps.push({
        key: 'video', title: 'video', word: 'clip', variants: clips,
        note: (x) => (x ? 'attempt ' + x.n : ''),
        body: (x, b, progs) => _videoStep(m, x, b, progs),
        freshen: say,
      });
    }
    // A recipe's message nothing has been drawn or made from yet opens on its first step.
    l.steps.paint({ steps, start: kind !== 'column' && !sheets.length && !clips.length ? first.key : '' });
  }
  // 1 · the storyboard prompt: its words to edit (the variant shown), the pictures it is drawn with.
  function _boardPromptStep(m, l, x, b, progs) {
    const c = l.m.card;
    l.bta = null;
    if (!x || x.writing) {
      const strip = el('div', 'mv3-ig-prog');
      b.appendChild(strip);
      progs.set('w', startInlineProgress(strip, {
        label: l.kind === 'recipe' ? 'writing another variant of both prompts…' : 'writing another variant of the storyboard prompt…',
        key: l.kind === 'recipe' ? 'mv3-video-writer' : 'mv3-board-writer', estimateMs: l.kind === 'recipe' ? 25000 : 20000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      }));
      return;
    }
    if (c.error && c.writing !== 'video') b.appendChild(el('div', 'mv3-ig-bad', 'The last writing did not work: ' + c.error));
    const bta = document.createElement('textarea');
    bta.className = 'vc-prompt-ta is-board';
    bta.spellcheck = true;
    bta.maxLength = 6000;
    bta.value = x.v.prompt || '';
    bta.title = 'The storyboard sheet\'s prompt - numbered panels, one per beat of the clip; Image 1, Image 2 are the pictures below.';
    const grow = () => { bta.style.height = 'auto'; bta.style.height = Math.min(320, bta.scrollHeight + 2) + 'px'; };
    requestAnimationFrame(grow);
    const key = 'b:' + m.id + ':' + x.key;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, board: bta.value };
      if (x.key !== 'b0') body.bver = x.key;
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    bta.addEventListener('input', () => { grow(); clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    bta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    b.appendChild(bta);
    const row = _mediaRow(l.m.media || []);
    if (row) b.appendChild(row);
    l.bta = bta;
  }
  // 1 · Kling's first frame (V7.6 as a recipe; the chat's own since V17): the moment of the clip it is drawn from and the
  // prompt the writer wrote - [clip 1] is the clip's still there, [picture N] the person's pictures. On a card that knows
  // its clip's length (V17) the moment is where the part starts, anywhere in the clip; on an older one it lies within
  // the part.
  const _t = (v) => { const x = Math.max(0, +v || 0); const mm = Math.floor(x / 60); return mm + ':' + (x - mm * 60).toFixed(1).padStart(4, '0'); };
  function _momentStep(m, l, x, b, progs) {
    const c = l.m.card, B = c.board || {};
    l.bta = null; l.range = null;
    if (!x || x.writing) {
      const strip = el('div', 'mv3-ig-prog');
      b.appendChild(strip);
      progs.set('w', startInlineProgress(strip, {
        label: 'writing another variant of the first frame\'s prompt…', key: 'mv3-video-writer', estimateMs: 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      }));
      return;
    }
    if (c.error) b.appendChild(el('div', 'mv3-ig-bad', 'The last writing did not work: ' + c.error));
    const clip = (l.m.media || []).find(y => y.kind === 'video') || {};
    const whole = +B.dur > 0;
    const len = Math.max(3, +B.len || ((+clip.out || 0) - (+clip.in || 0)));
    const lo = whole ? 0 : (+clip.in || 0);
    const hi = whole ? Math.max(0, B.dur - 3) : (+clip.out > lo ? +clip.out : lo);
    const mo = el('div', 'vc-moment');
    const v = document.createElement('video');
    v.className = 'vc-moment-v';
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.src = clip.path || '';
    const side = el('div', 'vc-moment-side');
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(lo); range.max = String(hi); range.step = '0.04';
    range.value = String(Math.max(lo, Math.min(hi, whole ? (+clip.in || 0) : (+B.at || lo))));
    range.title = whole ? 'The first frame: the moment your character is seen best - the moves go from here'
      : 'The moment of the clip the picture is drawn from - its first frame unless you pick another';
    const said = el('span', 'vc-moment-at');
    const say = () => {
      said.textContent = whole ? 'the first frame: ' + _t(range.value) + ' · the moves ' + _t(range.value) + ' – ' + _t(Math.min(B.dur, +range.value + len))
        : 'the moment: ' + _t(range.value) + ' · the part ' + _t(lo) + ' – ' + _t(hi);
    };
    say();
    let raf = 0;
    const show = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { try { v.currentTime = +range.value; } catch (e) { /* not loaded */ } }); };
    v.addEventListener('loadedmetadata', show, { once: true });
    range.addEventListener('input', () => { say(); show(); });
    // The drawing waits for the moment to be written (`atSave`): it reads it from the card.
    range.addEventListener('change', () => { l.atSave = _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, at: +range.value }, 'PATCH'); });
    side.append(range, said, el('span', 'vc-card-note', whole ? 'A new moment needs a new picture: the first frame is drawn from it.'
      : 'Pick a moment where the dancer is seen whole - the picture keeps that pose, room, light and angle.'));
    mo.append(v, side);
    b.appendChild(mo);
    const bta = document.createElement('textarea');
    bta.className = 'vc-prompt-ta is-board';
    bta.spellcheck = true;
    bta.maxLength = 6000;
    bta.value = toShown(x.v.prompt || '');
    bta.title = 'The first frame\'s prompt: [clip 1] is the clip\'s still at the moment above, [picture 1], [picture 2]... your pictures by their numbers.';
    const grow = () => { bta.style.height = 'auto'; bta.style.height = Math.min(240, bta.scrollHeight + 2) + 'px'; };
    requestAnimationFrame(grow);
    const key = 'b:' + m.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, board: toNeutral(bta.value) };
      if (x.key !== 'b0') body.bver = x.key;
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    bta.addEventListener('input', () => { grow(); clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    bta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    b.appendChild(bta);
    const row = _mediaRow(l.m.media || []);
    if (row) b.appendChild(row);
    l.bta = bta;
    l.range = range;
  }
  function _boardPromptActs(m, l, x, a) {
    l.drawGo = null; l.drawPrice = null;
    if (!x || x.writing) return;
    const go = el('button', 'mv3-c-btn vc-go is-make', 'draw the ' + l.W);
    go.type = 'button';
    const two = { bta: l.bta, range: l.range, frame: l.kind === 'swap', busy: false };
    go.addEventListener('click', (e) => _drawBoard(l.m, two, go, e));
    const price = el('span', 'vc-card-why');
    a.append(go, price);
    // A two-step recipe's writer writes both prompts again; Kling's first frame (V17) and the storyboard their own.
    const again = el('button', 'vc-link', l.kind === 'recipe' ? 'write both again' : 'write it again');
    again.type = 'button';
    again.title = l.kind === 'recipe' ? 'Another variant of both prompts - the storyboard\'s and the video\'s - from the same request; these stay'
      : l.kind === 'swap' ? 'Another variant of the first frame\'s prompt from the same words and pictures - this one stays'
        : 'Another variant of the storyboard prompt from the same words and pictures - this one stays';
    again.addEventListener('click', () => _rewrite(l.m, again));
    a.appendChild(again);
    if ((l.kind === 'column' || (l.kind === 'swap' && l.m.card.plain)) && (l.m.media || []).length) a.appendChild(_backLink(l.m));
    if (l.kind === 'recipe' && _ownRecipe(l.m.card)) a.appendChild(_changeLink());
    l.drawGo = go;
    l.drawPrice = price;
    _freshenStory(m.id, l);
  }
  // 2 · the storyboard (the picture): the one shown - drawing, drawn (press: large), or why not.
  function _sheetStep(m, l, x, b, progs) {
    if (!x) {
      b.appendChild(el('div', 'vc-card-note', 'Not drawn yet - "draw the ' + l.W + '" on the step before. The video follows the one shown here.'));
      return;
    }
    const g = x.g;
    if (g.state === 'pending') { b.appendChild(_boardBusy(g, progs, g.id, l.W)); return; }
    if (!_boardOk(g)) {
      b.appendChild(el('div', 'vc-board is-bad', g.gone ? 'not on the Images shelf any more - it cannot be followed' : String(g.error || 'it was not drawn').slice(0, 200)));
      return;
    }
    const t = _boardThumb(g, (l.m.boards || []).filter(_boardOk), l.W);
    t.classList.add('is-big');
    b.appendChild(t);
    // (phase V17) Kling's prompt is its own: said, not a field.
    if (l.kind === 'swap') {
      const clip = (l.m.media || []).find(y => y.kind === 'video') || {};
      b.appendChild(el('div', 'vc-card-note', 'Kling moves this picture with the clip ' + _t(clip.in) + ' – ' + _t(clip.out) + ' and gets: ' + (l.m.card.prompt || '')));
    }
  }
  function _sheetActs(m, l, x, a) {
    l.drawGo = null; l.drawPrice = null;
    // (phase V17, the owner 2026-10-08) Kling's first frame: the picture drawn, and right under it the press that makes the
    // video from it - its price, the count - then another picture.
    if (l.kind === 'swap') {
      l.go = null; l.price = null;
      if (x && _boardOk(x.g)) {
        const nBtn = el('button', 'vc-n', '×' + (_cardN.get(m.id) || 1));
        nBtn.type = 'button';
        nBtn.title = 'How many to make from it - each clip is its own variant of the video';
        nBtn.addEventListener('click', () => {
          _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
          nBtn.textContent = '×' + _cardN.get(m.id);
          _freshenStory(m.id, l);
        });
        const go = el('button', 'mv3-c-btn vc-go is-make', 'make the video');
        go.type = 'button';
        go.addEventListener('click', () => _make(l.m, go));
        const price = el('span', 'vc-card-why');
        a.append(nBtn, go, price);
        if (l.m.card.state === 'sent' && !l.m.card.plain) a.appendChild(_copyLink(l.m));
        l.go = go;
        l.price = price;
      }
      const redo = el('button', 'mv3-c-btn vc-go' + (x && _boardOk(x.g) ? '' : ' is-make'), x ? 'draw again' : 'draw the picture');
      redo.type = 'button';
      redo.title = 'Another picture from the prompt chosen on the step before';
      redo.addEventListener('click', (e) => _drawBoard(l.m, { bta: null, range: null, frame: true, busy: false }, redo, e));
      const dp = el('span', 'vc-card-why');
      a.append(redo, dp);
      l.drawGo = redo;
      l.drawPrice = dp;
      _freshenStory(m.id, l);
      return;
    }
    // The column's storyboard: the video's prompt is written now, with this sheet among the pictures.
    if (l.kind === 'column') {
      const write = el('button', 'mv3-c-btn vc-go is-make', 'write the video');
      write.type = 'button';
      write.title = 'The video\'s prompt from your words, with this storyboard among the pictures - you see it before the video is made';
      write.addEventListener('click', () => _writeVideo(l.m, l, write));
      write.disabled = !(x && _boardOk(x.g));
      a.appendChild(write);
    }
    const redo = el('button', 'mv3-c-btn vc-go' + (l.kind === 'column' ? '' : ' is-make'), x ? 'draw again' : 'draw the ' + l.W);
    redo.type = 'button';
    redo.title = 'Another sheet from the prompt chosen on the step before';
    redo.addEventListener('click', (e) => _drawBoard(l.m, { bta: null, range: null, frame: false, busy: false }, redo, e));
    const price = el('span', 'vc-card-why');
    a.append(redo, price);
    l.drawGo = redo;
    l.drawPrice = price;
    _freshenStory(m.id, l);
  }
  // "write the video": the writer writes the video's prompt with the sheet shown among the pictures - another variant.
  async function _writeVideo(m, l, btn) {
    if (btn.disabled) return;
    const g = _chosenSheet(l);
    if (!g) { note(btn, 'No storyboard yet.', 'Draw it first - the video follows it.'); return; }
    const why = _readyFor(m);
    if (why) { note(btn, why[0], why[1]); return; }
    btn.disabled = true;
    try {
      const b = _body(m.media || []);
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/video', { project: m.project, model: b.model, agg: b.agg, params: b.params, boardId: g.id });
      if (!d || !d.success) { note(btn, 'Not written.', (d && d.error) || 'the server did not answer'); return; }
      await ctx.reload(true);
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }
  // 3 · the video prompt: its words to edit, and what goes with it - the pictures with the sheet as the last one (the
  // column's: the sheet ITS variant was written with; a recipe's: the one shown on its step). Kling's first frame has no
  // such step - its prompt is Kling's own (V17).
  function _videoPromptStep(m, l, x, b, progs) {
    const c = l.m.card;
    l.ta = null; l.ver = ''; l.vmodel = ''; l.boardId = ''; l.patchKey = '';
    if (!x || x.writing) {
      const strip = el('div', 'mv3-ig-prog');
      b.appendChild(strip);
      progs.set('w', startInlineProgress(strip, {
        label: l.kind === 'recipe' ? 'writing another variant of both prompts…' : 'writing the video prompt…', key: 'mv3-video-writer', estimateMs: 25000,
        startedAt: Date.parse(c.startedAt || m.at) || 0,
      }));
      return;
    }
    const v = x.v;
    if (c.error && c.writing !== 'board') b.appendChild(el('div', 'mv3-ig-bad', 'The last writing did not work: ' + c.error));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta';
    ta.spellcheck = true;
    ta.value = toShown(v.prompt);
    ta.title = 'The prompt the model gets - edit it before the video is made. [picture N] names a picture; the storyboard is the last one.';
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(420, ta.scrollHeight + 2) + 'px'; };
    requestAnimationFrame(grow);
    const key = 'p:' + m.id + ':' + v.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, prompt: toNeutral(ta.value) };
      if (v.id !== 'v0') body.ver = v.id;
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    ta.addEventListener('input', () => { grow(); clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    ta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    b.appendChild(ta);
    const media = l.m.media || [];
    const sheet = l.kind === 'column' ? (l.m.boards || []).find(g => g.id === v.boardId) : _chosenSheet(l);
    const has = !!(sheet && sheet.imagePath);
    const all = media.filter(a => a.kind === 'image').concat(has ? [{ path: sheet.imagePath, kind: 'image', role: 'storyboard', label: 'storyboard' }] : [])
      .concat(media.filter(a => a.kind !== 'image'));
    const row = _mediaRow(all);
    if (row) b.appendChild(row);
    if (l.kind === 'column' && sheet && sheet.gone) b.appendChild(el('div', 'mv3-ig-bad', 'Its storyboard is not on the Images shelf any more - write the video again from another sheet.'));
    if (l.kind !== 'column' && !has) b.appendChild(el('div', 'vc-card-note', 'No ' + l.W + ' the video can follow yet - it follows the one shown on the step before: draw one there.'));
    Object.assign(l, { ta, save, ver: v.id === 'v0' ? '' : v.id, vmodel: v.model || c.model, boardId: v.boardId || '', patchKey: key });
  }
  function _videoPromptActs(m, l, x, a) {
    l.go = null; l.price = null;
    if (!x || x.writing) return;
    const nBtn = el('button', 'vc-n', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = 'How many to make from it - each clip is its own variant of the video';
    nBtn.addEventListener('click', () => {
      _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
      nBtn.textContent = '×' + _cardN.get(m.id);
      _freshenStory(m.id, l);
    });
    const go = el('button', 'mv3-c-btn vc-go is-make', 'make the video');
    go.type = 'button';
    go.addEventListener('click', () => _make(l.m, go));
    const price = el('span', 'vc-card-why');
    a.append(nBtn, go, price);
    const again = el('button', 'vc-link', l.kind === 'recipe' ? 'write both again' : 'write it again');
    again.type = 'button';
    again.title = l.kind === 'recipe' ? 'Another variant of both prompts - the storyboard\'s and the video\'s - from the same request; these stay'
      : 'Another variant of the video prompt, with the storyboard shown on its step - this one stays';
    again.addEventListener('click', () => (l.kind === 'recipe' ? _rewrite(l.m, again) : _writeVideo(l.m, l, again)));
    a.appendChild(again);
    if (l.kind !== 'column' && l.m.card.state === 'sent') a.appendChild(_copyLink(l.m));
    if (l.kind === 'recipe' && _ownRecipe(l.m.card)) a.appendChild(_changeLink());
    l.go = go;
    l.price = price;
    _freshenStory(m.id, l);
  }
  // The presses follow the column: a storyboard's video is Seedance's, Kling's first frame's Kling motion control's; the
  // drawing has its own price, and is the card's own model's to judge.
  function _freshenStory(id, l) {
    const mm = model();
    const fits = !!mm && (l.kind === 'swap' ? mm.family === 'kmc' : mm.family === 'seedance');
    if (l.drawGo) {
      const bp = _boardPrice(l);
      l.drawPrice.textContent = bp.text;
      l.drawGo.disabled = !bp.ok;
    }
    if (l.go) {
      _freshenReview(id, l);
      if (!fits) {
        l.go.disabled = true;
        l.go.classList.add('is-make');
        l.go.textContent = 'make the video';
        l.price.textContent = 'this video is made by ' + (l.kind === 'swap' ? 'Kling motion control' : 'Seedance') + ' - pick it on the left';
      }
    }
  }

  // A request as it was sent: the places as the person left them - theirs in solid gold, the example's dashed - and
  // what was attached, by the name of its slot.
  function _sentRequest(m) {
    const c = m.card;
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-request is-sent');
    const h = el('div', 'vc-card-h');
    h.append(el('span', 'k', 'recipe'), el('span', 't', (c.recipe && c.recipe.title) || ''));
    if (c.recipe && c.recipe.edited) h.appendChild(el('i', null, 'edited'));
    box.appendChild(h);
    const req = el('div', 'vc-req');
    const head = c.head || '';
    let last = 0;
    let i = 0;
    for (const g of head.matchAll(GAP_RE)) {
      if (g.index > last) req.appendChild(document.createTextNode(head.slice(last, g.index)));
      const v = (c.values || [])[i];
      const mine = v != null && String(v).trim() && String(v).trim() !== g[1];
      req.appendChild(el('span', 'vc-place ' + (_isSize(g[1]) ? 'is-auto' : mine ? 'is-changed' : 'is-example'), mine ? String(v).trim() : g[1]));
      last = g.index + g[0].length;
      i++;
    }
    if (last < head.length) req.appendChild(document.createTextNode(head.slice(last)));
    box.appendChild(req);
    const row = _mediaRow(m.media || []);
    if (row) box.appendChild(row);
    return box;
  }

  // What a message carries, by kind and number, each with its slot's or its role's name - a recipe's request, a
  // writer's message (phase V16).
  function _mediaRow(media) {
    if (!media.length) return null;
    const row = el('div', 'mv3-ig-msg-refs');
    const count = { image: 0, video: 0, audio: 0 };
    for (const a of media) {
      const k = count[a.kind] != null ? a.kind : 'image';
      count[k]++;
      const cell = refCell(a, k, count[k], { show: ctx.peekShow, hide: ctx.peekHide });
      cell.title = (REF_WORD[k] + ' ' + count[k]) + (a.label ? ' - ' + a.label : '');
      const wrap = el('div', 'vc-ref');
      wrap.appendChild(cell);
      if (a.label) wrap.appendChild(el('span', 'lab', a.label));
      row.appendChild(wrap);
    }
    return row;
  }

  // ── The writer's message (phase V16, the owner 2026-10-07) ──
  // With the writer on, ">" packs the words and the attachments into a message of their own - the box and the zone are
  // emptied - and the writer's prompt comes back in it to look at and edit; only its "make the video" spends. A one-step
  // recipe's prompt is the same message (V16.6), its request standing above it. The message is a SUB-PROJECT (vsteps.js):
  // "prompt" - every writing of it a variant - then "video" - every clip of every attempt a variant. The variant of the
  // prompt shown is the one made from.
  const _words = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  // A card written before its prompts had variants has its one prompt and no list: that one is its only variant (`v0`,
  // edited as the card's own).
  const _versOf = (c) => ((c.versions || []).length ? c.versions : c.prompt ? [{ id: 'v0', prompt: c.prompt, model: c.model }] : []);
  function _reviewCard(m, progs) {
    const c = m.card;
    _forget(m.id);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-prompt is-steps is-' + c.state);
    const h = el('div', 'vc-card-h');
    if (c.plain) {
      const frames = (m.media || []).some(a => /^frame-/.test(String(a.role || '')));
      h.append(el('span', 'k', 'video'), el('span', 't', _words(c.text).slice(0, 90) || (frames ? 'from the frames alone' : 'from the attachments alone')));
    } else h.append(el('span', 'k', 'recipe'), el('span', 't', (c.recipe && c.recipe.title) || ''));
    if (c.model) h.appendChild(el('span', 'm', 'for ' + _labelOf(c.model)));
    box.appendChild(h);
    if (!_versOf(c).length) {
      if (c.state === 'writing') {
        const strip = el('div', 'mv3-ig-prog');
        box.appendChild(strip);
        progs.set('w:' + m.id, startInlineProgress(strip, {
          label: 'writing the prompt…', key: 'mv3-video-writer', estimateMs: 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
        }));
        return box;
      }
      box.appendChild(el('div', 'mv3-ig-bad', c.error || 'it was not written'));
      const acts = el('div', 'vc-card-acts');
      const again = el('button', 'mv3-c-btn vc-go', 'write it again');
      again.type = 'button';
      again.addEventListener('click', () => _rewrite(m, again));
      acts.appendChild(again);
      if (c.plain && (m.media || []).length) acts.appendChild(_backLink(m));
      if (_ownRecipe(c)) acts.appendChild(_changeLink());
      box.appendChild(acts);
      return box;
    }
    const steps = stepCard(m.id);
    box.append(...steps.parts);
    const l = { m, el: box, steps, ta: null, go: null, price: null, save: null, review: true, ver: '', vmodel: '', patchKey: '' };
    _live.set(m.id, l);
    _paintReview(m.id, l);
    return box;
  }
  function _paintReview(id, l) {
    const m = l.m, c = m.card;
    const vers = _versOf(c).map(v => ({ key: v.id, sig: v.model, v }));
    if (c.state === 'writing') vers.push({ key: 'writing', sig: 'writing', writing: true });
    const steps = [{
      key: 'prompt', title: 'prompt', word: 'variant', pick: c.cur || 'v0', variants: vers,
      note: (x) => (!x ? '' : x.writing ? 'being written' : '"make the video" sends this one'),
      body: (x, b, progs) => _promptStep(m, l, x, b, progs),
      acts: (x, a) => _promptActs(m, l, x, a),
      // The variant paged to is the chosen one (the server keeps it for the next read).
      page: (x) => { if (x && x.v && x.key !== 'v0' && x.key !== l.m.card.cur) _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, cur: x.key }, 'PATCH'); },
      freshen: () => _freshenReview(id, l),
    }];
    const clips = _triesOf(m).flatMap((t, i) => t.gens.map(g => ({ key: g.id, sig: g.state + ':' + (g.videoPath || '') + ':' + (g.error || ''), g, t, n: i + 1 })));
    if (clips.length) {
      steps.push({
        key: 'video', title: 'video', word: 'clip', variants: clips,
        note: (x) => (x ? 'attempt ' + x.n : ''),
        body: (x, b, progs) => _videoStep(m, x, b, progs),
        freshen: (x) => { const p = x && x.g.state === 'pending' ? l.steps.progs.get(x.g.id) : null; if (p) p.say(ctx.stageWords(x.g)); },
      });
    }
    l.steps.paint({ steps });
  }
  function _promptStep(m, l, x, b, progs) {
    const c = l.m.card;
    l.ta = null; l.ver = ''; l.vmodel = ''; l.patchKey = '';
    if (!x || x.writing) {
      const strip = el('div', 'mv3-ig-prog');
      b.appendChild(strip);
      progs.set('w', startInlineProgress(strip, {
        label: 'writing another variant…', key: 'mv3-video-writer', estimateMs: 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      }));
      return;
    }
    const v = x.v;
    if (c.error) b.appendChild(el('div', 'mv3-ig-bad', 'The last writing did not work: ' + c.error));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta';
    ta.spellcheck = true;
    ta.value = toShown(v.prompt);
    ta.title = 'The prompt the model gets - edit it before the video is made. [picture 1], [clip 1] name what is attached, by its number in its part.';
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(420, ta.scrollHeight + 2) + 'px'; };
    requestAnimationFrame(grow);
    const key = 'p:' + m.id + ':' + v.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, prompt: toNeutral(ta.value) };
      if (v.id !== 'v0') body.ver = v.id;
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    ta.addEventListener('input', () => { grow(); clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    ta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    b.appendChild(ta);
    const row = _mediaRow(l.m.media || []);
    if (row) b.appendChild(row);
    Object.assign(l, { ta, save, ver: v.id === 'v0' ? '' : v.id, vmodel: v.model || c.model, patchKey: key });
  }
  function _promptActs(m, l, x, a) {
    l.go = null; l.price = null;
    if (!x || x.writing) return;
    const c = l.m.card;
    const nBtn = el('button', 'vc-n', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = 'How many to make from it - each clip is its own variant of the video';
    nBtn.addEventListener('click', () => {
      _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
      nBtn.textContent = '×' + _cardN.get(m.id);
      _freshenReview(m.id, l);
    });
    const go = el('button', 'mv3-c-btn vc-go is-make', 'make the video');
    go.type = 'button';
    go.addEventListener('click', () => _make(l.m, go));
    const price = el('span', 'vc-card-why');
    const again = el('button', 'vc-link', 'write it again');
    again.type = 'button';
    again.title = c.plain ? 'Another variant of the prompt from the same words and attachments - this one stays'
      : 'Another variant of the prompt from the same request - this one stays';
    again.addEventListener('click', () => _rewrite(l.m, again));
    a.append(nBtn, go, price, again);
    // The plain chat's attachments go back to the zone for the next message; a recipe's stand in its request, which
    // "change the values" brings back.
    if (c.plain && (l.m.media || []).length) a.appendChild(_backLink(l.m));
    if (!c.plain && c.state === 'sent') a.appendChild(_copyLink(l.m));
    if (_ownRecipe(c)) a.appendChild(_changeLink());
    l.go = go;
    l.price = price;
    _freshenReview(m.id, l);
  }
  // The press and the price follow the column: another kind of model than the variant was written for means writing
  // it again for that one.
  function _freshenReview(id, l) {
    // Not "is it on the page": the press is painted the moment its step is built, before the message is put in.
    if (!l.go) return;
    const c = l.m.card;
    const mm = model();
    const vm = l.vmodel || c.model;
    const other = !!(mm && _familyOf(vm) && mm.family !== _familyOf(vm));
    const n = _cardN.get(id) || 1;
    const made = (c.sends || []).length > 0 || (l.m.genIds || []).length > 0;
    l.go.textContent = other ? 'write it again for ' + mm.label : (made ? 'make the video again' : 'make the video') + (n > 1 ? ' ×' + n : '');
    l.go.classList.toggle('is-make', !other);
    l.go.disabled = c.state === 'writing';
    const pr = priceOf(rec(), l.m.media || []);
    l.price.textContent = other ? 'this variant was written for ' + _labelOf(vm)
      : !pr || pr.none ? (mm ? mm.label + ' · no published price' : '')
        : pr.fromClip ? (pr.usd != null ? '≈' + money(pr.usd * n) + ' at most · ' + _s(pr.secs) + ' of the clip' : '≈' + money(pr.per) + ' per second of clip') + ' · ' + (mm ? mm.label : '')
          : '≈' + money(pr.usd * n) + ' · ' + (pr.vidIn ? pr.out + ' s + ' + _s(pr.vidIn) + ' of the clips' : pr.secs + ' s') + ' · ' + pr.res + ' · '
            + (mm ? mm.label : '') + ' · ' + (rec() ? rec().aggLabel : '') + (_zhOn() ? ' · in 中文' : '');
  }
  function _videoStep(m, x, b, progs) {
    if (!x) return;
    const t = x.t;
    const h = el('div', 'vc-try-h');
    h.appendChild(el('span', 'k', 'attempt ' + x.n));
    const when = t.at ? new Date(t.at) : null;
    if (when && !isNaN(when)) h.appendChild(el('span', null, when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
    if (t.zh) h.appendChild(el('span', null, '中文'));
    const vi = t.ver ? (m.card.versions || []).findIndex(v => v.id === t.ver) : -1;
    if (vi >= 0 && (m.card.versions || []).length > 1) h.appendChild(el('span', null, 'from prompt variant ' + (vi + 1)));
    b.appendChild(h);
    const shots = ctx.shots({ gens: [x.g] }, progs);
    if (shots) b.appendChild(shots);
  }
  // "attachments back to the zone" (the owner's answer 6): this message's attachments in the zone again, for the next
  // message - what is there now is replaced, after a question.
  function _backLink(m) {
    const back = el('button', 'vc-link', 'attachments back to the zone');
    back.type = 'button';
    back.title = 'Put this message\'s attachments into the zone again, for the next message';
    back.addEventListener('click', () => {
      const list = (m.media || []).filter(a => a && a.path);
      if (!list.length) return;
      const put = () => { ctx.useAtts(list); const ui = ctx.ui(); if (ui) ui.ta.focus(); };
      const n = ctx.atts().length;
      if (n) askDelete(back, 'Replace what is in the zone?', n + ' attachment' + (n === 1 ? ' is' : 's are') + ' there now - this message\'s ' + list.length + ' come in their place.', put);
      else put();
    });
    return back;
  }

  return {
    name: 'videos',
    kind: 'clip',
    ids: { root: 'mv3-vc', head: 'mv3-vc-head', headL: 'mv3-vc-headl', crumb: 'mv3-lib-vgen' },
    keys: { draft: 'mv3_vc_draft_v1', write: 'mv3_vc_write_v1' },
    maxAtts: MAX_ATTS,
    counts: [1, 2],
    noun: { one: 'picture', many: 'pictures' },
    busyWord: 'making the clip',
    // A first guess; each model learns its own pace from its first clips (startInlineProgress keeps an average per key).
    eta: 180000,
    progressKey: (g) => 'mv3-video-' + (g.model || ''),
    sendUrl: '/api/mv3/video/send',
    // A clip that lands is not put in the zone by itself: it is one press on it in the picker - "made in this project".
    landAsRef: false,
    text: {
      placeholder: 'Describe a clip, or say what to change.',
      empty: 'Describe a clip. What comes back stays in this project — and on the B-roll shelf.',
      emptyNoProject: 'Describe a clip. A project is started for it with the first message.',
      onlyFiles: 'Only pictures, clips and sounds can be attached here.',
      slot: 'From the Library or this computer',
      crumb: 'Back to the conversation about clips',
    },
    // (phase V13, the owner 2026-10-07) No right column: every "+" of the zone opens the picker on its place.
    pick: {
      sources: (kind) => SOURCES[kind] || [],
      start: _startFor,
      first: FIRST,
      why: _pickWhy,
      sourceOf: _sourceOf,
      // The shelf a file from this computer is filed on, and what the picker says of it.
      lands: { image: 'images', video: 'uploads', audio: 'sounds' },
      upWords: {
        image: 'A picture goes into Images, in this project\'s category.',
        video: 'A clip goes into Uploads, in this project\'s category.',
        audio: 'A sound goes onto the Sounds shelf, in this project\'s category.',
      },
      // A part window left open over the zone goes: the picker covers it.
      onOpen: () => closeTrim(),
    },
    // (phase V7) Each kind through its own door, filed under the project's category: pictures into Images, clips into
    // Uploads, sounds onto the Sounds shelf - and straight into their part of the zone.
    uploads: {
      image: { url: '/api/mv3/img/upload', field: 'image', accept: 'image/*', ok: (f) => /^image\//.test(f.type || ''),
               att: (i) => ({ path: i.imagePath, name: i.name }) },
      video: { url: '/api/mv3/video/upload', field: 'video', accept: 'video/*,.mov,.mkv,.m4v',
               ok: (f) => /^video\//.test(f.type || '') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name || ''),
               att: (i) => ({ path: i.videoPath, name: i.name, poster: i.thumbPath || '', dur: +i.duration || 0 }) },
      audio: { url: '/api/sounds/upload', field: 'sound', accept: 'audio/*,.opus',
               ok: (f) => /^audio\//.test(f.type || '') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i.test(f.name || ''),
               att: (i) => ({ path: i.audioPath, name: i.name, dur: +i.duration || 0 }) },
    },
    // (phase V7.3) Kling motion control's empty box sends its standard prompt.
    emptyText: () => (isMC() && !ctx.writing() && _table ? _table.standardPrompt || '' : ''),
    // (phase V16, the owner's answer 3) With the writer on, a message may be the attachments alone - and with frames,
    // which the writer writes even when it is off.
    emptyOk: () => ctx.atts().length > 0 && (ctx.writing() || _framesMode()),
    // (phase V16) The writer's message holds the attachments now: the zone is emptied for the next message.
    afterSend: (d) => { if (d && (d.review || d.storyboard || d.frame)) ctx.useAtts([]); },
    // (phase V7) Clips and sounds in the zone: the part that goes, and what the cell says of it.
    attState: _attState,
    onAttach: (a) => { _onAttach(a); },
    trimFor: _trimFor,
    onHide: () => { closeTrim(); closeHelp(); },
    // (phase V15, the owner 2026-10-07) The writer is a switch of the column, and the almanac stands at its foot.
    penInBar: false,
    columnFoot: () => [_almanacBtn()],
    // (phase V6) The builder's cards in the thread, drawn here; the request at the thread's foot.
    cardBubble: _cardBubble,
    cardSig: _cardSig,
    busy: _busy,
    onThread: (thread) => { _paintFoot(true); _freshenLive(thread); },
    resultPath: (g) => g.videoPath,

    settings: {
      load,
      paint: () => { paint(); _paintRecipe(); },
      onAtts: () => {
        if (_set) _paintParams();
        // (review V7) A clip taken off while its part window is open takes the window with it.
        if (_trimPath && !ctx.atts().some(a => a.path === _trimPath)) closeTrim();
      },
      onCount: _paintPrice,
      // The reference was open for the project being left - its field is another project's.
      onProject: () => { closeHelp(); if (_set) _paintParams(); },
      room: _room,
      zone: _zone,
      ready: _ready,
      body: _body,
      // The recipe in use goes with the draft, per project (phase V5) - and the zone is laid out by its slots.
      draftExtra: () => (_skill ? { skill: _skill } : null),
      draftLoad: (x) => {
        _skill = (x && x.skill && x.skill.text) ? x.skill : null;
        if (_skill && _skill.orig == null) _skill.orig = _skill.text;
        _wantRecipe = false;
        _cardEls = null;
        _paintRecipe();
        if (ctx.atts().some(a => a.slot === undefined)) ctx.reslot({ unplaced: true }); else ctx.paintAtts();
        _paintFoot();
        _dropGone();
      },
      // The storyboard is the writer's: its seat and its price follow the writer too (phase V15).
      onPen: () => { _paintRecipe(); _paintParams(); ctx.paintAtts(); },
    },

    // A finished clip in the thread: its poster - a press plays it, and it can be dragged onto a lane (phase V13: the
    // right column it used to be dragged from is gone) - and "to timeline" under it.
    shot(g, cell, open) {
      const box = el('div', 'mv3-vc-shot');
      const shape = (g.w && g.h) ? g.w + '/' + g.h : String((g.params || {}).aspect || '9:16').replace(':', '/');
      box.style.aspectRatio = shape;
      if (g.posterPath) {
        const img = document.createElement('img');
        img.className = 'mv3-ig-shot';
        img.src = '/api/thumb?src=' + encodeURIComponent(g.posterPath) + '&v=strip';
        img.alt = g.said || '';
        img.loading = 'lazy'; img.decoding = 'async';
        img.draggable = false;
        img.addEventListener('error', () => { img.remove(); }, { once: true });
        box.appendChild(img);
      }
      box.appendChild(el('span', 'mv3-ig-play', '▶'));
      if (g.duration) box.appendChild(el('span', 'mv3-ig-dur', (+g.duration).toFixed(1) + 's'));
      box.title = 'Play it · drag it onto a lane';
      box.addEventListener('click', open);
      const item = {
        clip: true, src: g.videoPath, thumb: g.posterPath || null, libId: g.birolId || '',
        name: String(g.said || g.prompt || '').slice(0, 60), dur: +g.duration || 0, group: 'videochat',
      };
      box.draggable = true;
      box.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.effectAllowed = 'copy';
        ev.dataTransfer.setData(Store.DRAG_TYPE, JSON.stringify(item));
        box.classList.add('is-dragging');
      });
      box.addEventListener('dragend', () => box.classList.remove('is-dragging'));
      cell.appendChild(box);
      const acts = el('div', 'mv3-ig-acts');
      const add = el('button', 'mv3-c-btn', 'to timeline');
      add.type = 'button';
      add.title = 'Puts it on the lane above main video, at the playhead, at its own length.';
      add.addEventListener('click', () => ctx.place(item, add));
      acts.append(add);
      cell.appendChild(acts);
    },

    facts: (g) => [
      ['model', (g.model || '') + ' · ' + (g.agg || '?') + ' · ' + (((g.params || {}).resolution) || '')],
      ['length', g.duration ? (+g.duration).toFixed(1) + ' s' + (g.w && g.h ? ' · ' + g.w + '×' + g.h : '') : ''],
      ['took', g.secs ? g.secs + 's' : ''],
      ['cost', g.credits ? g.credits + ' kie credits (≈' + money(g.credits * 0.005) + ')' : ''],
      ['references', (g.media || []).length ? String(g.media.length) : ''],
      // (phase V7.4) Where the model did not keep the clip's sound itself.
      ['sound', g.underlay === 'laid' ? 'the clip\'s sound, laid under it' : (g.underlay || '')],
      ['writer', g.fell && !/^sent in English/.test(g.fell) ? 'sent as typed - ' + g.fell : (g.writer || '')],
      ['language', g.lang === 'zh' ? 'sent in 中文' : /^sent in English/.test(g.fell || '') ? g.fell : ''],
      ['in 中文', g.lang === 'zh' ? (g.sent || '') : ''],
      ['sent as', (g.prompt && g.said && g.prompt !== g.said) ? g.prompt : ''],
    ],

    // Every clip this thread finished, played in the Library's viewer.
    view(done, at) {
      openViewer(done.map(x => ({ id: x.id, kind: 'birols', media: x.videoPath, thumb: x.posterPath || x.videoPath,
        name: x.said || x.prompt || '', meta: { date: x.at } })), at);
    },

    headButtons: () => [],
    // ONE catalog, right beside "/ generate video" (the owner, 2026-10-06); with a recipe in use it opens on it.
    crumbButtons: () => {
      const b = el('button', 'mv3-c-btn mv3-vc-cat', 'catalog');
      b.type = 'button';
      b.title = 'Recipes for this model: the cookbook\'s templates and cases, Grok\'s examples, your presets';
      b.addEventListener('click', (ev) => { ev.stopPropagation(); _openCat(); });
      return [b];
    },
  };
}

const CHAT = createChat(VIDEOS);

/** Every way in: the generate menu, the lane's right-click, ?open=videos, Alerts. */
export const openVideos = () => CHAT.open();

export function initVidChat() { CHAT.init(); }
