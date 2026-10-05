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
   - A clip that lands is not put in the attachment row - clips are references only from phase V7.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { openViewer } from '../library/viewer.js';
import { createChat, el, money, json, stored, keep } from './chat-shell.js';

const LS_LAST = 'mv3_vc_last_v1';         // { model, agg: { <model>: agg }, params: { <model>: {...} } }
const SHOW_ATTS = 9;                       // places in the row at most, whatever a model takes

function arOf(i) {
  const w = +(i.w || (i.meta || {}).w || 0);
  const h = +(i.h || (i.meta || {}).h || 0);
  return (w > 0 && h > 0) ? (w + ':' + h) : '1:1';
}
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

  // ── The rates ─────────────────────────────────────────────────────────────
  // The aggregator's table, read through the chosen parameters - the server prices the same way
  // (lib/video-models.js price); the first real record of a model says what was really taken.
  function _perSec(r, res) {
    const rate = (r.rates || {})[res];
    return Array.isArray(rate) ? rate[0] : (rate == null ? null : rate);
  }
  function priceNow() {
    const r = rec();
    if (!r) return null;
    const p = params();
    const res = r.resolutions.includes(p.resolution) ? p.resolution : r.resDef;
    const per = _perSec(r, res);
    if (per == null) return { none: true, res };
    if (r.duration.fromClip) return { per, res, fromClip: true };
    const secs = clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max);
    return { per, res, secs, usd: per * secs };
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
      })), _last.model, (v) => { _last.model = v; _remember(); _paintModel(true); ctx.paintAtts(); });
      _row(host, 'model', mSel);
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
      _set = { model: mSel, agg: aSel, box, cost, fall };
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
      o.textContent = r.aggLabel + (r.usable ? (per != null ? ' · ' + money(per) + '/s' : '') : ' - ' + (r.why || 'cannot be asked'));
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
    ctx.banner(m.brief + (isMC() ? ' Clips as references arrive in a later step.' : ''));
    _paintParams();
  }

  function _paintParams() {
    if (!_set) return;
    const m = model(), r = rec();
    const box = _set.box;
    box.textContent = '';
    if (!m || !r) return;
    const p = params();
    const n = ctx.atts().length;
    const fam = m.family;
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
      const fixed = n > 0 && (fam === 'grok' || (fam === 'seedance' && (p.picturesAs === 'frame' || p.picturesAs === 'fl')));
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
      _row(box, 'sound', _select('mv3-vc-audio', 'Seedance makes its own sound', [{ value: 'on', text: 'with sound' }, { value: 'off', text: 'silent' }],
        p.audio === false ? 'off' : 'on', (v) => setParam('audio', v === 'on')));
      if (n > 0) {
        _row(box, 'pictures are', _select('mv3-vc-as', 'What the attached pictures are for', [
          { value: 'refs', text: 'references' },
          { value: 'frame', text: 'the first frame', disabled: n !== 1, title: 'one picture' },
          { value: 'fl', text: 'first and last frames', disabled: n !== 2, title: 'two pictures' },
        ], p.picturesAs || 'refs', (v) => { setParam('picturesAs', v); _paintParams(); }));
      }
    }
    if (fam === 'kmc') {
      _row(box, 'orientation', _select('mv3-vc-or', 'Which way the character faces', [
        { value: 'video', text: 'as in the clip (up to 30 s)' }, { value: 'image', text: 'as on the picture (up to 10 s)' },
      ], p.orientation || 'video', (v) => { setParam('orientation', v); _paintPrice(); }));
      if (r.keepSound) {
        _row(box, 'sound', _select('mv3-vc-keep', 'The clip\'s own sound', [{ value: 'on', text: 'keep the clip\'s sound' }, { value: 'off', text: 'silent' }],
          p.keepSound === false ? 'off' : 'on', (v) => setParam('keepSound', v === 'on')));
      }
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
      box.innerHTML = '<b>≈' + money(pr.per) + '</b><span>per second of your clip · ' + pr.res + ' · ' + r.aggLabel + '</span>';
    } else {
      box.className = 'mv3-ig-cost';
      box.innerHTML = '<b>≈' + money(pr.usd) + '</b><span>per clip · ' + pr.secs + ' s · ' + pr.res + ' · ' + r.aggLabel
        + (many > 1 ? ' · ' + money(pr.usd * many) + ' for ' + many : '') + '</span>';
    }
    const notes = [];
    if (r && r.agg === 'kie' && model() && model().id === 'grok15') notes.push("kie's rate for Grok 1.5 looks like a mistake - the first real clip will show");
    if (r && r.duration.fromClip) notes.push('it may come back shorter than the clip, paid all the same');
    if (_table && _table.fake) notes.push('FAKE aggregator - nothing is paid');
    _set.fall.textContent = notes.join(' · ');
    _last.model = (model() || {}).id || _last.model;
    _remember();
  }

  function _room() {
    const r = rec();
    if (!r) return SHOW_ATTS;
    return Math.min(SHOW_ATTS, r.limits.images || 0);
  }

  function _ready() {
    if (!_table) return ['No video models.', _err || 'reading the models…'];
    const m = model(), r = rec();
    if (!m || !m.usable) return ['Not available now.', (m && m.why) || 'no model can be asked'];
    if (!r || !r.usable) return [(r ? r.aggLabel : 'That aggregator') + ' cannot be asked.', (r && r.why) || ''];
    if (isMC()) return ['Not yet.', 'Kling motion control needs a clip of the moves - clips as references arrive in a later step.'];
    const n = ctx.atts().length;
    if (r.needs && r.needs.images && n < r.needs.images) return ['It needs a picture.', m.label + ' on ' + r.aggLabel + ' starts from one.'];
    if (n > (r.limits.images || 0)) return ['Too many pictures.', m.label + ' on ' + r.aggLabel + ' takes ' + (r.limits.images || 0) + '.'];
    if (n && !_table.r2) return ['Attachments need R2.', 'The models read pictures from a public link - set R2 on Admin → API keys.'];
    return '';
  }

  function _body() {
    const m = model(), r = rec();
    const p = params();
    const fam = m.family;
    const atts = ctx.atts();
    const as = p.picturesAs || 'refs';
    const role = (i) => (fam !== 'seedance' ? '' : as === 'frame' && i === 0 ? 'frame-first'
      : as === 'fl' ? (i === 0 ? 'frame-first' : i === 1 ? 'frame-last' : '') : '');
    const fmt = (Store.timeline() || {}).format || '9:16';
    return {
      model: m.id, agg: r.agg,
      params: {
        duration: r.duration.fromClip ? undefined : clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max),
        resolution: r.resolutions.includes(p.resolution) ? p.resolution : r.resDef,
        aspect: (r.aspects || []).includes(p.aspect) ? p.aspect : ((r.aspects || []).includes(fmt) ? fmt : (r.aspects || [])[0]),
        audio: p.audio !== false, mode: p.mode || 'normal', orientation: p.orientation || 'video', keepSound: p.keepSound !== false,
      },
      media: atts.map((a, i) => ({ path: a.path, kind: 'image', role: role(i) })),
    };
  }

  return {
    name: 'videos',
    kind: 'clip',
    ids: { root: 'mv3-vc', head: 'mv3-vc-head', crumb: 'mv3-lib-vgen' },
    keys: { draft: 'mv3_vc_draft_v1', write: 'mv3_vc_write_v1', strip: 'mv3-vc-strip-w' },
    maxAtts: SHOW_ATTS,
    counts: [1, 2],
    noun: { one: 'picture', many: 'pictures' },
    busyWord: 'making the clip',
    // A first guess; each model learns its own pace from its first clips (startInlineProgress keeps an average per key).
    eta: 180000,
    progressKey: (g) => 'mv3-video-' + (g.model || ''),
    sendUrl: '/api/mv3/video/send',
    // A clip is not an attachment until phase V7: one that lands is not put in the row.
    landAsRef: false,
    text: {
      placeholder: 'Describe a clip, or say what to change.',
      empty: 'Describe a clip. What comes back stays in this project — and on the B-roll shelf.',
      emptyNoProject: 'Describe a clip. A project is started for it with the first message.',
      onlyFiles: 'Only pictures can be attached here for now.',
      slot: 'A picture to work from - from this computer, or press one on the right',
      plus: 'Add a picture from this computer. It goes into Images and straight into the row above the message box.',
      cat: "This project's clips, or a category of the Library's Images - pictures to attach",
      crumb: 'Back to the conversation about clips',
    },
    upload: { url: '/api/mv3/img/upload', field: 'image', accept: 'image/*', ok: (f) => /^image\//.test(f.type || '') },
    // The right column: this project's clips (posters; dragged onto a lane, pressed to play), or a category of Images
    // (pictures, pressed to attach).
    feed: {
      url: (k) => '/api/mv3/video/feed?project=' + encodeURIComponent(k),
      map: (g) => ({
        kind: 'video', video: g.videoPath || '', poster: g.posterPath || '', path: g.videoPath || ('pending:' + g.id),
        aspect: (g.w && g.h) ? g.w + ':' + g.h : ((g.params || {}).aspect || '9:16'), state: g.state,
        name: g.said || g.prompt || '', error: g.error, dur: g.duration || 0, libId: g.birolId || '', group: 'videochat',
      }),
    },
    cats: {
      url: '/api/library/shelf/media?filter=images',
      map: (i) => ({ path: i.media, aspect: arOf(i), state: 'done', name: i.name || '', libId: i.id || '' }),
      group: 'images',
    },
    resultPath: (g) => g.videoPath,

    settings: {
      load,
      paint,
      onAtts: () => { if (_set) _paintParams(); },
      onCount: _paintPrice,
      onProject: () => { if (_set) _paintParams(); },
      room: _room,
      ready: _ready,
      body: _body,
    },

    // A finished clip in the thread: its poster - a press plays it - and "to timeline" under it.
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
        img.addEventListener('error', () => { img.remove(); }, { once: true });
        box.appendChild(img);
      }
      box.appendChild(el('span', 'mv3-ig-play', '▶'));
      if (g.duration) box.appendChild(el('span', 'mv3-ig-dur', (+g.duration).toFixed(1) + 's'));
      box.title = 'Play it';
      box.addEventListener('click', open);
      cell.appendChild(box);
      const acts = el('div', 'mv3-ig-acts');
      const add = el('button', 'mv3-c-btn', 'to timeline');
      add.type = 'button';
      add.title = 'Puts it on the lane above main video, at the playhead, at its own length.';
      add.addEventListener('click', () => ctx.place({
        clip: true, src: g.videoPath, thumb: g.posterPath || null, libId: g.birolId || '',
        name: String(g.said || g.prompt || '').slice(0, 60), dur: +g.duration || 0, group: 'videochat',
      }, add));
      acts.append(add);
      cell.appendChild(acts);
    },

    facts: (g) => [
      ['model', (g.model || '') + ' · ' + (g.agg || '?') + ' · ' + (((g.params || {}).resolution) || '')],
      ['length', g.duration ? (+g.duration).toFixed(1) + ' s' + (g.w && g.h ? ' · ' + g.w + '×' + g.h : '') : ''],
      ['took', g.secs ? g.secs + 's' : ''],
      ['cost', g.credits ? g.credits + ' kie credits (≈' + money(g.credits * 0.005) + ')' : ''],
      ['references', (g.media || []).length ? String(g.media.length) : ''],
      ['writer', g.fell ? 'sent as typed - ' + g.fell : (g.writer || '')],
      ['sent as', (g.prompt && g.said && g.prompt !== g.said) ? g.prompt : ''],
    ],

    // Every clip this thread finished, played in the Library's viewer.
    view(done, at) {
      openViewer(done.map(x => ({ id: x.id, kind: 'birols', media: x.videoPath, thumb: x.posterPath || x.videoPath,
        name: x.said || x.prompt || '', meta: { date: x.at } })), at);
    },
    // A clip pressed in the right column plays.
    openTile(it) {
      openViewer([{ id: it.libId || it.video, kind: 'birols', media: it.video, thumb: it.poster || it.video, name: it.name || '' }], 0);
    },

    headButtons: () => [],
  };
}

const CHAT = createChat(VIDEOS);

/** Every way in: the generate menu, the lane's right-click, ?open=videos, Alerts. */
export const openVideos = () => CHAT.open();

export function initVidChat() { CHAT.init(); }
