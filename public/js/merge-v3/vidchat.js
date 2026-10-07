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
   - Kling motion control has no writer: the box IS its prompt, standing at the standard one when empty.
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
import { note } from './ask.js';
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
    if (!(span > 0)) return 'no part of it is chosen - press it';
    if (+a.dur < rule.min - 0.05) return 'it is ' + _s(a.dur) + ' - ' + m.label + ' needs a ' + what + ' of at least ' + _s(rule.min);
    if (span < rule.min - 0.05) return 'the part is ' + _s(span) + ' - ' + m.label + ' needs at least ' + _s(rule.min) + ' - press it';
    if (span > rule.max + 0.05) {
      return rule.max < (rule.all || 0) - 0.05
        ? 'with the other ' + what + 's it is more than ' + _s(rule.all) + ' in all - shorten one'
        : 'the part is ' + _s(span) + ' - ' + m.label + ' takes ' + _s(rule.max) + ' - press it';
    }
    return '';
  }
  // What the zone's cell says of it (the shell asks): red with the reason, or gold seconds when only a part goes.
  function _attState(a) {
    if (_kind(a) === 'image') return null;
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
    if (dur > to - from + 0.05) {
      ctx.say(_s(dur) + ' → ' + (from ? _s(to - from) + ' from ' + _s(from) : 'the first ' + _s(to - from)) + ' go - press it to choose another part.');
    }
  }

  // The part chosen by hand: the clip (or the sound) in a panel over the zone, its window within what the model takes.
  // The attachment whose part window is open - the window goes with it when it is taken off (review V7).
  let _trimPath = '';
  function _trimFor(a, cell) {
    const dur = +a.dur || 0;
    if (!dur) { ctx.say('Its length is not known - it cannot be cut.'); return; }
    const k = _kind(a);
    const rule = _spanRule(a) || { min: 0.5, max: dur, why: '' };
    openTrim({
      anchor: cell, kind: k, src: a.path, poster: a.poster ? thumbOf(a.poster, 'main') : '', dur,
      from: +a.in || 0, to: +a.out || Math.min(dur, rule.max),
      min: Math.min(rule.min, dur), max: Math.max(Math.min(rule.min, dur), rule.max),
      title: a.name || (k === 'audio' ? 'the sound' : 'the clip'), why: rule.why,
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
      })), _last.model, (v) => { _last.model = v; _recipeParams(v); _remember(); _paintModel(true); ctx.paintAtts(); });
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
      const cost = el('div', 'mv3-ig-cost');
      const fall = el('div', 'mv3-ig-fall');
      host.append(cost, fall);
      _set = { model: mSel, brief, agg: aSel, box, cost, fall };
    }
    _paintModel(false);
  }

  function _paintModel(changed) {
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
    // Kling motion control's prompt is the box: the standard one stands there when it is empty; leaving the model
    // takes it away again if it was not changed.
    const std = _table.standardPrompt || '';
    if (isMC()) {
      ctx.placeholder('The prompt Kling gets, in English - the moves come from the clip, the look from the picture.');
      if (!String(ctx.text()).trim()) ctx.setText(std);
    } else {
      ctx.placeholder('');
      if (changed && ctx.text() === std) ctx.setText('');
    }
    _set.brief.textContent = m.brief;
    _paintParams();
    _paintRecipe();
    // Kling motion control has no writer: a recipe there only lays out what to attach, and the box comes back.
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
      const as = _skill || mixed ? 'refs' : p.picturesAs;
      const fixed = n > 0 && (fam === 'grok' || (fam === 'seedance' && (as === 'frame' || as === 'fl')));
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
      if (n > 0 && !_skill) {
        const alone = 'only without clips and sounds';
        _row(box, 'pictures are', _select('mv3-vc-as', 'What the attached pictures are for', [
          { value: 'refs', text: 'references' },
          { value: 'frame', text: 'the first frame', disabled: n !== 1 || mixed, title: mixed ? alone : 'one picture' },
          { value: 'fl', text: 'first and last frames', disabled: n !== 2 || mixed, title: mixed ? alone : 'two pictures' },
        ], mixed ? 'refs' : (p.picturesAs || 'refs'), (v) => { setParam('picturesAs', v); _paintParams(); }));
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
      const std = el('button', 'mv3-c-btn mv3-vc-std', 'standard prompt');
      std.type = 'button';
      std.title = 'Put the standard prompt back in the box: ' + (_table.standardPrompt || '');
      std.addEventListener('click', () => ctx.setText(_table.standardPrompt || ''));
      box.appendChild(std);
    }
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
  // opens on it -, "edited", what it wants attached, and a cross. The recipe is the writer's: with the pen off, or for
  // Kling motion control (no writer), it stands dimmed and is not sent.
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
    // control a recipe only lays out what to attach (phase V7.3) - it stands, and says the box is the prompt.
    // A picture-then-video recipe (V7.6) is Kling motion control's own.
    const seed = _skill.frameSwap ? isMC() : (!_skill.twoStep || (model() || {}).family === 'seedance');
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
    if (_skill.frameSwap) box.appendChild(el('span', 'needs', '2 steps - a picture of the dancer\'s room with your character, then Kling moves it'));
    box.appendChild(el('span', 'sp'));
    if (!seed) box.appendChild(el('span', 'why', _skill.frameSwap ? 'these two steps are Kling motion control\'s - pick it' : 'two steps are made by Seedance - pick a Seedance model'));
    else if (tooMuch) box.appendChild(el('span', 'why', 'it does not fit ' + ((model() || {}).label || 'this model') + ': ' + tooMuch));
    else if (isMC() && !_skill.frameSwap) box.appendChild(el('span', 'why', 'no writer here: the recipe lays out what to attach, the box is Kling\'s prompt'));
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
      // (phase V7.6) Kling's picture-then-video: a card made at the press, no writer.
      frameSwap: !!u.skill.frameSwap,
      // (phase V7.5) The settings it suggests, for every model of its list the person goes on to (`_recipeParams`).
      params: Object.assign({}, u.params || {}),
      // What was written in the places of the same recipe stays (matched by each place's own words).
      vals: was && was.id === u.skill.id && was.kind === u.skill.kind ? (was.vals || []) : [],
    } : null;
    _wantRecipe = true;
    if (_set) { _set.model.value = u.model; _paintModel(true); }
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
  const _seat = () => (_skill && _skill.twoStep && (model() || {}).family === 'seedance' ? 1 : 0);
  const _boardCap = () => {
    const ps = ((_table && _table.board && _table.board.providers) || []).filter(p => p.usable);
    return ps.length ? Math.max(...ps.map(p => p.maxRefs || 1)) : 14;
  };
  const _picRoom = (r) => {
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
    return { parts: [
      { kind: 'image', word: 'pictures', one: 'picture', room: Math.min(MAX_PICS, r ? _picRoom(r) : 0), slots: _slotsOf('image'),
        full: _seat() ? 'Room for ' + (r ? _picRoom(r) : 0) + ' - the storyboard goes to the video as one more picture, and it is drawn with these.' : '',
        none: who + ' takes no pictures.', other: 'Another picture for the writer to use - anything the recipe did not ask for' },
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
  // ── The prompt reference behind "/" (phase V14, the owner 2026-10-07; vhelp.js) ──
  // Between the count and the send - and on a written card between its count and its make: a tip pressed there is
  // copied, and the note says so on the field this "/" belongs to.
  const _helpNote = () => (isMC() ? 'Kling motion control: the camera follows your clip - a camera tip may not take.' : '');
  function _helpBtn(fieldOf, prefer) {
    const b = el('button', 'hp-btn', '/');
    b.type = 'button';
    b.title = 'Prompt reference - camera moves and more: press a tip to copy it';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); openHelp({ anchor: b, field: fieldOf(), prefer, note: _helpNote }); });
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
  // plan and two renders under Kling, which takes one picture. A picture-then-video recipe is judged by its own rules.
  function _recipeOver() {
    if (!_skill || _skill.frameSwap || !_applies()) return '';
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

  // Whether the recipe in use applies under the chosen model: a picture-then-video one is Kling motion control's, a
  // two-step one Seedance's. One that does not stands dimmed, and asks nothing of the send (review V7).
  const _applies = () => !!_skill && (_skill.frameSwap ? isMC() : (!_skill.twoStep || (model() || {}).family === 'seedance'));

  // The recipe's first slot that is not filled as far as it must be - the send waits for it.
  function _missing() {
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
    // (review V7) A recipe whose places must hold more than this model takes cannot be filled here - said plainly, rather
    // than blinking a place that can never be filled.
    const over = _recipeOver();
    if (over) return ['The recipe does not fit ' + m.label + '.', over + ' - pick another model, or stop using the recipe with the × on its line.'];
    // A recipe's cell that must be filled and is not: nothing is asked, the cell blinks (phase V6).
    const miss = _missing();
    if (miss) {
      ctx.flash(miss.part, miss.key);
      const what = miss.part === 'video' ? 'clip' : miss.part === 'audio' ? 'sound' : 'picture';
      return ['The recipe needs ' + (miss.min - miss.have) + ' more ' + (miss.label && miss.label !== what ? miss.label + ' ' : '') + what + (miss.min - miss.have === 1 ? '' : 's') + '.',
        miss.hint || 'Press its place, then a ' + what + ' on the right or a file.'];
    }
    const n = _pics().length;
    const L = r.limits || {};
    // (phase V7.3) Kling motion control: ONE picture - the person and the place - and ONE clip - the moves; the box is
    // its prompt, in English (translated when not), up to its limit.
    if (isMC()) {
      if (n !== 1 || _clips().length !== 1) {
        return ['Kling needs one picture and one clip.', 'The picture is the person and the place, the clip the moves (' + (r.duration.min || 3) + '-'
          + (params().orientation === 'image' ? (L.videoSecsImage || 10) : (L.videoSecs || 30)) + ' s).'];
      }
      // The box is the prompt - except under a picture-then-video recipe, whose card holds its own (review V7).
      const words = _skill && _skill.frameSwap ? '' : String(ctx.text() || '').trim();
      if (r.promptMax && words.length > r.promptMax) return ['The prompt is too long.', m.label + ' takes ' + r.promptMax + ' characters - this one is ' + words.length + '.'];
    }
    if (r.needs && r.needs.images && n < r.needs.images) return ['It needs a picture.', m.label + ' on ' + r.aggLabel + ' starts from one.'];
    if (n > _picRoom(r)) {
      return ['Too many pictures.', _seat() ? 'Room for ' + _picRoom(r) + ': the storyboard goes to ' + m.label + ' as one more picture, and it is drawn with these.'
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

  // `cardMedia`: a card's own attachments - what it is made with decides whether the clip's sound can go (V7.4).
  function _body(cardMedia) {
    const m = model(), r = rec();
    const p = params();
    const fam = m.family;
    const atts = ctx.atts();
    const as = p.picturesAs || 'refs';
    // What each picture is for: a recipe's slot says (its role - person, product... - or a frame), otherwise Seedance's
    // "pictures are" does.
    const slots = new Map(['image', 'video', 'audio'].flatMap(k => (_slotsOf(k) || []).map(s => [k + ':' + s.key, s])));
    // Beside a clip or a sound the pictures are references (phase V7).
    const mixed = atts.some(a => _kind(a) !== 'image');
    const frame = (i) => (fam !== 'seedance' || mixed ? '' : as === 'frame' && i === 0 ? 'frame-first'
      : as === 'fl' ? (i === 0 ? 'frame-first' : i === 1 ? 'frame-last' : '') : '');
    const role = (a, i) => {
      const s = a.slot ? slots.get(_kind(a) + ':' + a.slot) : null;
      if (s) return /^frame-/.test(s.kind) ? s.kind : s.role;
      return _kind(a) === 'image' && !_skill ? frame(i) : '';
    };
    const fmt = (Store.timeline() || {}).format || '9:16';
    // (phase V7.4) Seedance's sound from the clip: its own off, the first clip's part laid under when it lands - only
    // while a clip goes with it (remembered otherwise, and the model's own sound stands in).
    const clipSound = fam === 'seedance' && p.sound === 'clip'
      && (cardMedia ? cardMedia.some(a => a && a.kind === 'video') : atts.some(a => _kind(a) === 'video'));
    return {
      model: m.id, agg: r.agg,
      params: {
        duration: r.duration.fromClip ? undefined : clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max),
        resolution: r.resolutions.includes(p.resolution) ? p.resolution : r.resDef,
        aspect: (r.aspects || []).includes(p.aspect) ? p.aspect : ((r.aspects || []).includes(fmt) ? fmt : (r.aspects || [])[0]),
        audio: clipSound ? false : (p.sound === 'clip' || p.audio !== false), sound: clipSound ? 'clip' : '',
        mode: p.mode || 'normal', orientation: p.orientation || 'video', keepSound: p.keepSound !== false,
      },
      media: atts.map((a) => Object.assign({
        path: a.path, kind: _kind(a), role: role(a, atts.filter(x => _kind(x) === _kind(a)).indexOf(a)),
        label: (a.slot && slots.get(_kind(a) + ':' + a.slot) || {}).label || '',
      // (phase V7) A clip or a sound goes as its part - the server prepares just that.
      }, _kind(a) !== 'image' ? { in: +a.in || 0, out: +a.out || 0 } : {})),
      // The catalog's recipe, as it was left (the server keeps it only when the writer will use it).
      // (review V7) A picture-then-video recipe's words are its picture's prompt: never a writer's recipe.
      skill: _skill && !_skill.frameSwap ? { id: _skill.id, kind: _skill.kind, title: _skill.title, v: _skill.v, edited: _edited(_skill), text: _skill.text } : undefined,
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
    // Kling motion control has no writer (the owner's answer 5, phase V7): a recipe there only lays out what to attach,
    // the box stays its prompt and the send is one press - no request, no cards. A picture-then-video recipe (V7.6) is
    // Kling's own two steps: its foot is the START of its card - and under another model it is not used at all.
    const swap = !!(_skill && _skill.frameSwap);
    const builder = !!_skill && (swap ? isMC() : !isMC());
    ctx.bar(!builder);
    const show = builder && (_wantRecipe || !_recipeCards().length);
    const key = _skill ? [swap ? 'swap' : '', _skill.kind, _skill.id, _split(_skill.text).head].join('|') : '';
    if (!show) {
      _cardEls = null;
      if (foot.childNodes.length) { foot.textContent = ''; if (!quiet) ctx.footChanged(); }
      return;
    }
    if (_cardEls && _cardEls.key === key && foot.contains(_cardEls.box)) { _freshenRequest(); return; }
    foot.textContent = '';
    foot.appendChild(swap ? _startCard(key) : _requestCard(key));
    if (!quiet) ctx.footChanged();
  }

  // (phase V7.6) A picture-then-video recipe's foot: what its two steps are, and the press that makes its card - nothing is
  // paid there; the moment of the clip, both prompts and every press that costs are on the card.
  function _startCard(key) {
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-request');
    const h = el('div', 'vc-card-h');
    h.append(el('span', 'k', 'recipe'), el('span', 't', _skill.title));
    box.appendChild(h);
    box.appendChild(el('div', 'vc-req', 'Two steps, no writer: 1 · a picture - the dance clip\'s frame with your character in the dancer\'s place; '
      + '2 · the video - Kling moves that picture with the same part of the clip.'));
    box.appendChild(el('div', 'vc-card-note', 'Attach the dance clip and your character, then start: the card that comes holds the moment of the clip, '
      + 'both prompts and the presses that cost - always a stop after the picture.'));
    const acts = el('div', 'vc-card-acts');
    const go = el('button', 'mv3-c-btn vc-go', 'start');
    go.type = 'button';
    const why = el('span', 'vc-card-why');
    acts.append(go, why);
    box.appendChild(acts);
    go.addEventListener('click', () => _startSwap(go));
    _cardEls = { key, box, go, why, places: [], swap: true };
    _freshenRequest();
    return box;
  }
  async function _startSwap(btn) {
    if (_writingNow || !_skill || !_skill.frameSwap) return;
    const why = _ready();
    if (why) { note(btn, why[0], why[1]); return; }
    _writingNow = true;
    btn.disabled = true;
    try {
      let key;
      try { key = await ctx.ensureProject(); }
      catch (e) { note(btn, 'Could not start a project.', String(e.message || e).slice(0, 120)); return; }
      const b = _body();
      const d = await _post('/api/mv3/video/frameswap', {
        project: key, model: b.model, agg: b.agg, params: b.params, media: b.media, frameSwap: true, step: _skill.text,
        recipe: { id: _skill.id, kind: _skill.kind, title: _skill.title, v: _skill.v, edited: _edited(_skill) },
      });
      if (!d || !d.success) { note(btn, 'Not started.', (d && d.error) || 'the server did not answer'); return; }
      _wantRecipe = false;
      await ctx.reload(true);
    } finally {
      _writingNow = false;
      if (btn.isConnected) btn.disabled = false;
      _freshenRequest();
    }
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
    // (phase V7.6) A frame-swap's start: Kling's, nothing paid at it.
    if (_cardEls.swap) {
      _cardEls.go.disabled = _writingNow;
      const fi = _table && _table.frame;
      const fp = fi && (fi.providers || []).find(p => p.usable);
      _cardEls.why.textContent = fi ? 'the picture: ' + fi.label + ', ' + fi.quality + (fp && fp.price != null ? ', ≈' + money(fp.price) + ' on ' + fp.label : '')
        + ' · the video: ' + ((model() || {}).label || 'Kling') + ' by the seconds of the clip' : '';
      return;
    }
    for (const p of _cardEls.places) if (p.auto) p.el.textContent = _sizeWords();
    const m = model();
    const mc = isMC();
    _cardEls.go.disabled = mc || _writingNow;
    const two = !!(_skill && _skill.twoStep);
    _cardEls.why.textContent = mc ? 'Kling motion control has no writer - pick another model on the left.'
      : two && m && m.family !== 'seedance' ? 'A two-step recipe is made by Seedance - pick a Seedance model on the left.'
        : two && m ? 'The writer writes the storyboard\'s prompt and the video\'s for ' + m.label + ' - you read and edit both before anything is made.'
          : m ? 'The writer turns it into a prompt for ' + m.label + ' - you read it and edit it before anything is made.' : '';
  }

  async function _write(btn) {
    if (_writingNow || !_skill) return;
    if (isMC()) { note(btn, 'No writer here.', 'Kling motion control has no writer - pick another model on the left.'); return; }
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
  // Drawn again when what the card IS changes - its state, its model, another make; its sheets and its clips are
  // repainted in place (_paintBoards, _paintTries), never under the typing.
  const _cardSig = (m) => {
    const c = m.card;
    return [c.type, c.state || '', c.error || '', c.model || '', (m.genIds || []).length].join(':');
  };
  const _busy = (thread) => thread.some(m => (m.card && m.card.type === 'prompt' && m.card.state === 'writing')
    || (m.boards || []).some(g => g.state === 'pending'));

  function _cardBubble(m, progs) {
    const c = m.card;
    if (c.type === 'recipe') return _sentRequest(m);
    _forget(m.id);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-prompt is-' + c.state);
    const h = el('div', 'vc-card-h');
    h.append(el('span', 'k', 'prompt'), el('span', 't', c.recipe && c.recipe.title ? c.recipe.title : ''));
    if (c.model) h.appendChild(el('span', 'm', 'for ' + _labelOf(c.model) + (c.board ? ' · 2 steps' : '')));
    box.appendChild(h);
    if (c.state === 'writing') {
      const strip = el('div', 'mv3-ig-prog');
      box.appendChild(strip);
      progs.set('w:' + m.id, startInlineProgress(strip, {
        label: c.board ? 'writing the prompts…' : 'writing the prompt…', key: 'mv3-video-writer', estimateMs: 25000, startedAt: Date.parse(c.startedAt || m.at) || 0,
      }));
      return box;
    }
    if (c.state === 'failed') {
      box.appendChild(el('div', 'mv3-ig-bad', c.error || 'it was not written'));
      const acts = el('div', 'vc-card-acts');
      const again = el('button', 'mv3-c-btn vc-go', 'write it again');
      again.type = 'button';
      again.addEventListener('click', () => _rewrite(m, again));
      acts.appendChild(again);
      if (_skill && c.recipe && c.recipe.id === _skill.id) acts.appendChild(_changeLink());
      box.appendChild(acts);
      return box;
    }
    // Written - waiting, or made: a made card stays a field to edit and make again from (the owner, 2026-10-06), its
    // attempts under it, each with what it followed and what it made.
    return _readyCard(m, box);
  }

  // A written card: the prompt to edit, the count, the price, and the press that makes the video - again and again; the
  // attempts it made under it.
  function _readyCard(m, box) {
    const c = m.card;
    if (c.edited) box.querySelector('.vc-card-h').appendChild(el('i', null, 'edited'));
    const frame = !!(c.board && c.board.kind === 'frame');
    const two = c.board ? (frame ? _framePart(m, box) : _boardPart(m, box)) : null;
    // The sheet's number in the prompt, said where it is read (review V8): taken out, the video would not follow it.
    if (frame) box.appendChild(el('div', 'vc-step', '2 · the video - Kling moves the picture chosen above with the same part of the clip'));
    else if (two) box.appendChild(el('div', 'vc-step', '2 · the video - it follows the storyboard chosen above, [picture '
      + ((m.media || []).filter(x => x.kind === 'image').length + 1) + '] in its prompt'));
    const ta = document.createElement('textarea');
    ta.className = 'vc-prompt-ta';
    ta.spellcheck = true;
    ta.value = toShown(c.prompt);
    ta.title = 'The prompt the model gets. [picture 1], [clip 1] name what is attached - by its number in its part.';
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(420, ta.scrollHeight + 2) + 'px'; };
    requestAnimationFrame(grow);
    const save = () => {
      clearTimeout(_patchT.get(m.id));
      _patchT.delete(m.id);
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, prompt: toNeutral(ta.value) }, 'PATCH');
    };
    ta.addEventListener('input', () => {
      grow();
      clearTimeout(_patchT.get(m.id));
      _patchT.set(m.id, setTimeout(save, 600));
    });
    ta.addEventListener('blur', () => { if (_patchT.has(m.id)) save(); });
    box.appendChild(ta);
    const acts = el('div', 'vc-card-acts');
    const nBtn = el('button', 'vc-n', '×' + (_cardN.get(m.id) || 1));
    nBtn.type = 'button';
    nBtn.title = 'How many to make from it. Each is its own attempt.';
    nBtn.addEventListener('click', () => {
      _cardN.set(m.id, (_cardN.get(m.id) || 1) === 1 ? 2 : 1);
      nBtn.textContent = '×' + _cardN.get(m.id);
      _freshenCards();
    });
    const go = el('button', 'mv3-c-btn vc-go is-make', 'make');
    go.type = 'button';
    const price = el('span', 'vc-card-why');
    go.addEventListener('click', () => _make(m, go));
    // The 中文 box (the owner: ticked on the prompt, right before it is sent; Seedance only - PLAN V-I).
    const zh = el('label', 'vc-zh-box');
    const zcb = document.createElement('input');
    zcb.type = 'checkbox';
    // Remembered per model - every waiting card of this model follows.
    zcb.addEventListener('change', () => { setParam('zh', zcb.checked); _freshenCards(); });
    zh.append(zcb, el('span', null, '中文'));
    zh.title = 'Send the prompt in Chinese (experimental, Seedance): it is translated just before it goes - the references and every quoted line stay as they are, and if the translation fails, the English goes.';
    // (phase V14) The prompt reference beside the count, its copies for this card's prompt.
    acts.append(nBtn, _helpBtn(() => ta, 'below'), zh, go, price);
    if (_skill && c.recipe && c.recipe.id === _skill.id) acts.appendChild(_changeLink());
    // A made card: a copy of it, to change and make apart from this one.
    if (c.state === 'sent') {
      const again = el('button', 'vc-link', 'again - a copy');
      again.type = 'button';
      again.title = 'A new card with this prompt, to change and make apart from this one';
      again.addEventListener('click', async () => {
        if (again.disabled) return;
        again.disabled = true;
        const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/again', { project: m.project });
        if (again.isConnected) again.disabled = false;
        if (!d || !d.success) { note(again, 'Not copied.', (d && d.error) || 'the server did not answer'); return; }
        ctx.reload(true);
      });
      acts.appendChild(again);
    }
    box.appendChild(acts);
    // The attempts: every make of the card, each with the sheet it followed and its clips - repainted in place.
    const tries = el('div', 'vc-tries');
    box.appendChild(tries);
    const l = { m, ta, go, price, save, zh, zcb, two, tries, triesSig: '', triesProgs: new Map() };
    _live.set(m.id, l);
    if (two) _paintBoards(m.id, l);
    _paintTries(m.id, l);
    _freshenOne(m.id, l);
    return box;
  }

  // ── The attempts of a card (the owner, 2026-10-06: a made card is made again from its own field) ──
  // Every make is one: when, how many, the sheet it followed and its clips. A card made before attempts were kept has
  // its clips as the first.
  function _triesOf(m) {
    const c = m.card;
    const byId = new Map((m.gens || []).map(g => [g.id, g]));
    const sends = Array.isArray(c.sends) && c.sends.length ? c.sends
      : ((m.genIds || []).length ? [{ at: (c.sent || {}).at || '', n: (c.sent || {}).n || 1, zh: !!(c.sent || {}).zh,
          boardId: (c.board || {}).chosen || '', genIds: m.genIds }] : []);
    return sends.map(s => Object.assign({}, s, { gens: (s.genIds || []).map(id => byId.get(id)).filter(Boolean) }));
  }
  const _triesSig = (l) => _triesOf(l.m).map(t => t.gens.map(g => g.id + ':' + g.state + ':' + (g.videoPath || '') + ':' + (g.error || '')).join(',')
    + '@' + (t.boardId || '')).join('|') + '#' + ((l.m.boards || []).map(g => g.id + (g.gone ? '-' : '')).join(','));
  function _paintTries(id, l) {
    const list = _triesOf(l.m);
    // What a countdown says follows its clip's stage between the paints.
    for (const t of list) for (const g of t.gens) { const p = g.state === 'pending' ? l.triesProgs.get(g.id) : null; if (p) p.say(ctx.stageWords(g)); }
    const sig = _triesSig(l);
    if (sig === l.triesSig) return;
    l.triesSig = sig;
    // A countdown seen landing teaches the estimate; the others only stop.
    const now = new Map(list.flatMap(t => t.gens.map(g => [g.id, g])));
    for (const [gid, p] of l.triesProgs) { const g = now.get(gid); if (g && g.state === 'done' && !document.hidden) p.finish(); else p.detach(); }
    l.triesProgs.clear();
    l.tries.textContent = '';
    if (!list.length) return;
    const boards = l.m.boards || [];
    list.forEach((t, i) => {
      const blk = el('div', 'vc-try');
      const h = el('div', 'vc-try-h');
      const when = t.at ? new Date(t.at) : null;
      h.appendChild(el('span', 'k', 'attempt ' + (i + 1)));
      if (when && !isNaN(when)) h.appendChild(el('span', null, when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
      if (t.zh) h.appendChild(el('span', null, '中文'));
      const sheet = t.boardId ? boards.find(g => g.id === t.boardId) : null;
      if (sheet && sheet.imagePath) {
        const row = el('span', 'vc-try-sheet');
        const W = (l.m.card.board || {}).kind === 'frame' ? 'picture' : 'storyboard';
        row.appendChild(_boardThumb(sheet, false, null, [sheet], W));
        row.appendChild(el('span', null, sheet.gone ? 'its ' + W + ' - not on the Images shelf any more' : 'its ' + W));
        h.appendChild(row);
      }
      blk.appendChild(h);
      const shots = ctx.shots({ gens: t.gens }, l.triesProgs);
      if (shots) blk.appendChild(shots);
      l.tries.appendChild(blk);
    });
  }

  // The prices and the presses of the waiting cards follow the column: another kind of model means writing again.
  function _freshenCards() {
    for (const [id, l] of _live) {
      if (!l.go.isConnected) { _forget(id); continue; }
      _freshenOne(id, l);
    }
  }
  // A card leaving the live ones takes its countdowns with it (review V8): each is an interval of its own.
  function _forget(id) {
    const l = _live.get(id);
    if (l && l.two) { for (const p of l.two.progs.values()) p.detach(); l.two.progs.clear(); }
    if (l && l.triesProgs) { for (const p of l.triesProgs.values()) p.detach(); l.triesProgs.clear(); }
    _live.delete(id);
  }
  function _freshenOne(id, l) {
    const m = model();
    const pr = priceOf(rec(), l.m.media || []);
    const n = _cardN.get(id) || 1;
    const other = m && _familyOf(l.m.card.model) && m.family !== _familyOf(l.m.card.model);
    // A two-step card is Seedance's whatever the column says (review V8): another model is no reason to write it again.
    const seedOnly = !!l.two && other;
    const again = l.m.card.state === 'sent' || (l.m.genIds || []).length > 0;
    l.go.textContent = other && !seedOnly ? 'write it again for ' + m.label : (again ? 'make again' : 'make') + (n > 1 ? ' ×' + n : '');
    l.go.classList.toggle('is-make', !other || seedOnly);
    if (l.zh) {
      l.zh.hidden = !!other || !(m && (m.langs || []).includes('zh'));
      l.zcb.checked = !!params().zh;
    }
    if (l.two) {
      const has = !!_chosenBoard(l);
      const drawing = (l.m.boards || []).some(g => g.state === 'pending');
      l.go.classList.toggle('is-waiting', !other && !has);
      const W = l.two.W || 'storyboard';
      l.go.title = other || has ? '' : drawing ? 'The ' + W + ' is being drawn - the video follows it' : 'Draw the ' + W + ' first - the video follows the one you choose';
      const bp = _boardPrice(l);
      l.two.price.textContent = bp.text;
      l.two.go.disabled = !bp.ok || !!l.two.busy;
      l.two.go.title = bp.ok ? '' : bp.text;
    }
    // The sheet was planned for the length the card was written for (review V8): another length is said, not refused.
    const wasSecs = l.two && !l.two.frame ? +((l.m.card.params || {}).duration || 0) : 0;
    const nowSecs = pr && !pr.none && !pr.fromClip ? (pr.out || pr.secs) : 0;
    const longer = wasSecs && nowSecs && wasSecs !== nowSecs ? ' · the storyboard was planned for ' + wasSecs + ' s' : '';
    l.price.textContent = seedOnly ? (l.two.frame ? 'a picture-then-video card is made by Kling motion control - pick it on the left'
      : 'a two-step video is made by Seedance - pick a Seedance model on the left')
      : other ? 'it was written for ' + _labelOf(l.m.card.model)
        : !pr || pr.none ? (m ? m.label + ' · no published price' : '')
          : pr.fromClip ? (pr.usd != null ? '≈' + money(pr.usd * n) + ' at most · ' + _s(pr.secs) + ' of the clip' : '≈' + money(pr.per) + ' per second of clip') + ' · ' + (m ? m.label : '')
            : '≈' + money(pr.usd * n) + ' · ' + (pr.vidIn ? pr.out + ' s + ' + _s(pr.vidIn) + ' of the clips' : pr.secs + ' s') + ' · ' + pr.res + ' · '
              + (m ? m.label : '') + ' · ' + (rec() ? rec().aggLabel : '') + longer;
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
    if (mm && mm.family !== _familyOf(m.card.model)) {
      if (l.two && l.two.frame) { note(go, 'Kling makes it.', 'A picture-then-video card is made by Kling motion control - pick it on the left.'); return; }
      if (l.two) { note(go, 'Seedance makes it.', 'A two-step video follows its storyboard with Seedance - pick a Seedance model on the left.'); return; }
      return _rewrite(m, go);
    }
    const prompt = toNeutral(l.ta.value).trim();
    if (!prompt) { note(go, 'The prompt is empty.', 'Write what the clip shows, or write it again.'); return; }
    const why = _readyFor(m);
    if (why) { note(go, why[0], why[1]); return; }
    if (l.two && !_chosenBoard(l)) {
      const W = l.two.W || 'storyboard';
      if ((l.m.boards || []).some(g => g.state === 'pending')) note(go, 'The ' + W + ' is being drawn.', 'The video follows it - make it when it has landed.');
      else note(go, 'The ' + W + ' first.', 'Draw the ' + W + ' above - the video follows the one you choose.');
      return;
    }
    go.disabled = true;
    try {
      clearTimeout(_patchT.get(m.id));
      _patchT.delete(m.id);
      const b = _body(m.media || []);
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/make', {
        project: m.project, prompt, n: _cardN.get(m.id) || 1, model: b.model, agg: b.agg, params: b.params, where: _where(m.project),
        boardId: l.two ? ((_chosenBoard(l) || {}).id || '') : undefined,
        zh: !!(l.zh && !l.zh.hidden && l.zcb.checked),
      });
      if (!d || !d.success) { note(go, 'Not made.', (d && d.error) || 'the server did not answer'); return; }
      _cardN.delete(m.id);
      await ctx.reload(true);
    } finally {
      if (go.isConnected) go.disabled = false;
    }
  }

  async function _rewrite(m, btn) {
    if (isMC()) { note(btn, 'No writer here.', 'Kling motion control has no writer - pick another model on the left.'); return; }
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

  // ── The storyboard part of a two-step card (phase V8, PLAN V-G; the owner: 4K, always a stop after it) ──
  // Its prompt to edit, the press that draws it (a picture of the pictures chat, with its own Alerts row, filed on Images
  // in the project's category), and the sheets drawn: pressed, one is CHOSEN - the newest done one until then - and the
  // video follows it. Drawn again in place when the thread is read, so the fields of the card are never rebuilt under
  // the typing.
  const _boardPick = new Map();     // card id -> the storyboard chosen here
  function _boardPart(m, box) {
    const c = m.card;
    box.appendChild(el('div', 'vc-step', '1 · the storyboard - drawn first, the video follows it'));
    const bta = document.createElement('textarea');
    bta.className = 'vc-prompt-ta is-board';
    bta.spellcheck = true;
    bta.maxLength = 6000;
    bta.value = c.board.prompt || '';
    bta.title = 'The prompt of the storyboard sheet - numbered panels, one per beat of the clip.';
    const grow = () => { bta.style.height = 'auto'; bta.style.height = Math.min(320, bta.scrollHeight + 2) + 'px'; };
    requestAnimationFrame(grow);
    const key = 'b:' + m.id;
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, board: bta.value }, 'PATCH');
    };
    bta.addEventListener('input', () => { grow(); clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    bta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    box.appendChild(bta);
    const acts = el('div', 'vc-card-acts');
    const go = el('button', 'mv3-c-btn vc-go', 'draw the storyboard');
    go.type = 'button';
    const price = el('span', 'vc-card-why');
    acts.append(go, price);
    box.appendChild(acts);
    const strip = el('div', 'vc-boards');
    box.appendChild(strip);
    const two = { bta, go, price, strip, sig: '', progs: new Map(), busy: false, W: 'storyboard' };
    go.addEventListener('click', (e) => _drawBoard(m, two, go, e));
    return two;
  }

  // ── The picture of a frame-swap (phase V7.6, the owner 2026-10-07: dancer-swap-room) ──
  // The clip's frame at a MOMENT - the part's first by default, the slider picks another (the owner's answer 1) - redrawn
  // with the person in the dancer's place, its prompt editable ([clip 1] is that frame, [picture 1] the person), drawn by
  // the press (nano-banana-2, 2K - answer 2) as a picture with its own Alerts row; the pictures in a strip, one chosen,
  // and the video below moves the chosen one with the same part of the clip. No writer, and always a stop after it.
  const _t = (v) => { const x = Math.max(0, +v || 0); const mm = Math.floor(x / 60); return mm + ':' + (x - mm * 60).toFixed(1).padStart(4, '0'); };
  function _framePart(m, box) {
    const c = m.card;
    const clip = (m.media || []).find(x => x.kind === 'video') || {};
    const lo = +clip.in || 0, hi = +clip.out > lo ? +clip.out : lo;
    box.appendChild(el('div', 'vc-step', '1 · the picture - your character in the dancer\'s place, drawn first; the video moves it'));
    // The moment of the clip the picture is drawn from.
    const mo = el('div', 'vc-moment');
    const v = document.createElement('video');
    v.className = 'vc-moment-v';
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.src = clip.path || '';
    const side = el('div', 'vc-moment-side');
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(lo); range.max = String(hi); range.step = '0.04';
    range.value = String(Math.max(lo, Math.min(hi, +c.board.at || lo)));
    range.title = 'The moment of the clip the picture is drawn from - its first frame unless you pick another';
    const said = el('span', 'vc-moment-at');
    const say = () => { said.textContent = 'the moment: ' + _t(range.value) + ' · the part ' + _t(lo) + ' – ' + _t(hi); };
    say();
    let raf = 0;
    const show = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { try { v.currentTime = +range.value; } catch (e) { /* not loaded */ } }); };
    v.addEventListener('loadedmetadata', show, { once: true });
    const key = 'b:' + m.id;
    range.addEventListener('input', () => { say(); show(); });
    range.addEventListener('change', () => _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, at: +range.value }, 'PATCH'));
    side.append(range, said, el('span', 'vc-card-note', 'Pick a moment where the dancer is seen whole - the picture keeps that pose, room, light and angle.'));
    mo.append(v, side);
    box.appendChild(mo);
    const bta = document.createElement('textarea');
    bta.className = 'vc-prompt-ta is-board';
    bta.spellcheck = true;
    bta.maxLength = 6000;
    bta.value = toShown(c.board.prompt || '');
    bta.title = 'The picture\'s prompt: [clip 1] is the clip\'s frame at the moment above, [picture 1] your character.';
    const grow = () => { bta.style.height = 'auto'; bta.style.height = Math.min(240, bta.scrollHeight + 2) + 'px'; };
    requestAnimationFrame(grow);
    const save = () => {
      clearTimeout(_patchT.get(key));
      _patchT.delete(key);
      return _post('/api/mv3/video/card/' + encodeURIComponent(m.id), { project: m.project, board: toNeutral(bta.value) }, 'PATCH');
    };
    bta.addEventListener('input', () => { grow(); clearTimeout(_patchT.get(key)); _patchT.set(key, setTimeout(save, 600)); });
    bta.addEventListener('blur', () => { if (_patchT.has(key)) save(); });
    box.appendChild(bta);
    const acts = el('div', 'vc-card-acts');
    const go = el('button', 'mv3-c-btn vc-go', 'draw the picture');
    go.type = 'button';
    const price = el('span', 'vc-card-why');
    acts.append(go, price);
    box.appendChild(acts);
    const strip = el('div', 'vc-boards');
    box.appendChild(strip);
    const two = { bta, go, price, strip, sig: '', progs: new Map(), busy: false, W: 'picture', frame: true, range };
    go.addEventListener('click', (e) => _drawBoard(m, two, go, e));
    return two;
  }
  // What the storyboard costs, and whether it can be drawn now. A frame-swap's picture is drawn at 2K from two pictures -
  // the clip's frame and the person (V7.6).
  function _boardPrice(l) {
    if (!_table) return { ok: false, text: 'reading the prices…' };
    const frame = !!(l.two && l.two.frame);
    const info = frame ? _table.frame : _table.board;
    if (!info) return { ok: false, text: 'the picture engine is not in this program' };
    // The sheet always goes to the video as a picture (review V8): without R2 it would be bought for nothing.
    if (!_table.r2) return { ok: false, text: 'the ' + (frame ? 'picture' : 'storyboard') + ' goes to the video as a picture - set R2 on Admin → API keys' };
    const n = frame ? 2 : (l.m.media || []).filter(x => x.kind === 'image').length;
    const p = (info.providers || []).find(x => x.usable && (!n || (x.maxRefs || 1) >= n));
    if (!p) return { ok: false, text: ((info.providers || []).find(x => x.why) || {}).why || (info.label + ' cannot take ' + n + ' pictures') };
    return { ok: true, text: (p.price != null ? '≈' + money(p.price) + ' · ' : '') + info.quality + ' · ' + info.label + ' · ' + p.label };
  }
  // The sheets the video can follow: landed, and still on the Images shelf (the server says `gone` - review V8).
  const _boardOk = (g) => !!(g && g.state === 'done' && g.imagePath && !g.gone);
  // The storyboard the video follows: the one pressed, else the card's, else the newest that can be followed.
  function _chosenBoard(l) {
    const done = (l.m.boards || []).filter(_boardOk);
    const want = _boardPick.get(l.m.id) || (l.m.card.board || {}).chosen;
    return done.find(g => g.id === want) || done[done.length - 1] || null;
  }
  // ONE PRESS, ONE SHEET (review V8): the button stays shut from the press until the thread has been read with the new
  // sheet in it, whatever repaints meanwhile, and the second click of a double click is not a press.
  async function _drawBoard(m, two, btn, e) {
    if (btn.disabled || two.busy || (e && e.detail > 1)) return;
    two.busy = true;
    btn.disabled = true;
    try {
      clearTimeout(_patchT.get('b:' + m.id));
      _patchT.delete('b:' + m.id);
      // A frame-swap's picture: its prompt in the neutral references, and the moment of the clip it is drawn from (V7.6).
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/board', two.frame
        ? { project: m.project, board: toNeutral(two.bta.value), at: +two.range.value, where: _where(m.project) }
        : { project: m.project, board: two.bta.value, where: _where(m.project) });
      if (!d || !d.success) { note(btn, 'Not drawn.', (d && d.error) || 'the server did not answer'); return; }
      // Read in place - the new countdown is on this card, not at the end of the thread.
      await ctx.reload();
    } finally {
      two.busy = false;
      const l = _live.get(m.id);
      if (l && l.two === two) _freshenOne(m.id, l);
      else if (btn.isConnected) btn.disabled = false;
    }
  }
  // A sheet in the strip: a press CHOOSES it (after the double-click's moment, so looking at one large does not choose
  // it), a double press shows the card's sheets large, hovering shows it bigger. On a made card a press shows it large.
  function _boardThumb(g, chosen, onPick, all, W) {
    const word = W || 'storyboard';
    const t = el('button', 'vc-board' + (chosen ? ' is-chosen' : ''));
    t.type = 'button';
    t.dataset.id = g.id;
    const img = document.createElement('img');
    img.src = '/api/thumb?src=' + encodeURIComponent(g.imagePath) + '&v=strip';
    img.loading = 'lazy'; img.decoding = 'async'; img.alt = word;
    // Gone from the shelf since it was read: said, and never chosen (the server says so too at the next read).
    img.addEventListener('error', () => { t.classList.add('is-gone'); t.title = 'Not on the Images shelf any more'; }, { once: true });
    t.appendChild(img);
    t.title = onPick ? (chosen ? 'The video follows this ' + word : 'Press: the video follows this one') + ' · double-click: large' : 'The ' + word + ' it followed · press: large';
    t.addEventListener('mouseenter', () => ctx.peekShow('/api/thumb?src=' + encodeURIComponent(g.imagePath) + '&v=main', t));
    t.addEventListener('mouseleave', ctx.peekHide);
    const list = (all && all.length ? all : [g]);
    const large = () => openViewer(list.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: word })),
      Math.max(0, list.findIndex(x => x.id === g.id)));
    let pickT = 0;
    if (onPick) {
      t.addEventListener('click', (e) => {
        if (e.detail > 1 || t.classList.contains('is-gone')) return;
        clearTimeout(pickT);
        pickT = setTimeout(() => onPick(g), 260);
      });
      t.addEventListener('dblclick', () => { clearTimeout(pickT); large(); });
    } else t.addEventListener('click', large);
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
  const _boardSig = (l, chosen) => (l.m.boards || []).map(g => g.id + ':' + g.state + ':' + (g.imagePath || '') + ':' + (g.error || '') + ':' + (g.gone ? 1 : 0)).join('|')
    + '#' + (chosen ? chosen.id : '');
  // The sheets of a waiting card, drawn again only when what they are changes.
  function _paintBoards(id, l) {
    const two = l.two;
    const list = l.m.boards || [];
    // What a countdown says follows its sheet's stage between the paints.
    for (const g of list) { const p = g.state === 'pending' ? two.progs.get(g.id) : null; if (p) p.say(_boardWords(g, two.W)); }
    const chosen = _chosenBoard(l);
    const sig = _boardSig(l, chosen);
    if (sig === two.sig) return;
    two.sig = sig;
    // A countdown seen landing teaches the estimate (review V8); the others only stop.
    const now = new Map(list.map(g => [g.id, g]));
    for (const [gid, p] of two.progs) { const g = now.get(gid); if (g && g.state === 'done' && !document.hidden) p.finish(); else p.detach(); }
    two.progs.clear();
    const had = two.strip.contains(document.activeElement) ? document.activeElement.dataset.id : '';
    two.strip.textContent = '';
    const ok = list.filter(_boardOk);
    for (const g of list) {
      if (_boardOk(g)) {
        two.strip.appendChild(_boardThumb(g, chosen && chosen.id === g.id, (x) => {
          _boardPick.set(id, x.id);
          _post('/api/mv3/video/card/' + encodeURIComponent(id), { project: l.m.project, chosen: x.id }, 'PATCH');
          // Chosen in place: the strip is not drawn again for a choice, and the focus stays where it is.
          for (const b of two.strip.querySelectorAll('.vc-board[data-id]')) b.classList.toggle('is-chosen', b.dataset.id === x.id);
          two.sig = _boardSig(l, _chosenBoard(l));
          _freshenOne(id, l);
        }, ok, two.W));
      } else if (g.state === 'pending') {
        two.strip.appendChild(_boardBusy(g, two.progs, g.id, two.W));
      } else {
        two.strip.appendChild(el('div', 'vc-board is-bad', g.gone ? 'not on the Images shelf any more - it cannot be followed'
          : String(g.error || 'it was not drawn').slice(0, 140)));
      }
    }
    if (had) { const b = two.strip.querySelector('.vc-board[data-id="' + CSS.escape(had) + '"]'); if (b) b.focus(); }
  }
  // Every written card as the thread is read: its sheets and its attempts repainted in place.
  function _freshenLive(thread) {
    for (const [id, l] of _live) {
      if (!l.go.isConnected) { _forget(id); continue; }
      const now = thread.find(x => x.id === id);
      if (now) l.m = now;
      if (l.two) _paintBoards(id, l);
      _paintTries(id, l);
      _freshenOne(id, l);
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
    const media = m.media || [];
    if (media.length) {
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
      box.appendChild(row);
    }
    return box;
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
    emptyText: () => (isMC() && _table ? _table.standardPrompt || '' : ''),
    // (phase V7) Clips and sounds in the zone: the part that goes, and what the cell says of it.
    attState: _attState,
    onAttach: (a) => { _onAttach(a); },
    trimFor: _trimFor,
    onHide: () => { closeTrim(); closeHelp(); },
    // (phase V14) The prompt reference "/" between the count and the send.
    barButtons: () => [_helpBtn(() => (ctx.ui() || {}).ta, 'above')],
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
      onPen: () => _paintRecipe(),
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
