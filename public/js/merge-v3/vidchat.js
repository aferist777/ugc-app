/* ════════════════════════════════════════════════════════════════════════════
   MERGE — making clips, as a conversation, in a window (phase V3, docs/local-app/PLAN.md "Фаза V").

   The pictures chat's shell (chat-shell.js) with its own description: its own window (chat-window.js), column and
   box, its own conversation (kind 'clip'). The server is phase V2
   (routes/mv3-video.js): a press writes the turn, a record and an Alerts row for each clip asked for, and the
   work - the writer, the references hosted, the aggregator asked, the clip fetched and filed as a B-roll in its
   model's folder (VIDEO -> Generated -> <model>) - goes on behind it.

   What is this chat's own (the owner, 2026-10-05):
   - ONE dropdown of every model, each its own line with its price; the chosen model shows ITS OWN parameters
     (duration, quality, shape, sound, Grok's mode, how Seedance reads the pictures, Kling's orientation) and the
     price of this send; the aggregator beside it with its own rate - the cheapest with a working key by default.
   - A line under the model's dropdown says what the chosen model does and what to attach.
   - Kling motion control's VIDEO has no writer - Kling gets its own prompt. With the writer off the box IS that prompt
     (empty: the standard one); with it on the box says what to take from which picture, and the first frame is drawn
     before the video (phase V17).
   - (phase V13, the owner 2026-10-07) Every "+" of the attachment zone opens the picker on its place (chat-pick.js) - the
     Library's shelves of that kind and this computer. A clip that lands is not put in the zone by itself - it is one press
     on it there, under "made in this project".
   - (phase V60.2, the owner 2026-10-29, (вч1б)-(вч5а)) A RIGHT COLUMN again, the pictures chat's folder column
     (js/folder-column.js): "this project" - the clips made here - first, then REFERENCES, IMAGES, VIDEO and AUDIO; a press
     puts a picture, a clip or a sound into its part of the zone. VIDEO is not there while the model takes no clips (and
     AUDIO while it takes no sounds), and a clip longer than the model takes is not shown (V57's rule of the window).
   - (phase V7) Clips and sounds are references too: from this project's clips, B-roll, Uploads, the Sounds shelf, this
     computer or a lane of the timeline; each goes as the PART of it the person chose (vtrim.js), the first seconds
     the model takes by default, and the price follows that part.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './chat-owner.js';
import { openViewer } from '../library/viewer.js';
import { createChat, el, money, json, stored, keep, thumbOf, refCell, ratioOf, refuseHome, switchRow } from './chat-shell.js';
import { chatWindow } from './chat-window.js';
import * as Src from './chat-sources.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';
import { openTrim, closeTrim } from './vtrim.js';
import { openCatalog } from './vcatalog.js';
import { openHelp, closeHelp } from './vhelp.js';
import { stepCard } from './vsteps.js';
import { note, askDelete } from './ask.js';
// (phase V73 block 2, step 2b) The model table being read or not read - the shared parts (a row of the column); the reason a popup.
import { emptyEl, loadingEl, failedEl, cap as capFirst } from '../ui-state.js';
import { showError } from '../notice.js';
import { startInlineProgress } from '../progress.js';
import { wire as wireRange } from '../ui-range.js';
import { backButton } from './tl-gen.js';

const LS_LAST = 'mv3_vc_last_v1';         // { model, agg: { <model>: agg }, params: { <model>: {...} } }
const SHOW_ATTS = 9;                       // the old row's places at most (the zone grows instead - phase V6)
const MAX_PICS = 30;                       // pictures at most, whatever a model says (Seedance 2.5 takes 30)
const MAX_ATTS = 50;                       // everything attached at most - pictures, clips and sounds

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// (phase V77) The description's way in from outside (openVideos with a thing from the timeline) - set when it is made.
let _api = null;

function VIDEOS(ctx) {
  let _table = null;
  let _err = '';
  let _set = null;
  const _last = stored(LS_LAST, {});
  _last.agg = _last.agg || {};
  _last.params = _last.params || {};
  const _remember = () => keep(LS_LAST, _last);
  // (phase V29, the owner 2026-10-14) The 中文 box went: a remembered tick of it goes too.
  if (Object.values(_last.params).some(p => p && 'zh' in p)) {
    for (const p of Object.values(_last.params)) if (p) delete p.zh;
    _remember();
  }

  const models = () => (_table ? _table.models : []);
  const model = () => models().find(m => m.id === (_set && _set.model.value)) || models().find(m => m.usable) || models()[0] || null;
  const recOf = (m, agg) => (m ? (m.records.find(r => r.agg === agg) || null) : null);
  function rec() {
    const m = model();
    if (!m) return null;
    return recOf(m, _set && _set.agg.value) || recOf(m, _last.agg[m.id]) || recOf(m, m.defaultAgg) || m.records[0];
  }
  const params = () => { const m = model(); return (m && _last.params[m.id]) || {}; };
  // (phase V10.2) Seedance's sound beside a clip: 'clip' (the default - laid under), 'on' (its own) or 'off'.
  const _clipSoundOf = (p) => (['clip', 'on', 'off'].includes(p.clipSound) ? p.clipSound : 'clip');
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
      // (phase V47) The only clip is the video's length: 4 s at least (lib/video-models.js byClip).
      const alone = !!r.oneClip && !ctx.atts().some(x => x !== a && x.path !== a.path && _kind(x) === 'video');
      if (alone) {
        const least = Math.max(lo, r.oneClip.least || 4);
        return { min: least, max: Math.min(hi, all), all,
          why: m.label + ' makes the video as long as its clip: ' + least + '-' + hi + ' s' + (r.agg === 'kie' ? ' - kie bills its seconds too.' : '.') };
      }
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
  // (phase V60.2) What the right column offers: everything until the models are read.
  const _colTakes = (k) => !_table || _takes(k);
  // (phase V47, the owner 2026-10-24/25) ONE clip decides Seedance's length and shape (lib/video-models.js byClip): the
  // column's rows show the clip's and are not sent - 2.5 on kie makes the clip's own seconds, the others its seconds
  // rounded. With several clips the column's length and shape go. `media`: a card's own attachments, else the zone.
  function _byClip(r, media) {
    if (!r || !r.oneClip) return null;
    const cl = media ? media.filter(x => x && x.kind === 'video') : (_takes('video') ? _clips() : []);
    return cl.length === 1 ? cl[0] : null;
  }
  // How long the video made beside that clip is (0 while its part is not known).
  const _clipOut = (r, a) => { const s = _span(a); return !(s > 0) ? 0 : r.oneClip.auto ? s : clamp(Math.round(s), r.duration.min, r.duration.max); };
  // The seconds a price is made of, in words.
  const _secsWords = (pr) => (pr.byClip ? _s(pr.out) + ' (as long as the clip)' + (pr.vidIn ? ' + ' + _s(pr.vidIn) + ' of the clip' : '')
    : pr.vidIn ? pr.out + ' s + ' + _s(pr.vidIn) + ' of the clips' : pr.secs + ' s');

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
      // (phase V10.2) kie bills Kling by the whole seconds that come back, rounded down.
      const secs = !vidIn ? 0 : r.billWhole ? Math.max(1, Math.floor(Math.min(vidIn, cap) + 0.001)) : Math.min(vidIn, cap);
      return { per, res, fromClip: true, whole: !!r.billWhole, secs, usd: secs ? per * secs : null };
    }
    // (phase V47) One Seedance clip: the video is as long as the clip - kie bills the clip's seconds and the video's.
    const one = r.oneClip && clips.length === 1 ? clips[0] : null;
    if (one && _span(one) > 0) {
      const out1 = _clipOut(r, one);
      const in1 = r.agg === 'kie' ? vidIn : 0;
      return { per, res, secs: out1 + in1, out: out1, vidIn: in1, usd: per * (out1 + in1), byClip: true };
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
    if (d && d.success) { _table = d; _err = ''; }
    else {
      _err = (d && d.error) || 'could not read the models';
      showError(capFirst(_err));
    }
    paint();
    ctx.paintAtts();
  }

  function _row(host, label, ctl, cls) {
    const r = el('div', 'mv3-ig-row' + (cls ? ' ' + cls : ''));
    if (ctl.tagName === 'SELECT') ctl.classList.add('u-in', 'is-s');   // (phase V73 block 2) the shared field at 24, (2a-3) б
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
      // (phase V73 block 2, (б2-18)) Not read: "did not load" with Try again - the reason was the popup (load). A table with no
      // model says so rather than "reading" for ever.
      host.appendChild(_err ? failedEl('The models', () => { _err = ''; paint(); load(); }, { line: true })
        : _table ? emptyEl('No video models.', { line: true }) : loadingEl('reading the models…', { line: true }));
      _set = null;
      ctx.banner('');
      return;
    }
    if (!_set) {
      host.textContent = '';
      const mSel = _select('mv3-vc-model', 'The model - each its own price', models().map(m => ({
        value: m.id, text: _modelLine(m), disabled: !m.usable, title: m.why,
      })), _last.model, (v) => { _last.model = v; _recipeParams(v); _recent(v); _remember(); _paintModel(); ctx.paintAtts(); });
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
      // (phase V15) The writer and the storyboard - the switches of how the message goes (中文 went in phase V29).
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

  // The switches (phase V15, the owner 2026-10-07): the writer - it was the pen in the bar - and the storyboard. The 中文
  // box beside them went in phase V29 (the owner 2026-10-14): every prompt goes in English.
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
    // (phase V16, the owner) The writer is a checkbox like the storyboard - on by default.
    // (phase V73 block 4) the shared switch (.u-switch), its word beside it
    const wr = switchRow('Writer', ctx.writing(), held, (v) => ctx.setWriting(v));
    if (held) wr.classList.add('is-held');
    // (phase V17) Under Kling motion control the writer writes the first frame's picture prompt.
    wr.title = held ? 'The storyboard is written by the writer - untick the storyboard first'
      : isMC() ? 'On: the writer reads your pictures and the still of the clip and writes the first frame\'s prompt - you see the prompt, then the picture, then the video, each paid step by its own press. Off: one picture and the clip go straight to Kling.'
        : 'The writer - a prompt engineer - writes the prompt this model wants from your message and attachments. Off: your words go as typed (translated into English when they are not).';
    box.appendChild(wr);
    const sb = switchRow('Storyboard', !bWhy && _boardOn(), !!bWhy, (v) => {
      setParam('storyboard', v);
      if (v && !ctx.writing()) ctx.setWriting(true);
      _paintSwitches();
      _paintPrice();
      ctx.paintAtts();
    });
    if (bWhy) sb.classList.add('is-off');
    sb.title = bWhy || 'A storyboard first: the writer turns your message and pictures into the prompt of a sheet of numbered panels - nothing is paid at ">". On its message "draw the storyboard" draws the sheet (4K), "write the video" writes the video with it among the pictures and "make the video" makes it - each paid step by its own press. While it is ticked the writer stays on.';
    box.appendChild(sb);
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
    // (phase V47) One clip: the length and the shape are the clip's - shown, not chosen; several: chosen here.
    const one = _byClip(r);
    if (!r.duration.fromClip && one) {
      const out = _clipOut(r, one);
      const sel = _select('mv3-vc-dur', '', [{ value: 'clip', text: 'As the clip' + (out ? ' · ' + _s(out) : '') }], 'clip');
      sel.disabled = true;
      sel.title = 'With one clip ' + m.label + ' makes the video as long as the clip' + (r.oneClip.auto ? '' : ', rounded to a whole second')
        + '. With several clips the length is chosen here.';
      _row(box, 'length', sel);
    } else if (!r.duration.fromClip) {
      const opts = [];
      for (let s = r.duration.min; s <= r.duration.max; s++) opts.push({ value: String(s), text: s + ' s' });
      _row(box, 'length', _select('mv3-vc-dur', 'How long the clip is', opts, clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max),
        (v) => { setParam('duration', +v); _paintPrice(); }));
    }
    _row(box, 'quality', _select('mv3-vc-res', 'Resolution', r.resolutions.map(x => ({ value: x, text: x })),
      r.resolutions.includes(p.resolution) ? p.resolution : r.resDef, (v) => {
        setParam('resolution', v);
        _paintPrice();
        // (phase V10.2) The zone's places can change with it (Grok 1.5 on kie: one picture at 1080p).
        if (r.limits.imagesAt) ctx.paintAtts();
      }));
    // The shape: with a picture Grok takes the picture's (Grok 1.5 on kie: with one - several are references, and the
    // shape is chosen again), and Seedance's frames take theirs.
    if (r.aspects && r.aspects.length && one) {
      const sel = _select('mv3-vc-ar', '', [{ value: 'clip', text: 'As the clip' }], 'clip');
      sel.disabled = true;
      sel.title = 'With one clip the video takes the clip\'s shape. With several clips the shape is chosen here.';
      _row(box, 'shape', sel);
    } else if (r.aspects && r.aspects.length) {
      const fmt = (Store.timeline() || {}).format || '9:16';
      // Frames on their own make the clip in their shape; beside a clip or a sound they go as references.
      const fixed = n > 0 && ((fam === 'grok' && !(r.aspectWithImages && n > 1)) || (fam === 'seedance' && _framesMode() && !mixed));
      const sel = _select('mv3-vc-ar', 'Shape', r.aspects.map(a => ({ value: a, text: a + (a === fmt ? ' •' : '') })),
        r.aspects.includes(p.aspect) ? p.aspect : (r.aspects.includes(fmt) ? fmt : r.aspects[0]), (v) => { setParam('aspect', v); _freshenCards(); });
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
      // (phase V10.2, the owner 2026-10-10) With a clip the clip's sound is the DEFAULT: Seedance with its own sound beside a
      // reference clip said the clip's words over again (V10.1 No 6). The choice beside a clip is remembered on its own
      // (`clipSound`), so "with sound" chosen for words alone does not turn it back.
      const withClip = _takes('video') && _clips().length > 0;
      const opts = [{ value: 'on', text: withClip ? 'the model\'s sound' : 'with sound' }];
      if (withClip) opts.push({ value: 'clip', text: 'The clip\'s sound' });
      opts.push({ value: 'off', text: 'Silent' });
      const now = withClip ? _clipSoundOf(p) : (p.audio !== false ? 'on' : 'off');
      const sel = _select('mv3-vc-audio', withClip ? 'With a clip, the first clip\'s sound is laid under the video when it lands - Seedance\'s own sound would say the clip\'s words over again' : 'Seedance makes its own sound',
        opts, now, (v) => { if (withClip) setParam('clipSound', v); else setParam('audio', v === 'on'); });
      _row(box, 'sound', sel);
      if (!_skill) {
        // (phase V16) Chosen first, even before a picture: the zone lays out the frames' places for it.
        _row(box, 'pictures are', _select('mv3-vc-as', 'What the pictures are for: references the video uses, or the frame it starts on (and the one it ends on)', [
          { value: 'refs', text: 'References' },
          { value: 'frame', text: 'The first frame' },
          { value: 'fl', text: 'First and last frames' },
        ], _asOf(), (v) => { setParam('picturesAs', v); ctx.reslot(); _paintParams(); }));
      }
    }
    if (fam === 'kmc') {
      _row(box, 'orientation', _select('mv3-vc-or', 'Which way the character faces', [
        { value: 'video', text: 'As in the clip (up to 30 s)' }, { value: 'image', text: 'As on the picture (up to 10 s)' },
      ], p.orientation || 'video', (v) => { setParam('orientation', v); ctx.paintAtts(); ctx.columnChanged(); }));
      // (phase V10.2) Whose background: the picture's, always - Kling puts the moves into the picture's place (V10.1 No 11,
      // 12; kie's "keep the clip's room" for 3.0 came back on the picture's background too). Said, not chosen.
      const bg = _select('mv3-vc-bg', 'Kling puts the moves into your picture\'s place - the room of the clip does not come along. For another place, keep the writer on: it draws the first frame with your character there.',
        [{ value: 'image', text: 'From your picture' }], 'image', () => {});
      bg.disabled = true;
      _row(box, 'background', bg);
      // The clip's sound: Replicate's Kling keeps it itself; on kie it is laid under the video when it lands (V7.4).
      _row(box, 'sound', _select('mv3-vc-keep', r.keepSound ? 'The clip\'s own sound - Kling keeps it' : 'The clip\'s own sound - laid under the video when it lands',
        [{ value: 'on', text: 'Keep the clip\'s sound' }, { value: 'off', text: 'Silent' }],
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
    // (phase V60.2) The right column follows the model: its VIDEO and AUDIO, the longest clip it shows.
    ctx.columnChanged();
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
      box.innerHTML = '<b>≈' + money(pr.usd) + '</b><span>per clip · ' + _secsWords(pr)
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
    if (ctx.priceFrom) ctx.priceFrom(box);
    const notes = [];
    if (r && r.priceNote) notes.push(r.priceNote);
    if (r && r.duration.fromClip) notes.push(r.billWhole ? 'the most it costs: billed by the whole seconds that come back, rounded down' : 'the most it costs: billed by the seconds that come back');
    else if (pr && pr.vidIn && r.agg === 'kie') notes.push('the most it costs: kie.ai has billed a second less');
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
    box.appendChild(el('span', 'k', 'Recipe'));
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
    const x = el('button', 'x u-btn is-s is-icon is-quiet is-del u-x', '');
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

  // (phase V77) The models used, newest first - the one to go back to when the chosen one cannot take what the timeline gives.
  function _recent(id) {
    if (!id) return;
    _last.recent = [id].concat((_last.recent || []).filter(x => x !== id)).slice(0, 8);
  }
  function _useModel(id) {
    _last.model = id;
    _recipeParams(id);
    _recent(id);
    _remember();
    if (_set) { _set.model.value = id; _paintModel(); }
  }
  // Whether a model takes what came from the timeline: a clip as a reference, or a picture as the clip's FIRST FRAME - Grok
  // starts on one picture by itself, Seedance once its pictures are frames; Kling motion control's picture is the character it
  // moves, never a first frame.
  function _takesFrom(mm, kind, as) {
    if (!mm || !mm.usable) return false;
    const r = recOf(mm, _last.agg[mm.id]) || recOf(mm, mm.defaultAgg) || mm.records[0];
    const L = (r && r.limits) || {};
    if (kind === 'video') return L.videos > 0;
    if (!(L.images > 0)) return false;
    return as !== 'first' || (mm.family !== 'kmc' && (r.modes || []).includes('i2v'));
  }

  // (phase V77, the owner's (тч6)-(тч8а)) A THING FROM THE TIMELINE (js/merge-v3/tl-gen.js): the zone emptied - the thread and the
  // words in the box stay -, the thing in its place, a model that takes it (the chosen one, else the last one used that does,
  // else Seedance 2.5), Seedance's pictures as the first frame for a first frame, a recipe in use let go; then the page's word
  // at the end of the thread - what came in, what was changed and where to change it back (the owner's (тч7)).
  async function fromTimeline(o) {
    const a = (o && o.attach) || {};
    if (!a.path) return;
    await load();
    if (!_table || !models().length) return;
    const kind = a.kind === 'video' ? 'video' : 'image';
    const was = model();
    let switched = '';
    if (!_takesFrom(was, kind, o.as)) {
      const byId = (id) => models().find(x => x.id === id);
      const fits = (mm) => _takesFrom(mm, kind, o.as);
      const want = (_last.recent || []).map(byId).find(fits) || [byId('sd25')].find(fits) || models().find(fits);
      if (want) { switched = was ? was.label : ''; _useModel(want.id); }
    }
    const hadRecipe = !!_skill;
    if (_skill) { _skill = null; _wantRecipe = false; _cardEls = null; ctx.saveDraft(); _paintRecipe(); _paintFoot(); }
    const m = model();
    const seed = !!m && m.family === 'seedance';
    const first = kind === 'image' && o.as === 'first';
    if (first && seed && _asOf() !== 'frame') { setParam('picturesAs', 'frame'); _paintParams(); }
    // Beside a clip Seedance's pictures are references: its frames' places would wait empty and hold the send.
    if (kind === 'video' && seed && _framesMode()) { setParam('picturesAs', 'refs'); _paintParams(); }
    ctx.useAtts([]);
    if (kind === 'video') ctx.attach(a.path, a.name || '', { kind: 'video', poster: a.poster || '', dur: +a.dur || 0, in: a.in, out: a.out });
    else ctx.attach(a.path, a.name || '', first && seed ? { slot: 'first' } : {});
    const lines = [];
    // (phase V78) From the Library too (js/gen-menu.js) - its words say where it came from.
    const lib = o.from === 'library';
    const src = lib ? 'the Library' : 'the timeline';
    if (kind === 'video') lines.push(lib ? 'The clip from the Library is a REFERENCE: its first seconds the model takes go.'
      : 'The clip from the timeline is a REFERENCE: the part the timeline plays, ' + _s(+a.in || 0) + ' - ' + _s(+a.out || 0) + ' of its file.');
    else if (o.act === 'continue') lines.push('The last frame of the clip ' + (lib ? 'from the Library' : 'on the timeline') + ' is the FIRST FRAME - the new clip starts on it.');
    else if (first) lines.push('The ' + (o.act === 'frame-vid' ? 'frame' : 'picture') + ' from ' + src + ' is the FIRST FRAME - the clip starts on it.');
    else lines.push('The picture from ' + src + ' is in the zone.');
    if (!m || !_takesFrom(m, kind, o.as)) lines.push('No model here takes it - a key is set on Admin → API keys.');
    else if (switched) lines.push(switched + (kind === 'video' ? ' takes no clips' : ' does not start a clip on a picture') + ' - the model is ' + m.label + ' now.');
    if (hadRecipe) lines.push('The recipe in use was let go.');
    if (first && seed) lines.push('To send it as a reference instead, set "pictures are" on the left to References; the model and its settings are on the left too.');
    else if (kind === 'video') lines.push('Its part is set on it in the zone; the model and its settings are on the left.');
    else lines.push('The model and its settings are on the left.');
    if (o.back) lines.push('When the clip is made, "' + o.back + '" under it puts it on the timeline.');
    else if (lib && m) lines.push('What it makes lies in VIDEO → Generated → ' + m.label + '.');
    ctx.notice(lines.join('\n'));
    const ui = ctx.ui();
    if (ui) ui.ta.focus();
  }
  _api = { fromTimeline };

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
  // (phase V10.2) Fewer at some resolutions - Grok 1.5 on kie takes one picture at 1080p.
  const _imgCap = (r) => {
    const at = r && r.limits.imagesAt ? r.limits.imagesAt[params().resolution || r.resDef] : null;
    return at != null ? Math.min(at, r.limits.images || 0) : ((r && r.limits.images) || 0);
  };
  const _picRoom = (r) => {
    if (_mcSteps()) return _frameRoom();
    const n = Math.max(0, _imgCap(r) - _seat());
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
  // (phase V26.5) The pictures' loaders are shared with the frames chat (chat-sources.js).
  const _gone = Src.gone;
  const _shape = Src.shape;
  const _clip = (path, poster, name, x) => Object.assign({ path, src: path, poster: poster || '', name: name || '',
    thumb: poster ? thumbOf(poster, 'strip') : '' }, x || {});
  // The clips this chat made in this project.
  async function _made() {
    const k = ctx.key();
    if (!k) return { items: [], why: 'No project is open yet - nothing has been made in it.' };
    const d = await json('/api/mv3/video/feed?project=' + encodeURIComponent(k));
    if (!d || !d.success) return _gone(d);
    return { items: (d.items || []).filter(g => g && g.state === 'done' && g.videoPath).map(g => _clip(g.videoPath, g.posterPath,
      String(g.said || g.prompt || '').slice(0, 80), { aspect: _shape(g.w, g.h) || (g.params || {}).aspect || '', dur: +g.duration || 0 })) };
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
  // (phase V55, (гн2)) What is not a folder, as rows above the window's tree; the rest - REFERENCES, IMAGES, VIDEO,
  // AUDIO - is the media tree itself (chat-sources.js TREE).
  const SOURCES = {
    image: [Src.PEOPLE_ROW],
    // (phase V78, the owner 2026-11-07: one "this project") With THIS PROJECT in the window's tree the row goes - its clips lie
    // in THIS PROJECT's top (js/merge-v3/chat-pick.js _madeIntoProject).
    video: [{ id: 'made', label: 'Made in this project', load: _made, empty: 'No clips made in this project yet.', unless: 'plinks' }],
    audio: [{ id: 'voices', label: 'Voices', load: _voices, empty: 'No saved voices yet - they are kept on the Library\'s Voices shelf.' }],
  };
  // Where the window opens: a recipe's slot of pictures by what it is for (the owner) - a person on the characters and
  // looks, a place on Environments, clothes on Lookbooks, anything else on IMAGES; else ('') where this kind was last
  // taken from - the window remembers -, the first time the tree's own (chat-sources.js TREE fallback).
  function _startFor(kind, s) {
    if (kind !== 'image' || !s || !s.key) return '';
    return Src.pictureStart(s.role);
  }
  // (phase V15) Where a thing in the zone is - the rows that may hold it; the window finds the rest in the tree itself.
  function _sourceOf(path, kind) {
    const at = (dir) => String(path || '').startsWith('/media/' + dir + '/');
    if (kind === 'image') return Src.pictureSourceOf(path);
    if (kind === 'video') return at('birols') ? ['made'] : [];
    return at('voice') ? ['voices'] : [];
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
    const b = el('button', 'mv3-vc-almanac u-btn is-l', 'Almanac');
    b.type = 'button';
    b.title = 'The prompt reference - camera moves and more: press a tip to copy it, then paste it into your prompt';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); openHelp({ anchor: b, field: _fieldForHelp, note: _helpNote }); });
    return b;
  }

  // What cannot go into the zone at all, said on its tile: a clip or a sound shorter than the model takes (one longer
  // goes, and only its part is sent).
  // (phase V57, the owner's (ок1)) The longest clip the chosen model takes - Seedance one clip of 2-15 s (2.5: 2-30), Kling
  // motion control 3-30 s of the moves (10 s while the character keeps the picture's orientation), lib/video-models.js's
  // limits as the matrix gives them: the attachment window shows no clip longer, and counts none in its folders. A clip
  // whose length is not known yet is shown (its cell says so when it is attached).
  function _clipFit() {
    const r = rec(), m = model();
    const L = (r && r.limits) || {};
    if (!r || !m || !(L.videos > 0)) return {};
    const cap = m.family === 'kmc'
      ? (params().orientation === 'image' ? (L.videoSecsImage || 10) : (L.videoSecs || 30))
      : ((L.clipSecs || [2, 15])[1] || 15);
    return {
      fit: (x) => !(+(x && x.dur) > 0) || +x.dur <= cap + 0.05,
      note: 'clips up to ' + cap + ' s - ' + m.label + ' takes no longer',
    };
  }

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
          : m.label + ' on ' + r.aggLabel + ' takes ' + _imgCap(r) + (_imgCap(r) < (L.images || 0) ? ' at ' + (params().resolution || r.resDef) : '') + '.'];
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
    // while a clip goes with it. (phase V10.2) Beside a clip that is the default, and the choice there is its own.
    const withClip = fam === 'seedance'
      && (cardMedia ? cardMedia.some(a => a && a.kind === 'video') : atts.some(a => _kind(a) === 'video'));
    const besideClip = withClip ? _clipSoundOf(p) : '';
    const clipSound = besideClip === 'clip';
    // (phase V47) One clip: the length the record shows is the clip's (the server sends the clip's, whatever comes here).
    const one = _byClip(r, cardMedia || atts.map(a => ({ kind: _kind(a), in: a.in, out: a.out })));
    const oneSecs = one && _span(one) > 0 ? clamp(Math.round(_span(one)), r.duration.min, r.duration.max) : 0;
    return {
      model: m.id, agg: r.agg,
      // (phase V15) The column's storyboard: the sheet is written and drawn, and it stops there.
      storyboard: boarding || undefined,
      // (phase V16, the owner) The writer stops for a look: its prompt comes back as a message of its own, and the video is
      // made from there - "make the video". Under Kling motion control the writer writes the first frame instead (V17).
      review: !boarding && ctx.writing() && !isMC() ? true : undefined,
      params: {
        duration: r.duration.fromClip ? undefined : oneSecs || clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max),
        resolution: r.resolutions.includes(p.resolution) ? p.resolution : r.resDef,
        aspect: (r.aspects || []).includes(p.aspect) ? p.aspect : ((r.aspects || []).includes(fmt) ? fmt : (r.aspects || [])[0]),
        audio: besideClip ? besideClip === 'on' : p.audio !== false, sound: clipSound ? 'clip' : '',
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
    // (phase V47) One Seedance clip: the clip's length and shape.
    const one = _byClip(r);
    if (one) return 'as long as the clip' + (_clipOut(r, one) ? ' (' + _s(_clipOut(r, one)) + ')' : '') + ', in the clip\'s shape.';
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
  // (phase V64 block 4) Merge's project with the chat open - or the Library, from its unbound chat (chat-owner.js).
  const _where = (key) => Store.whereOf(key, 'videos');
  const _post = (url, body, method) => json(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // This recipe's prompt cards in the thread. The request stands at the foot only while there is none - or when
  // "change the values" asks for it: brought back by itself under a made card, it read as the recipe said twice (the
  // owner, 2026-10-06). The card itself is the step that comes next.
  const _recipeCards = () => (_skill ? ctx.thread().filter(m => m.card && m.card.type === 'prompt' && m.card.recipe && m.card.recipe.id === _skill.id) : []);
  // "change the values": the request again, under the card that waits.
  function _changeLink() {
    const change = el('button', 'vc-link', 'Change the values');
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
    h.append(el('span', 'k', 'Recipe'), el('span', 't', _skill.title));
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
      const fold = el('button', 'vc-fold', 'The whole recipe ▸');
      fold.type = 'button';
      bodyTa = document.createElement('textarea');
      bodyTa.className = 'vc-req-body u-area';
      bodyTa.hidden = true;
      bodyTa.spellcheck = false;
      bodyTa.value = body;
      back = el('button', 'vc-link vc-back', 'Back to the original');
      back.type = 'button';
      back.hidden = !_edited(_skill);
      const grow = () => { bodyTa.style.height = 'auto'; bodyTa.style.height = Math.min(520, bodyTa.scrollHeight + 2) + 'px'; };
      fold.addEventListener('click', () => {
        bodyTa.hidden = !bodyTa.hidden;
        fold.textContent = bodyTa.hidden ? 'The whole recipe ▸' : 'The whole recipe ▾';
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
    const go = el('button', 'mv3-c-btn vc-go u-btn is-s', _skill.twoStep ? 'write the prompts' : 'write the prompt');
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
    // (phase V48) A Seedance card shows its steps from the moment its clips begin to be watched.
    const has = B.kind === 'frame' ? (B.versions || []).length || B.prompt
      : (c.versions || []).length || c.prompt || (B.versions || []).length || B.prompt || (c.watch || []).length;
    return [c.type, c.plain ? 'plain' : c.board ? (B.kind || 'two') : 'one', has ? 'v' : (c.state || '') + ':' + (c.error || '')].join(':');
  };
  const _busy = (thread) => thread.some(m => (m.card && (m.card.type === 'prompt' || m.card.type === 'board') && m.card.state === 'writing')
    || (m.boards || []).some(g => g.state === 'pending'));

  // (phase V16, the owner 2026-10-07) Every working message is a SUB-PROJECT (vsteps.js): its steps paged at its top - the
  // chat does not grow with every attempt. (phase V60.2, the owner 2026-10-29) Two steps at most, the video at the head of
  // the message: the plain chat's and a one-step recipe's - "clip watched" (Seedance with clips) and "prompt"; the column's
  // storyboard and a two-step recipe - "storyboard" (the clips' descriptions, its prompt and its sheet) and "video prompt";
  // Kling's first frame (V17) - "first frame prompt" and "first frame". Every prompt folded into one line.
  function _cardBubble(m, progs) {
    const c = m.card;
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
    if (l && l.vid) l.vid.destroy();
    _live.delete(id);
  }
  function _freshenOne(id, l) {
    if (l.story) _freshenStory(id, l);
    else _freshenReview(id, l);
    // (phase V60.2) Its video field: before any clip it takes the shape the column would make it.
    _paintVid(l);
  }

  // Whether a card can go to the model chosen now - the card's own attachments are the server's to check.
  function _readyFor(m) {
    if (!_table) return ['No video models.', _err || 'reading the models…'];
    const mm = model(), r = rec();
    if (!mm || !mm.usable) return ['Not available now.', (mm && mm.why) || 'no model can be asked'];
    if (!r || !r.usable) return [(r ? r.aggLabel : 'That aggregator') + ' cannot be asked.', (r && r.why) || ''];
    // A two-step card always sends a picture - its storyboard (review V8).
    // (phase V23) A card whose character or place is not in this library any more: what is missing, before the press.
    const gone = (m.media || []).filter(a => a && a.gone);
    if (gone.length) {
      const what = gone.map(a => a.label ? '«' + a.label + '»' : (a.kind === 'video' ? 'a clip' : a.kind === 'audio' ? 'a sound' : 'a picture')).join(', ');
      return ['Not in this library.', what + (gone.length === 1 ? ' is' : ' are') + ' not here - it stayed in the library this chat came from. Send it again with another in its place.'];
    }
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
      // (phase V48) A description being corrected is saved first: the writer writes from it as it stands.
      await _flushWatch(m.id);
      const b = _body(m.media || []);
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/rewrite', { project: m.project, model: b.model, agg: b.agg, params: b.params });
      if (!d || !d.success) { note(btn, 'Not written.', (d && d.error) || 'the server did not answer'); return; }
      await ctx.reload(true);
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }
  // ── What the agent saw (phase V48, the owner 2026-10-25; кл5) ──
  // Seedance's clips are WATCHED whole before its writer writes (routes/mv3-video.js _watchFor): the first step of the
  // message, one description per clip - "clip not watched" where no model could, the writer then seeing three frames.
  // A description is the person's to correct - who is who, what happens - and "write it again" writes the prompt from
  // it as it stands; it is kept on the card, never watched (and paid) again for the same part. Read-only while the
  // prompt is being written from it.
  const _watchSaves = new Map();     // message id -> Map(clip number -> save())
  async function _flushWatch(id) {
    const saves = _watchSaves.get(id);
    if (!saves) return;
    await Promise.all([...saves.values()].map(f => f()));
  }
  const _watchBusy = (c) => (c.watch || []).some(w => w && (w.state === 'watching' || w.state === 'waiting'));
  const _clipT = (v) => { const x = Math.max(0, +v || 0); const mm = Math.floor(x / 60); return mm + ':' + (x - mm * 60).toFixed(1).padStart(4, '0'); };
  // The step, or null when the message watched nothing. `written` - whether a prompt of it has been written.
  function _watchStep(m, l, written) {
    const c = m.card;
    const list = (c.watch || []).filter(Boolean);
    if (!list.length) return null;
    const failed = !written && c.state === 'failed';
    const tail = '|' + (c.state === 'writing' ? 'w' : 'r') + '|' + (failed ? c.error || 'x' : '');
    // (phase V60.3, the owner's (вс6а)) One clip's description at a time, as a field down to the bottom of the video: each clip
    // is a variant of the step - "‹ 1 of 2 ›" in its title line.
    const variants = list.map(w => ({ key: 'c' + w.n, sig: w.n + ':' + w.state + ':' + (w.why ? 1 : 0) + tail, w }));
    return {
      key: 'watch', title: list.length > 1 ? 'clips watched' : 'clip watched', word: 'clip', variants, pick: variants[0].key,
      note: (x) => (!x ? '' : x.w.state === 'done' ? 'what the agent saw in it' : x.w.state === 'failed' ? 'not watched' : x.w.state),
      body: (x, b, progs, nav) => _watchBody(l.m, b, progs, failed, x ? { w: x.w, nav } : null),
      acts: (x, a) => _watchActs(l.m, a),
    };
  }
  // The clips' descriptions: `one` - { w, nav } - the one shown as a field (the step "clip watched"); without it every clip folded
  // into one line (the storyboard's step, (вс7а)).
  function _watchBody(m, b, progs, failed, one) {
    const c = m.card;
    const list = (c.watch || []).filter(Boolean);
    const clips = (m.media || []).filter(a => a && a.kind === 'video');
    const locked = c.state === 'writing';
    // Kept across the step's redraws: a description paged away from is written by its own pending save.
    const saves = _watchSaves.get(m.id) || new Map();
    _watchSaves.set(m.id, saves);
    for (const w of (one ? [one.w] : list)) {
      const lab = clips[w.n - 1] && clips[w.n - 1].label;
      if (one) {
        _watchField(m, w, lab, b, progs, saves, locked, one.nav);
        continue;
      }
      const box = el('div', 'vc-watch is-' + w.state);
      const h = el('div', 'vc-try-h');
      h.appendChild(el('span', 'k', '[clip ' + w.n + ']'));
      h.appendChild(el('span', null, _clipT(w.in) + '–' + _clipT(w.out)));
      if (lab) h.appendChild(el('span', null, lab));
      if (w.state === 'done') {
        h.appendChild(el('span', null, (w.cached ? 'watched before by ' : 'watched by ') + (w.by || 'an agent')));
        if (w.edited) h.appendChild(el('span', 'is-mine', 'corrected by you'));
      }
      if (w.state === 'done') {
        const ta = _watchTa(m, w, locked, saves);
        ta.classList.add('is-fit');
        // (phase V60.2, (вч10а), (вч12а)) Folded into one line; open, its part, who watched it, the description and - one line,
        // no empty block under it any more - what the writer does with it.
        const open = [h, ta];
        if (!locked) open.push(el('div', 'vc-card-note', 'The writer writes the prompt from this. Correct who is who or what happens here, then "write it again".'));
        box.appendChild(_foldLine({ id: m.id, key: 'watch' + w.n, word: 'clip ' + w.n, lead: _clipT(w.in) + '–' + _clipT(w.out) + ' · ', text: () => ta.value, ta, open }));
        b.appendChild(box);
        continue;
      }
      box.appendChild(h);
      if (w.state === 'watching') {
        const strip = el('div', 'mv3-ig-prog');
        box.appendChild(strip);
        progs.set('watch:' + w.n, startInlineProgress(strip, {
          label: 'watching clip ' + w.n + (list.length > 1 ? ' of ' + list.length : '') + ' with its sound…', key: 'mv3-clip-watch', estimateMs: 60000,
          startedAt: Date.parse(w.at || c.startedAt || m.at) || 0,
        }));
      } else if (w.state === 'waiting') {
        // (phase V60.2, (вч12а)) A note of one line - `vc-card-why` is the row of presses' and stood 180 px tall here.
        box.appendChild(el('div', 'vc-card-note', 'waits for clip ' + (w.n - 1)));
      } else {
        box.appendChild(el('div', 'mv3-ig-bad', 'Clip not watched - ' + (w.why || 'no model watched it') + '. The writer saw three of its frames instead.'));
      }
      b.appendChild(box);
    }
    if (failed) b.appendChild(el('div', 'mv3-ig-bad', 'The prompt was not written: ' + (c.error || 'no writer answered')));
  }
  // A clip's description to correct: written 0.6 s after the typing stops, or when the field is left; read-only while the
  // prompt is being written from it.
  function _watchTa(m, w, locked, saves) {
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta vc-watch-ta u-area';
    ta.spellcheck = true;
    ta.maxLength = 40000;
    ta.value = w.text || '';
    ta.readOnly = locked;
    ta.title = locked ? 'The prompt is being written from this now'
      : 'What the agent saw in this clip - correct who is who or what happens; "write it again" writes the prompt from it as it stands.';
    const key = 'w:' + m.id + ':' + w.n;
    let last = ta.value;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      if (ta.value === last || !ta.value.trim()) return Promise.resolve();
      last = ta.value;
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, watch: { n: w.n, text: ta.value } }, 'PATCH');
    };
    ta.addEventListener('input', () => { clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    ta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    saves.set(w.n, save);
    return ta;
  }
  // (phase V60.3, the owner's (вс6а)) The clip shown on the step "clip watched": its description as a field down to the bottom
  // of the video - its part, who watched it, "corrected by you" in the title line, what the writer does with it under the
  // pointer; being watched, waiting or not watched - said in the field's place.
  function _watchField(m, w, lab, b, progs, saves, locked, nav) {
    const c = m.card;
    const n = (c.watch || []).filter(Boolean).length;
    const part = _clipT(w.in) + '–' + _clipT(w.out);
    const base = { nav, word: 'clip ' + w.n, always: true, pager: nav ? nav.pager() : null };
    if (w.state === 'done') {
      const ta = _watchTa(m, w, locked, saves);
      const lead = [part, lab, (w.cached ? 'watched before by ' : 'watched by ') + (w.by || 'an agent'), w.edited ? 'corrected by you' : ''].filter(Boolean).join(' · ');
      b.appendChild(_field(Object.assign(base, { lead, text: () => ta.value, ta })));
      return;
    }
    const lead = [part, lab].filter(Boolean).join(' · ');
    if (w.state === 'watching') {
      b.appendChild(_waitField(Object.assign(base, { lead, progs, progKey: 'watch:' + w.n, prog: {
        label: 'watching clip ' + w.n + (n > 1 ? ' of ' + n : '') + ' with its sound…', key: 'mv3-clip-watch', estimateMs: 60000,
        startedAt: Date.parse(w.at || c.startedAt || m.at) || 0,
      } })));
    } else if (w.state === 'waiting') {
      b.appendChild(_waitField(Object.assign(base, { lead, words: 'waits for clip ' + (w.n - 1) })));
    } else {
      b.appendChild(_waitField(Object.assign(base, { lead, bad: true,
        words: 'Clip not watched - ' + (w.why || 'no model watched it') + '. The writer saw three of its frames instead.' })));
    }
  }
  function _watchActs(m, a) {
    const c = m.card;
    if (c.state === 'writing') return;
    const again = el('button', 'mv3-c-btn vc-go u-btn is-s', 'Write it again');
    again.type = 'button';
    again.title = 'Another variant of the prompt, written from these descriptions as they stand - a clip not watched is watched again';
    again.addEventListener('click', () => _rewrite(m, again));
    a.appendChild(again);
    if (c.plain && (m.media || []).length && !(c.versions || []).length) a.appendChild(_backLink(m));
  }

  // "again - a copy" (the owner, 2026-10-06): a recipe's message that was made, copied into a new one to change and make
  // apart from it.
  function _copyLink(m) {
    const again = el('button', 'vc-link', 'Again - a copy');
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
  // A sheet: a press shows the card's sheets large.
  // (phase V18.1, the owner 2026-10-08) `how`: 'big' - the storyboard at the message's width, from the 1280px tier (the
  // 440px miniature stretched to 600 came out in squares); 'frame' - Kling's first frame at its own shape, at most 320px
  // high, its box set before the picture loads. No popup under the pointer: the press opens it large. (phase V60.3) 'row' -
  // the storyboard's sheet in its row under the prompt, 72 px high at its shape; Kling's first frame fills its step down to the
  // bottom of the video (css .vm-fill).
  function _boardThumb(g, all, W, how) {
    const word = W || 'storyboard';
    const t = el('button', 'vc-board' + (how ? ' is-' + how : ''));
    t.type = 'button';
    t.dataset.id = g.id;
    if (how === 'frame' || how === 'row') t.style.setProperty('--ar', String(ratioOf(g.aspect)));
    const img = document.createElement('img');
    img.src = '/api/thumb?src=' + encodeURIComponent(g.imagePath) + '&v=' + (how ? 'preset' : 'strip');
    img.loading = 'lazy'; img.decoding = 'async'; img.alt = word;
    // Gone from the shelf since it was read: said, and never followed (the server says so too at the next read).
    img.addEventListener('error', () => { t.classList.add('is-gone'); t.title = 'Not on the Images shelf any more'; }, { once: true });
    t.appendChild(img);
    t.title = 'The ' + word + ' · press: large';
    const list = (all && all.length ? all : [g]);
    t.addEventListener('click', () => openViewer(list.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: word })),
      Math.max(0, list.findIndex(x => x.id === g.id))));
    return t;
  }
  // A sheet still being drawn: its countdown in the person's words (the asking's stage first), and the cross.
  function _boardWords(g, W) {
    if (g.stage) return g.stage + '…';
    if (g.error) return String(g.error).slice(0, 60) + ' - trying the next…';
    return 'drawing the ' + (W || 'storyboard') + '…';
  }
  function _boardBusy(g, progs, key, W) {
    const cell = el('div', 'vc-board is-busy');
    const bar = el('div', 'mv3-ig-prog');
    cell.appendChild(bar);
    // (phase V18.1) Kling's first frame waits in the box it will land in - its shape and size - with the countdown under
    // it, so nothing moves when the picture comes.
    let box = cell;
    if (W === 'picture') {
      box = el('div', 'vc-frame-busy');
      cell.className = 'vc-board is-frame is-waiting';
      cell.style.setProperty('--ar', String(ratioOf(g.aspect)));
      cell.textContent = '';
      box.append(cell, bar);
    }
    progs.set(key, startInlineProgress(bar, {
      label: _boardWords(g, W), key: W === 'picture' ? 'mv3-frame' : 'mv3-board', estimateMs: W === 'picture' ? 60000 : 90000, startedAt: Date.parse(g.at) || 0,
      onCancel: g.alertId ? async () => { await json('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', { method: 'POST' }); ctx.reload(); } : null,
    }));
    return box;
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
  // moment, by its own prompt. Their steps (phase V60.2: two, the video at the message's head): the storyboard's -
  // "storyboard" (its prompt, every writing a variant, and its sheets, every one drawn a variant - the one shown is the one
  // the video follows) · "video prompt" (every writing a variant); Kling's - "first frame prompt" · "first frame" (the
  // pictures, and the press that makes the video). A recipe's message and Kling's open on their first step; the column's
  // steps grow as the work goes.
  const _kindOf = (c) => (c.type === 'board' ? 'column' : c.board && c.board.kind === 'frame' ? 'swap' : 'recipe');
  function _storyCard(m, progs) {
    const c = m.card;
    _forget(m.id);
    const kind = _kindOf(c);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-prompt is-board is-steps is-' + c.state);
    const h = el('div', 'vc-card-h');
    // (phase V17) Kling's first frame of the plain chat is the person's message, not a recipe.
    const own = kind === 'swap' && c.plain;
    if (kind === 'column') h.appendChild(el('span', 'k', 'Storyboard'));
    else if (own) h.appendChild(el('span', 'k', 'Video'));
    else h.append(el('span', 'k', 'Recipe'), el('span', 't', (c.recipe && c.recipe.title) || ''));
    if (c.model) h.appendChild(el('span', 'm', 'for ' + _labelOf(c.model) + (kind === 'column' ? '' : own ? ' · the first frame, then the video' : ' · 2 steps')));
    box.appendChild(h);
    // (phase V18.3) What was asked, at the head - seen on every step.
    const asked = _askedOf(kind === 'column' || own ? { words: c.text, media: m.media, none: own ? 'from your pictures' : 'from the attachments alone' }
      : { request: _requestOf(m), media: m.media });
    // (phase V60.2) What was asked on the left, the video on the right; "read more" of the clip shown at the foot.
    const foot = el('div', 'vm-foot');
    const vid = _vidField(m.id, foot);
    const hd = _headOf(asked, vid);
    box.appendChild(hd.el);
    const B = c.board || {};
    // (phase V48) A Seedance card whose clips are being watched, or were, has its steps at once.
    if (!((B.versions || []).length || B.prompt) && !(c.watch || []).length) {
      vid.paint(_clipsOf(m), _shapeNow(m.media || []));
      // Nothing written yet: the writer at work, or why not - (phase V60.3, (вс8а)) in the place the prompt will stand in.
      const word = kind === 'swap' ? 'first frame prompt' : kind === 'column' ? 'storyboard prompt' : 'prompts';
      if (c.state === 'writing') {
        hd.left.appendChild(_waitField({ word, progs, progKey: 'w:' + m.id, prog: {
          label: kind === 'column' ? 'writing the storyboard prompt…' : kind === 'swap' ? 'writing the first frame\'s prompt…' : 'writing the prompts…',
          key: kind === 'column' ? 'mv3-board-writer' : 'mv3-video-writer',
          estimateMs: kind === 'column' ? 20000 : 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
        } }));
        return box;
      }
      hd.left.appendChild(_waitField({ word, bad: true, words: c.error || 'it was not written' }));
      const acts = el('div', 'vc-card-acts');
      const again = el('button', 'mv3-c-btn vc-go u-btn is-s', 'Write it again');
      again.type = 'button';
      again.addEventListener('click', () => _rewrite(m, again));
      acts.appendChild(again);
      if ((kind === 'column' || own) && (m.media || []).length) acts.appendChild(_backLink(m));
      if (_ownRecipe(c)) acts.appendChild(_changeLink());
      box.appendChild(acts);
      return box;
    }
    const steps = stepCard(m.id);
    // (phase V60.3) The steps under what was asked, in the left column; their presses under both columns.
    hd.left.append(steps.parts[0], steps.parts[1]);
    box.append(steps.parts[2], foot);
    const l = { m, el: box, steps, vid, story: true, kind, W: kind === 'swap' ? 'picture' : 'storyboard', ta: null, go: null, price: null, save: null,
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
    // (phase V48) The writing begins once the clips have been watched.
    const writing = c.state === 'writing' && !_watchBusy(c);
    // A card written before its prompts had variants has its one prompt and no list: that one is its only variant (`b0`,
    // `v0` - edited as the card's own). (phase V48) None while nothing is written - its clips watched first.
    const bv = (B.versions || []).length ? B.versions : B.prompt ? [{ id: 'b0', prompt: B.prompt, aspect: B.aspect, edited: !!B.edited }] : [];
    const bvars = bv.map(v => ({ key: v.id, sig: '', v }));
    if (writing && (kind === 'recipe' || c.writing === 'board')) bvars.push({ key: 'writing', sig: 'writing', writing: true });
    const sheets = (m.boards || []).map(g => ({ key: g.id, sig: g.state + ':' + (g.imagePath || '') + ':' + (g.error || '') + ':' + (g.gone ? 1 : 0), g }));
    const vv = (c.versions || []).length ? c.versions : (c.prompt ? [{ id: 'v0', prompt: c.prompt, model: c.model, boardId: '' }] : []);
    const vvars = vv.map(v => ({ key: v.id, sig: (v.model || '') + ':' + (v.boardId || ''), v }));
    if (writing && (kind === 'recipe' || c.writing === 'video')) vvars.push({ key: 'writing', sig: 'writing', writing: true });
    const made = _triesOf(m).some(t => t.gens.length);
    // A sheet's countdown in its words, on the step that shows it.
    const say = (x) => { const p = x && x.g && x.g.state === 'pending' ? l.steps.progs.get(x.g.id) : null; if (p) p.say(_boardWords(x.g, l.W)); };
    // Its sheets (Kling: its pictures) - every one drawn a variant; the one paged to, when it has landed, is the one chosen.
    const sheetSet = {
      key: 'board', word: kind === 'swap' ? 'picture' : 'sheet', pick: B.chosen, variants: sheets,
      note: (x) => (!x ? '' : x.g.state === 'pending' ? 'being drawn' : !_boardOk(x.g) ? (x.g.gone ? 'not on the Images shelf any more' : 'not drawn')
        : 'the video follows this one'),
      page: (x) => { if (x && _boardOk(x.g) && x.key !== B.chosen) patch({ chosen: x.key }); },
    };
    const bpage = (x) => { if (x && x.v && (B.versions || []).length && x.key !== B.cur) patch({ bcur: x.key }); };
    const steps = [];
    // (phase V60.2, the owner's (вч6а), (вч7а)) Two steps at most - the video is at the head of the message.
    if (kind === 'swap') {
      // (phase V17) Kling's first frame: 1 - its prompt and the moment of the clip; 2 - the picture, and the press that makes
      // the video from it (Kling's prompt is its own, put in by the server).
      if (bvars.length) {
        steps.push({
          key: 'picture-prompt', title: 'first frame prompt', word: 'variant', pick: B.cur || 'b0', variants: bvars,
          note: (x) => (!x ? '' : x.writing ? 'being written' : '"draw the picture" draws this one'),
          body: (x, b, progs, nav) => _momentStep(m, l, x, b, progs, nav),
          acts: (x, a) => _boardPromptActs(m, l, x, a),
          page: bpage,
          freshen: () => _freshenStory(id, l),
        });
      }
      if (sheets.length || bvars.some(x => !x.writing)) {
        steps.push(Object.assign({}, sheetSet, {
          title: 'first frame',
          body: (x, b, progs, nav) => _sheetStep(m, l, x, b, progs, nav),
          acts: (x, a) => _sheetActs(m, l, x, a),
          freshen: (x) => { say(x); _freshenStory(id, l); },
        }));
      }
    } else {
      // The storyboard: 1 - what the agent saw of the clips (V48), the sheet's prompt and the sheet; 2 - the video's prompt.
      const watchSig = (c.watch || []).filter(Boolean).map(w => w.n + ':' + w.state + ':' + (w.why ? 1 : 0)).join(',') + '|' + (c.state === 'writing' ? 'w' : 'r');
      if ((c.watch || []).length || bvars.length) {
        steps.push({
          key: 'board-prompt', title: 'storyboard', word: 'variant', pick: B.cur || 'b0', variants: bvars, more: [sheetSet],
          sig: () => watchSig,
          note: (x) => (!x ? '' : x.writing ? 'being written' : '"draw" draws from this one'),
          body: (x, b, progs, nav) => _storyStep(m, l, x, b, progs, nav),
          acts: (x, a, nav) => _storyActs(m, l, x, a, nav),
          page: bpage,
          freshen: (x, nav) => { say(nav.shown('board')); _freshenStory(id, l); },
        });
      }
      if (vvars.length) {
        steps.push({
          key: 'prompt', title: 'video prompt', word: 'variant', pick: c.cur || 'v0', variants: vvars,
          // The sheet a recipe's video follows is shown with its prompt: another one paged to on its step draws this anew.
          sig: () => (kind === 'column' ? '' : (_chosenSheet(l) || {}).id || ''),
          note: (x) => (!x ? '' : x.writing ? 'being written' : '"make the video" sends this one'),
          body: (x, b, progs, nav) => _videoPromptStep(m, l, x, b, progs, nav),
          acts: (x, a) => _videoPromptActs(m, l, x, a),
          page: (x) => { if (x && x.v && (c.versions || []).length && x.key !== c.cur) patch({ cur: x.key }); },
          freshen: () => _freshenStory(id, l),
        });
      }
    }
    // A recipe's message nothing has been drawn or made from yet opens on its first step.
    l.steps.paint({ steps, start: kind !== 'column' && !sheets.length && !made && steps.length ? steps[0].key : '' });
    _paintVid(l);
  }
  // (phase V60.2) The storyboard's first step: the clips' descriptions (folded), the sheet's prompt and the sheet.
  // (phase V60.3, the owner's (вс7а)) The sheet's prompt a field down to the bottom of the video, the sheet a row under it.
  function _storyStep(m, l, x, b, progs, nav) {
    const c = l.m.card;
    const B = c.board || {};
    const written = (B.versions || []).length > 0 || !!B.prompt;
    const watched = (c.watch || []).length > 0;
    if (watched) _watchBody(l.m, b, progs, !written && c.state === 'failed');
    l.bta = null;
    // The steps' line stays over the clips' lines when there are some, not in the prompt's title line under them.
    if (x) _boardPromptStep(m, l, x, b, progs, watched ? Object.assign({}, nav, { head: null }) : nav);
    if (written || (l.m.boards || []).length) _sheetRow(m, l, nav.shown('board'), b, progs, nav);
  }
  // (phase V60.3, the owner's (вс7а)) The storyboard's sheet under its prompt: a row 72 px high - the sheet shown at its shape
  // (a press: the card's sheets large), its "‹ 2 of 3 ›", what it is; being drawn - its countdown; not drawn - why.
  function _sheetRow(m, l, x, b, progs, nav) {
    const row = el('div', 'vm-sheet');
    const pg = nav ? nav.pager('board') : null;
    const g = x ? x.g : null;
    if (!g) row.appendChild(el('span', 'vc-card-note', 'Not drawn yet - "draw the storyboard" below. The video follows the one shown here.'));
    else if (g.state === 'pending') row.appendChild(_boardBusy(g, progs, g.id, l.W));
    else if (!_boardOk(g)) row.appendChild(el('div', 'vc-board is-bad', g.gone ? 'not on the Images shelf any more - it cannot be followed' : String(g.error || 'it was not drawn').slice(0, 200)));
    else {
      row.appendChild(_boardThumb(g, (l.m.boards || []).filter(_boardOk), l.W, 'row'));
      row.appendChild(el('span', 'vc-card-note', 'the storyboard - the video follows this one'));
    }
    if (pg) row.appendChild(pg);
    b.appendChild(row);
  }
  // Its presses: draw (from the prompt shown, as it is edited), "write the video" (the column's, from the sheet shown), the
  // price, "write it again" / "write both again", the attachments back, "change the values".
  function _storyActs(m, l, x, a, nav) {
    l.drawGo = null; l.drawPrice = null;
    if (!x || x.writing) return;
    const sx = nav.shown('board');
    const ok = !!(sx && _boardOk(sx.g));
    if (l.kind === 'column') {
      const write = el('button', 'mv3-c-btn vc-go u-btn is-s' + (ok ? ' is-make is-main' : ''), 'write the video');
      write.type = 'button';
      write.title = 'The video\'s prompt from your words, with this storyboard among the pictures - you see it before the video is made';
      write.addEventListener('click', () => _writeVideo(l.m, l, write));
      write.disabled = !ok;
      a.appendChild(write);
    }
    const drawn = (l.m.boards || []).length > 0;
    const go = el('button', 'mv3-c-btn vc-go u-btn is-s' + (drawn && l.kind === 'column' ? '' : ' is-make is-main'), drawn ? 'draw again' : 'draw the ' + l.W);
    go.type = 'button';
    go.title = 'A sheet from the storyboard prompt shown - as you edited it';
    const two = { bta: l.bta, range: null, frame: false, busy: false };
    go.addEventListener('click', (e) => _drawBoard(l.m, two, go, e));
    const price = el('span', 'vc-card-why');
    a.append(go, price);
    const again = el('button', 'vc-link', l.kind === 'recipe' ? 'write both again' : 'write it again');
    again.type = 'button';
    again.title = l.kind === 'recipe' ? 'Another variant of both prompts - the storyboard\'s and the video\'s - from the same request; these stay'
      : 'Another variant of the storyboard prompt from the same words and pictures - this one stays';
    again.addEventListener('click', () => _rewrite(l.m, again));
    a.appendChild(again);
    if (l.kind === 'column' && (l.m.media || []).length) a.appendChild(_backLink(l.m));
    if (l.kind === 'recipe' && _ownRecipe(l.m.card)) a.appendChild(_changeLink());
    l.drawGo = go;
    l.drawPrice = price;
    _freshenStory(m.id, l);
  }
  // 1 · the storyboard prompt: its words to edit (the variant shown), the pictures it is drawn with.
  function _boardPromptStep(m, l, x, b, progs, nav) {
    const c = l.m.card;
    l.bta = null;
    if (!x || x.writing) {
      const B = c.board || {};
      const first = !((B.versions || []).length || B.prompt);
      // (phase V60.3, (вс8а)) In the place the prompt will stand in.
      b.appendChild(_waitField({ nav, word: 'prompt', always: true, pager: nav ? nav.pager() : null, progs, progKey: 'w', prog: {
        label: l.kind === 'recipe' ? (first ? 'writing the prompts…' : 'writing another variant of both prompts…')
          : (first ? 'writing the storyboard prompt…' : 'writing another variant of the storyboard prompt…'),
        key: l.kind === 'recipe' ? 'mv3-video-writer' : 'mv3-board-writer', estimateMs: l.kind === 'recipe' ? 25000 : 20000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      } }));
      return;
    }
    if (c.error && c.writing !== 'video') b.appendChild(el('div', 'mv3-ig-bad', 'The last writing did not work: ' + c.error));
    const bta = document.createElement('textarea');
    bta.className = 'vc-prompt-ta is-board u-area';
    bta.spellcheck = true;
    bta.maxLength = 6000;
    bta.value = x.v.prompt || '';
    bta.title = 'The storyboard sheet\'s prompt - numbered panels, one per beat of the clip; Image 1, Image 2 are the pictures below.';
    const key = 'b:' + m.id + ':' + x.key;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, board: bta.value };
      if (x.key !== 'b0') body.bver = x.key;
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    bta.addEventListener('input', () => { clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    bta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    // (phase V60.3, (вс7а)) A field down to the bottom of the video (less the sheet's row under it), its variants' pager in its
    // title line.
    b.appendChild(_field({ nav, word: 'prompt', always: true, text: () => bta.value, ta: bta, pager: nav ? nav.pager() : null }));
    l.bta = bta;
  }
  // 1 · Kling's first frame (V7.6 as a recipe; the chat's own since V17): the moment of the clip it is drawn from and the
  // prompt the writer wrote - [clip 1] is the clip's still there, [picture N] the person's pictures. On a card that knows
  // its clip's length (V17) the moment is where the part starts, anywhere in the clip; on an older one it lies within
  // the part.
  const _t = (v) => { const x = Math.max(0, +v || 0); const mm = Math.floor(x / 60); return mm + ':' + (x - mm * 60).toFixed(1).padStart(4, '0'); };
  function _momentStep(m, l, x, b, progs, nav) {
    const c = l.m.card, B = c.board || {};
    l.bta = null; l.range = null;
    if (!x || x.writing) {
      // (phase V60.3, (вс8а)) In the place the prompt will stand in.
      b.appendChild(_waitField({ nav, word: 'first frame prompt', pager: nav ? nav.pager() : null, progs, progKey: 'w', prog: {
        label: 'writing another variant of the first frame\'s prompt…', key: 'mv3-video-writer', estimateMs: 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      } }));
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
    wireRange(range);                               // (phase V73 block 2) the shared slider
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
    const bta = document.createElement('textarea');
    bta.className = 'vc-prompt-ta is-board u-area';
    bta.spellcheck = true;
    bta.maxLength = 6000;
    bta.value = toShown(x.v.prompt || '');
    bta.title = 'The first frame\'s prompt: [clip 1] is the clip\'s still at the moment above, [picture 1], [picture 2]... your pictures by their numbers.';
    const key = 'b:' + m.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, board: toNeutral(bta.value) };
      if (x.key !== 'b0') body.bver = x.key;
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    bta.addEventListener('input', () => { clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    bta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    // (phase V60.3, the owner's (вс6а)) Its title line (the steps, the variants' pager), the moment of the clip under it, then the
    // prompt as a field down to the bottom of the video.
    const f = _field({ nav, word: 'first frame prompt', text: () => bta.value, ta: bta, pager: nav ? nav.pager() : null });
    f.insertBefore(mo, bta);
    b.appendChild(f);
    l.bta = bta;
    l.range = range;
  }
  function _boardPromptActs(m, l, x, a) {
    l.drawGo = null; l.drawPrice = null;
    if (!x || x.writing) return;
    const go = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', 'Draw the ' + l.W);
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
  // 2 · Kling's first frame (the picture): the one shown - drawing, drawn (press: large), or why not. (phase V60.3, the owner's
  // (вс6а)) It fills the step down to the bottom of the video, at least 160 px, at its shape; the steps and its pictures'
  // "‹ 2 of 3 ›" in its title line, Kling's own prompt under it. (The storyboard's sheet is a row under its prompt: _sheetRow.)
  function _sheetStep(m, l, x, b, progs, nav) {
    const fill = el('div', 'vm-fill');
    const g = x ? x.g : null;
    const ok = !!(g && _boardOk(g));
    if (!g) {
      fill.classList.add('is-empty');
      fill.appendChild(el('span', 'w', 'Not drawn yet - "draw the picture" on the step before. The video follows the one shown here.'));
    } else if (g.state === 'pending') fill.appendChild(_boardBusy(g, progs, g.id, l.W));
    else if (!ok) fill.appendChild(el('div', 'vc-board is-bad', g.gone ? 'not on the Images shelf any more - it cannot be followed' : String(g.error || 'it was not drawn').slice(0, 200)));
    else fill.appendChild(_boardThumb(g, (l.m.boards || []).filter(_boardOk), l.W, 'frame'));
    b.appendChild(_field({ nav, word: 'first frame', pager: nav ? nav.pager('board') : null, wait: fill }));
    // (phase V17) Kling's prompt is its own: said, not a field.
    if (ok) {
      const clip = (l.m.media || []).find(y => y.kind === 'video') || {};
      const said = 'Kling moves this picture with the clip ' + _t(clip.in) + ' – ' + _t(clip.out) + ' and gets: ' + (l.m.card.prompt || '');
      const n = el('div', 'vc-card-note vm-note2', said);
      n.title = said;
      b.appendChild(n);
    }
  }
  function _sheetActs(m, l, x, a) {
    l.drawGo = null; l.drawPrice = null;
    // (phase V17, the owner 2026-10-08) Kling's first frame: the picture drawn, and right under it the press that makes the
    // video from it - its price, the count - then another picture.
    if (l.kind === 'swap') {
      l.go = null; l.price = null;
      if (x && _boardOk(x.g)) {
        const nBtn = el('button', 'vc-n u-btn is-s', '×' + (_cardN.get(m.id) || 1));
        nBtn.type = 'button';
        nBtn.title = 'How many to make from it - each clip is its own variant of the video';
        nBtn.addEventListener('click', () => {
          _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
          nBtn.textContent = '×' + _cardN.get(m.id);
          _freshenStory(m.id, l);
        });
        const go = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', 'Make the video');
        go.type = 'button';
        go.addEventListener('click', () => _make(l.m, go));
        const price = el('span', 'vc-card-why');
        a.append(nBtn, go, price);
        if (l.m.card.state === 'sent' && !l.m.card.plain) a.appendChild(_copyLink(l.m));
        l.go = go;
        l.price = price;
      }
      const redo = el('button', 'mv3-c-btn vc-go u-btn is-s' + (x && _boardOk(x.g) ? '' : ' is-make is-main'), x ? 'draw again' : 'draw the picture');
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
      const write = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', 'Write the video');
      write.type = 'button';
      write.title = 'The video\'s prompt from your words, with this storyboard among the pictures - you see it before the video is made';
      write.addEventListener('click', () => _writeVideo(l.m, l, write));
      write.disabled = !(x && _boardOk(x.g));
      a.appendChild(write);
    }
    const redo = el('button', 'mv3-c-btn vc-go u-btn is-s' + (l.kind === 'column' ? '' : ' is-make is-main'), x ? 'draw again' : 'draw the ' + l.W);
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
      await _flushWatch(m.id);
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
  function _videoPromptStep(m, l, x, b, progs, nav) {
    const c = l.m.card;
    l.ta = null; l.ver = ''; l.vmodel = ''; l.boardId = ''; l.patchKey = '';
    if (!x || x.writing) {
      // (phase V60.3, (вс8а)) In the place the prompt will stand in.
      b.appendChild(_waitField({ nav, word: 'prompt', pager: nav ? nav.pager() : null, progs, progKey: 'w', prog: {
        label: l.kind === 'recipe' ? 'writing another variant of both prompts…' : 'writing the video prompt…', key: 'mv3-video-writer', estimateMs: 25000,
        startedAt: Date.parse(c.startedAt || m.at) || 0,
      } }));
      return;
    }
    const v = x.v;
    if (c.error && c.writing !== 'board') b.appendChild(el('div', 'mv3-ig-bad', 'The last writing did not work: ' + c.error));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta u-area';
    ta.spellcheck = true;
    ta.value = toShown(v.prompt);
    ta.title = 'The prompt the model gets - edit it before the video is made. [picture N] names a picture; the storyboard is the last one.';
    const key = 'p:' + m.id + ':' + v.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, prompt: toNeutral(ta.value) };
      if (v.id !== 'v0') body.ver = v.id;
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    ta.addEventListener('input', () => { clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    ta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    const media = l.m.media || [];
    const sheet = l.kind === 'column' ? (l.m.boards || []).find(g => g.id === v.boardId) : _chosenSheet(l);
    const has = !!(sheet && sheet.imagePath);
    const all = media.filter(a => a.kind === 'image').concat(has ? [{ path: sheet.imagePath, kind: 'image', role: 'storyboard', label: 'storyboard' }] : [])
      .concat(media.filter(a => a.kind !== 'image'));
    // (phase V60.3, the owner's (вс3а), (вс7а)) Open at once, down to the bottom of the video; what goes with it under it, in
    // small cells.
    b.appendChild(_field({ nav, word: 'video prompt', text: () => ta.value, ta, pager: nav ? nav.pager() : null }));
    const row = _mediaRow(all);
    if (row) { row.classList.add('vm-refs-s'); b.appendChild(row); }
    if (l.kind === 'column' && sheet && sheet.gone) b.appendChild(el('div', 'mv3-ig-bad', 'Its storyboard is not on the Images shelf any more - write the video again from another sheet.'));
    if (l.kind !== 'column' && !has) b.appendChild(el('div', 'vc-card-note', 'No ' + l.W + ' the video can follow yet - it follows the one shown on the step before: draw one there.'));
    Object.assign(l, { ta, save, ver: v.id === 'v0' ? '' : v.id, vmodel: v.model || c.model, boardId: v.boardId || '', patchKey: key });
  }
  function _videoPromptActs(m, l, x, a) {
    l.go = null; l.price = null;
    if (!x || x.writing) return;
    const nBtn = el('button', 'vc-n u-btn is-s', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = 'How many to make from it - each clip is its own variant of the video';
    nBtn.addEventListener('click', () => {
      _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
      nBtn.textContent = '×' + _cardN.get(m.id);
      _freshenStory(m.id, l);
    });
    const go = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', 'Make the video');
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
      l.drawPrice.title = bp.text;
      l.drawGo.disabled = !bp.ok;
    }
    if (l.go) {
      _freshenReview(id, l);
      if (!fits) {
        l.go.disabled = true;
        l.go.classList.add('is-make', 'is-main');
        l.go.textContent = 'Make the video';
        l.price.textContent = 'this video is made by ' + (l.kind === 'swap' ? 'Kling motion control' : 'Seedance') + ' - pick it on the left';
        l.price.title = l.price.textContent;
      }
    }
  }

  // A request as it was sent: the places as the person left them - theirs in solid gold, the example's dashed - and
  // what was attached, by the name of its slot.
  // (phase V18.3) The request card is not drawn apart any more: its request heads the prompt card written from it.
  function _requestOf(m) {
    const from = m.card && m.card.from;
    const rc = from ? (ctx.thread() || []).find(x => x.id === from && x.card && x.card.type === 'recipe') : null;
    if (!rc) return null;
    const c = rc.card;
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
    return req;
  }

  // (phase V18.3, the owner 2026-10-08) WHAT WAS ASKED stands at the head of its answer - the person's turn is not drawn
  // apart any more: the words whole (folded after three lines), or a recipe's request with its places; the attachments.
  function _askedOf(o) {
    const box = el('div', 'vc-asked');
    if (o.request) box.appendChild(o.request);
    else {
      const words = String(o.words || '').trim();
      if (words || o.none) {
        const t = el('div', 'vc-asked-t' + (words ? '' : ' is-none'), words || o.none);
        box.appendChild(t);
        if (words) _fold(t, 0);
      }
    }
    const row = _mediaRow(o.media || []);
    if (row) box.appendChild(row);
    return box.childNodes.length ? box : null;
  }
  // Long words fold after three lines, and "more" opens them - measured once the message is on screen.
  function _fold(t, tries) {
    requestAnimationFrame(() => {
      if (!t.isConnected || !t.clientHeight) { if (tries < 30) _fold(t, tries + 1); return; }
      if (t.scrollHeight <= t.clientHeight + 1 || t.nextSibling && t.nextSibling.classList && t.nextSibling.classList.contains('vc-asked-more')) return;
      const more = el('button', 'vc-asked-more', 'More');
      more.type = 'button';
      more.addEventListener('click', () => { const open = t.classList.toggle('is-open'); more.textContent = open ? 'Less' : 'More'; });
      t.after(more);
    });
  }
  // The message drawn at the press (the shell's `sending`): what was asked, and "sending…" until the answer comes.
  // (phase V60.2, (вч14а), (вч17а)) With its head as every message has it: the video's field on the right, empty.
  let _pendSeq = 0;
  function _sendingCard(o) {
    const box = el('div', 'mv3-ig-msg is-agent is-sending vc-card');
    const h = el('div', 'vc-card-h');
    const m = model();
    h.appendChild(el('span', 'k', _boardOn() ? 'storyboard' : 'video'));
    if (m) h.appendChild(el('span', 'm', 'for ' + m.label));
    box.appendChild(h);
    const asked = _askedOf({ words: o.text, media: o.media, none: 'from the attachments alone' });
    const vid = _vidField('pend:' + (++_pendSeq), null);
    vid.paint([], _shapeNow(o.media || null));
    const hd = _headOf(asked, vid);
    hd.left.appendChild(_waitField({ words: 'sending…', pulse: true }));
    box.appendChild(hd.el);
    return box;
  }
  // (phase V60.2, the owner's (вч17а)) A message of the one press - the writer off - has the same head: what was asked on the
  // left, its clip on the right (×2 - its variants), "read more" at its foot. It has no steps and no presses. Its countdown is
  // the thread's to finish when the clip lands, as before (`progs`).
  function _plainBubble(m, progs, asked) {
    if (m.role === 'user' || m.card) return null;
    const gens = (m.gens && m.gens.length) ? m.gens : (m.gen ? [m.gen] : []);
    if (!gens.length) return null;
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-plain-msg');
    const h = el('div', 'vc-card-h');
    h.appendChild(el('span', 'k', 'Video'));
    if (gens[0].model) h.appendChild(el('span', 'm', 'for ' + _labelOf(gens[0].model)));
    box.appendChild(h);
    const media = (m.media || []).length ? m.media : ((asked && asked.media) || []);
    const words = String((m.asked != null ? m.asked : (asked ? asked.text : '')) || '').trim();
    // (phase V60.3, the owner's (вс11а)) The words whole, as a block down to the bottom of the video, scrolling inside - not
    // three lines and "more"; the attachments under them.
    let head = null;
    if (words || media.length) {
      head = el('div', 'vc-asked vm-plain');
      if (words) head.appendChild(el('div', 'vm-words', words));
      const row = _mediaRow(media);
      if (row) head.appendChild(row);
    }
    const foot = el('div', 'vm-foot');
    const vid = _vidField(m.id, foot, progs);
    box.append(_headOf(head, vid).el, foot);
    vid.paint(gens.map(g => ({ key: g.id, g, n: 0, at: g.at })), (gens[0].params || {}).aspect || '9:16');
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
      const wrap = el('div', 'vc-ref' + (a.gone ? ' is-gone' : ''));
      if (a.gone) cell.title += ' - not in this library';
      wrap.appendChild(cell);
      if (a.label) wrap.appendChild(el('span', 'lab', a.label));
      row.appendChild(wrap);
    }
    return row;
  }

  // ── A PROMPT FOLDED INTO ONE LINE (phase V60.2, the owner 2026-10-29, (вч10а), (вч11а)) ──
  // Every prompt of a message - a clip's description, the storyboard's or the first frame's prompt, the video's - is one
  // line: its word and ▸, its first words, how many characters, and its variants' "‹ 2 of 3 ›" at the right end. A press
  // opens it in place, to read and edit, as tall as its text. What is open stays open while the person stays in the chat -
  // the thread's repaints, another variant, a make -, and everything folds again when anything hides the chat (its window
  // closed, another project, another page, a reload).
  // (phase V60.3, the owner 2026-10-30, (вс3а), (вс6а)) Only the clips' descriptions on the storyboard's step are folded now:
  // every other text of a step is a field down to the bottom of the video (`_field` below).
  const _open = new Set();       // message id + ':' + line key - the lines open now
  const _folds = new Set();      // { el, fold } of every line drawn - folded at once when the chat hides
  function _foldAll() {
    _open.clear();
    for (const f of _folds) { if (f.el.isConnected) f.fold(); else _folds.delete(f); }
  }
  const _flat = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const _chars = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' chars';
  // o: { id, key, word, lead, text(), ta, open: [what the open line shows], pager }
  function _foldLine(o) {
    const key = o.id + ':' + o.key;
    const wrap = el('div', 'vm-fold');
    const line = el('div', 'vm-fold-line');
    const btn = el('button', 'vm-fold-b');
    btn.type = 'button';
    const tw = el('span', 'tw');
    const sum = el('span', 's');
    const n = el('span', 'n');
    btn.append(el('span', 'k', o.word), tw, sum, n);
    line.appendChild(btn);
    if (o.pager) line.appendChild(o.pager);
    const part = el('div', 'vm-fold-part');
    part.append(...(o.open || []));
    wrap.append(line, part);
    const say = () => {
      const t = String(o.text() || '');
      sum.textContent = (o.lead || '') + (_flat(t) || '—');
      n.textContent = t.trim() ? _chars(t.length) : '';
    };
    say();
    if (o.ta) o.ta.addEventListener('input', say);
    const set = (on) => {
      wrap.classList.toggle('is-open', on);
      part.hidden = !on;
      tw.textContent = on ? '▾' : '▸';
      btn.title = on ? 'Fold it into one line' : 'Open the whole text - to read and edit';
      if (on) _open.add(key); else _open.delete(key);
    };
    // Folded with a change being typed: its blur writes it.
    const fold = () => { if (o.ta && document.activeElement === o.ta) o.ta.blur(); set(false); };
    set(_open.has(key));
    btn.addEventListener('click', () => set(!wrap.classList.contains('is-open')));
    _folds.add({ el: wrap, fold });
    return wrap;
  }

  // ── A STEP'S TEXT AS A FIELD (phase V60.3, the owner 2026-10-30, (вс3а)-(вс5а)) ──
  // The text of the step shown - a prompt, a clip's description - is open at once: a field from under what was asked down
  // to the bottom of the video's column, at least 120 px, scrolling inside, edited in place as before. Its title line: the
  // steps' "‹ step k of N ›" when there are two (`nav.head()`), its word (when the steps' line does not already say it, or
  // `always`), what it is (`lead`), how many characters, its variants' "‹ 2 of 3 ›".
  // o: { nav, word, always, lead, text(), ta, pager, wait } - `wait` stands in the field's place while there is no text.
  function _field(o) {
    const wrap = el('div', 'vm-field');
    const line = el('div', 'vm-fh');
    const steps = o.nav && o.nav.head ? o.nav.head() : null;
    if (steps) line.appendChild(steps);
    const many = !!(o.nav && o.nav.many && o.nav.many());
    if (o.word && (o.always || !many)) line.appendChild(el('span', 'k', o.word));
    const sum = el('span', 's', o.lead || '');
    if (o.lead) sum.title = o.lead;
    const n = el('span', 'n');
    line.append(sum, n);
    if (o.pager) line.appendChild(o.pager);
    const say = () => { const t = o.text ? String(o.text() || '') : ''; n.textContent = t.trim() ? _chars(t.length) : ''; };
    say();
    if (o.ta) o.ta.addEventListener('input', say);
    wrap.appendChild(line);
    if (o.ta) { o.ta.classList.add('vm-ta'); wrap.appendChild(o.ta); }
    else if (o.wait) wrap.appendChild(o.wait);
    return wrap;
  }
  // (phase V60.3, the owner's (вс8а)) A field's place while it has no text - from the press of ">" on: dashed, as tall as the
  // field will be, its countdown (or "sending…") inside, why not in red; the text comes into the same place, nothing moves.
  // o: _field's { nav, word, always, lead, pager } and { words, pulse, bad, prog (startInlineProgress's), progs, progKey }
  function _waitField(o) {
    const box = el('div', 'vm-wait' + (o.bad ? ' is-bad' : ''));
    if (o.words) box.appendChild(el('span', 'w' + (o.pulse ? ' vc-sending' : ''), o.words));
    if (o.prog) {
      const strip = el('div', 'mv3-ig-prog');
      box.appendChild(strip);
      o.progs.set(o.progKey, startInlineProgress(strip, o.prog));
    }
    return _field(Object.assign({}, o, { ta: null, text: null, wait: box }));
  }

  // ── THE VIDEO AT THE HEAD OF ITS MESSAGE (phase V60.2, the owner 2026-10-29, (вч13б)-(вч17а)) ──
  // Right of what was asked, against the message's right edge, 180 px wide at the clip's shape (9:16 - 180×320, 16:9 -
  // 180×101, 1:1 - 180×180). Before any clip: a dashed field of the shape the column would make it now (the price and the
  // press follow the column too), "the video will appear here" - from the press of ">" on. Being made: its countdown in it,
  // the cross letting go of the row. Failed: a red frame and its words, "Alerts can try it again" under it. Several clips -
  // ×2, made again - are its variants: "‹ 1 of 3 ›" under it, a new one shown by itself, which attempt it is under the
  // pointer. "read more" at the message's foot, as before (вч16б). (phase V60.3, the owner's (вс1б)) No "to timeline" under
  // it: the clip is dragged onto a lane.
  const _vidShown = new Map();   // message id -> { key, n } - the clip shown as the person left it, and how many there were
  const _dims = new Map();       // a clip's path -> 'w:h' ('' while it is read) - one clip decides Seedance's shape (V47)
  const _arOf = (shape) => String(shape || '9:16').replace(':', ' / ');
  function _readDims(path) {
    if (_dims.has(path)) return;
    _dims.set(path, '');
    json('/api/media/probe?src=' + encodeURIComponent(path)).then((d) => {
      if (!(d && d.success && d.w > 0 && d.h > 0)) return;
      _dims.set(path, d.w + ':' + d.h);
      _freshenCards();
    });
  }
  // The shape a clip would come out at now: one clip that decides it - the clip's; else the column's.
  function _shapeNow(media) {
    try {
      const r = rec();
      const one = r ? _byClip(r, media || null) : null;
      if (one && one.path) {
        const d = _dims.get(one.path);
        if (d) return d;
        _readDims(one.path);
      }
      return _body(media || null).params.aspect || '9:16';
    } catch (e) { return '9:16'; }
  }
  async function _letGo(g) {
    await json('/api/alerts/' + encodeURIComponent(g.alertId) + '/cancel', { method: 'POST' });
    ctx.reload();
  }
  // The field of one message: `paint(clips, shape)` - clips [{ key, g, n, at, ver, zh }] in their order, `shape` the field's
  // before any of them; `foot` - where the shown clip's "read more" goes; `outer` - the thread's map of the message's
  // countdowns, when the thread draws the message anew rather than this field (a message of the one press).
  function _vidField(id, foot, outer) {
    const box = el('div', 'vm-vid');
    let sig = null, prog = null, progId = '', last = null;
    const drop = (landed) => {
      if (prog) { if (landed) prog.finish(); else prog.detach(); }
      if (outer && progId) outer.delete(progId);
      prog = null;
      progId = '';
    };
    function paint(clips, shape) {
      last = [clips, shape];
      const known = _vidShown.get(id);
      let key = known && clips.some(c => c.key === known.key) ? known.key : '';
      // What has just appeared is shown by itself.
      if (!known || clips.length > known.n || !key) key = clips.length ? clips[clips.length - 1].key : '';
      _vidShown.set(id, { key, n: clips.length });
      const i = clips.findIndex(c => c.key === key);
      const x = i >= 0 ? clips[i] : null;
      const g = x ? x.g : null;
      const nsig = (g ? g.id + ':' + g.state + ':' + (g.videoPath || '') + ':' + (g.error || '') + ':' + (g.posterPath || '') : 'none:' + shape) + '|' + i + '/' + clips.length;
      if (nsig === sig) { if (g && g.state === 'pending' && prog) prog.say(ctx.stageWords(g)); return; }
      drop(!!(g && prog && progId === g.id && g.state === 'done'));
      sig = nsig;
      box.textContent = '';
      if (foot) foot.textContent = '';
      if (!g) {
        const e = el('div', 'vm-vid-box is-empty');
        e.style.aspectRatio = _arOf(shape);
        e.appendChild(el('span', 'w', 'the video will appear here'));
        box.appendChild(e);
        return;
      }
      const shp = g.w && g.h ? g.w + ':' + g.h : (g.params || {}).aspect || shape || '9:16';
      let face = null;
      if (g.state === 'done' && g.videoPath) {
        const cell = el('div', 'vm-vid-cell');
        _shotOf(g, cell, () => ctx.view(g));
        box.appendChild(cell);
        face = cell.querySelector('.mv3-vc-shot');
      } else if (g.state === 'pending') {
        face = el('div', 'vm-vid-box is-busy');
        face.style.aspectRatio = _arOf(shp);
        const strip = el('div', 'mv3-ig-prog');
        face.appendChild(strip);
        box.appendChild(face);
        prog = startInlineProgress(strip, {
          label: ctx.stageWords(g), key: 'mv3-video-' + (g.model || ''), estimateMs: 180000, startedAt: Date.parse(g.at) || 0,
          onCancel: g.alertId ? () => _letGo(g) : null,
        });
        progId = g.id;
        if (outer) outer.set(g.id, prog);
      } else {
        face = el('div', 'vm-vid-box is-bad');
        face.style.aspectRatio = _arOf(shp);
        face.appendChild(el('span', 'w', g.error || 'nothing came back'));
        box.appendChild(face);
        if (!g.cancelled && g.alertId && !/question instead/.test(g.error || '')) box.appendChild(el('div', 'mv3-ig-note', 'Alerts can try it again'));
      }
      // Which attempt it is, under the pointer.
      const when = x.at ? new Date(x.at) : null;
      const said = [x.n ? 'attempt ' + x.n : '', when && !isNaN(when) ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        x.ver ? 'from prompt variant ' + x.ver : '', x.zh ? 'sent in 中文' : ''].filter(Boolean).join(' · ');
      if (face && said) face.title = (face.title ? face.title + ' · ' : '') + said;
      if (clips.length > 1) {
        const pg = el('span', 'vm-pg is-vid');
        const p = el('button', 'vc-nav is-prev u-btn is-s is-icon', '‹');
        const t = el('span', 'vm-pg-t', (i + 1) + ' of ' + clips.length);
        const nx = el('button', 'vc-nav is-next u-btn is-s is-icon', '›');
        p.type = 'button'; nx.type = 'button';
        p.disabled = i <= 0;
        nx.disabled = i >= clips.length - 1;
        t.title = 'clip ' + (i + 1) + ' of ' + clips.length + (said ? ' · ' + said : '');
        p.title = i > 0 ? '‹ The clip before (' + i + ' of ' + clips.length + ')' : 'This is the first clip';
        nx.title = i < clips.length - 1 ? 'The next clip (' + (i + 2) + ' of ' + clips.length + ') ›' : 'This is the newest clip';
        const to = (d) => { const c = clips[i + d]; if (!c) return; _vidShown.set(id, { key: c.key, n: clips.length }); sig = null; paint(...last); };
        p.addEventListener('click', () => to(-1));
        nx.addEventListener('click', () => to(1));
        pg.append(p, t, nx);
        box.appendChild(pg);
      }
      if (foot) foot.appendChild(ctx.facts(g));
    }
    return { el: box, paint, destroy: () => drop(false) };
  }
  // (phase V60.3, the owner's (вс2а)) The message's two columns: what was asked at the top of the left one - the steps go
  // under it, into `left` -, the video in the right one; the presses go under both (the caller's).
  function _headOf(asked, vid) {
    const h = el('div', 'vm-head');
    const left = el('div', 'vm-head-l');
    if (asked) left.appendChild(asked);
    h.append(left, vid.el);
    return { el: h, left };
  }
  // A card's clips, attempt by attempt, as the field shows them.
  function _clipsOf(m) {
    const vers = m.card.versions || [];
    return _triesOf(m).flatMap((t, i) => t.gens.map(g => {
      const vi = t.ver ? vers.findIndex(v => v.id === t.ver) : -1;
      return { key: g.id, g, n: i + 1, at: t.at || g.at, ver: vi >= 0 && vers.length > 1 ? vi + 1 : 0, zh: !!t.zh };
    }));
  }
  // A working message's field drawn as the card is now.
  function _paintVid(l) {
    if (!l || !l.vid) return;
    l.vid.paint(_clipsOf(l.m), _shapeNow(l.m.media || []));
  }

  // ── The writer's message (phase V16, the owner 2026-10-07) ──
  // With the writer on, ">" packs the words and the attachments into a message of their own - the box and the zone are
  // emptied - and the writer's prompt comes back in it to look at and edit; only its "make the video" spends. A one-step
  // recipe's prompt is the same message (V16.6), its request standing above it. The message is a SUB-PROJECT (vsteps.js):
  // "prompt" - every writing of it a variant - then "video" - every clip of every attempt a variant. The variant of the
  // prompt shown is the one made from.
  // A card written before its prompts had variants has its one prompt and no list: that one is its only variant (`v0`,
  // edited as the card's own).
  const _versOf = (c) => ((c.versions || []).length ? c.versions : c.prompt ? [{ id: 'v0', prompt: c.prompt, model: c.model }] : []);
  function _reviewCard(m, progs) {
    const c = m.card;
    _forget(m.id);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-prompt is-steps is-' + c.state);
    const h = el('div', 'vc-card-h');
    if (c.plain) h.appendChild(el('span', 'k', 'Video'));
    else h.append(el('span', 'k', 'Recipe'), el('span', 't', (c.recipe && c.recipe.title) || ''));
    if (c.model) h.appendChild(el('span', 'm', 'for ' + _labelOf(c.model)));
    box.appendChild(h);
    // (phase V18.3) What was asked, at the head - seen on every step.
    const frames = (m.media || []).some(a => /^frame-/.test(String(a.role || '')));
    const asked = _askedOf(c.plain ? { words: c.text, media: m.media, none: frames ? 'from the frames alone' : 'from the attachments alone' }
      : { request: _requestOf(m), media: m.media });
    // (phase V60.2) What was asked on the left, the video on the right; "read more" of the clip shown at the foot.
    const foot = el('div', 'vm-foot');
    const vid = _vidField(m.id, foot);
    const hd = _headOf(asked, vid);
    box.appendChild(hd.el);
    // (phase V48) A card whose clips are being watched, or were, has its steps at once: what the agent saw comes first.
    if (!_versOf(c).length && !(c.watch || []).length) {
      vid.paint(_clipsOf(m), _shapeNow(m.media || []));
      // (phase V60.3, (вс8а)) The prompt's place, with its countdown or why it was not written.
      if (c.state === 'writing') {
        hd.left.appendChild(_waitField({ word: 'prompt', progs, progKey: 'w:' + m.id, prog: {
          label: 'writing the prompt…', key: 'mv3-video-writer', estimateMs: 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
        } }));
        return box;
      }
      hd.left.appendChild(_waitField({ word: 'prompt', bad: true, words: c.error || 'it was not written' }));
      const acts = el('div', 'vc-card-acts');
      const again = el('button', 'mv3-c-btn vc-go u-btn is-s', 'Write it again');
      again.type = 'button';
      again.addEventListener('click', () => _rewrite(m, again));
      acts.appendChild(again);
      if (c.plain && (m.media || []).length) acts.appendChild(_backLink(m));
      if (_ownRecipe(c)) acts.appendChild(_changeLink());
      box.appendChild(acts);
      return box;
    }
    const steps = stepCard(m.id);
    // (phase V60.3) The steps under what was asked, in the left column; their presses under both columns.
    hd.left.append(steps.parts[0], steps.parts[1]);
    box.append(steps.parts[2], foot);
    const l = { m, el: box, steps, vid, ta: null, go: null, price: null, save: null, review: true, ver: '', vmodel: '', patchKey: '' };
    _live.set(m.id, l);
    _paintReview(m.id, l);
    return box;
  }
  // (phase V60.2, (вч6а)) Two steps at most: what the agent saw of the clips, then the prompt - the video is at the head.
  function _paintReview(id, l) {
    const m = l.m, c = m.card;
    const vers = _versOf(c).map(v => ({ key: v.id, sig: v.model, v }));
    const written = vers.length > 0;
    // (phase V48) The prompt is being written once the clips have been watched - not while they are.
    if (c.state === 'writing' && !_watchBusy(c)) vers.push({ key: 'writing', sig: 'writing', writing: true });
    const steps = [];
    const watch = _watchStep(m, l, written);
    if (watch) steps.push(watch);
    if (vers.length) steps.push({
      key: 'prompt', title: 'prompt', word: 'variant', pick: c.cur || 'v0', variants: vers,
      note: (x) => (!x ? '' : x.writing ? 'being written' : '"make the video" sends this one'),
      body: (x, b, progs, nav) => _promptStep(m, l, x, b, progs, nav),
      acts: (x, a) => _promptActs(m, l, x, a),
      // The variant paged to is the chosen one (the server keeps it for the next read).
      page: (x) => { if (x && x.v && x.key !== 'v0' && x.key !== l.m.card.cur) _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, cur: x.key }, 'PATCH'); },
      freshen: () => _freshenReview(id, l),
    });
    l.steps.paint({ steps });
    _paintVid(l);
  }
  function _promptStep(m, l, x, b, progs, nav) {
    const c = l.m.card;
    l.ta = null; l.ver = ''; l.vmodel = ''; l.patchKey = '';
    if (!x || x.writing) {
      // (phase V48) Counted from the end of the watching, when the clips were watched first.
      const watched = (c.watch || []).map(w => Date.parse((w && w.at) || '') || 0);
      // (phase V60.3, (вс8а)) In the place the prompt will stand in.
      b.appendChild(_waitField({ nav, word: 'prompt', pager: nav ? nav.pager() : null, progs, progKey: 'w', prog: {
        label: _versOf(c).length ? 'writing another variant…' : 'writing the prompt…', key: 'mv3-video-writer', estimateMs: 25000,
        startedAt: Math.max(Date.parse(c.startedAt || m.at) || 0, ...watched),
      } }));
      return;
    }
    const v = x.v;
    if (c.error) b.appendChild(el('div', 'mv3-ig-bad', 'The last writing did not work: ' + c.error));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta u-area';
    ta.spellcheck = true;
    ta.value = toShown(v.prompt);
    ta.title = 'The prompt the model gets - edit it before the video is made. [picture 1], [clip 1] name what is attached, by its number in its part.';
    const key = 'p:' + m.id + ':' + v.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, prompt: toNeutral(ta.value) };
      if (v.id !== 'v0') body.ver = v.id;
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    ta.addEventListener('input', () => { clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    ta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    // (phase V60.3, the owner's (вс3а), (вс4а)) Open at once, down to the bottom of the video; the steps and its variants'
    // pager in its title line.
    b.appendChild(_field({ nav, word: 'prompt', text: () => ta.value, ta, pager: nav ? nav.pager() : null }));
    Object.assign(l, { ta, save, ver: v.id === 'v0' ? '' : v.id, vmodel: v.model || c.model, patchKey: key });
  }
  function _promptActs(m, l, x, a) {
    l.go = null; l.price = null;
    if (!x || x.writing) return;
    const c = l.m.card;
    const nBtn = el('button', 'vc-n u-btn is-s', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = 'How many to make from it - each clip is its own variant of the video';
    nBtn.addEventListener('click', () => {
      _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
      nBtn.textContent = '×' + _cardN.get(m.id);
      _freshenReview(m.id, l);
    });
    const go = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', 'Make the video');
    go.type = 'button';
    go.addEventListener('click', () => _make(l.m, go));
    const price = el('span', 'vc-card-why');
    const again = el('button', 'vc-link', 'Write it again');
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
    l.go.textContent = other ? 'Write it again for ' + mm.label : (made ? 'Make the video again' : 'Make the video') + (n > 1 ? ' ×' + n : '');
    l.go.classList.toggle('is-make', !other);
    l.go.classList.toggle('is-main', !other);
    l.go.disabled = c.state === 'writing';
    const pr = priceOf(rec(), l.m.media || []);
    l.price.textContent = other ? 'this variant was written for ' + _labelOf(vm)
      : !pr || pr.none ? (mm ? mm.label + ' · no published price' : '')
        : pr.fromClip ? (pr.usd != null ? '≈' + money(pr.usd * n) + ' at most · ' + _s(pr.secs) + ' of the clip' : '≈' + money(pr.per) + ' per second of clip') + ' · ' + (mm ? mm.label : '')
          : '≈' + money(pr.usd * n) + ' · ' + _secsWords(pr) + ' · ' + pr.res + ' · '
            + (mm ? mm.label : '') + ' · ' + (rec() ? rec().aggLabel : '');
    // (phase V60.3, (вс9б)) The row of presses stays one line: the price gives way, whole under the pointer.
    l.price.title = l.price.textContent;
  }
  // A finished clip: its poster - a press plays it, and it can be dragged onto a lane (phase V13). (phase V60.2) At its
  // message's head, 180 px wide at its shape. (phase V60.3, the owner's (вс1б)) No "to timeline" under it: the drag lays it.
  function _shotOf(g, cell, open) {
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
      // (phase V49) Not onto a highlights project's own timeline - a fragment is opened first.
      if (refuseHome(box, ev)) return;
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData(Store.DRAG_TYPE, JSON.stringify(item));
      box.classList.add('is-dragging');
    });
    box.addEventListener('dragend', () => box.classList.remove('is-dragging'));
    cell.appendChild(box);
    // (phase V77) Made from a thing of the timeline: the button that lays it back there (js/merge-v3/tl-gen.js).
    const back = backButton(g, g.media || [], { src: g.videoPath, thumb: g.posterPath || null, libId: g.birolId || '',
      name: item.name, dur: +g.duration || 0, w: +g.w || 0, h: +g.h || 0 }, 'video');
    if (back) cell.appendChild(back);
  }

  // "attachments back to the zone" (the owner's answer 6): this message's attachments in the zone again, for the next
  // message - what is there now is replaced, after a question.
  function _backLink(m) {
    const back = el('button', 'vc-link', 'Attachments back to the zone');
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
    // (phase V64 block 3) A WINDOW, no view of the Library panel (chat-window.js): its window is its owner.
    host: true,
    ids: { root: 'mv3-vc' },
    keys: { draft: 'mv3_vc_draft_v1', write: 'mv3_vc_write_v1', strip: 'mv3-vc-strip-w' },
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
      empty: 'Describe a clip. What comes back stays in this project - and on the B-roll shelf.',
      emptyIcon: 'film',
      // (phase V73 block 0) From Home or the Library - THE draft's conversation (chat-owner.js unbound): VIDEO → Generated →
      // the model's folder (phase V60.2).
      emptyDraft: 'Describe a clip. What comes back lies in the Library, in VIDEO → Generated → its model.',
      emptyNoProject: 'Describe a clip. A project is started for it with the first message.',
      onlyFiles: 'Only pictures, clips and sounds can be attached here.',
      slot: 'From the Library or this computer',
      crumb: 'The video chat - clips made with a model',
      plus: 'Add a picture, a clip or a sound from this computer - into the folder open here when it is one of yours of its kind (IMAGES, VIDEO → Uploads, My sounds), else into the root of its kind - and straight into the zone.',
      cat: 'This project\'s clips, or a folder of the Library',
    },
    // (phase V60.2) The right column's "this project": the clips made in it.
    feed: {
      url: (k) => '/api/mv3/video/feed?project=' + encodeURIComponent(k),
      map: (g) => ({
        path: g.videoPath, aspect: Src.shape(g.w, g.h) || (g.params || {}).aspect || '', state: g.state, error: g.error,
        name: String(g.said || g.prompt || '').slice(0, 80), thumb: g.posterPath || '', dur: +g.duration || 0,
        ftype: 'video', libId: g.birolId || '', group: 'videochat',
      }),
    },
    // (phase V60.2, the owner's (вч1б), (вч4б)) The right column: what the zone takes, by the model chosen.
    column: {
      multi: true,
      // (phase V78, (лч16)) THIS PROJECT first - its pictures, and its clips and sounds while the model takes them.
      roots: () => ['plinks', 'references', 'images'].concat(_colTakes('video') ? ['video'] : [], _colTakes('audio') ? ['audio'] : []),
      files: (root) => (root === 'plinks' ? ['photo'].concat(_colTakes('video') ? ['video'] : [], _colTakes('audio') ? ['audio'] : [])
        : root === 'references' ? (_colTakes('video') ? ['photo', 'video'] : 'photo')
        : root === 'video' ? 'video' : root === 'audio' ? 'audio' : 'photo'),
      fit: (f) => { if (!f || f.ftype !== 'video') return true; const c = _clipFit(); return !c.fit || c.fit(f); },
      // Read again when what it offers changes with the model: clips or not, sounds or not, the longest clip.
      sig: () => [_colTakes('video'), _colTakes('audio'), _clipFit().note || ''].join('|'),
      group: 'images', home: 'images',
      play: (it) => openViewer([{ id: it.libId || it.path, kind: 'birols', media: it.path, thumb: it.thumb || it.path, name: it.name || '' }], 0),
    },
    // (phase V13, the owner 2026-10-07) Every "+" of the zone opens the picker on its place.
    pick: {
      // (phase V64 block 4) The Library's unbound chat has no project: no "made in this project".
      sources: (kind) => (SOURCES[kind] || []).filter(s => !(s.id === 'made' && Store.unbound())),
      // (phase V55) The window with the tree, the almanac's size (chat-pick.js). (phase V57, the owner's (ок1): "все клипы
      // длинне чем берет модель") For clips: only the ones the chosen model takes by their length - read at every opening.
      tree: (kind) => (kind === 'video' && Src.TREE.video ? Object.assign({}, Src.TREE.video, _clipFit()) : Src.TREE[kind] || null),
      start: _startFor,
      why: _pickWhy,
      sourceOf: _sourceOf,
      // The shelf a file from this computer is filed on, and what the picker says of it.
      lands: { image: 'images', video: 'uploads', audio: 'sounds' },
      upWords: {
        image: 'A picture goes into the folder open here when it is one of yours in IMAGES - else into IMAGES itself.',
        video: 'A clip goes into the folder open here when it is one of yours in VIDEO → Uploads - else into Uploads itself.',
        audio: 'A sound goes into the folder open here when it is one of yours in My sounds - else into My sounds itself.',
      },
      // A part window left open over the zone goes: the picker covers it.
      onOpen: () => closeTrim(),
    },
    // (phase V27) A clip comes by a link too - the picker's "from a link", into Uploads (its root, V56) and into its place,
    // as a clip from this computer (chat-shell.js _linkIn, lib/link-queue.js).
    links: { video: true },
    // (phase V7) Each kind through its own door - pictures into IMAGES, clips into VIDEO -> Uploads, sounds into SFX ->
    // My sounds, each into the root of its kind (phase V56, (ги4)) or, through the attachment window, the person's folder open
    // there (V57) - and straight into their part of the zone.
    uploads: {
      image: { url: '/api/mv3/img/upload', field: 'image', accept: PICTURE_ACCEPT, ok: isPictureFile,
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
    // (phase V18.3, the owner 2026-10-08) ONE MESSAGE PER SEND: the person's turns are not drawn apart - what was asked
    // heads its answer - nor is a recipe's request card, which heads the prompt card written from it; the message is
    // drawn at the press.
    hidden: (m) => m.role === 'user' || !!(m.card && m.card.type === 'recipe'),
    askedHead: (m, user) => {
      const media = (m.media || []).length ? m.media : ((user && user.media) || []);
      const words = m.asked != null ? m.asked : (user ? user.text : '');
      return (String(words || '').trim() || media.length) ? _askedOf({ words, media }) : null;
    },
    sending: (o) => _sendingCard(o),
    // (phase V60.2, (вч17а)) A message of the one press has the working message's head.
    bubble: (m, progs, asked) => _plainBubble(m, progs, asked),
    // (phase V7) Clips and sounds in the zone: the part that goes, and what the cell says of it.
    attState: _attState,
    onAttach: (a) => { _onAttach(a); },
    trimFor: _trimFor,
    // (phase V60.2, (вч11а)) Whatever hides the chat folds every prompt again.
    onHide: () => { closeTrim(); closeHelp(); _foldAll(); },
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
      onProject: () => { closeHelp(); _foldAll(); if (_set) _paintParams(); },
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

    // A finished clip: the field at a message's head draws it (phase V60.2), the shell's results too.
    shot: _shotOf,

    facts: (g) => [
      ['model', (g.model || '') + ' · ' + (g.agg || '?') + ' · ' + (((g.params || {}).resolution) || '')],
      ['length', g.duration ? (+g.duration).toFixed(1) + ' s' + (g.w && g.h ? ' · ' + g.w + '×' + g.h : '') : ''],
      ['took', g.secs ? g.secs + 's' : ''],
      ['cost', g.credits ? g.credits + ' kie credits (≈' + money(g.credits * 0.005) + ')' : ''],
      ['references', (g.media || []).length ? String(g.media.length) : ''],
      // (phase V7.4) Where the model did not keep the clip's sound itself.
      ['sound', g.underlay === 'laid' ? 'the clip\'s sound, laid under it' : (g.underlay || '')],
      ['writer', g.fell && !/^sent in English/.test(g.fell) ? 'sent as typed - ' + g.fell : (g.writer || '')],
      // A clip from before phase V29 that went in Chinese - its history; every clip since goes in English.
      ['language', g.lang === 'zh' ? 'sent in 中文' : /^sent in English/.test(g.fell || '') ? g.fell : ''],
      ['in 中文', g.lang === 'zh' ? (g.sent || '') : ''],
      ['sent as', (g.prompt && g.said && g.prompt !== g.said) ? g.prompt : ''],
    ],

    // Every clip this thread finished, played in the Library's viewer.
    view(done, at) {
      openViewer(done.map(x => ({ id: x.id, kind: 'birols', media: x.videoPath, thumb: x.posterPath || x.videoPath,
        name: x.said || x.prompt || '', meta: { date: x.at } })), at);
    },

    // (phase V34.E, the owner's (м2)) The catalog's button beside "/ generate video" went - its recipes, vcatalog.js,
    // routes/mv3-catalog.js and vendor/cookbook/ stay for the guidelines to come. A recipe already in use still opens it
    // from its line above the thread.
  };
}

const CHAT = createChat(VIDEOS);
const WIN = chatWindow({ chat: CHAT, id: 'mv3-vc', cls: 'is-video', name: 'video chat', title: 'generate video' });

/** Every way in - VIDEO's "generate", the lane's right-click, ?open=videos, Alerts: its window (phase V64 block 3). */
export async function openVideos(o) {
  await WIN.open();
  // (phase V77) Opened with a thing from the timeline (js/merge-v3/tl-gen.js).
  if (o && o.attach && _api) await _api.fromTimeline(o);
}
export const closeVideos = () => WIN.close();

export function initVidChat() { CHAT.init(); }
