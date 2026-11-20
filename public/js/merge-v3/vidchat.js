/* ════════════════════════════════════════════════════════════════════════════
   MERGE — making clips, as a conversation, in a window.

   The pictures chat's shell (chat-shell.js) with its own description: its own window (chat-window.js), column and
   box, its own conversation (kind 'clip'). The server side
   (routes/mv3-video.js): a press writes the turn, a record and an Alerts row for each clip asked for, and the
   work - the writer, the references hosted, the aggregator asked, the clip fetched and filed as a B-roll in its
   model's folder (VIDEO -> Generated -> <model>) - goes on behind it.

   What is this chat's own:
   - ONE dropdown of every model, each its own line with its price; the chosen model shows ITS OWN parameters
     (duration, quality, shape, sound, Grok's mode, how Seedance reads the pictures, Kling's orientation) and the
     price of this send; the aggregator beside it with its own rate - the cheapest with a working key by default.
   - A line under the model's dropdown says what the chosen model does and what to attach.
   - Kling motion control's VIDEO has no writer - Kling gets its own prompt. With the writer off the box IS that prompt
     (empty: the standard one); with it on the box says what to take from which picture, and the first frame is drawn
     before the video.
   - Every "+" of the attachment zone opens the picker on its place (chat-pick.js) - the
     Library's shelves of that kind and this computer. A clip that lands is not put in the zone by itself - it is one press
     on it there, under "made in this project".
   - A RIGHT COLUMN, the pictures chat's folder column
     (js/folder-column.js): "this project" - the clips made here - first, then REFERENCES, IMAGES, VIDEO and AUDIO; a press
     puts a picture, a clip or a sound into its part of the zone. VIDEO is not there while the model takes no clips (and
     AUDIO while it takes no sounds), and a clip longer than the model takes is not shown (the attachment window's rule, _clipFit).
   - Clips and sounds are references too: from this project's clips, B-roll, Uploads, the Sounds shelf, this
     computer or a lane of the timeline; each goes as the PART of it the person chose (vtrim.js), the first seconds
     the model takes by default, and the price follows that part.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './chat-owner.js';
import { openViewer } from '../library/viewer.js';
import { createChat, el, money, json, stored, keep, thumbOf, refCell, ratioOf, refuseHome, switchRow, mediaBtn, hoverClip } from './chat-shell.js';
import { chatWindow, CHAT_WIN } from './chat-window.js';
import * as Src from './chat-sources.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';
import { openTrim, closeTrim } from './vtrim.js';
import { openHelp, closeHelp } from './vhelp.js';
import { stepCard } from './vsteps.js';
import { note, askDelete } from '../ask.js';
// The model table being read or not read - the shared parts (a row of the column); the reason a popup.
import { emptyEl, loadingEl, failedEl, cap as capFirst } from '../ui-state.js';
import { showError } from '../notice.js';
import { startInlineProgress } from '../progress.js';
import { wire as wireRange } from '../ui-range.js';
import { backButton } from './tl-gen.js';
// The interface's words (`t` is a time and a target here, so the module's words are T.t). What goes to a model or the
// server stays English: the box's text, the prompts, a slot's `label`, the zone's `noun`.
import * as T from '../i18n/t.js';

const LS_LAST = 'mv3_vc_last_v1';         // { model, agg: { <model>: agg }, params: { <model>: {...} } }
const SHOW_ATTS = 9;                       // the row's places at most (the zone grows instead)
const MAX_PICS = 30;                       // pictures at most, whatever a model says (Seedance 2.5 takes 30)
const MAX_ATTS = 50;                       // everything attached at most - pictures, clips and sounds

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// The description's way in from outside (openVideos with a thing from the timeline) - set when it is made.
let _api = null;

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
  // Seedance's sound beside a clip: 'clip' (the default - laid under), 'on' (its own) or 'off'.
  const _clipSoundOf = (p) => (['clip', 'on', 'off'].includes(p.clipSound) ? p.clipSound : 'clip');
  function setParam(k, v) {
    const m = model();
    if (!m) return;
    _last.params[m.id] = Object.assign({}, _last.params[m.id] || {}, { [k]: v });
    _remember();
  }
  const isMC = () => (model() || {}).family === 'kmc';
  // Kling motion control STEP BY STEP: with the writer on, the person's pictures (the
  // character - and a place, clothes or a thing, said in the box from which) and a still of the clip go to the writer and
  // a picture model first; the first frame is drawn, and Kling moves it with the clip from that moment.
  const _mcSteps = () => isMC() && ctx.writing();
  // As many pictures as the picture model takes beside the still (nano-banana-2: 14 references, one is the still).
  const _frameRoom = () => {
    const ps = ((_table && _table.frame && _table.frame.providers) || []).filter(p => p.usable);
    return Math.max(1, Math.min(13, (ps.length ? Math.max(...ps.map(p => p.maxRefs || 2)) : 14) - 1));
  };
  // Seedance's pictures as FRAMES - "pictures are": 'frame' the first frame, 'fl' the first
  // and the last. The zone's pictures are then those places alone, both required; beside a clip or a sound they go as
  // references (Seedance takes frames OR references - kie, Replicate and ByteDance all say so), and the prompt names
  // them. The writer writes the animation from the frames, with the words or without - the server says in its first
  // sentence that the clip starts exactly on the first frame (and ends exactly on the last).
  const _asOf = () => { const m = model(); return m && m.family === 'seedance' ? (params().picturesAs || 'refs') : 'refs'; };
  const _framesMode = () => _asOf() === 'frame' || _asOf() === 'fl';
  function _frameSlots() {
    const s = [{ key: 'first', label: T.t('first frame'), kind: 'frame-first', role: '', min: 1, max: 1, required: true, hint: T.t('The video starts exactly on this picture') }];
    if (_asOf() === 'fl') s.push({ key: 'last', label: T.t('last frame'), kind: 'frame-last', role: '', min: 1, max: 1, required: true, hint: T.t('The video ends exactly on this picture') });
    return s;
  }
  const _frameKeys = () => _frameSlots().map(s => s.key);
  const _onlyFrames = () => (_asOf() === 'fl' ? T.t('In this mode only the first and last frames go') : T.t('In this mode only the first frame goes'));
  // The column's STORYBOARD: ticked, under Seedance, with the writer, and not with frames
  // (the sheet goes as a reference). ">" writes its sheet's prompt, and every paid step waits for its press on its message.
  const _boardOn = () => { const m = model(); return !!params().storyboard && !!m && m.family === 'seedance' && ctx.writing() && !_framesMode(); };
  // What is attached, by kind (the zone has pictures, clips and sounds).
  const _kind = (a) => (a && (a.kind === 'video' || a.kind === 'audio') ? a.kind : 'image');
  const _pics = () => ctx.atts().filter(a => _kind(a) === 'image');
  const _clips = () => ctx.atts().filter(a => _kind(a) === 'video');
  const _sounds = () => ctx.atts().filter(a => _kind(a) === 'audio');
  // "<model> takes no pictures / clips / sounds." - whole, by the kind.
  const _takesNo = (k, model) => (k === 'video' ? T.t('{model} takes no clips.', { model })
    : k === 'audio' ? T.t('{model} takes no sounds.', { model }) : T.t('{model} takes no pictures.', { model }));
  // The seconds of a clip or a sound that go - its part.
  const _span = (a) => Math.max(0, (+a.out || 0) - (+a.in || 0));
  const _s = (v) => T.t('{n} s', { n: (+v).toFixed(1).replace(/\.0$/, '') });

  // ── The part of a clip or a sound that goes ────────────────────
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
          why: img ? T.t('{model} follows {min}-{max} s of the moves when the character keeps the picture\'s orientation - and is billed by them.', { model: m.label, min: r.duration.min || 3, max: cap })
            : T.t('{model} follows {min}-{max} s of the moves - and is billed by them.', { model: m.label, min: r.duration.min || 3, max: cap }) };
      }
      const [lo, hi] = L.clipSecs || [2, 15];
      const all = L.videoSecs || hi;
      // The only clip is the video's length: 4 s at least (lib/video-models.js byClip).
      const alone = !!r.oneClip && !ctx.atts().some(x => x !== a && x.path !== a.path && _kind(x) === 'video');
      if (alone) {
        const least = Math.max(lo, r.oneClip.least || 4);
        return { min: least, max: Math.min(hi, all), all,
          why: r.agg === 'kie' ? T.t('{model} makes the video as long as its clip: {min}-{max} s - kie bills its seconds too.', { model: m.label, min: least, max: hi })
            : T.t('{model} makes the video as long as its clip: {min}-{max} s.', { model: m.label, min: least, max: hi }) };
      }
      return { min: lo, max: Math.min(hi, Math.max(0, all - others)), all,
        why: r.agg === 'kie' ? T.t('{model} takes clips of {min}-{max} s, {all} s in all - kie bills their seconds too.', { model: m.label, min: lo, max: hi, all })
          : T.t('{model} takes clips of {min}-{max} s, {all} s in all.', { model: m.label, min: lo, max: hi, all }) };
    }
    if (k === 'audio') {
      if (!(L.audios > 0)) return null;
      const all = L.audioSecs || 15;
      return { min: 0.5, max: Math.max(0, all - others), all, why: T.t('{model} takes {all} s of sound in all.', { model: m.label, all }) };
    }
    return null;
  }
  // Why a clip or a sound cannot go as it is ('' when it can) - the cell turns red and the send says it.
  function _spanWrong(a) {
    const k = _kind(a), m = model();
    const clip = k === 'video';
    if (!(+a.dur > 0)) return T.t('its length is not known yet - is the file whole?');
    const rule = _spanRule(a);
    if (!rule) return _takesNo(k, (m && m.label) || T.t('This model'));
    const span = _span(a);
    if (!(span > 0)) return T.t('no part of it is chosen - press its seconds');
    if (+a.dur < rule.min - 0.05) {
      const o = { secs: _s(a.dur), model: m.label, min: _s(rule.min) };
      return clip ? T.t('it is {secs} - {model} needs a clip of at least {min}', o) : T.t('it is {secs} - {model} needs a sound of at least {min}', o);
    }
    if (span < rule.min - 0.05) return T.t('the part is {secs} - {model} needs at least {min} - press its seconds', { secs: _s(span), model: m.label, min: _s(rule.min) });
    if (span > rule.max + 0.05) {
      if (rule.max < (rule.all || 0) - 0.05) {
        return clip ? T.t('with the other clips it is more than {all} in all - shorten one', { all: _s(rule.all) })
          : T.t('with the other sounds it is more than {all} in all - shorten one', { all: _s(rule.all) });
      }
      return T.t('the part is {secs} - {model} takes {max} - press its seconds', { secs: _s(span), model: m.label, max: _s(rule.max) });
    }
    return '';
  }
  // What the zone's cell says of it (the shell asks): red with the reason, or gold seconds when only a part goes; a picture
  // beyond the frames' places dimmed, with the reason.
  function _attState(a) {
    if (_kind(a) === 'image') {
      return _framesMode() && !_frameKeys().includes(a.slot) ? { off: T.t('{only} - take this one off, or set "pictures are" to references', { only: _onlyFrames() }) } : null;
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
      // Another project opened meanwhile: its own attachment of the same file is not this one.
      if (ctx.key() !== key0) return;
      if (d && d.success && +d.duration > 0) dur = Math.round(+d.duration * 100) / 100;
      if (d && d.success && ((k === 'video' && !(d.w > 0)) || (k === 'audio' && !d.audio))) {
        ctx.detach(a.path);
        ctx.say(k === 'video' ? T.t('Not attached: it has no picture in it.') : T.t('Not attached: it has no sound in it.'));
        return;
      }
    }
    const now = ctx.atts().find(x => x.path === a.path);
    if (!now) return;
    if (!dur) { ctx.setAtt(a.path, { dur: '' }); return; }
    const rule = _spanRule(now);
    if (rule && rule.max < rule.min - 0.05) {
      ctx.detach(a.path);
      ctx.say(T.tn(rule.all - rule.max, '{why} {secs} of it is taken - shorten one first.', '{why} {secs} of it are taken - shorten one first.', { why: rule.why, secs: _s(rule.all - rule.max) }));
      return;
    }
    let from = +now.in >= 0 && +now.out > +now.in ? Math.max(0, Math.min(+now.in, dur)) : 0;
    let to = +now.out > from ? Math.min(+now.out, dur) : dur;
    if (rule) {
      if (to - from > rule.max) to = from + rule.max;
      if (to - from < rule.min && dur >= rule.min) { to = Math.min(dur, from + rule.min); from = Math.max(0, to - rule.min); }
    }
    ctx.setAtt(a.path, { dur, in: Math.round(from * 100) / 100, out: Math.round(to * 100) / 100 });
    // Kling motion control: the clip opens on its first frame's slider at once.
    if (k === 'video' && isMC()) { setTimeout(() => _autoStill(a.path), 150); return; }
    if (dur > to - from + 0.05) {
      ctx.say(from ? T.t('{dur} → {secs} from {from} go - press its seconds to choose another part.', { dur: _s(dur), secs: _s(to - from), from: _s(from) })
        : T.t('{dur} → the first {secs} go - press its seconds to choose another part.', { dur: _s(dur), secs: _s(to - from) }));
    }
  }
  function _autoStill(path) {
    const a = ctx.atts().find(x => x.path === path);
    const ui = ctx.ui();
    if (!a || !isMC() || !ui) return;
    _trimFor(a, ui.atts.querySelector('.mv3-ig-att[data-path="' + CSS.escape(path) + '"]'));
  }

  // The part chosen by hand: the clip (or the sound) in a panel over the zone, its window within what the model takes.
  // The attachment whose part window is open - the window goes with it when it is taken off.
  let _trimPath = '';
  function _trimFor(a, cell) {
    const dur = +a.dur || 0;
    if (!dur) { ctx.say(T.t('Its length is not known - it cannot be cut.')); return; }
    const k = _kind(a);
    const rule = _spanRule(a) || { min: 0.5, max: dur, why: '' };
    // Under Kling motion control the part starts on the first frame, picked on a slider.
    const still = isMC() && k === 'video';
    openTrim({
      anchor: cell, kind: k, src: a.path, poster: a.poster ? thumbOf(a.poster, 'main') : '', dur,
      from: +a.in || 0, to: +a.out || Math.min(dur, rule.max),
      min: Math.min(rule.min, dur), max: Math.max(Math.min(rule.min, dur), rule.max),
      title: a.name || (k === 'audio' ? T.t('the sound') : T.t('the clip')),
      why: !still ? rule.why : ctx.writing() ? T.t('Pick the moment your character is seen best: the first frame is drawn from it, and the moves go from there. {why}', { why: rule.why })
        : T.t('Pick the moment the moves start from. {why}', { why: rule.why }),
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
  // What the right column offers: everything until the models are read.
  const _colTakes = (k) => !_table || _takes(k);
  // ONE clip decides Seedance's length and shape (lib/video-models.js byClip): the
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
  const _secsWords = (pr) => (pr.byClip ? (pr.vidIn ? T.t('{out} (as long as the clip) + {in} of the clip', { out: _s(pr.out), in: _s(pr.vidIn) }) : T.t('{out} (as long as the clip)', { out: _s(pr.out) }))
    : pr.vidIn ? T.t('{out} s + {in} of the clips', { out: pr.out, in: _s(pr.vidIn) }) : T.t('{n} s', { n: pr.secs }));

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
    ctx.say(gone.length === 1 ? (_kind(gone[0]) === 'video' ? T.t('A clip of the zone is not in the library any more.') : T.t('A sound of the zone is not in the library any more.'))
      : T.t('{n} clips and sounds of the zone are not in the library any more.', { n: gone.length }));
  }

  // A clip let go over the zone from a lane of the timeline (timeline-b.js): the part of its file the timeline plays.
  window.addEventListener('mv3:clip-out', (ev) => {
    const d = ev.detail || {};
    if (!ctx.shown() || !d.src) return;
    const k = d.kind === 'audio' ? 'audio' : 'video';
    if (!_takes(k)) { ctx.say(_takesNo(k, (model() || {}).label || T.t('This model'))); return; }
    const was = ctx.atts().find(x => x.path === d.src);
    if (was) {
      // One place per file: a clip's sound twin let go over the sounds is not the clip attached already.
      if (_kind(was) !== k) { ctx.say(_kind(was) === 'video' ? T.t('This file is attached already as a clip - one place per file.') : T.t('This file is attached already as a sound - one place per file.')); return; }
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
    // With a reference clip a rate's second figure is the one asked (lib/video-models.js price), and the
    // clip's seconds count: Kling is billed by the seconds of the moves, kie's Seedance by the clip's AND the video's.
    const clips = media ? media.filter(x => x && x.kind === 'video') : (_takes('video') ? _clips() : []);
    // Kling follows ONE clip - the first; Seedance's clips count together.
    const vidIn = r.duration.fromClip ? _span(clips[0] || {}) : clips.reduce((s, a) => s + _span(a), 0);
    const rate = (r.rates || {})[res];
    const per = Array.isArray(rate) ? rate[clips.length ? 1 : 0] : (rate == null ? null : rate);
    if (per == null) return { none: true, res };
    if (r.duration.fromClip) {
      const cap = p.orientation === 'image' ? (r.limits.videoSecsImage || 10) : (r.limits.videoSecs || 30);
      // kie bills Kling by the whole seconds that come back, rounded down.
      const secs = !vidIn ? 0 : r.billWhole ? Math.max(1, Math.floor(Math.min(vidIn, cap) + 0.001)) : Math.min(vidIn, cap);
      return { per, res, fromClip: true, whole: !!r.billWhole, secs, usd: secs ? per * secs : null };
    }
    // One Seedance clip: the video is as long as the clip - kie bills the clip's seconds and the video's.
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
    if (r.duration.fromClip) return T.t('{model} · {price} / s of clip', { model: m.label, price: money(_perSec(r, r.resDef)) });
    return t.usd != null ? T.t('{model} · ≈{price} / 10 s', { model: m.label, price: money(t.usd) }) : m.label;
  }

  async function load() {
    if (_table) { paint(); return; }
    const d = await json('/api/mv3/video/matrix');
    if (d && d.success) { _table = d; _err = ''; }
    else {
      _err = (d && d.error) || T.t('could not read the models');
      showError(capFirst(_err));
    }
    paint();
    ctx.paintAtts();
  }

  function _row(host, label, ctl, cls) {
    const r = el('div', 'mv3-ig-row' + (cls ? ' ' + cls : ''));
    if (ctl.tagName === 'SELECT') ctl.classList.add('u-in', 'is-s');   // the shared field at 24
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
      // Not read: "did not load" with Try again - the reason a popup (load). A table with no
      // model says so rather than "reading" for ever.
      host.appendChild(_err ? failedEl(T.t('The models'), () => { _err = ''; paint(); load(); }, { line: true })
        : _table ? emptyEl(T.t('No video models.'), { line: true }) : loadingEl(T.t('reading the models…'), { line: true }));
      _set = null;
      return;
    }
    if (!_set) {
      host.textContent = '';
      const mSel = _select('mv3-vc-model', T.t('The model - each its own price'), models().map(m => ({
        value: m.id, text: _modelLine(m), disabled: !m.usable, title: m.why,
      })), _last.model, (v) => { _last.model = v; _recent(v); _remember(); _paintModel(); ctx.paintAtts(); });
      _row(host, T.t('model'), mSel);
      // What the chosen model does and what to attach - under its dropdown.
      const brief = el('div', 'mv3-vc-brief');
      host.appendChild(brief);
      const aSel = document.createElement('select');
      aSel.id = 'mv3-vc-agg';
      aSel.title = T.t('Who is asked');
      aSel.addEventListener('change', () => { const m = model(); if (m) { _last.agg[m.id] = aSel.value; _remember(); } _paintParams(); ctx.paintAtts(); });
      _row(host, T.t('aggregator'), aSel, 'is-prov');
      const box = el('div', 'mv3-vc-params');
      host.appendChild(box);
      // The writer and the storyboard - the switches of how the message goes.
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

  // The switches: the writer and the storyboard. Every prompt goes in English.
  function _paintSwitches() {
    if (!_set) return;
    const m = model();
    const box = _set.sw;
    box.textContent = '';
    if (!m) return;
    // The storyboard, under the writer: its sheet's prompt is the writer's, so ticking it switches the writer on
    // - and holds it on while it is ticked.
    const bWhy = m.family !== 'seedance' ? T.t('A storyboard is drawn for Seedance - pick a Seedance model')
      : _framesMode() ? T.t('The storyboard goes to the video as a reference picture - not with frames: set "pictures are" to references')
      : !(_table && _table.r2) ? T.t('The storyboard goes to the video as a picture, from a public link - set R2 on Admin → API keys') : '';
    const held = !bWhy && _boardOn();
    // The writer is a switch like the storyboard - on by default: the shared switch (.u-switch), its word beside it.
    const wr = switchRow(T.t('Writer'), ctx.writing(), held, (v) => ctx.setWriting(v));
    if (held) wr.classList.add('is-held');
    // Under Kling motion control the writer writes the first frame's picture prompt.
    wr.title = held ? T.t('The storyboard is written by the writer - untick the storyboard first')
      : isMC() ? T.t('On: the writer reads your pictures and the still of the clip and writes the first frame\'s prompt - you see the prompt, then the picture, then the video, each paid step by its own press. Off: one picture and the clip go straight to Kling.')
        : T.t('The writer - a prompt engineer - writes the prompt this model wants from your message and attachments. Off: your words go as typed (translated into English when they are not).');
    box.appendChild(wr);
    const sb = switchRow(T.t('Storyboard'), !bWhy && _boardOn(), !!bWhy, (v) => {
      setParam('storyboard', v);
      if (v && !ctx.writing()) ctx.setWriting(true);
      _paintSwitches();
      _paintPrice();
      ctx.paintAtts();
    });
    if (bWhy) sb.classList.add('is-off');
    sb.title = bWhy || T.t('A storyboard first: the writer turns your message and pictures into the prompt of a sheet of numbered panels - nothing is paid at ">". On its message "draw the storyboard" draws the sheet (4K), "write the video" writes the video with it among the pictures and "make the video" makes it - each paid step by its own press. While it is ticked the writer stays on.');
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
      o.textContent = r.usable ? (per != null ? T.t('{agg} · {price}/s', { agg: r.aggLabel, price: money(per) }) : r.aggLabel) : (r.why || T.t('{agg} - cannot be asked', { agg: r.aggLabel }));
      o.disabled = !r.usable;
      _set.agg.appendChild(o);
    }
    const want = recOf(m, _last.agg[m.id]) && recOf(m, _last.agg[m.id]).usable ? _last.agg[m.id] : m.defaultAgg;
    if (want) _set.agg.value = want;
    _set.agg.disabled = m.records.filter(r => r.usable).length < 2;
    // Kling's prompt is put in by the server - the box holds no standard text, and a draft's box that holds it is
    // emptied. The box's hint is painted with the model's settings.
    const std = _table.standardPrompt || '';
    if (std && ctx.text() === std) ctx.setText('');
    _set.brief.textContent = m.brief;
    _paintParams();
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
    // Beside a clip or a sound Seedance's pictures are references - frames go only on their own.
    const mixed = _takes('video') && _clips().length + _sounds().length > 0;
    // One clip: the length and the shape are the clip's - shown, not chosen; several: chosen here.
    const one = _byClip(r);
    if (!r.duration.fromClip && one) {
      const out = _clipOut(r, one);
      const sel = _select('mv3-vc-dur', '', [{ value: 'clip', text: out ? T.t('As the clip · {secs}', { secs: _s(out) }) : T.t('As the clip') }], 'clip');
      sel.disabled = true;
      sel.title = r.oneClip.auto ? T.t('With one clip {model} makes the video as long as the clip. With several clips the length is chosen here.', { model: m.label })
        : T.t('With one clip {model} makes the video as long as the clip, rounded to a whole second. With several clips the length is chosen here.', { model: m.label });
      _row(box, T.t('length'), sel);
    } else if (!r.duration.fromClip) {
      const opts = [];
      for (let s = r.duration.min; s <= r.duration.max; s++) opts.push({ value: String(s), text: T.t('{n} s', { n: s }) });
      _row(box, T.t('length'), _select('mv3-vc-dur', T.t('How long the clip is'), opts, clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max),
        (v) => { setParam('duration', +v); _paintPrice(); }));
    }
    _row(box, T.t('quality'), _select('mv3-vc-res', T.t('Resolution'), r.resolutions.map(x => ({ value: x, text: x })),
      r.resolutions.includes(p.resolution) ? p.resolution : r.resDef, (v) => {
        setParam('resolution', v);
        _paintPrice();
        // The zone's places can change with it (Grok 1.5 on kie: one picture at 1080p).
        if (r.limits.imagesAt) ctx.paintAtts();
      }));
    // The shape: with a picture Grok takes the picture's (Grok 1.5 on kie: with one - several are references, and the
    // shape is chosen again), and Seedance's frames take theirs.
    if (r.aspects && r.aspects.length && one) {
      const sel = _select('mv3-vc-ar', '', [{ value: 'clip', text: T.t('As the clip') }], 'clip');
      sel.disabled = true;
      sel.title = T.t('With one clip the video takes the clip\'s shape. With several clips the shape is chosen here.');
      _row(box, T.t('shape'), sel);
    } else if (r.aspects && r.aspects.length) {
      const fmt = (Store.timeline() || {}).format || '9:16';
      // Frames on their own make the clip in their shape; beside a clip or a sound they go as references.
      const fixed = n > 0 && ((fam === 'grok' && !(r.aspectWithImages && n > 1)) || (fam === 'seedance' && _framesMode() && !mixed));
      const sel = _select('mv3-vc-ar', T.t('Shape'), r.aspects.map(a => ({ value: a, text: a + (a === fmt ? ' •' : '') })),
        r.aspects.includes(p.aspect) ? p.aspect : (r.aspects.includes(fmt) ? fmt : r.aspects[0]), (v) => { setParam('aspect', v); _freshenCards(); });
      sel.disabled = fixed;
      if (fixed) sel.title = T.t('The clip takes the shape of the picture');
      _row(box, T.t('shape'), sel);
    }
    if (r.extra && r.extra.mode) {
      _row(box, T.t('mode'), _select('mv3-vc-mode', T.t('How Grok plays it'), r.extra.mode.map(x => ({
        value: x, text: x, disabled: x === 'spicy' && n > 0, title: T.t('spicy only from words - an outside picture plays it normal'),
      })), p.mode || 'normal', (v) => setParam('mode', v)));
    }
    if (fam === 'seedance') {
      // With a clip attached the sound can be the CLIP's: Seedance makes none, and the
      // clip's part is laid under the video when it lands.
      // With a clip the clip's sound is the DEFAULT: Seedance with its own sound beside a
      // reference clip says the clip's words over again. The choice beside a clip is remembered on its own
      // (`clipSound`), so "with sound" chosen for words alone does not turn it back.
      const withClip = _takes('video') && _clips().length > 0;
      const opts = [{ value: 'on', text: withClip ? T.t('the model\'s sound') : T.t('with sound') }];
      if (withClip) opts.push({ value: 'clip', text: T.t('The clip\'s sound') });
      opts.push({ value: 'off', text: T.t('Silent') });
      const now = withClip ? _clipSoundOf(p) : (p.audio !== false ? 'on' : 'off');
      const sel = _select('mv3-vc-audio', withClip ? T.t('With a clip, the first clip\'s sound is laid under the video when it lands - Seedance\'s own sound would say the clip\'s words over again') : T.t('Seedance makes its own sound'),
        opts, now, (v) => { if (withClip) setParam('clipSound', v); else setParam('audio', v === 'on'); });
      _row(box, T.t('sound'), sel);
      // Chosen first, even before a picture: the zone lays out the frames' places for it.
      _row(box, T.t('pictures are'), _select('mv3-vc-as', T.t('What the pictures are for: references the video uses, or the frame it starts on (and the one it ends on)'), [
        { value: 'refs', text: T.t('References') },
        { value: 'frame', text: T.t('The first frame') },
        { value: 'fl', text: T.t('First and last frames') },
      ], _asOf(), (v) => { setParam('picturesAs', v); ctx.reslot(); _paintParams(); }));
    }
    if (fam === 'kmc') {
      _row(box, T.t('orientation'), _select('mv3-vc-or', T.t('Which way the character faces'), [
        { value: 'video', text: T.t('As in the clip (up to 30 s)') }, { value: 'image', text: T.t('As on the picture (up to 10 s)') },
      ], p.orientation || 'video', (v) => { setParam('orientation', v); ctx.paintAtts(); ctx.columnChanged(); }));
      // Whose background: the picture's, always - Kling puts the moves into the picture's place (kie's "keep the
      // clip's room" for 3.0 comes back on the picture's background too). Said, not chosen.
      const bg = _select('mv3-vc-bg', T.t('Kling puts the moves into your picture\'s place - the room of the clip does not come along. For another place, keep the writer on: it draws the first frame with your character there.'),
        [{ value: 'image', text: T.t('From your picture') }], 'image', () => {});
      bg.disabled = true;
      _row(box, T.t('background'), bg);
      // The clip's sound: Replicate's Kling keeps it itself; on kie it is laid under the video when it lands.
      _row(box, T.t('sound'), _select('mv3-vc-keep', r.keepSound ? T.t('The clip\'s own sound - Kling keeps it') : T.t('The clip\'s own sound - laid under the video when it lands'),
        [{ value: 'on', text: T.t('Keep the clip\'s sound') }, { value: 'off', text: T.t('Silent') }],
        p.keepSound === false ? 'off' : 'on', (v) => setParam('keepSound', v === 'on')));
    }
    // With frames the words may be left out - the writer decides the motion from the frames. Under
    // Kling the box says what it is for: with the writer, what to take from which picture; without it, Kling's prompt.
    ctx.placeholder(isMC()
      ? (ctx.writing() ? T.t('What to take from which picture - "the character from 1, the place from 2, the hat from 3 on her head" - or nothing, and the writer works it out. Kling gets its own prompt.')
        : T.t('The prompt Kling gets, in English - empty, the standard one'))
      : !_framesMode() ? '' : _asOf() === 'fl' ? T.t('What happens from the first frame to the last - or leave it empty, and the writer decides')
        : T.t('What happens from the first frame - or leave it empty, and the writer decides'));
    _paintSwitches();
    _paintPrice();
    // The right column follows the model: its VIDEO and AUDIO, the longest clip it shows.
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
      box.innerHTML = '<b>&mdash;</b><span>' + T.t('no published price for this one') + '</span>';
    } else if (pr.fromClip) {
      box.className = 'mv3-ig-cost';
      box.innerHTML = pr.usd != null
        ? '<b>≈' + money(pr.usd) + '</b><span>' + T.t('at most · {secs} of your clip × {per}/s · {res} · {agg}', { secs: _s(pr.secs), per: money(pr.per), res: pr.res, agg: r.aggLabel })
          + (many > 1 ? ' · ' + T.t('{sum} for {n}', { sum: money(pr.usd * many), n: many }) : '') + '</span>'
        : '<b>≈' + money(pr.per) + '</b><span>' + T.t('per second of your clip · {res} · {agg}', { res: pr.res, agg: r.aggLabel }) + '</span>';
    } else {
      box.className = 'mv3-ig-cost';
      box.innerHTML = '<b>≈' + money(pr.usd) + '</b><span>' + T.t('per clip · {secs} · {res} · {agg}', { secs: _secsWords(pr), res: pr.res, agg: r.aggLabel })
        + (many > 1 ? ' · ' + T.t('{sum} for {n}', { sum: money(pr.usd * many), n: many }) : '') + '</span>';
    }
    // The storyboard first: what the sheet costs now, and the video's price for later - its own press.
    if (_boardOn() && pr && !pr.none && !pr.fromClip) {
      const sp = _sheetPrice(_pics().filter(a => a.role !== 'storyboard').length);
      box.className = 'mv3-ig-cost';
      box.textContent = '';
      box.append(el('b', null, sp.usd != null ? '≈' + money(sp.usd) : '—'),
        el('span', null, T.t('the storyboard first · {what} · then, by its own press, the video ≈{price}', { what: sp.words, price: money(pr.usd * many) })));
    }
    // Kling step by step: the first frame first, and the video after it - each by its own press.
    if (_mcSteps() && pr && !pr.none) {
      const fi = _table && _table.frame;
      const fp = fi && (fi.providers || []).find(p => p.usable);
      box.className = 'mv3-ig-cost';
      box.textContent = '';
      const vp = pr.usd != null ? '≈' + money(pr.usd * many) : T.t('≈{price} per second of the clip', { price: money(pr.per) });
      box.append(el('b', null, fp && fp.price != null ? '≈' + money(fp.price) : '—'),
        el('span', null, fi ? T.t('the first frame first · {quality} · {engine} · then, by its own press, the video {price}', { quality: fi.quality, engine: fi.label, price: vp })
          : T.t('the first frame first · then, by its own press, the video {price}', { price: vp })));
    }
    if (ctx.priceFrom) ctx.priceFrom(box);
    const notes = [];
    if (r && r.priceNote) notes.push(r.priceNote);
    if (r && r.duration.fromClip) notes.push(r.billWhole ? T.t('the most it costs: billed by the whole seconds that come back, rounded down') : T.t('the most it costs: billed by the seconds that come back'));
    else if (pr && pr.vidIn && r.agg === 'kie') notes.push(T.t('the most it costs: kie.ai has billed a second less'));
    // The fallback rung, with its own price: asked only when the chosen one turns the clip down.
    const other = r && model() ? model().records.find(x => x.agg !== r.agg && x.usable) : null;
    if (other && !(_table && _table.fake)) {
      const po = priceOf(other);
      const o = { agg: r.aggLabel, other: other.aggLabel };
      notes.push(po && po.cannot ? T.t('if {agg} turns it down: {other} - skipped, it does not make {res}', Object.assign({ res: po.cannot }, o))
        : !po ? T.t('if {agg} turns it down: {other} - skipped, it does not make this', o)
          : po.none ? T.t('if {agg} turns it down: {other} (no published price)', o)
            : T.t('if {agg} turns it down: {other} {price}', Object.assign({ price: po.fromClip ? T.t('≈{price}/s', { price: money(po.per) }) : '≈' + money(po.usd) }, o)));
    }
    if (_table && _table.fake) notes.push(T.t('FAKE aggregator - nothing is paid'));
    _set.fall.textContent = notes.join(' · ');
    _last.model = (model() || {}).id || _last.model;
    _remember();
    _freshenCards();
  }

  // The models used, newest first - the one to go back to when the chosen one cannot take what the timeline gives.
  function _recent(id) {
    if (!id) return;
    _last.recent = [id].concat((_last.recent || []).filter(x => x !== id)).slice(0, 8);
  }
  function _useModel(id) {
    _last.model = id;
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

  // A THING FROM THE TIMELINE (js/merge-v3/tl-gen.js): the zone emptied - the thread and the
  // words in the box stay -, the thing in its place, a model that takes it (the chosen one, else the last one used that does,
  // else Seedance 2.5), Seedance's pictures as the first frame for a first frame; then the page's word
  // at the end of the thread - what came in, what was changed and where to change it back.
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
    // From the Library too (js/gen-menu.js) - its words say where it came from.
    const lib = o.from === 'library';
    if (kind === 'video') lines.push(lib ? T.t('The clip from the Library is a REFERENCE: its first seconds the model takes go.')
      : T.t('The clip from the timeline is a REFERENCE: the part the timeline plays, {from} - {to} of its file.', { from: _s(+a.in || 0), to: _s(+a.out || 0) }));
    else if (o.act === 'continue') lines.push(lib ? T.t('The last frame of the clip from the Library is the FIRST FRAME - the new clip starts on it.')
      : T.t('The last frame of the clip on the timeline is the FIRST FRAME - the new clip starts on it.'));
    else if (first && o.act === 'frame-vid') lines.push(lib ? T.t('The frame from the Library is the FIRST FRAME - the clip starts on it.')
      : T.t('The frame from the timeline is the FIRST FRAME - the clip starts on it.'));
    else if (first) lines.push(lib ? T.t('The picture from the Library is the FIRST FRAME - the clip starts on it.')
      : T.t('The picture from the timeline is the FIRST FRAME - the clip starts on it.'));
    else lines.push(lib ? T.t('The picture from the Library is in the zone.') : T.t('The picture from the timeline is in the zone.'));
    if (!m || !_takesFrom(m, kind, o.as)) lines.push(T.t('No model here takes it - a key is set on Admin → API keys.'));
    else if (switched) {
      lines.push(kind === 'video' ? T.t('{was} takes no clips - the model is {model} now.', { was: switched, model: m.label })
        : T.t('{was} does not start a clip on a picture - the model is {model} now.', { was: switched, model: m.label }));
    }
    if (first && seed) lines.push(T.t('To send it as a reference instead, set "pictures are" on the left to References; the model and its settings are on the left too.'));
    else if (kind === 'video') lines.push(T.t('Its part is set on it in the zone; the model and its settings are on the left.'));
    else lines.push(T.t('The model and its settings are on the left.'));
    if (o.back) lines.push(T.t('When the clip is made, "{back}" under it puts it on the timeline.', { back: o.back }));
    else if (lib && m) lines.push(T.t('What it makes lies in VIDEO → Generated → {model}.', { model: m.label }));
    ctx.notice(lines.join('\n'));
    const ui = ctx.ui();
    if (ui) ui.ta.focus();
  }
  _api = { fromTimeline };

  // The column's storyboard keeps its sheet's place: the sheet goes to the video as one more picture, after
  // the message's own - one place fewer, Seedance's alone - and it is drawn WITH the message's pictures, which
  // nano-banana-2 takes up to 14 of.
  const _seat = () => (_boardOn() ? 1 : 0);
  // What a sheet of the column's storyboard costs: the first aggregator that draws from this many pictures.
  function _sheetPrice(n) {
    const info = _table && _table.board;
    if (!info) return { usd: null, words: T.t('the storyboard engine is not in this program') };
    const p = (info.providers || []).find(x => x.usable && (!n || (x.maxRefs || 1) >= n));
    if (!p) return { usd: null, words: ((info.providers || []).find(x => x.why) || {}).why || T.tn(n, '{engine} cannot take {n} pictures', '{engine} cannot take {n} pictures', { engine: info.label }) };
    return { usd: p.price, words: info.quality + ' · ' + info.label + ' · ' + p.label };
  }
  const _boardCap = () => {
    const ps = ((_table && _table.board && _table.board.providers) || []).filter(p => p.usable);
    return ps.length ? Math.max(...ps.map(p => p.maxRefs || 1)) : 14;
  };
  // Fewer at some resolutions - Grok 1.5 on kie takes one picture at 1080p.
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

  // ── The attachment zone ──────────────────
  // Pictures | clips | sounds, each as many as the model takes on the chosen aggregator - the shell grows them one
  // place at a time. Seedance's pictures as frames have the frames' places, each cell wearing its name. A
  // clip or a sound shows the seconds of it that go; pressed, the part is chosen.
  const _slotsOf = (kind) => (kind === 'image' && _framesMode() ? _frameSlots() : null);
  function _zone() {
    const r = rec(), m = model();
    const lim = r ? r.limits : { images: 0, videos: 0, audios: 0 };
    const who = (m && m.label) || T.t('This model');
    // Frames: their places alone; beside a clip or a sound they go as references - said over the zone.
    const frames = _framesMode();
    const asRefs = frames && ctx.anyAtt(a => a.kind === 'video' || a.kind === 'audio');
    return { parts: [
      { kind: 'image', word: T.t('pictures'), one: T.t('picture'), room: frames ? _frameSlots().length : Math.min(MAX_PICS, r ? _picRoom(r) : 0), slots: _slotsOf('image'),
        full: frames ? T.t('{only} - set "pictures are" to references for more pictures.', { only: _onlyFrames() })
          : _mcSteps() ? T.tn(_frameRoom(), 'Up to {n} pictures - the still of the clip is the picture model\'s other reference.', 'Up to {n} pictures - the still of the clip is the picture model\'s other reference.')
          : _seat() ? T.t('Room for {n} - the storyboard goes to the video as one more picture, and it is drawn with these.', { n: r ? _picRoom(r) : 0 }) : '',
        note: asRefs ? T.t('go as references - may not match exactly') : '',
        noteLong: asRefs ? T.t('With a clip or a sound Seedance takes the frames as references: the video aims at them, but may not start and end on them exactly. Without clips and sounds they are the model\'s own frames.') : '',
        otherLabel: frames ? T.t('not sent') : '',
        none: _takesNo('image', who), other: frames ? T.t('{only} - take it off, or set "pictures are" to references', { only: _onlyFrames() }) : '' },
      { kind: 'video', word: T.t('clips'), one: T.t('clip'), room: lim.videos || 0, slots: null, none: _takesNo('video', who) },
      { kind: 'audio', word: T.t('sounds'), one: T.t('sound'), room: lim.audios || 0, slots: null, none: _takesNo('audio', who) },
    ] };
  }
  // ── Where attachments come from (the picker, chat-pick.js) ─────
  // Each kind its own shelves; an item is { path, name, sub, cat, thumb, big, poster, aspect, dur, src }.
  // The pictures' loaders are shared with the frames chat (chat-sources.js).
  const _gone = Src.gone;
  const _shape = Src.shape;
  const _clip = (path, poster, name, x) => Object.assign({ path, src: path, poster: poster || '', name: name || '',
    thumb: poster ? thumbOf(poster, 'strip') : '' }, x || {});
  // The clips this chat made in this project.
  async function _made() {
    const k = ctx.key();
    if (!k) return { items: [], why: T.t('No project is open yet - nothing has been made in it.') };
    const d = await json('/api/mv3/video/feed?project=' + encodeURIComponent(k));
    if (!d || !d.success) return _gone(d);
    return { items: (d.items || []).filter(g => g && g.state === 'done' && g.videoPath).map(g => _clip(g.videoPath, g.posterPath,
      String(g.said || g.prompt || '').slice(0, 80), { aspect: _shape(g.w, g.h) || (g.params || {}).aspect || '', dur: +g.duration || 0 })) };
  }
  // The Library's saved voices - our own demo of each - among the sounds: listened to
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
        sub: [looks, whose ? T.t('voice of {who}', { who: whose }) : ''].filter(Boolean).join(' · ') };
    }) };
  }
  // What is not a folder, as rows above the window's tree; the rest - REFERENCES, IMAGES, VIDEO,
  // AUDIO - is the media tree itself (chat-sources.js TREE).
  const SOURCES = {
    image: [Src.PEOPLE_ROW],
    // With THIS PROJECT in the window's tree the row is left out (`unless`) - its clips lie
    // in THIS PROJECT's top (js/merge-v3/chat-pick.js _madeIntoProject).
    video: [{ id: 'made', label: T.t('Made in this project'), load: _made, empty: T.t('No clips made in this project yet.'), unless: 'plinks' }],
    audio: [{ id: 'voices', label: T.t('Voices'), load: _voices, empty: T.t('No saved voices yet - they are kept on the Library\'s Voices shelf.') }],
  };
  // Where the window opens: a frame's place on IMAGES (chat-sources.js pictureStart); else ('') where this kind was last
  // taken from - the window remembers -, the first time the tree's own (chat-sources.js TREE fallback).
  function _startFor(kind, s) {
    if (kind !== 'image' || !s || !s.key) return '';
    return Src.pictureStart(s.role);
  }
  // ── The almanac - the prompt reference (at the foot of the column, vhelp.js) ──
  // One for the whole chat: a tip pressed there is copied, and the note says so on the prompt
  // field typed in last - the chat's box, or the prompt of a card.
  const _helpNote = () => (isMC() ? T.t('Kling motion control: the camera follows your clip - a camera tip may not take.') : '');
  let _lastField = null;
  const _seen = (e) => !!(e && e.isConnected && e.offsetParent !== null);
  function _fieldForHelp() {
    if (_seen(_lastField)) return _lastField;
    const ui = ctx.ui();
    if (ui && _seen(ui.ta)) return ui.ta;
    // Else the newest card's prompt.
    const cards = ui ? [...ui.thread.querySelectorAll('textarea.vc-prompt-ta:not(.is-board)')] : [];
    return cards[cards.length - 1] || null;
  }
  function _almanacBtn() {
    const b = el('button', 'mv3-vc-almanac u-btn is-l is-gen', T.t('Almanac'));
    b.type = 'button';
    b.title = T.t('The prompt reference - camera moves and more: press a tip to copy it, then paste it into your prompt');
    b.addEventListener('click', (ev) => { ev.stopPropagation(); openHelp({ anchor: b, field: _fieldForHelp, note: _helpNote }); });
    return b;
  }

  // What cannot go into the zone at all, said on its tile: a clip or a sound shorter than the model takes (one longer
  // goes, and only its part is sent).
  // The longest clip the chosen model takes - Seedance one clip of 2-15 s (2.5: 2-30), Kling
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
      note: T.t('clips up to {n} s - {model} takes no longer', { n: cap, model: m.label }),
    };
  }

  function _pickWhy(it, kind) {
    if (kind === 'image' || !(+it.dur > 0)) return '';
    const rule = _spanRule({ kind, path: it.path });
    const m = model();
    if (!rule || !m || +it.dur >= rule.min - 0.05) return '';
    return T.t('{secs} - {model} needs at least {min}', { secs: _s(it.dur), model: m.label, min: _s(rule.min) });
  }
  // The first frame's place - or the last one's - that is empty: the send waits for it.
  function _missing() {
    if (!_framesMode()) return null;
    for (const s of _frameSlots()) if (!_pics().some(a => a.slot === s.key)) return Object.assign({ part: 'image' }, s);
    return null;
  }

  function _ready() {
    if (!_table) return [T.t('No video models.'), _err || T.t('reading the models…')];
    const m = model(), r = rec();
    if (!m || !m.usable) return [T.t('Not available now.'), (m && m.why) || T.t('no model can be asked')];
    if (!r || !r.usable) return [T.t('{agg} cannot be asked.', { agg: r ? r.aggLabel : T.t('That aggregator') }), (r && r.why) || ''];
    // An empty numbered place: the numbers in the prompt would move under it.
    const hole = ctx.holeWhy();
    if (hole) return hole;
    // A frame's place that must be filled and is not: nothing is asked, the cell blinks.
    const miss = _missing();
    if (miss) {
      ctx.flash(miss.part, miss.key);
      return [miss.key === 'last' ? T.t('The last frame is empty.') : T.t('The first frame is empty.'), T.t('{hint} - press its place, then a picture.', { hint: miss.hint })];
    }
    // A picture beyond the frames' places does not go - it stands dimmed with the reason.
    if (_framesMode() && _pics().some(a => !_frameKeys().includes(a.slot))) {
      return [_onlyFrames() + '.', T.t('Take the other pictures off, or set "pictures are" to references.')];
    }
    const n = _pics().length;
    const L = r.limits || {};
    // Kling motion control: ONE picture - the person and the place - and ONE clip - the moves; the box is
    // its prompt, in English (translated when not), up to its limit. With the writer on: the person's pictures
    // - the character, and whatever else they want taken from where - and the clip; the first frame is drawn from them.
    if (isMC()) {
      const secs = T.t('{min}-{max} s', { min: r.duration.min || 3, max: params().orientation === 'image' ? (L.videoSecsImage || 10) : (L.videoSecs || 30) });
      if (_mcSteps()) {
        if (n < 1 || _clips().length !== 1) {
          return [T.t('Kling needs your character and a clip.'), T.t('Pictures: your character - and a place, clothes or a thing if you like (say in the box what to take from which); the clip: the moves ({secs}).', { secs })];
        }
        const fi = _table.frame;
        if (!fi || !(fi.providers || []).some(p => p.usable)) return [T.t('The first frame cannot be drawn.'), ((fi && (fi.providers || []).find(p => p.why)) || {}).why || T.t('no picture model can be asked')];
      } else {
        if (n !== 1 || _clips().length !== 1) return [T.t('Kling needs one picture and one clip.'), T.t('The picture is the person and the place, the clip the moves ({secs}).', { secs })];
        const words = String(ctx.text() || '').trim();
        if (r.promptMax && words.length > r.promptMax) return [T.t('The prompt is too long.'), T.tn(r.promptMax, '{model} takes {n} characters - this one is {len}.', '{model} takes {n} characters - this one is {len}.', { model: m.label, len: words.length })];
      }
    }
    if (r.needs && r.needs.images && n < r.needs.images) return [T.t('It needs a picture.'), T.t('{model} on {agg} starts from one.', { model: m.label, agg: r.aggLabel })];
    if (n > _picRoom(r)) {
      const cap = _imgCap(r);
      return [T.t('Too many pictures.'), _seat() ? T.t('Room for {n}: the storyboard goes to {model} as one more picture, and it is drawn with these.', { n: _picRoom(r), model: m.label })
        : _mcSteps() ? T.t('Up to {n} - the still of the clip is the picture model\'s other reference.', { n: _picRoom(r) })
          : cap < (L.images || 0) ? T.t('{model} on {agg} takes {n} at {res}.', { model: m.label, agg: r.aggLabel, n: cap, res: params().resolution || r.resDef })
            : T.t('{model} on {agg} takes {n}.', { model: m.label, agg: r.aggLabel, n: cap })];
    }
    // Clips and sounds: as many as the model takes, each with a part it takes.
    const vi = _clips(), au = _sounds();
    const on = { model: m.label, agg: r.aggLabel };
    if (vi.length > (L.videos || 0)) return [T.t('Too many clips.'), L.videos ? T.t('{model} on {agg} takes {n}.', Object.assign({ n: L.videos }, on)) : T.t('{model} on {agg} takes no clips.', on)];
    if (au.length > (L.audios || 0)) return [T.t('Too many sounds.'), L.audios ? T.t('{model} on {agg} takes {n}.', Object.assign({ n: L.audios }, on)) : T.t('{model} on {agg} takes no sounds.', on)];
    if (L.total && n + vi.length + au.length + _seat() > L.total) return [T.t('Too many attachments.'), T.tn(L.total, '{model} takes {n} files in all.', '{model} takes {n} files in all.', { model: m.label })];
    const wrong = vi.concat(au).map(a => [a, _spanWrong(a)]).find(x => x[1]);
    if (wrong) {
      const a = wrong[0];
      const k = _kind(a);
      const i = ctx.atts().filter(x => _kind(x) === k).indexOf(a) + 1;
      return [k === 'video' ? T.t('Clip {n} cannot go like this.', { n: i }) : T.t('Sound {n} cannot go like this.', { n: i }), wrong[1] + '.'];
    }
    if (au.length && !n && !vi.length) return [T.t('A sound goes beside a picture or a clip.'), T.t('{model} takes sounds as references to something it sees.', { model: m.label })];
    // A two-step video always sends a picture - its storyboard.
    const any = n + vi.length + au.length;
    if ((any || _seat()) && !_table.r2) {
      return [T.t('Attachments need R2.'), _seat() ? T.t('The storyboard goes to the video as a picture - from a public link: set R2 on Admin → API keys.')
        : T.t('The models read what is attached from a public link: set R2 on Admin → API keys.')];
    }
    return '';
  }

  const _ownRole = (a) => a.role === 'voice' || a.role === 'storyboard';
  // `cardMedia`: a card's own attachments - what it is made with decides whether the clip's sound can go.
  function _body(cardMedia) {
    const m = model(), r = rec();
    const p = params();
    const fam = m.family;
    // The column's storyboard is drawn from the pictures - an older sheet among them is not one of them (the
    // new sheet takes its place when it lands).
    const boarding = _boardOn();
    const atts = ctx.atts().filter(a => !(boarding && _kind(a) === 'image' && a.role === 'storyboard'));
    // What each picture is for: its place says - a frame's place ("pictures are" lays them out in the zone;
    // beside a clip or a sound the server sends them as references, and the prompt names them).
    const slots = new Map(['image', 'video', 'audio'].flatMap(k => (_slotsOf(k) || []).map(s => [k + ':' + s.key, s])));
    const role = (a) => {
      const s = a.slot ? slots.get(_kind(a) + ':' + a.slot) : null;
      return s ? (/^frame-/.test(s.kind) ? s.kind : s.role) : '';
    };
    const fmt = (Store.timeline() || {}).format || '9:16';
    // Seedance's sound from the clip: its own off, the first clip's part laid under when it lands - only
    // while a clip goes with it. Beside a clip that is the default, and the choice there is its own.
    const withClip = fam === 'seedance'
      && (cardMedia ? cardMedia.some(a => a && a.kind === 'video') : atts.some(a => _kind(a) === 'video'));
    const besideClip = withClip ? _clipSoundOf(p) : '';
    const clipSound = besideClip === 'clip';
    // One clip: the length the record shows is the clip's (the server sends the clip's, whatever comes here).
    const one = _byClip(r, cardMedia || atts.map(a => ({ kind: _kind(a), in: a.in, out: a.out })));
    const oneSecs = one && _span(one) > 0 ? clamp(Math.round(_span(one)), r.duration.min, r.duration.max) : 0;
    return {
      model: m.id, agg: r.agg,
      // The column's storyboard: the sheet is written and drawn, and it stops there.
      storyboard: boarding || undefined,
      // The writer stops for a look: its prompt comes back as a message of its own, and the video is
      // made from there - "make the video". Under Kling motion control the writer writes the first frame instead.
      review: !boarding && ctx.writing() && !isMC() ? true : undefined,
      params: {
        duration: r.duration.fromClip ? undefined : oneSecs || clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max),
        resolution: r.resolutions.includes(p.resolution) ? p.resolution : r.resDef,
        aspect: (r.aspects || []).includes(p.aspect) ? p.aspect : ((r.aspects || []).includes(fmt) ? fmt : (r.aspects || [])[0]),
        audio: besideClip ? besideClip === 'on' : p.audio !== false, sound: clipSound ? 'clip' : '',
        mode: p.mode || 'normal', orientation: p.orientation || 'video', keepSound: p.keepSound !== false,
      },
      media: atts.map((a) => Object.assign({
        // A thing that says what it is for - a voice, a storyboard - goes as that; otherwise its place decides
        // (a message's attachments put back into the zone keep nothing of their earlier places - a first frame put
        // back under "references" is a reference).
        path: a.path, kind: _kind(a), role: _ownRole(a) ? a.role : role(a),
        label: (_ownRole(a) && a.label) || ((a.slot && slots.get(_kind(a) + ':' + a.slot)) || {}).label || '',
      // A clip or a sound goes as its part - the server prepares just that.
      }, _kind(a) !== 'image' ? { in: +a.in || 0, out: +a.out || 0 } : {})),
    };
  }

  // ── The prompt cards (the writer's message) ──
  // The writer's answer is a PROMPT CARD the person edits; the press under it makes the video (POST /card/:id/make).
  const REF_WORD = { image: 'picture', video: 'clip', audio: 'sound' };
  const REF_KIND = { picture: 'image', clip: 'video', sound: 'audio' };
  // The writer's neutral references as the person reads and writes them: {{image:1}} <-> [picture 1].
  const toShown = (p) => String(p || '').replace(/\{\{\s*(image|video|audio)\s*:\s*(\d+)\s*\}\}/gi, (a, k, n) => '[' + REF_WORD[k.toLowerCase()] + ' ' + (+n) + ']');
  const toNeutral = (p) => String(p || '').replace(/\[(picture|clip|sound) (\d+)\]/gi, (a, k, n) => '{{' + REF_KIND[k.toLowerCase()] + ':' + n + '}}');
  const _live = new Map();      // card id -> its controls, while it waits to be made (price and button follow the column)
  const _cardN = new Map();     // card id -> how many clips it makes
  const _patchT = new Map();
  const _familyOf = (id) => ((models().find(m => m.id === id) || {}).family || '');
  const _labelOf = (id) => ((models().find(m => m.id === id) || {}).label || id || '');
  // Merge's project with the chat open - or the Library, from its unbound chat (chat-owner.js).
  const _where = (key) => Store.whereOf(key, 'videos');
  const _post = (url, body, method) => json(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ── The cards in the thread ──
  // A working message is drawn anew only when it first has something written - or fails without it: from
  // then on its steps, their variants, its clips and its prices are painted in place (_paintStory, _paintReview), never
  // under the typing.
  const _cardSig = (m) => {
    const c = m.card;
    const B = c.board || {};
    // A first frame's card is written when its picture's prompt is: Kling's own is put in at its start.
    // A Seedance card shows its steps from the moment its clips begin to be watched.
    const has = B.kind === 'frame' ? (B.versions || []).length || B.prompt
      : (c.versions || []).length || c.prompt || (B.versions || []).length || B.prompt || (c.watch || []).length;
    return [c.type, c.plain ? 'plain' : c.board ? (B.kind || 'two') : 'one', has ? 'v' : (c.state || '') + ':' + (c.error || '')].join(':');
  };
  const _busy = (thread) => thread.some(m => (m.card && (m.card.type === 'prompt' || m.card.type === 'board') && m.card.state === 'writing')
    || (m.boards || []).some(g => g.state === 'pending'));

  // Every working message is a SUB-PROJECT (vsteps.js): its steps paged at its top - the
  // chat does not grow with every attempt. Two steps at most, the video at the head of
  // the message: the plain chat's - "clip watched" (Seedance with clips) and "prompt"; the column's storyboard -
  // "storyboard" (the clips' descriptions, its prompt and its sheet) and "video prompt"; Kling's first frame - "first
  // frame prompt" and "first frame". Every prompt is a field open at once (_field).
  function _cardBubble(m, progs) {
    const c = m.card;
    if (c.type === 'board' || c.board) return _storyCard(m, progs);
    return _reviewCard(m, progs);
  }

  // ── The attempts of a card (a made card is made again from its own field) ──
  // Every make is one: when, how many, the sheet it followed and its clips. Every clip of every attempt is a
  // variant of the message's "video" step.
  function _triesOf(m) {
    const c = m.card;
    const byId = new Map((m.gens || []).map(g => [g.id, g]));
    const sends = Array.isArray(c.sends) ? c.sends : [];
    return sends.map(s => Object.assign({}, s, { gens: (s.genIds || []).map(id => byId.get(id)).filter(Boolean) }));
  }

  // The prices and the presses of the working messages follow the column.
  function _freshenCards() {
    for (const [id, l] of _live) {
      if (!l.el.isConnected) { _forget(id); continue; }
      _freshenOne(id, l);
    }
  }
  // A message leaving the live ones takes its countdowns with it: each is an interval of its own.
  function _forget(id) {
    const l = _live.get(id);
    if (l && l.steps) l.steps.destroy();
    if (l && l.vid) l.vid.destroy();
    _live.delete(id);
  }
  function _freshenOne(id, l) {
    if (l.story) _freshenStory(id, l);
    else _freshenReview(id, l);
    // Its video field: before any clip it takes the shape the column would make it.
    _paintVid(l);
  }

  // Whether a card can go to the model chosen now - the card's own attachments are the server's to check.
  function _readyFor(m) {
    if (!_table) return [T.t('No video models.'), _err || T.t('reading the models…')];
    const mm = model(), r = rec();
    if (!mm || !mm.usable) return [T.t('Not available now.'), (mm && mm.why) || T.t('no model can be asked')];
    if (!r || !r.usable) return [T.t('{agg} cannot be asked.', { agg: r ? r.aggLabel : T.t('That aggregator') }), (r && r.why) || ''];
    // A two-step card always sends a picture - its storyboard.
    // A card whose character or place is not in this library any more: what is missing, before the press.
    const gone = (m.media || []).filter(a => a && a.gone);
    if (gone.length) {
      const what = gone.map(a => a.label ? '«' + a.label + '»' : (a.kind === 'video' ? T.t('a clip') : a.kind === 'audio' ? T.t('a sound') : T.t('a picture'))).join(', ');
      return [T.t('Not in this library.'), T.tn(gone.length, '{what} is not here - it stayed in the library this chat came from. Send it again with another in its place.', '{what} are not here - it stayed in the library this chat came from. Send it again with another in its place.', { what })];
    }
    if (((m.media || []).length || m.card.board) && !_table.r2) {
      return [T.t('Attachments need R2.'), !m.card.board ? T.t('The models read pictures from a public link: set R2 on Admin → API keys.')
        : m.card.board.kind === 'frame' ? T.t('The picture goes to the video as a picture - from a public link: set R2 on Admin → API keys.')
          : T.t('The storyboard goes to the video as a picture - from a public link: set R2 on Admin → API keys.')];
    }
    return '';
  }

  async function _make(m, go) {
    const l = _live.get(m.id);
    if (!l || go.disabled) return;
    const mm = model();
    // A message makes from the variant shown - written for its own model.
    if (mm && mm.family !== _familyOf(l.vmodel || m.card.model)) {
      if (l.kind === 'swap') { note(go, T.t('Kling makes it.'), T.t('A first frame\'s video is made by Kling motion control - pick it on the left.')); return; }
      if (l.story) { note(go, T.t('Seedance makes it.'), T.t('A video that follows a storyboard is made by Seedance - pick a Seedance model on the left.')); return; }
      return _rewrite(m, go);
    }
    // Kling's first frame has no prompt field: Kling's own prompt is the card's.
    const prompt = l.kind === 'swap' ? String(m.card.prompt || (_table && _table.standardPrompt) || '').trim() : toNeutral(l.ta.value).trim();
    if (!prompt) { note(go, T.t('The prompt is empty.'), T.t('Write what the clip shows, or write it again.')); return; }
    const why = _readyFor(m);
    if (why) { note(go, why[0], why[1]); return; }
    // Kling's first frame's video follows the picture shown on its second step.
    const follows = l.kind === 'swap';
    const sheet = follows ? _chosenSheet(l) : null;
    if (follows && !sheet) {
      const pic = l.W === 'picture';
      if ((l.m.boards || []).some(g => g.state === 'pending')) note(go, pic ? T.t('The picture is being drawn.') : T.t('The storyboard is being drawn.'), T.t('The video follows it - make it when it has landed.'));
      else note(go, pic ? T.t('The picture first.') : T.t('The storyboard first.'), pic ? T.t('Draw the picture - the video follows the one shown on its step.') : T.t('Draw the storyboard - the video follows the one shown on its step.'));
      return;
    }
    go.disabled = true;
    try {
      clearTimeout(_patchT.get(l.patchKey || m.id));
      _patchT.delete(l.patchKey || m.id);
      const b = _body(m.media || []);
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/make', {
        project: m.project, prompt, n: _cardN.get(m.id) || 1, model: b.model, agg: b.agg, params: b.params, where: _where(m.project),
        // The column storyboard's video follows the sheet its prompt variant was written with; the others the
        // one shown.
        boardId: l.kind === 'column' ? (l.boardId || undefined) : sheet ? sheet.id : undefined,
        ver: l.ver || undefined,
      });
      if (!d || !d.success) { note(go, T.t('Not made.'), (d && d.error) || T.t('the server did not answer')); return; }
      _cardN.delete(m.id);
      await ctx.reload(true);
    } finally {
      if (go.isConnected) go.disabled = false;
    }
  }

  async function _rewrite(m, btn) {
    // Under Kling the writer writes the first frame's prompt - nothing else.
    const frameCard = !!(m.card.board && m.card.board.kind === 'frame');
    if (isMC() && !frameCard) { note(btn, T.t('No writer here.'), T.t('Under Kling motion control the writer writes only the first frame - pick another model on the left.')); return; }
    if (frameCard && !isMC()) { note(btn, T.t('Kling makes this one.'), T.t('The first frame is Kling motion control\'s - pick it on the left.')); return; }
    const why = _readyFor(m);
    if (why) { note(btn, why[0], why[1]); return; }
    btn.disabled = true;
    try {
      // A description being corrected is saved first: the writer writes from it as it stands.
      await _flushWatch(m.id);
      const b = _body(m.media || []);
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/rewrite', { project: m.project, model: b.model, agg: b.agg, params: b.params });
      if (!d || !d.success) { note(btn, T.t('Not written.'), (d && d.error) || T.t('the server did not answer')); return; }
      await ctx.reload(true);
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }
  // ── What the agent saw ──
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
  // Who watched a clip - the model the server names, or "an agent".
  const _watchedBy = (w) => (w.cached ? T.t('watched before by {who}', { who: w.by || T.t('an agent') }) : T.t('watched by {who}', { who: w.by || T.t('an agent') }));
  // The step, or null when the message watched nothing. `written` - whether a prompt of it has been written.
  function _watchStep(m, l, written) {
    const c = m.card;
    const list = (c.watch || []).filter(Boolean);
    if (!list.length) return null;
    const failed = !written && c.state === 'failed';
    const tail = '|' + (c.state === 'writing' ? 'w' : 'r') + '|' + (failed ? c.error || 'x' : '');
    // One clip's description at a time, as a field down to the bottom of the video: each clip
    // is a variant of the step - "‹ 1 of 2 ›" in its title line.
    const variants = list.map(w => ({ key: 'c' + w.n, sig: w.n + ':' + w.state + ':' + (w.why ? 1 : 0) + tail, w }));
    return {
      key: 'watch', title: list.length > 1 ? T.t('clips watched') : T.t('clip watched'), word: T.t('clip'), variants, pick: variants[0].key,
      note: (x) => (!x ? '' : x.w.state === 'done' ? T.t('what the agent saw in it') : x.w.state === 'failed' ? T.t('not watched')
        : x.w.state === 'watching' ? T.t('watching') : x.w.state === 'waiting' ? T.t('waiting') : x.w.state),
      body: (x, b, progs, nav) => _watchBody(l.m, b, progs, failed, x ? { w: x.w, nav } : null),
      acts: (x, a) => _watchActs(l.m, a),
    };
  }
  // The clips' descriptions: `one` - { w, nav } - the one shown as a field (the step "clip watched"); without it every clip folded
  // into one line (the storyboard's step).
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
        h.appendChild(el('span', null, _watchedBy(w)));
        if (w.edited) h.appendChild(el('span', 'is-mine', T.t('corrected by you')));
      }
      if (w.state === 'done') {
        const ta = _watchTa(m, w, locked, saves);
        ta.classList.add('is-fit');
        // Folded into one line; open, its part, who watched it, the description and - one line,
        // no empty block under it - what the writer does with it.
        const open = [h, ta];
        if (!locked) open.push(el('div', 'vc-card-note', T.t('The writer writes the prompt from this. Correct who is who or what happens here, then "write it again".')));
        box.appendChild(_foldLine({ id: m.id, key: 'watch' + w.n, word: T.t('clip {n}', { n: w.n }), lead: _clipT(w.in) + '–' + _clipT(w.out) + ' · ', text: () => ta.value, ta, open }));
        b.appendChild(box);
        continue;
      }
      box.appendChild(h);
      if (w.state === 'watching') {
        const strip = el('div', 'mv3-ig-prog');
        box.appendChild(strip);
        progs.set('watch:' + w.n, startInlineProgress(strip, {
          label: list.length > 1 ? T.t('watching clip {n} of {all} with its sound…', { n: w.n, all: list.length }) : T.t('watching clip {n} with its sound…', { n: w.n }), key: 'mv3-clip-watch', estimateMs: 60000,
          startedAt: Date.parse(w.at || c.startedAt || m.at) || 0,
        }));
      } else if (w.state === 'waiting') {
        // A note of one line - not `vc-card-why`, which is the row of presses' and would stand 180 px tall here.
        box.appendChild(el('div', 'vc-card-note', T.t('waits for clip {n}', { n: w.n - 1 })));
      } else {
        box.appendChild(el('div', 'mv3-ig-bad', T.t('Clip not watched - {why}. The writer saw three of its frames instead.', { why: w.why || T.t('no model watched it') })));
      }
      b.appendChild(box);
    }
    if (failed) b.appendChild(el('div', 'mv3-ig-bad', T.t('The prompt was not written: {why}', { why: c.error || T.t('no writer answered') })));
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
    ta.title = locked ? T.t('The prompt is being written from this now')
      : T.t('What the agent saw in this clip - correct who is who or what happens; "write it again" writes the prompt from it as it stands.');
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
  // The clip shown on the step "clip watched": its description as a field down to the bottom
  // of the video - its part, who watched it, "corrected by you" in the title line, what the writer does with it under the
  // pointer; being watched, waiting or not watched - said in the field's place.
  function _watchField(m, w, lab, b, progs, saves, locked, nav) {
    const c = m.card;
    const n = (c.watch || []).filter(Boolean).length;
    const part = _clipT(w.in) + '–' + _clipT(w.out);
    const base = { nav, word: T.t('clip {n}', { n: w.n }), always: true, pager: nav ? nav.pager() : null };
    if (w.state === 'done') {
      const ta = _watchTa(m, w, locked, saves);
      const lead = [part, lab, _watchedBy(w), w.edited ? T.t('corrected by you') : ''].filter(Boolean).join(' · ');
      b.appendChild(_field(Object.assign(base, { lead, text: () => ta.value, ta })));
      return;
    }
    const lead = [part, lab].filter(Boolean).join(' · ');
    if (w.state === 'watching') {
      b.appendChild(_waitField(Object.assign(base, { lead, progs, progKey: 'watch:' + w.n, prog: {
        label: n > 1 ? T.t('watching clip {n} of {all} with its sound…', { n: w.n, all: n }) : T.t('watching clip {n} with its sound…', { n: w.n }), key: 'mv3-clip-watch', estimateMs: 60000,
        startedAt: Date.parse(w.at || c.startedAt || m.at) || 0,
      } })));
    } else if (w.state === 'waiting') {
      b.appendChild(_waitField(Object.assign(base, { lead, words: T.t('waits for clip {n}', { n: w.n - 1 }) })));
    } else {
      b.appendChild(_waitField(Object.assign(base, { lead, bad: true,
        words: T.t('Clip not watched - {why}. The writer saw three of its frames instead.', { why: w.why || T.t('no model watched it') }) })));
    }
  }
  function _watchActs(m, a) {
    const c = m.card;
    if (c.state === 'writing') return;
    const again = el('button', 'mv3-c-btn vc-go u-btn is-s', T.t('Write it again'));
    again.type = 'button';
    again.title = T.t('Another variant of the prompt, written from these descriptions as they stand - a clip not watched is watched again');
    again.addEventListener('click', () => _rewrite(m, again));
    a.appendChild(again);
    if (c.plain && (m.media || []).length && !(c.versions || []).length) a.appendChild(_backLink(m));
  }

  // What the storyboard - or Kling's first frame, drawn at 2K from the clip's still and every picture of the person
  // - costs, and whether it can be drawn.
  function _boardPrice(l) {
    if (!_table) return { ok: false, text: T.t('reading the prices…') };
    const frame = l.kind === 'swap';
    const info = frame ? _table.frame : _table.board;
    if (!info) return { ok: false, text: T.t('the picture engine is not in this program') };
    // The sheet always goes to the video as a picture: without R2 it would be bought for nothing.
    if (!_table.r2) return { ok: false, text: frame ? T.t('the picture goes to the video as a picture - set R2 on Admin → API keys') : T.t('the storyboard goes to the video as a picture - set R2 on Admin → API keys') };
    const pics = (l.m.media || []).filter(x => x.kind === 'image').length;
    const n = frame ? pics + 1 : pics;
    const p = (info.providers || []).find(x => x.usable && (!n || (x.maxRefs || 1) >= n));
    if (!p) return { ok: false, text: ((info.providers || []).find(x => x.why) || {}).why || T.tn(n, '{engine} cannot take {n} pictures', '{engine} cannot take {n} pictures', { engine: info.label }) };
    return { ok: true, text: (p.price != null ? '≈' + money(p.price) + ' · ' : '') + info.quality + ' · ' + info.label + ' · ' + p.label };
  }
  // The sheets the video can follow: landed, and still on the Images shelf (the server says `gone`).
  const _boardOk = (g) => !!(g && g.state === 'done' && g.imagePath && !g.gone);
  // ONE PRESS, ONE SHEET: the button stays shut from the press until the thread has been read with the new
  // sheet in it, whatever repaints meanwhile, and the second click of a double click is not a press. `two`: { bta - the
  // prompt field shown, frame, range - the first frame's moment, busy }; without a field the card's own prompt is drawn.
  async function _drawBoard(m, two, btn, e) {
    if (btn.disabled || two.busy || (e && e.detail > 1)) return;
    two.busy = true;
    btn.disabled = true;
    try {
      clearTimeout(_patchT.get('b:' + m.id));
      _patchT.delete('b:' + m.id);
      // A moment just moved is written before the picture is drawn from it.
      const live = _live.get(m.id);
      if (live && live.atSave) { await live.atSave; live.atSave = null; }
      // Kling's first frame: its prompt in the neutral references (its moment is the card's - written just above).
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/board', {
        project: m.project, where: _where(m.project),
        board: two.bta ? (two.frame ? toNeutral(two.bta.value) : two.bta.value) : undefined,
      });
      if (!d || !d.success) { note(btn, T.t('Not drawn.'), (d && d.error) || T.t('the server did not answer')); return; }
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
  // `how`: 'big' - the storyboard at the message's width, from the 1280px tier (the
  // 440px miniature stretched to 600 shows its squares); 'frame' - Kling's first frame at its own shape, at most 320px
  // high, its box set before the picture loads. No popup under the pointer: the press opens it large. 'row' -
  // the storyboard's sheet in its row under the prompt, 72 px high at its shape; Kling's first frame fills its step down to the
  // bottom of the video (css .vm-fill).
  function _boardThumb(g, all, W, how) {
    const pic = W === 'picture';
    const word = pic ? T.t('picture') : T.t('storyboard');
    const t = el('button', 'vc-board' + (how ? ' is-' + how : ''));
    t.type = 'button';
    t.dataset.id = g.id;
    if (how === 'frame' || how === 'row') t.style.setProperty('--ar', String(ratioOf(g.aspect)));
    const img = document.createElement('img');
    img.src = '/api/thumb?src=' + encodeURIComponent(g.imagePath) + '&v=' + (how ? 'preset' : 'strip');
    img.loading = 'lazy'; img.decoding = 'async'; img.alt = word;
    // Gone from the shelf since it was read: said, and never followed (the server says so too at the next read).
    img.addEventListener('error', () => { t.classList.add('is-gone'); t.title = T.t('Not on the Images shelf any more'); }, { once: true });
    t.appendChild(img);
    t.title = pic ? T.t('The picture · press: large') : T.t('The storyboard · press: large');
    const list = (all && all.length ? all : [g]);
    t.addEventListener('click', () => openViewer(list.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: word })),
      Math.max(0, list.findIndex(x => x.id === g.id))));
    return t;
  }
  // A sheet still being drawn: its countdown in the person's words (the asking's stage first), and the cross.
  function _boardWords(g, W) {
    if (g.stage) return g.stage + '…';
    if (g.error) return T.t('{error} - trying the next…', { error: String(g.error).slice(0, 60) });
    return W === 'picture' ? T.t('drawing the picture…') : T.t('drawing the storyboard…');
  }
  // A press's word by what it draws.
  const _drawWord = (W) => (W === 'picture' ? T.t('draw the picture') : T.t('draw the storyboard'));
  function _boardBusy(g, progs, key, W) {
    const cell = el('div', 'vc-board is-busy');
    const bar = el('div', 'mv3-ig-prog');
    cell.appendChild(bar);
    // Kling's first frame waits in the box it will land in - its shape and size - with the countdown under
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

  // ── A message with a picture first (a sub-project) ──
  // Two kinds, one shape. The column's storyboard (`column`): ">" writes the sheet's prompt alone, and every paid step
  // waits for its press - "draw the storyboard", "write the video" (the video's prompt from the
  // same words with the sheet shown among the pictures), "make the video". Kling's first frame (`swap`): the
  // writer's prompt for a picture of the person's character in the pose of the clip's still, drawn by its press; then
  // Kling moves the picture shown with the part of the clip from that moment, by its own prompt. Their steps
  // (two, the video at the message's head): the storyboard's - "storyboard" (its prompt, every writing a
  // variant, and its sheets, every one drawn a variant - the one shown is the one the video follows) · "video prompt"
  // (every writing a variant); Kling's - "first frame prompt" · "first frame" (the pictures, and the press that makes the
  // video). Kling's message opens on its first step; the column's steps grow as the work goes.
  const _kindOf = (c) => (c.board && c.board.kind === 'frame' ? 'swap' : 'column');
  function _storyCard(m, progs) {
    const c = m.card;
    _forget(m.id);
    const kind = _kindOf(c);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-prompt is-board is-steps is-' + c.state);
    const h = el('div', 'vc-card-h');
    // Kling's first frame of the plain chat is the person's message.
    const own = kind === 'swap' && c.plain;
    h.appendChild(el('span', 'k', kind === 'column' ? T.t('Storyboard') : T.t('Video')));
    if (c.model) h.appendChild(el('span', 'm', kind === 'column' ? T.t('for {model}', { model: _labelOf(c.model) }) : T.t('for {model} · the first frame, then the video', { model: _labelOf(c.model) })));
    box.appendChild(h);
    // What was asked, at the head - seen on every step.
    const asked = _askedOf({ words: c.text, media: m.media, none: own ? T.t('from your pictures') : T.t('from the attachments alone') });
    // What was asked on the left, the video on the right; "read more" of the clip shown at the foot.
    const foot = el('div', 'vm-foot');
    const vid = _vidField(m.id, foot);
    const hd = _headOf(asked, vid);
    box.appendChild(hd.el);
    const B = c.board || {};
    // A Seedance card whose clips are being watched, or were, has its steps at once.
    if (!((B.versions || []).length || B.prompt) && !(c.watch || []).length) {
      vid.paint(_clipsOf(m), _shapeNow(m.media || []));
      // Nothing written yet: the writer at work, or why not - in the place the prompt will stand in.
      const word = kind === 'swap' ? T.t('first frame prompt') : T.t('storyboard prompt');
      if (c.state === 'writing') {
        hd.left.appendChild(_waitField({ word, progs, progKey: 'w:' + m.id, prog: {
          label: kind === 'column' ? T.t('writing the storyboard prompt…') : T.t('writing the first frame\'s prompt…'),
          key: kind === 'column' ? 'mv3-board-writer' : 'mv3-video-writer',
          estimateMs: kind === 'column' ? 20000 : 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
        } }));
        return box;
      }
      hd.left.appendChild(_waitField({ word, bad: true, words: c.error || T.t('it was not written') }));
      const acts = el('div', 'vc-card-acts');
      const again = el('button', 'mv3-c-btn vc-go u-btn is-s', T.t('Write it again'));
      again.type = 'button';
      again.addEventListener('click', () => _rewrite(m, again));
      acts.appendChild(again);
      if ((kind === 'column' || own) && (m.media || []).length) acts.appendChild(_backLink(m));
      box.appendChild(acts);
      return box;
    }
    const steps = stepCard(m.id);
    // The steps under what was asked, in the left column; their presses under both columns.
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
    // The writing begins once the clips have been watched.
    const writing = c.state === 'writing' && !_watchBusy(c);
    // Every writing of a prompt is a variant of it. None while nothing is written - its clips watched first.
    const bv = B.versions || [];
    const bvars = bv.map(v => ({ key: v.id, sig: '', v }));
    if (writing && c.writing === 'board') bvars.push({ key: 'writing', sig: 'writing', writing: true });
    const sheets = (m.boards || []).map(g => ({ key: g.id, sig: g.state + ':' + (g.imagePath || '') + ':' + (g.error || '') + ':' + (g.gone ? 1 : 0), g }));
    const vv = c.versions || [];
    const vvars = vv.map(v => ({ key: v.id, sig: (v.model || '') + ':' + (v.boardId || ''), v }));
    if (writing && c.writing === 'video') vvars.push({ key: 'writing', sig: 'writing', writing: true });
    const made = _triesOf(m).some(t => t.gens.length);
    // A sheet's countdown in its words, on the step that shows it.
    const say = (x) => { const p = x && x.g && x.g.state === 'pending' ? l.steps.progs.get(x.g.id) : null; if (p) p.say(_boardWords(x.g, l.W)); };
    // Its sheets (Kling: its pictures) - every one drawn a variant; the one paged to, when it has landed, is the one chosen.
    const sheetSet = {
      key: 'board', word: kind === 'swap' ? T.tc('pager', 'picture') : T.t('sheet'), pick: B.chosen, variants: sheets,
      note: (x) => (!x ? '' : x.g.state === 'pending' ? T.t('being drawn') : !_boardOk(x.g) ? (x.g.gone ? T.t('not on the Images shelf any more') : T.t('not drawn'))
        : T.t('the video follows this one')),
      page: (x) => { if (x && _boardOk(x.g) && x.key !== B.chosen) patch({ chosen: x.key }); },
    };
    const bpage = (x) => { if (x && x.v && x.key !== B.cur) patch({ bcur: x.key }); };
    const steps = [];
    // Two steps at most - the video is at the head of the message.
    if (kind === 'swap') {
      // Kling's first frame: 1 - its prompt and the moment of the clip; 2 - the picture, and the press that makes
      // the video from it (Kling's prompt is its own, put in by the server).
      if (bvars.length) {
        steps.push({
          key: 'picture-prompt', title: T.t('first frame prompt'), word: T.t('variant'), pick: B.cur, variants: bvars,
          note: (x) => (!x ? '' : x.writing ? T.t('being written') : T.t('"draw the picture" draws this one')),
          body: (x, b, progs, nav) => _momentStep(m, l, x, b, progs, nav),
          acts: (x, a) => _boardPromptActs(m, l, x, a),
          page: bpage,
          freshen: () => _freshenStory(id, l),
        });
      }
      if (sheets.length || bvars.some(x => !x.writing)) {
        steps.push(Object.assign({}, sheetSet, {
          title: T.t('first frame'),
          body: (x, b, progs, nav) => _sheetStep(m, l, x, b, progs, nav),
          acts: (x, a) => _sheetActs(m, l, x, a),
          freshen: (x) => { say(x); _freshenStory(id, l); },
        }));
      }
    } else {
      // The storyboard: 1 - what the agent saw of the clips, the sheet's prompt and the sheet; 2 - the video's prompt.
      const watchSig = (c.watch || []).filter(Boolean).map(w => w.n + ':' + w.state + ':' + (w.why ? 1 : 0)).join(',') + '|' + (c.state === 'writing' ? 'w' : 'r');
      if ((c.watch || []).length || bvars.length) {
        steps.push({
          key: 'board-prompt', title: T.t('storyboard'), word: T.t('variant'), pick: B.cur, variants: bvars, more: [sheetSet],
          sig: () => watchSig,
          note: (x) => (!x ? '' : x.writing ? T.t('being written') : T.t('"draw" draws from this one')),
          body: (x, b, progs, nav) => _storyStep(m, l, x, b, progs, nav),
          acts: (x, a, nav) => _storyActs(m, l, x, a, nav),
          page: bpage,
          freshen: (x, nav) => { say(nav.shown('board')); _freshenStory(id, l); },
        });
      }
      if (vvars.length) {
        steps.push({
          key: 'prompt', title: T.t('video prompt'), word: T.t('variant'), pick: c.cur, variants: vvars,
          note: (x) => (!x ? '' : x.writing ? T.t('being written') : T.t('"make the video" sends this one')),
          body: (x, b, progs, nav) => _videoPromptStep(m, l, x, b, progs, nav),
          acts: (x, a) => _videoPromptActs(m, l, x, a),
          page: (x) => { if (x && x.v && x.key !== c.cur) patch({ cur: x.key }); },
          freshen: () => _freshenStory(id, l),
        });
      }
    }
    // Kling's message nothing has been drawn or made from yet opens on its first step.
    l.steps.paint({ steps, start: kind !== 'column' && !sheets.length && !made && steps.length ? steps[0].key : '' });
    _paintVid(l);
  }
  // The storyboard's first step: the clips' descriptions (folded), the sheet's prompt and the sheet.
  // The sheet's prompt a field down to the bottom of the video, the sheet a row under it.
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
  // The storyboard's sheet under its prompt: a row 72 px high - the sheet shown at its shape
  // (a press: the card's sheets large), its "‹ 2 of 3 ›", what it is; being drawn - its countdown; not drawn - why.
  function _sheetRow(m, l, x, b, progs, nav) {
    const row = el('div', 'vm-sheet');
    const pg = nav ? nav.pager('board') : null;
    const g = x ? x.g : null;
    if (!g) row.appendChild(el('span', 'vc-card-note', T.t('Not drawn yet - "draw the storyboard" below. The video follows the one shown here.')));
    else if (g.state === 'pending') row.appendChild(_boardBusy(g, progs, g.id, l.W));
    else if (!_boardOk(g)) row.appendChild(el('div', 'vc-board is-bad', g.gone ? T.t('not on the Images shelf any more - it cannot be followed') : String(g.error || T.t('it was not drawn')).slice(0, 200)));
    else {
      row.appendChild(_boardThumb(g, (l.m.boards || []).filter(_boardOk), l.W, 'row'));
      row.appendChild(el('span', 'vc-card-note', T.t('the storyboard - the video follows this one')));
    }
    if (pg) row.appendChild(pg);
    b.appendChild(row);
  }
  // Its presses: draw (from the prompt shown, as it is edited), "write the video" (the column's, from the sheet shown), the
  // price, "write it again", the attachments back.
  function _storyActs(m, l, x, a, nav) {
    l.drawGo = null; l.drawPrice = null;
    if (!x || x.writing) return;
    const sx = nav.shown('board');
    const ok = !!(sx && _boardOk(sx.g));
    if (l.kind === 'column') {
      const write = el('button', 'mv3-c-btn vc-go u-btn is-s' + (ok ? ' is-make is-main' : ''), T.t('write the video'));
      write.type = 'button';
      write.title = T.t('The video\'s prompt from your words, with this storyboard among the pictures - you see it before the video is made');
      write.addEventListener('click', () => _writeVideo(l.m, l, write));
      write.disabled = !ok;
      a.appendChild(write);
    }
    const drawn = (l.m.boards || []).length > 0;
    const go = el('button', 'mv3-c-btn vc-go u-btn is-s' + (drawn && l.kind === 'column' ? '' : ' is-make is-main'), drawn ? T.t('draw again') : _drawWord(l.W));
    go.type = 'button';
    go.title = T.t('A sheet from the storyboard prompt shown - as you edited it');
    const two = { bta: l.bta, range: null, frame: false, busy: false };
    go.addEventListener('click', (e) => _drawBoard(l.m, two, go, e));
    const price = el('span', 'vc-card-why');
    a.append(go, price);
    const again = el('button', 'vc-link', T.t('write it again'));
    again.type = 'button';
    again.title = T.t('Another variant of the storyboard prompt from the same words and pictures - this one stays');
    again.addEventListener('click', () => _rewrite(l.m, again));
    a.appendChild(again);
    if (l.kind === 'column' && (l.m.media || []).length) a.appendChild(_backLink(l.m));
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
      // In the place the prompt will stand in.
      b.appendChild(_waitField({ nav, word: T.t('prompt'), always: true, pager: nav ? nav.pager() : null, progs, progKey: 'w', prog: {
        label: first ? T.t('writing the storyboard prompt…') : T.t('writing another variant of the storyboard prompt…'),
        key: 'mv3-board-writer', estimateMs: 20000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      } }));
      return;
    }
    if (c.error && c.writing !== 'video') b.appendChild(el('div', 'mv3-ig-bad', T.t('The last writing did not work: {why}', { why: c.error })));
    const bta = document.createElement('textarea');
    bta.className = 'vc-prompt-ta is-board u-area';
    bta.spellcheck = true;
    bta.maxLength = 6000;
    bta.value = x.v.prompt || '';
    bta.title = T.t('The storyboard sheet\'s prompt - numbered panels, one per beat of the clip; Image 1, Image 2 are the pictures below.');
    const key = 'b:' + m.id + ':' + x.key;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, board: bta.value, bver: x.key };
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    bta.addEventListener('input', () => { clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    bta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    // A field down to the bottom of the video (less the sheet's row under it), its variants' pager in its
    // title line.
    b.appendChild(_field({ nav, word: T.t('prompt'), always: true, text: () => bta.value, ta: bta, pager: nav ? nav.pager() : null }));
    l.bta = bta;
  }
  // 1 · Kling's first frame: the moment of the clip it is drawn from and the prompt the writer wrote - [clip 1] is
  // the clip's still there, [picture N] the person's pictures. The moment is where the part starts, anywhere in the clip.
  const _t = (v) => { const x = Math.max(0, +v || 0); const mm = Math.floor(x / 60); return mm + ':' + (x - mm * 60).toFixed(1).padStart(4, '0'); };
  function _momentStep(m, l, x, b, progs, nav) {
    const c = l.m.card, B = c.board || {};
    l.bta = null; l.range = null;
    if (!x || x.writing) {
      // In the place the prompt will stand in.
      b.appendChild(_waitField({ nav, word: T.t('first frame prompt'), pager: nav ? nav.pager() : null, progs, progKey: 'w', prog: {
        label: T.t('writing another variant of the first frame\'s prompt…'), key: 'mv3-video-writer', estimateMs: 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      } }));
      return;
    }
    if (c.error) b.appendChild(el('div', 'mv3-ig-bad', T.t('The last writing did not work: {why}', { why: c.error })));
    const clip = (l.m.media || []).find(y => y.kind === 'video') || {};
    const len = Math.max(3, +B.len || ((+clip.out || 0) - (+clip.in || 0)));
    const lo = 0;
    const hi = Math.max(0, (+B.dur || 0) - 3);
    const mo = el('div', 'vc-moment');
    const v = document.createElement('video');
    v.className = 'vc-moment-v';
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.src = clip.path || '';
    const side = el('div', 'vc-moment-side');
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(lo); range.max = String(hi); range.step = '0.04';
    range.value = String(Math.max(lo, Math.min(hi, +clip.in || 0)));
    wireRange(range);                               // the shared slider
    range.title = T.t('The first frame: the moment your character is seen best - the moves go from here');
    const said = el('span', 'vc-moment-at');
    const say = () => {
      said.textContent = T.t('the first frame: {at} · the moves {from} – {to}', { at: _t(range.value), from: _t(range.value), to: _t(Math.min(B.dur, +range.value + len)) });
    };
    say();
    let raf = 0;
    const show = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { try { v.currentTime = +range.value; } catch (e) { /* not loaded */ } }); };
    v.addEventListener('loadedmetadata', show, { once: true });
    range.addEventListener('input', () => { say(); show(); });
    // The drawing waits for the moment to be written (`atSave`): it reads it from the card.
    range.addEventListener('change', () => { l.atSave = _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, at: +range.value }, 'PATCH'); });
    side.append(range, said, el('span', 'vc-card-note', T.t('A new moment needs a new picture: the first frame is drawn from it.')));
    mo.append(v, side);
    const bta = document.createElement('textarea');
    bta.className = 'vc-prompt-ta is-board u-area';
    bta.spellcheck = true;
    bta.maxLength = 6000;
    bta.value = toShown(x.v.prompt || '');
    bta.title = T.t('The first frame\'s prompt: [clip 1] is the clip\'s still at the moment above, [picture 1], [picture 2]... your pictures by their numbers.');
    const key = 'b:' + m.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, board: toNeutral(bta.value), bver: x.key };
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    bta.addEventListener('input', () => { clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    bta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    // Its title line (the steps, the variants' pager), the moment of the clip under it, then the
    // prompt as a field down to the bottom of the video.
    const f = _field({ nav, word: T.t('first frame prompt'), text: () => bta.value, ta: bta, pager: nav ? nav.pager() : null });
    f.insertBefore(mo, bta);
    b.appendChild(f);
    l.bta = bta;
    l.range = range;
  }
  function _boardPromptActs(m, l, x, a) {
    l.drawGo = null; l.drawPrice = null;
    if (!x || x.writing) return;
    const go = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', l.W === 'picture' ? T.t('Draw the picture') : T.t('Draw the storyboard'));
    go.type = 'button';
    const two = { bta: l.bta, range: l.range, frame: l.kind === 'swap', busy: false };
    go.addEventListener('click', (e) => _drawBoard(l.m, two, go, e));
    const price = el('span', 'vc-card-why');
    a.append(go, price);
    // Kling's first frame and the storyboard: their own prompt written again.
    const again = el('button', 'vc-link', T.t('write it again'));
    again.type = 'button';
    again.title = l.kind === 'swap' ? T.t('Another variant of the first frame\'s prompt from the same words and pictures - this one stays')
      : T.t('Another variant of the storyboard prompt from the same words and pictures - this one stays');
    again.addEventListener('click', () => _rewrite(l.m, again));
    a.appendChild(again);
    if ((l.kind === 'column' || (l.kind === 'swap' && l.m.card.plain)) && (l.m.media || []).length) a.appendChild(_backLink(l.m));
    l.drawGo = go;
    l.drawPrice = price;
    _freshenStory(m.id, l);
  }
  // 2 · Kling's first frame (the picture): the one shown - drawing, drawn (press: large), or why not.
  // It fills the step down to the bottom of the video, at least 160 px, at its shape; the steps and its pictures'
  // "‹ 2 of 3 ›" in its title line, Kling's own prompt under it. (The storyboard's sheet is a row under its prompt: _sheetRow.)
  function _sheetStep(m, l, x, b, progs, nav) {
    const fill = el('div', 'vm-fill');
    const g = x ? x.g : null;
    const ok = !!(g && _boardOk(g));
    if (!g) {
      fill.classList.add('is-empty');
      fill.appendChild(el('span', 'w', T.t('Not drawn yet - "draw the picture" on the step before. The video follows the one shown here.')));
    } else if (g.state === 'pending') fill.appendChild(_boardBusy(g, progs, g.id, l.W));
    else if (!ok) fill.appendChild(el('div', 'vc-board is-bad', g.gone ? T.t('not on the Images shelf any more - it cannot be followed') : String(g.error || T.t('it was not drawn')).slice(0, 200)));
    else fill.appendChild(_boardThumb(g, (l.m.boards || []).filter(_boardOk), l.W, 'frame'));
    b.appendChild(_field({ nav, word: T.t('first frame'), pager: nav ? nav.pager('board') : null, wait: fill }));
    // Kling's prompt is its own: said, not a field.
    if (ok) {
      const clip = (l.m.media || []).find(y => y.kind === 'video') || {};
      const said = T.t('Kling moves this picture with the clip {from} – {to} and gets: {prompt}', { from: _t(clip.in), to: _t(clip.out), prompt: l.m.card.prompt || '' });
      const n = el('div', 'vc-card-note vm-note2', said);
      n.title = said;
      b.appendChild(n);
    }
  }
  function _sheetActs(m, l, x, a) {
    l.drawGo = null; l.drawPrice = null;
    // Kling's first frame: the picture drawn, and right under it the press that makes the
    // video from it - its price, the count - then another picture.
    if (l.kind === 'swap') {
      l.go = null; l.price = null;
      if (x && _boardOk(x.g)) {
        const nBtn = el('button', 'vc-n u-btn is-s', '×' + (_cardN.get(m.id) || 1));
        nBtn.type = 'button';
        nBtn.title = T.t('How many to make from it - each clip is its own variant of the video');
        nBtn.addEventListener('click', () => {
          _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
          nBtn.textContent = '×' + _cardN.get(m.id);
          _freshenStory(m.id, l);
        });
        const go = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', T.t('Make the video'));
        go.type = 'button';
        go.addEventListener('click', () => _make(l.m, go));
        const price = el('span', 'vc-card-why');
        a.append(nBtn, go, price);
        l.go = go;
        l.price = price;
      }
      const redo = el('button', 'mv3-c-btn vc-go u-btn is-s' + (x && _boardOk(x.g) ? '' : ' is-make is-main'), x ? T.t('draw again') : T.t('draw the picture'));
      redo.type = 'button';
      redo.title = T.t('Another picture from the prompt chosen on the step before');
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
      const write = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', T.t('Write the video'));
      write.type = 'button';
      write.title = T.t('The video\'s prompt from your words, with this storyboard among the pictures - you see it before the video is made');
      write.addEventListener('click', () => _writeVideo(l.m, l, write));
      write.disabled = !(x && _boardOk(x.g));
      a.appendChild(write);
    }
    const redo = el('button', 'mv3-c-btn vc-go u-btn is-s' + (l.kind === 'column' ? '' : ' is-make is-main'), x ? T.t('draw again') : _drawWord(l.W));
    redo.type = 'button';
    redo.title = T.t('Another sheet from the prompt chosen on the step before');
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
    if (!g) { note(btn, T.t('No storyboard yet.'), T.t('Draw it first - the video follows it.')); return; }
    const why = _readyFor(m);
    if (why) { note(btn, why[0], why[1]); return; }
    btn.disabled = true;
    try {
      await _flushWatch(m.id);
      const b = _body(m.media || []);
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/video', { project: m.project, model: b.model, agg: b.agg, params: b.params, boardId: g.id });
      if (!d || !d.success) { note(btn, T.t('Not written.'), (d && d.error) || T.t('the server did not answer')); return; }
      await ctx.reload(true);
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  }
  // 3 · the video prompt: its words to edit, and what goes with it - the pictures with the sheet as the last one (the
  // sheet ITS variant was written with). Kling's first frame has no such step - its prompt is Kling's own.
  function _videoPromptStep(m, l, x, b, progs, nav) {
    const c = l.m.card;
    l.ta = null; l.ver = ''; l.vmodel = ''; l.boardId = ''; l.patchKey = '';
    if (!x || x.writing) {
      // In the place the prompt will stand in.
      b.appendChild(_waitField({ nav, word: T.t('prompt'), pager: nav ? nav.pager() : null, progs, progKey: 'w', prog: {
        label: T.t('writing the video prompt…'), key: 'mv3-video-writer', estimateMs: 25000,
        startedAt: Date.parse(c.startedAt || m.at) || 0,
      } }));
      return;
    }
    const v = x.v;
    if (c.error && c.writing !== 'board') b.appendChild(el('div', 'mv3-ig-bad', T.t('The last writing did not work: {why}', { why: c.error })));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta u-area';
    ta.spellcheck = true;
    ta.value = toShown(v.prompt);
    ta.title = T.t('The prompt the model gets - edit it before the video is made. [picture N] names a picture; the storyboard is the last one.');
    const key = 'p:' + m.id + ':' + v.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, prompt: toNeutral(ta.value), ver: v.id };
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    ta.addEventListener('input', () => { clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    ta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    const media = l.m.media || [];
    const sheet = (l.m.boards || []).find(g => g.id === v.boardId);
    const has = !!(sheet && sheet.imagePath);
    const all = media.filter(a => a.kind === 'image').concat(has ? [{ path: sheet.imagePath, kind: 'image', role: 'storyboard', label: T.t('storyboard') }] : [])
      .concat(media.filter(a => a.kind !== 'image'));
    // Open at once, down to the bottom of the video; what goes with it under it, in
    // small cells.
    b.appendChild(_field({ nav, word: T.t('video prompt'), text: () => ta.value, ta, pager: nav ? nav.pager() : null }));
    const row = _mediaRow(all);
    if (row) { row.classList.add('vm-refs-s'); b.appendChild(row); }
    if (sheet && sheet.gone) b.appendChild(el('div', 'mv3-ig-bad', T.t('Its storyboard is not on the Images shelf any more - write the video again from another sheet.')));
    Object.assign(l, { ta, save, ver: v.id, vmodel: v.model || c.model, boardId: v.boardId || '', patchKey: key });
  }
  function _videoPromptActs(m, l, x, a) {
    l.go = null; l.price = null;
    if (!x || x.writing) return;
    const nBtn = el('button', 'vc-n u-btn is-s', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = T.t('How many to make from it - each clip is its own variant of the video');
    nBtn.addEventListener('click', () => {
      _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
      nBtn.textContent = '×' + _cardN.get(m.id);
      _freshenStory(m.id, l);
    });
    const go = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', T.t('Make the video'));
    go.type = 'button';
    go.addEventListener('click', () => _make(l.m, go));
    const price = el('span', 'vc-card-why');
    a.append(nBtn, go, price);
    const again = el('button', 'vc-link', T.t('write it again'));
    again.type = 'button';
    again.title = T.t('Another variant of the video prompt, with the storyboard shown on its step - this one stays');
    again.addEventListener('click', () => _writeVideo(l.m, l, again));
    a.appendChild(again);
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
        l.go.textContent = T.t('Make the video');
        l.price.textContent = T.t('this video is made by {model} - pick it on the left', { model: l.kind === 'swap' ? 'Kling motion control' : 'Seedance' });
        l.price.title = l.price.textContent;
      }
    }
  }

  // WHAT WAS ASKED stands at the head of its answer - the person's turn is not drawn
  // apart: the words whole (folded after three lines); the attachments.
  function _askedOf(o) {
    const box = el('div', 'vc-asked');
    const words = String(o.words || '').trim();
    if (words || o.none) {
      const t = el('div', 'vc-asked-t' + (words ? '' : ' is-none'), words || o.none);
      box.appendChild(t);
      if (words) _fold(t, 0);
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
      const more = el('button', 'vc-asked-more', T.t('More'));
      more.type = 'button';
      more.addEventListener('click', () => { const open = t.classList.toggle('is-open'); more.textContent = open ? T.t('Less') : T.t('More'); });
      t.after(more);
    });
  }
  // The message drawn at the press (the shell's `sending`): what was asked, and "sending…" until the answer comes.
  // With its head as every message has it: the video's field on the right, empty.
  let _pendSeq = 0;
  function _sendingCard(o) {
    const box = el('div', 'mv3-ig-msg is-agent is-sending vc-card');
    const h = el('div', 'vc-card-h');
    const m = model();
    h.appendChild(el('span', 'k', _boardOn() ? T.t('storyboard') : T.t('video')));
    if (m) h.appendChild(el('span', 'm', T.t('for {model}', { model: m.label })));
    box.appendChild(h);
    const asked = _askedOf({ words: o.text, media: o.media, none: T.t('from the attachments alone') });
    const vid = _vidField('pend:' + (++_pendSeq), null);
    vid.paint([], _shapeNow(o.media || null));
    const hd = _headOf(asked, vid);
    hd.left.appendChild(_waitField({ words: T.t('sending…'), pulse: true }));
    box.appendChild(hd.el);
    return box;
  }
  // A message of the one press - the writer off - has the same head: what was asked on the
  // left, its clip on the right (×2 - its variants), "read more" at its foot. It has no steps and no presses. Its countdown is
  // the thread's to finish when the clip lands (`progs`).
  function _plainBubble(m, progs, asked) {
    if (m.role === 'user' || m.card) return null;
    const gens = (m.gens && m.gens.length) ? m.gens : (m.gen ? [m.gen] : []);
    if (!gens.length) return null;
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-plain-msg');
    const h = el('div', 'vc-card-h');
    h.appendChild(el('span', 'k', T.t('Video')));
    if (gens[0].model) h.appendChild(el('span', 'm', T.t('for {model}', { model: _labelOf(gens[0].model) })));
    box.appendChild(h);
    const media = (m.media || []).length ? m.media : ((asked && asked.media) || []);
    const words = String((m.asked != null ? m.asked : (asked ? asked.text : '')) || '').trim();
    // The words whole, as a block down to the bottom of the video, scrolling inside - not
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

  // What a message carries, by kind and number, each with its slot's or its role's name - what was asked, a writer's
  // message.
  function _mediaRow(media) {
    if (!media.length) return null;
    const row = el('div', 'mv3-ig-msg-refs');
    const count = { image: 0, video: 0, audio: 0 };
    for (const a of media) {
      const k = count[a.kind] != null ? a.kind : 'image';
      count[k]++;
      const cell = refCell(a, k, count[k], media);
      const what = k === 'video' ? T.t('clip {n}', { n: count[k] }) : k === 'audio' ? T.t('sound {n}', { n: count[k] }) : T.t('picture {n}', { n: count[k] });
      const named = a.label ? T.t('{what} - {label}', { what, label: a.label }) : what;
      cell.title = a.gone ? T.t('{what} - not in this library', { what: named }) : named;
      const wrap = el('div', 'vc-ref' + (a.gone ? ' is-gone' : ''));
      wrap.appendChild(cell);
      if (a.label) wrap.appendChild(el('span', 'lab', a.label));
      row.appendChild(wrap);
    }
    return row;
  }

  // ── A TEXT FOLDED INTO ONE LINE ──
  // Only the clips' descriptions on the storyboard's step are folded: each is one
  // line: its word and ▸, its first words, how many characters, and its variants' "‹ 2 of 3 ›" at the right end. A press
  // opens it in place, to read and edit, as tall as its text. What is open stays open while the person stays in the chat -
  // the thread's repaints, another variant, a make -, and everything folds again when anything hides the chat (its window
  // closed, another project, another page, a reload).
  // Every other text of a step is a field down to the bottom of the video (`_field` below).
  const _open = new Set();       // message id + ':' + line key - the lines open now
  const _folds = new Set();      // { el, fold } of every line drawn - folded at once when the chat hides
  function _foldAll() {
    _open.clear();
    for (const f of _folds) { if (f.el.isConnected) f.fold(); else _folds.delete(f); }
  }
  const _flat = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const _chars = (n) => T.tn(n, '{n} chars', '{n} chars', { n: String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') });
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
      btn.title = on ? T.t('Fold it into one line') : T.t('Open the whole text - to read and edit');
      if (on) _open.add(key); else _open.delete(key);
    };
    // Folded with a change being typed: its blur writes it.
    const fold = () => { if (o.ta && document.activeElement === o.ta) o.ta.blur(); set(false); };
    set(_open.has(key));
    btn.addEventListener('click', () => set(!wrap.classList.contains('is-open')));
    _folds.add({ el: wrap, fold });
    return wrap;
  }

  // ── A STEP'S TEXT AS A FIELD ──
  // The text of the step shown - a prompt, a clip's description - is open at once: a field from under what was asked down
  // to the bottom of the video's column, at least 120 px, scrolling inside, edited in place. Its title line: the
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
  // A field's place while it has no text - from the press of ">" on: dashed, as tall as the
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

  // ── THE VIDEO AT THE HEAD OF ITS MESSAGE ──
  // Right of what was asked, against the message's right edge, 180 px wide at the clip's shape (9:16 - 180×320, 16:9 -
  // 180×101, 1:1 - 180×180). Before any clip: a dashed field of the shape the column would make it now (the price and the
  // press follow the column too), "the video will appear here" - from the press of ">" on. Being made: its countdown in it,
  // the cross letting go of the row. Failed: a red frame and its words, "Alerts can try it again" under it. Several clips -
  // ×2, made again - are its variants: "‹ 1 of 3 ›" under it, a new one shown by itself, which attempt it is under the
  // pointer. "read more" at the message's foot. No "to timeline" under
  // it: the clip is dragged onto a lane.
  const _vidShown = new Map();   // message id -> { key, n } - the clip shown as the person left it, and how many there were
  const _dims = new Map();       // a clip's path -> 'w:h' ('' while it is read) - one clip decides Seedance's shape
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
  // The field of one message: `paint(clips, shape)` - clips [{ key, g, n, at, ver }] in their order, `shape` the field's
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
        e.appendChild(el('span', 'w', T.t('the video will appear here')));
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
        face.appendChild(el('span', 'w', g.error || T.t('nothing came back')));
        box.appendChild(face);
        if (!g.cancelled && g.alertId && !/question instead/.test(g.error || '')) box.appendChild(el('div', 'mv3-ig-note', T.t('Alerts can try it again')));
      }
      // Which attempt it is, under the pointer.
      const when = x.at ? new Date(x.at) : null;
      const said = [x.n ? T.t('attempt {n}', { n: x.n }) : '', when && !isNaN(when) ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        x.ver ? T.t('from prompt variant {n}', { n: x.ver }) : ''].filter(Boolean).join(' · ');
      if (face && said) face.title = (face.title ? face.title + ' · ' : '') + said;
      if (clips.length > 1) {
        const pg = el('span', 'vm-pg is-vid');
        const p = el('button', 'vc-nav is-prev u-btn is-s is-icon', '‹');
        const t = el('span', 'vm-pg-t', T.t('{i} of {n}', { i: i + 1, n: clips.length }));
        const nx = el('button', 'vc-nav is-next u-btn is-s is-icon', '›');
        p.type = 'button'; nx.type = 'button';
        p.disabled = i <= 0;
        nx.disabled = i >= clips.length - 1;
        t.title = said ? T.t('clip {i} of {n} · {note}', { i: i + 1, n: clips.length, note: said }) : T.t('clip {i} of {n}', { i: i + 1, n: clips.length });
        p.title = i > 0 ? T.t('‹ The clip before ({i} of {n})', { i, n: clips.length }) : T.t('This is the first clip');
        nx.title = i < clips.length - 1 ? T.t('The next clip ({i} of {n}) ›', { i: i + 2, n: clips.length }) : T.t('This is the newest clip');
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
  // The message's two columns: what was asked at the top of the left one - the steps go
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
      return { key: g.id, g, n: i + 1, at: t.at || g.at, ver: vi >= 0 && vers.length > 1 ? vi + 1 : 0 };
    }));
  }
  // A working message's field drawn as the card is now.
  function _paintVid(l) {
    if (!l || !l.vid) return;
    l.vid.paint(_clipsOf(l.m), _shapeNow(l.m.media || []));
  }

  // ── The writer's message ──
  // With the writer on, ">" packs the words and the attachments into a message of their own - the box and the zone are
  // emptied - and the writer's prompt comes back in it to look at and edit; only its "make the video" spends. The message
  // is a SUB-PROJECT (vsteps.js):
  // "prompt" - every writing of it a variant - then "video" - every clip of every attempt a variant. The variant of the
  // prompt shown is the one made from.
  function _reviewCard(m, progs) {
    const c = m.card;
    _forget(m.id);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-prompt is-steps is-' + c.state);
    const h = el('div', 'vc-card-h');
    h.appendChild(el('span', 'k', T.t('Video')));
    if (c.model) h.appendChild(el('span', 'm', T.t('for {model}', { model: _labelOf(c.model) })));
    box.appendChild(h);
    // What was asked, at the head - seen on every step.
    const frames = (m.media || []).some(a => /^frame-/.test(String(a.role || '')));
    const asked = _askedOf({ words: c.text, media: m.media, none: frames ? T.t('from the frames alone') : T.t('from the attachments alone') });
    // What was asked on the left, the video on the right; "read more" of the clip shown at the foot.
    const foot = el('div', 'vm-foot');
    const vid = _vidField(m.id, foot);
    const hd = _headOf(asked, vid);
    box.appendChild(hd.el);
    // A card whose clips are being watched, or were, has its steps at once: what the agent saw comes first.
    if (!(c.versions || []).length && !(c.watch || []).length) {
      vid.paint(_clipsOf(m), _shapeNow(m.media || []));
      // The prompt's place, with its countdown or why it was not written.
      if (c.state === 'writing') {
        hd.left.appendChild(_waitField({ word: T.t('prompt'), progs, progKey: 'w:' + m.id, prog: {
          label: T.t('writing the prompt…'), key: 'mv3-video-writer', estimateMs: 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
        } }));
        return box;
      }
      hd.left.appendChild(_waitField({ word: T.t('prompt'), bad: true, words: c.error || T.t('it was not written') }));
      const acts = el('div', 'vc-card-acts');
      const again = el('button', 'mv3-c-btn vc-go u-btn is-s', T.t('Write it again'));
      again.type = 'button';
      again.addEventListener('click', () => _rewrite(m, again));
      acts.appendChild(again);
      if (c.plain && (m.media || []).length) acts.appendChild(_backLink(m));
      box.appendChild(acts);
      return box;
    }
    const steps = stepCard(m.id);
    // The steps under what was asked, in the left column; their presses under both columns.
    hd.left.append(steps.parts[0], steps.parts[1]);
    box.append(steps.parts[2], foot);
    const l = { m, el: box, steps, vid, ta: null, go: null, price: null, save: null, review: true, ver: '', vmodel: '', patchKey: '' };
    _live.set(m.id, l);
    _paintReview(m.id, l);
    return box;
  }
  // Two steps at most: what the agent saw of the clips, then the prompt - the video is at the head.
  function _paintReview(id, l) {
    const m = l.m, c = m.card;
    const vers = (c.versions || []).map(v => ({ key: v.id, sig: v.model, v }));
    const written = vers.length > 0;
    // The prompt is being written once the clips have been watched - not while they are.
    if (c.state === 'writing' && !_watchBusy(c)) vers.push({ key: 'writing', sig: 'writing', writing: true });
    const steps = [];
    const watch = _watchStep(m, l, written);
    if (watch) steps.push(watch);
    if (vers.length) steps.push({
      key: 'prompt', title: T.t('prompt'), word: T.t('variant'), pick: c.cur, variants: vers,
      note: (x) => (!x ? '' : x.writing ? T.t('being written') : T.t('"make the video" sends this one')),
      body: (x, b, progs, nav) => _promptStep(m, l, x, b, progs, nav),
      acts: (x, a) => _promptActs(m, l, x, a),
      // The variant paged to is the chosen one (the server keeps it for the next read).
      page: (x) => { if (x && x.v && x.key !== l.m.card.cur) _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, cur: x.key }, 'PATCH'); },
      freshen: () => _freshenReview(id, l),
    });
    l.steps.paint({ steps });
    _paintVid(l);
  }
  function _promptStep(m, l, x, b, progs, nav) {
    const c = l.m.card;
    l.ta = null; l.ver = ''; l.vmodel = ''; l.patchKey = '';
    if (!x || x.writing) {
      // Counted from the end of the watching, when the clips were watched first.
      const watched = (c.watch || []).map(w => Date.parse((w && w.at) || '') || 0);
      // In the place the prompt will stand in.
      b.appendChild(_waitField({ nav, word: T.t('prompt'), pager: nav ? nav.pager() : null, progs, progKey: 'w', prog: {
        label: (c.versions || []).length ? T.t('writing another variant…') : T.t('writing the prompt…'), key: 'mv3-video-writer', estimateMs: 25000,
        startedAt: Math.max(Date.parse(c.startedAt || m.at) || 0, ...watched),
      } }));
      return;
    }
    const v = x.v;
    if (c.error) b.appendChild(el('div', 'mv3-ig-bad', T.t('The last writing did not work: {why}', { why: c.error })));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta u-area';
    ta.spellcheck = true;
    ta.value = toShown(v.prompt);
    ta.title = T.t('The prompt the model gets - edit it before the video is made. [picture 1], [clip 1] name what is attached, by its number in its part.');
    const key = 'p:' + m.id + ':' + v.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      const body = { project: m.project, prompt: toNeutral(ta.value), ver: v.id };
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), body, 'PATCH');
    };
    ta.addEventListener('input', () => { clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    ta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    // Open at once, down to the bottom of the video; the steps and its variants'
    // pager in its title line.
    b.appendChild(_field({ nav, word: T.t('prompt'), text: () => ta.value, ta, pager: nav ? nav.pager() : null }));
    Object.assign(l, { ta, save, ver: v.id, vmodel: v.model || c.model, patchKey: key });
  }
  function _promptActs(m, l, x, a) {
    l.go = null; l.price = null;
    if (!x || x.writing) return;
    const c = l.m.card;
    const nBtn = el('button', 'vc-n u-btn is-s', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = T.t('How many to make from it - each clip is its own variant of the video');
    nBtn.addEventListener('click', () => {
      _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
      nBtn.textContent = '×' + _cardN.get(m.id);
      _freshenReview(m.id, l);
    });
    const go = el('button', 'mv3-c-btn vc-go is-make u-btn is-s is-main', T.t('Make the video'));
    go.type = 'button';
    go.addEventListener('click', () => _make(l.m, go));
    const price = el('span', 'vc-card-why');
    const again = el('button', 'vc-link', T.t('Write it again'));
    again.type = 'button';
    again.title = T.t('Another variant of the prompt from the same words and attachments - this one stays');
    again.addEventListener('click', () => _rewrite(l.m, again));
    a.append(nBtn, go, price, again);
    // The plain chat's attachments go back to the zone for the next message.
    if (c.plain && (l.m.media || []).length) a.appendChild(_backLink(l.m));
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
    l.go.textContent = other ? T.t('Write it again for {model}', { model: mm.label }) : (made ? T.t('Make the video again') : T.t('Make the video')) + (n > 1 ? ' ×' + n : '');
    l.go.classList.toggle('is-make', !other);
    l.go.classList.toggle('is-main', !other);
    l.go.disabled = c.state === 'writing';
    const pr = priceOf(rec(), l.m.media || []);
    l.price.textContent = other ? T.t('this variant was written for {model}', { model: _labelOf(vm) })
      : !pr || pr.none ? (mm ? T.t('{model} · no published price', { model: mm.label }) : '')
        : pr.fromClip ? (pr.usd != null ? T.t('≈{price} at most · {secs} of the clip', { price: money(pr.usd * n), secs: _s(pr.secs) }) : T.t('≈{price} per second of clip', { price: money(pr.per) })) + ' · ' + (mm ? mm.label : '')
          : '≈' + money(pr.usd * n) + ' · ' + _secsWords(pr) + ' · ' + pr.res + ' · '
            + (mm ? mm.label : '') + ' · ' + (rec() ? rec().aggLabel : '');
    // The row of presses stays one line: the price gives way, whole under the pointer.
    l.price.title = l.price.textContent;
  }
  // A finished clip: its poster - dragged onto a lane. At its message's head, 180 px wide at its
  // shape. No "to timeline" under it: the drag lays it. A press on it does nothing: ▶ in its middle plays the thread's clips in the Library's viewer, and the pointer
  // resting on it plays it in place without its sound.
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
    box.appendChild(mediaBtn('video', open));
    if (g.duration) box.appendChild(el('span', 'mv3-ig-dur', T.t('{n}s', { n: (+g.duration).toFixed(1) })));
    box.title = T.t('Drag it onto a lane');
    hoverClip(box, g.videoPath);
    const item = {
      clip: true, src: g.videoPath, thumb: g.posterPath || null, libId: g.birolId || '',
      name: String(g.said || g.prompt || '').slice(0, 60), dur: +g.duration || 0, group: 'videochat',
    };
    box.draggable = true;
    box.addEventListener('dragstart', (ev) => {
      // Not onto a highlights project's own timeline - a fragment is opened first.
      if (refuseHome(box, ev)) return;
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData(Store.DRAG_TYPE, JSON.stringify(item));
      box.classList.add('is-dragging');
    });
    box.addEventListener('dragend', () => box.classList.remove('is-dragging'));
    cell.appendChild(box);
    // Made from a thing of the timeline: the button that lays it back there (js/merge-v3/tl-gen.js).
    const back = backButton(g, g.media || [], { src: g.videoPath, thumb: g.posterPath || null, libId: g.birolId || '',
      name: item.name, dur: +g.duration || 0, w: +g.w || 0, h: +g.h || 0 }, 'video');
    if (back) cell.appendChild(back);
  }

  // "attachments back to the zone": this message's attachments in the zone again, for the next
  // message - what is there now is replaced, after a question.
  function _backLink(m) {
    const back = el('button', 'vc-link', T.t('Attachments back to the zone'));
    back.type = 'button';
    back.title = T.t('Put this message\'s attachments into the zone again, for the next message');
    back.addEventListener('click', () => {
      const list = (m.media || []).filter(a => a && a.path);
      if (!list.length) return;
      const put = () => { ctx.useAtts(list); const ui = ctx.ui(); if (ui) ui.ta.focus(); };
      const n = ctx.atts().length;
      if (n) askDelete(back, T.t('Replace what is in the zone?'), T.tn(n, '{n} attachment is there now - this message\'s {m} come in their place.', '{n} attachments are there now - this message\'s {m} come in their place.', { m: list.length }), put);
      else put();
    });
    return back;
  }

  return {
    name: 'videos',
    kind: 'clip',
    ids: { root: 'mv3-vc' },
    keys: { draft: 'mv3_vc_draft_v1', write: 'mv3_vc_write_v1', strip: 'mv3-vc-strip-w' },
    maxAtts: MAX_ATTS,
    counts: [1, 2],
    noun: { one: 'picture', many: 'pictures' },
    busyWord: T.t('making the clip'),
    // A first guess; each model learns its own pace from its first clips (startInlineProgress keeps an average per key).
    eta: 180000,
    progressKey: (g) => 'mv3-video-' + (g.model || ''),
    sendUrl: '/api/mv3/video/send',
    // A clip that lands is not put in the zone by itself: it is one press on it in the picker - "made in this project".
    landAsRef: false,
    text: {
      placeholder: T.t('Describe a clip, or say what to change.'),
      empty: T.t('Describe a clip. What comes back stays in this project - and on the B-roll shelf.'),
      emptyIcon: 'film',
      // From Home or the Library - THE draft's conversation (chat-owner.js unbound): VIDEO → Generated →
      // the model's folder.
      emptyDraft: T.t('Describe a clip. What comes back lies in the Library, in VIDEO → Generated → its model.'),
      emptyNoProject: T.t('Describe a clip. A project is started for it with the first message.'),
      onlyFiles: T.t('Only pictures, clips and sounds can be attached here.'),
      slot: T.t('From the Library or this computer'),
      plus: T.t('Add a picture, a clip or a sound from this computer - into the folder open here when it is one of yours of its kind (IMAGES, VIDEO → Uploads, My sounds), else into the root of its kind - and straight into the zone.'),
      cat: T.t('This project\'s clips, or a folder of the Library'),
    },
    // The right column's "this project": the clips made in it.
    feed: {
      url: (k) => '/api/mv3/video/feed?project=' + encodeURIComponent(k),
      map: (g) => ({
        path: g.videoPath, aspect: Src.shape(g.w, g.h) || (g.params || {}).aspect || '', state: g.state, error: g.error,
        name: String(g.said || g.prompt || '').slice(0, 80), thumb: g.posterPath || '', dur: +g.duration || 0,
        ftype: 'video', libId: g.birolId || '', group: 'videochat',
      }),
    },
    // The right column: what the zone takes, by the model chosen.
    column: {
      multi: true,
      // THIS PROJECT first - its pictures, and its clips and sounds while the model takes them.
      roots: () => ['plinks', 'references', 'images'].concat(_colTakes('video') ? ['video'] : [], _colTakes('audio') ? ['audio'] : []),
      files: (root) => (root === 'plinks' ? ['photo'].concat(_colTakes('video') ? ['video'] : [], _colTakes('audio') ? ['audio'] : [])
        : root === 'references' ? (_colTakes('video') ? ['photo', 'video'] : 'photo')
        : root === 'video' ? 'video' : root === 'audio' ? 'audio' : 'photo'),
      fit: (f) => { if (!f || f.ftype !== 'video') return true; const c = _clipFit(); return !c.fit || c.fit(f); },
      // Read again when what it offers changes with the model: clips or not, sounds or not, the longest clip.
      sig: () => [_colTakes('video'), _colTakes('audio'), _clipFit().note || ''].join('|'),
      group: 'images', home: 'images',
    },
    // Every "+" of the zone opens the picker on its place.
    pick: {
      // The Library's unbound chat has no project: no "made in this project".
      sources: (kind) => (SOURCES[kind] || []).filter(s => !(s.id === 'made' && Store.unbound())),
      // The window with the tree, the almanac's size (chat-pick.js). For clips: only the ones the chosen model takes by their length - read at every opening.
      tree: (kind) => (kind === 'video' && Src.TREE.video ? Object.assign({}, Src.TREE.video, _clipFit()) : Src.TREE[kind] || null),
      start: _startFor,
      why: _pickWhy,
      // The shelf a file from this computer is filed on, and what the picker says of it.
      lands: { image: 'images', video: 'uploads', audio: 'sounds' },
      upWords: {
        image: T.t('A picture goes into the folder open here when it is one of yours in IMAGES - else into IMAGES itself.'),
        video: T.t('A clip goes into the folder open here when it is one of yours in VIDEO → Uploads - else into Uploads itself.'),
        audio: T.t('A sound goes into the folder open here when it is one of yours in My sounds - else into My sounds itself.'),
      },
      // A part window left open over the zone goes: the picker covers it.
      onOpen: () => closeTrim(),
    },
    // A clip comes by a link too - the picker's "from a link", into Uploads (its root) and into its place,
    // as a clip from this computer (chat-shell.js _linkIn, lib/link-queue.js).
    links: { video: true },
    // Each kind through its own door - pictures into IMAGES, clips into VIDEO -> Uploads, sounds into SFX ->
    // My sounds, each into the root of its kind or, through the attachment window, the person's folder open
    // there - and straight into their part of the zone.
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
    // Kling motion control's empty box sends its standard prompt.
    emptyText: () => (isMC() && !ctx.writing() && _table ? _table.standardPrompt || '' : ''),
    // With the writer on, a message may be the attachments alone - and with frames,
    // which the writer writes even when it is off.
    emptyOk: () => ctx.atts().length > 0 && (ctx.writing() || _framesMode()),
    // The writer's message holds the attachments: the zone is emptied for the next message.
    afterSend: (d) => { if (d && (d.review || d.storyboard || d.frame)) ctx.useAtts([]); },
    // ONE MESSAGE PER SEND: the person's turns are not drawn apart - what was asked
    // heads its answer; the message is drawn at the press.
    hidden: (m) => m.role === 'user',
    askedHead: (m, user) => {
      const media = (m.media || []).length ? m.media : ((user && user.media) || []);
      const words = m.asked != null ? m.asked : (user ? user.text : '');
      return (String(words || '').trim() || media.length) ? _askedOf({ words, media }) : null;
    },
    sending: (o) => _sendingCard(o),
    // A message of the one press has the working message's head.
    bubble: (m, progs, asked) => _plainBubble(m, progs, asked),
    // Clips and sounds in the zone: the part that goes, and what the cell says of it.
    attState: _attState,
    onAttach: (a) => { _onAttach(a); },
    trimFor: _trimFor,
    // Whatever hides the chat folds every folded line again.
    onHide: () => { closeTrim(); closeHelp(); _foldAll(); },
    // The writer is a switch of the column, and the almanac stands at its foot.
    penInBar: false,
    columnFoot: () => [_almanacBtn()],
    // The cards in the thread, drawn here.
    cardBubble: _cardBubble,
    cardSig: _cardSig,
    busy: _busy,
    onThread: (thread) => _freshenLive(thread),
    resultPath: (g) => g.videoPath,

    settings: {
      load,
      paint,
      onAtts: () => {
        if (_set) _paintParams();
        // A clip taken off while its part window is open takes the window with it.
        if (_trimPath && !ctx.atts().some(a => a.path === _trimPath)) closeTrim();
      },
      onCount: _paintPrice,
      // The reference was open for the project being left - its field is another project's.
      onProject: () => { closeHelp(); _foldAll(); if (_set) _paintParams(); },
      room: _room,
      zone: _zone,
      ready: _ready,
      body: _body,
      // A draft's zone laid out by its slots.
      draftLoad: () => {
        if (ctx.atts().some(a => a.slot === undefined)) ctx.reslot({ unplaced: true }); else ctx.paintAtts();
        _dropGone();
      },
      // The storyboard is the writer's: its seat and its price follow the writer too.
      onPen: () => { _paintParams(); ctx.paintAtts(); },
    },

    // A finished clip: the field at a message's head draws it, the shell's results too.
    shot: _shotOf,

    facts: (g) => [
      [T.t('model'), (g.model || '') + ' · ' + (g.agg || '?') + ' · ' + (((g.params || {}).resolution) || '')],
      [T.t('length'), g.duration ? T.t('{n} s', { n: (+g.duration).toFixed(1) }) + (g.w && g.h ? ' · ' + g.w + '×' + g.h : '') : ''],
      [T.t('took'), g.secs ? T.t('{n}s', { n: g.secs }) : ''],
      [T.t('cost'), g.credits ? T.t('{n} kie credits (≈{price})', { n: g.credits, price: money(g.credits * 0.005) }) : ''],
      [T.t('references'), (g.media || []).length ? String(g.media.length) : ''],
      // Where the model did not keep the clip's sound itself.
      [T.t('sound'), g.underlay === 'laid' ? T.t('the clip\'s sound, laid under it') : (g.underlay || '')],
      [T.t('writer'), g.fell ? T.t('sent as typed - {why}', { why: g.fell }) : (g.writer || '')],
      [T.t('sent as'), (g.prompt && g.said && g.prompt !== g.said) ? g.prompt : ''],
    ],

    // Every clip this thread finished, played in the Library's viewer.
    view(done, at) {
      openViewer(done.map(x => ({ id: x.id, kind: 'birols', media: x.videoPath, thumb: x.posterPath || x.videoPath,
        name: x.said || x.prompt || '', meta: { date: x.at } })), at);
    },
  };
}

const CHAT = createChat(VIDEOS);
const WIN = chatWindow({ chat: CHAT, id: 'mv3-vc', cls: 'is-video', ...CHAT_WIN.videos });

/** Every way in - VIDEO's "generate", the lane's right-click, ?open=videos, Alerts: its window. */
export async function openVideos(o) {
  if (!(await WIN.open())) return;
  // Opened with a thing from the timeline (js/merge-v3/tl-gen.js).
  if (o && o.attach && _api) await _api.fromTimeline(o);
}

export function initVidChat() { CHAT.init(); }
