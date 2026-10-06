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
import { openCatalog } from './vcatalog.js';
import { note } from './ask.js';
import { startInlineProgress } from '../progress.js';

const LS_LAST = 'mv3_vc_last_v1';         // { model, agg: { <model>: agg }, params: { <model>: {...} } }
const SHOW_ATTS = 9;                       // the old row's places at most (the zone grows instead - phase V6)
const MAX_PICS = 30;                       // pictures at most, whatever a model says (Seedance 2.5 takes 30)
const MAX_ATTS = 50;                       // everything attached at most - pictures, clips and sounds

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
  // The catalog's recipe in use (phase V5) - kept with the draft, per project, until its cross.
  let _skill = null;
  // What is attached, by kind (phase V6: the zone has pictures, clips and sounds).
  const _kind = (a) => (a && (a.kind === 'video' || a.kind === 'audio') ? a.kind : 'image');
  const _pics = () => ctx.atts().filter(a => _kind(a) === 'image');

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
  function priceOf(r) {
    if (!r) return null;
    const p = params();
    if (p.resolution && !r.resolutions.includes(p.resolution)) return { none: true, cannot: p.resolution };
    const res = p.resolution || r.resDef;
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
    _set.brief.textContent = m.brief + (isMC() ? ' Clips as references arrive in a later step.' : '');
    _paintParams();
    _paintRecipe();
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
    const used = !isMC();
    box.className = 'mv3-ig-banner mv3-vc-recipe' + (used ? '' : ' is-off');
    box.appendChild(el('span', 'k', 'recipe'));
    const t = el('button', 't', _skill.title);
    t.type = 'button';
    t.title = 'Open it in the catalog';
    t.addEventListener('click', _openCat);
    box.appendChild(t);
    if (_edited(_skill)) box.appendChild(el('i', null, 'edited'));
    box.appendChild(el('span', 'sp'));
    if (!used) box.appendChild(el('span', 'why', 'Kling motion control has no writer - pick another model'));
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

  function _room() {
    const r = rec();
    if (!r) return SHOW_ATTS;
    return Math.min(SHOW_ATTS, r.limits.images || 0);
  }

  // ── The attachment zone (phase V6, the owner 2026-10-06) ──────────────────
  // Pictures | clips | sounds, each as many as the model takes on the chosen aggregator - the shell grows them one
  // place at a time. With a recipe each part holds the recipe's slots of its kind, each cell wearing its name. Clips and
  // sounds as references are phase V7: until then their parts say so (and a recipe's cells there stand dimmed).
  const GENERIC = ['picture', 'pictures', 'clip', 'clips', 'sound', 'sounds'];
  const _partOf = (k) => (k === 'video' || k === 'audio' ? k : 'image');
  function _slotsOf(kind) {
    if (!_skill) return null;
    return (_skill.slots || []).filter(s => _partOf(s.kind) === kind).map(s => ({
      key: String(s.key || s.kind), role: s.role || '', kind: s.kind,
      label: String(GENERIC.includes(s.key) ? (s.role || s.key) : s.key).replace(/[-_]+/g, ' '),
      min: Math.max(0, +s.min || 0), max: Math.max(1, +s.max || 1, +s.min || 0), required: !!s.required, hint: s.hint || '',
    }));
  }
  function _zone() {
    const r = rec(), m = model();
    const lim = r ? r.limits : { images: 0, videos: 0, audios: 0 };
    const who = (m && m.label) || 'This model';
    return { parts: [
      { kind: 'image', word: 'pictures', one: 'picture', room: Math.min(MAX_PICS, lim.images || 0), slots: _slotsOf('image'),
        none: who + ' takes no pictures.', other: 'Another picture for the writer to use - anything the recipe did not ask for' },
      { kind: 'video', word: 'clips', one: 'clip', room: lim.videos || 0, slots: _slotsOf('video'),
        none: who + ' takes no clips.', off: (lim.videos || 0) ? 'Clips as references arrive in the next step.' : '' },
      { kind: 'audio', word: 'sounds', one: 'sound', room: lim.audios || 0, slots: _slotsOf('audio'),
        none: who + ' takes no sounds.', off: (lim.audios || 0) ? 'Sounds as references arrive in the next step.' : '' },
    ] };
  }
  // An armed slot turns the right column to what suits it (the owner): a person - characters and looks, a place -
  // environments, clothes - lookbooks, a product, a style or anything else - Images.
  function _shelfFor(kind, s) {
    const role = (s && s.role) || '';
    if (kind !== 'image') return '';
    if (role === 'person') return 'shelf:people';
    if (role === 'location') return 'shelf:environments';
    if (role === 'outfit') return 'shelf:lookbooks';
    return 'images';
  }
  // The shelves the column can show: a character's sheet, then its looks, one character after another.
  async function _loadPeople() {
    const [c, l] = await Promise.all([json('/api/library/shelf/characters'), json('/api/library/shelf/looks')]);
    const chars = (c && c.success) ? c.items || [] : [];
    const looks = (l && l.success) ? l.items || [] : [];
    const out = [];
    const tile = (i, name) => ({ path: i.media, state: 'done', name: name || i.name || '', libId: i.id || '' });
    for (const ch of chars) {
      out.push(tile(ch, ch.name));
      for (const lk of looks.filter(x => (x.meta || {}).charId === ch.id)) out.push(tile(lk, ch.name + ' · ' + lk.name));
    }
    for (const lk of looks.filter(x => !chars.some(ch => ch.id === (x.meta || {}).charId))) out.push(tile(lk, lk.name));
    return out.filter(x => x.path);
  }
  async function _loadShelf(kind) {
    const d = await json('/api/library/shelf/' + kind);
    return ((d && d.success) ? d.items || [] : []).filter(i => i && i.media)
      .map(i => ({ path: i.media, state: 'done', name: i.name || '', libId: i.id || '' }));
  }
  // The recipe's first slot that is not filled as far as it must be - the send waits for it.
  function _missing() {
    if (!_skill) return null;
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
    if (isMC()) return ['Not yet.', 'Kling motion control needs a clip of the moves - clips as references arrive in a later step.'];
    // A recipe's cell that must be filled and is not: nothing is asked, the cell blinks (phase V6).
    const miss = _missing();
    if (miss) {
      ctx.flash(miss.part, miss.key);
      const what = miss.part === 'video' ? 'clip' : miss.part === 'audio' ? 'sound' : 'picture';
      if (miss.part !== 'image') return ['The recipe needs a ' + what + '.', (what === 'clip' ? 'Clips' : 'Sounds') + ' as references arrive in the next step.'];
      return ['The recipe needs ' + (miss.min - miss.have) + ' more ' + (miss.label || what) + ' ' + what + (miss.min - miss.have === 1 ? '' : 's') + '.',
        miss.hint || 'Press its place, then a picture on the right or a file.'];
    }
    const n = _pics().length;
    if (r.needs && r.needs.images && n < r.needs.images) return ['It needs a picture.', m.label + ' on ' + r.aggLabel + ' starts from one.'];
    if (n > (r.limits.images || 0)) return ['Too many pictures.', m.label + ' on ' + r.aggLabel + ' takes ' + (r.limits.images || 0) + '.'];
    if (ctx.atts().length > n) return ['Pictures only for now.', 'Clips and sounds as references arrive in the next step.'];
    if (n && !_table.r2) return ['Attachments need R2.', 'The models read pictures from a public link - set R2 on Admin → API keys.'];
    return '';
  }

  function _body() {
    const m = model(), r = rec();
    const p = params();
    const fam = m.family;
    const atts = ctx.atts();
    const as = p.picturesAs || 'refs';
    // What each picture is for: a recipe's slot says (its role - person, product... - or a frame), otherwise Seedance's
    // "pictures are" does.
    const slots = new Map(['image', 'video', 'audio'].flatMap(k => (_slotsOf(k) || []).map(s => [k + ':' + s.key, s])));
    const frame = (i) => (fam !== 'seedance' ? '' : as === 'frame' && i === 0 ? 'frame-first'
      : as === 'fl' ? (i === 0 ? 'frame-first' : i === 1 ? 'frame-last' : '') : '');
    const role = (a, i) => {
      const s = a.slot ? slots.get(_kind(a) + ':' + a.slot) : null;
      if (s) return /^frame-/.test(s.kind) ? s.kind : s.role;
      return _kind(a) === 'image' && !_skill ? frame(i) : '';
    };
    const fmt = (Store.timeline() || {}).format || '9:16';
    return {
      model: m.id, agg: r.agg,
      params: {
        duration: r.duration.fromClip ? undefined : clamp(+p.duration || r.duration.def, r.duration.min, r.duration.max),
        resolution: r.resolutions.includes(p.resolution) ? p.resolution : r.resDef,
        aspect: (r.aspects || []).includes(p.aspect) ? p.aspect : ((r.aspects || []).includes(fmt) ? fmt : (r.aspects || [])[0]),
        audio: p.audio !== false, mode: p.mode || 'normal', orientation: p.orientation || 'video', keepSound: p.keepSound !== false,
      },
      media: atts.map((a) => ({
        path: a.path, kind: _kind(a), role: role(a, atts.filter(x => _kind(x) === _kind(a)).indexOf(a)),
        label: (a.slot && slots.get(_kind(a) + ':' + a.slot) || {}).label || '',
      })),
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
  const toShown = (p) => String(p || '').replace(/\{\{(image|video|audio):(\d+)\}\}/g, (a, k, n) => '[' + REF_WORD[k] + ' ' + n + ']');
  const toNeutral = (p) => String(p || '').replace(/\[(picture|clip|sound) (\d+)\]/gi, (a, k, n) => '{{' + REF_KIND[k.toLowerCase()] + ':' + n + '}}');
  let _wantRecipe = false;      // "change the values" pressed: the request shows though a prompt card waits
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

  // This recipe's newest prompt card while it is not made - being written, waiting, or failed (its "write it again" is
  // the step): the step that comes next. Once it is made, the request comes back for the next variant.
  function _openCard() {
    if (!_skill) return null;
    const cards = ctx.thread().filter(m => m.card && m.card.type === 'prompt' && m.card.recipe && m.card.recipe.id === _skill.id);
    const last = cards.length ? cards[cards.length - 1] : null;
    return last && last.card.state !== 'sent' ? last : null;
  }
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
    ctx.bar(!_skill);
    const show = !!_skill && (!_openCard() || _wantRecipe);
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
      bodyTa.className = 'vc-body';
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
    const go = el('button', 'mv3-c-btn vc-go', 'write the prompt');
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
    _cardEls.why.textContent = mc ? 'Kling motion control has no writer - pick another model on the left.'
      : m ? 'The writer turns it into a prompt for ' + m.label + ' - you read it and edit it before anything is made.' : '';
  }

  async function _write(btn) {
    if (_writingNow || !_skill) return;
    if (isMC()) { note(btn, 'No writer here.', 'Kling motion control has no writer - pick another model on the left.'); return; }
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
        head, values, body, media: b.media,
      });
      if (!d || !d.success) { note(btn, 'Not sent.', (d && d.error) || 'the server did not answer'); return; }
      _wantRecipe = false;
      await ctx.reload(true);
    } finally {
      _writingNow = false;
      if (btn.isConnected) btn.disabled = isMC();
    }
  }

  // ── The cards in the thread ──
  const _cardSig = (m) => {
    const c = m.card;
    return [c.type, c.state || '', c.error || '', c.model || '', (m.genIds || []).join(',')].join(':');
  };
  const _busy = (thread) => thread.some(m => m.card && m.card.type === 'prompt' && m.card.state === 'writing');

  function _cardBubble(m, progs) {
    const c = m.card;
    if (c.type === 'recipe') return _sentRequest(m);
    _live.delete(m.id);
    const box = el('div', 'mv3-ig-msg is-agent vc-card is-prompt is-' + c.state);
    const h = el('div', 'vc-card-h');
    h.append(el('span', 'k', 'prompt'), el('span', 't', c.recipe && c.recipe.title ? c.recipe.title : ''));
    if (c.model) h.appendChild(el('span', 'm', 'for ' + _labelOf(c.model)));
    box.appendChild(h);
    if (c.state === 'writing') {
      const strip = el('div', 'mv3-ig-prog');
      box.appendChild(strip);
      progs.set('w:' + m.id, startInlineProgress(strip, {
        label: 'writing the prompt…', key: 'mv3-video-writer', estimateMs: 25000, startedAt: Date.parse(m.at) || 0,
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
    if (c.state === 'ready') return _readyCard(m, box);
    // Made: what was sent, and the clips it made under it.
    box.appendChild(el('div', 'vc-prompt-sent', toShown(c.prompt)));
    const g0 = (m.gens || [])[0];
    if (g0 && g0.lang === 'zh' && g0.sent) {
      box.appendChild(el('div', 'vc-zh-line', 'sent in 中文 · the English above'));
      box.appendChild(el('div', 'vc-prompt-sent is-zh', toShown(g0.sent)));
    } else if (c.sent && c.sent.zh && g0 && /^sent in English/.test(g0.fell || '')) {
      box.appendChild(el('div', 'vc-zh-line is-fell', g0.fell));
    }
    const shots = ctx.shots(m, progs);
    if (shots) box.appendChild(shots);
    const acts = el('div', 'vc-card-acts is-quiet');
    const again = el('button', 'vc-link', 'again - a copy to change and make');
    again.type = 'button';
    again.addEventListener('click', async () => {
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/again', { project: m.project });
      if (!d || !d.success) { note(again, 'Not copied.', (d && d.error) || 'the server did not answer'); return; }
      ctx.reload(true);
    });
    acts.appendChild(again);
    box.appendChild(acts);
    return box;
  }

  // A prompt card waiting to be made: the prompt to edit, the count, the price, and the press that makes the video.
  function _readyCard(m, box) {
    const c = m.card;
    if (c.edited) box.querySelector('.vc-card-h').appendChild(el('i', null, 'edited'));
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
    const zh = el('label', 'vc-zh');
    const zcb = document.createElement('input');
    zcb.type = 'checkbox';
    // Remembered per model - every waiting card of this model follows.
    zcb.addEventListener('change', () => { setParam('zh', zcb.checked); _freshenCards(); });
    zh.append(zcb, el('span', null, '中文'));
    zh.title = 'Send the prompt in Chinese (experimental, Seedance): it is translated just before it goes - the references and every quoted line stay as they are, and if the translation fails, the English goes.';
    acts.append(nBtn, zh, go, price);
    if (_skill && c.recipe && c.recipe.id === _skill.id) acts.appendChild(_changeLink());
    box.appendChild(acts);
    const l = { m, ta, go, price, save, zh, zcb };
    _live.set(m.id, l);
    _freshenOne(m.id, l);
    return box;
  }

  // The prices and the presses of the waiting cards follow the column: another kind of model means writing again.
  function _freshenCards() {
    for (const [id, l] of _live) {
      if (!l.go.isConnected) { _live.delete(id); continue; }
      _freshenOne(id, l);
    }
  }
  function _freshenOne(id, l) {
    const m = model();
    const pr = priceNow();
    const n = _cardN.get(id) || 1;
    const other = m && _familyOf(l.m.card.model) && m.family !== _familyOf(l.m.card.model);
    l.go.textContent = other ? 'write it again for ' + m.label : 'make' + (n > 1 ? ' ' + n : '');
    l.go.classList.toggle('is-make', !other);
    if (l.zh) {
      l.zh.hidden = !!other || !(m && (m.langs || []).includes('zh'));
      l.zcb.checked = !!params().zh;
    }
    l.price.textContent = other ? 'it was written for ' + _labelOf(l.m.card.model)
      : !pr || pr.none ? (m ? m.label + ' · no published price' : '')
        : pr.fromClip ? '≈' + money(pr.per) + ' per second of clip · ' + (m ? m.label : '')
          : '≈' + money(pr.usd * n) + ' · ' + pr.secs + ' s · ' + pr.res + ' · ' + (m ? m.label : '') + ' · ' + (rec() ? rec().aggLabel : '');
  }

  async function _make(m, go) {
    const l = _live.get(m.id);
    if (!l || go.disabled) return;
    const mm = model();
    if (mm && mm.family !== _familyOf(m.card.model)) return _rewrite(m, go);
    const prompt = toNeutral(l.ta.value).trim();
    if (!prompt) { note(go, 'The prompt is empty.', 'Write what the clip shows, or write it again.'); return; }
    const why = _ready();
    if (why) { note(go, why[0], why[1]); return; }
    go.disabled = true;
    try {
      clearTimeout(_patchT.get(m.id));
      _patchT.delete(m.id);
      const b = _body();
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/make', {
        project: m.project, prompt, n: _cardN.get(m.id) || 1, model: b.model, agg: b.agg, params: b.params, where: _where(m.project),
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
    btn.disabled = true;
    try {
      const b = _body();
      const d = await _post('/api/mv3/video/card/' + encodeURIComponent(m.id) + '/rewrite', { project: m.project, model: b.model, agg: b.agg, params: b.params });
      if (!d || !d.success) { note(btn, 'Not written.', (d && d.error) || 'the server did not answer'); return; }
      await ctx.reload(true);
    } finally {
      if (btn.isConnected) btn.disabled = false;
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
        const cell = el('div', 'mv3-ig-msg-ref');
        if (k === 'image') {
          const img = document.createElement('img');
          img.src = '/api/thumb?src=' + encodeURIComponent(a.path) + '&v=strip';
          img.loading = 'lazy'; img.decoding = 'async';
          cell.appendChild(img);
          cell.addEventListener('mouseenter', () => ctx.peekShow('/api/thumb?src=' + encodeURIComponent(a.path) + '&v=main', cell));
          cell.addEventListener('mouseleave', ctx.peekHide);
        }
        cell.appendChild(el('span', 'n', String(count[k])));
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
    keys: { draft: 'mv3_vc_draft_v1', write: 'mv3_vc_write_v1', strip: 'mv3-vc-strip-w' },
    maxAtts: MAX_ATTS,
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
      cat: "This project's clips, a shelf of the Library or a category of its Images - pictures to attach",
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
    // (phase V6) The Library's shelves the column can show besides Images - an armed slot of a recipe turns it to one.
    shelves: [
      { id: 'people', label: 'characters & looks', load: _loadPeople },
      { id: 'environments', label: 'environments', load: () => _loadShelf('environments') },
      { id: 'lookbooks', label: 'lookbooks', load: () => _loadShelf('lookbooks') },
    ],
    shelfFor: _shelfFor,
    // (phase V6) The builder's cards in the thread, drawn here; the request at the thread's foot.
    cardBubble: _cardBubble,
    cardSig: _cardSig,
    busy: _busy,
    onThread: () => _paintFoot(true),
    resultPath: (g) => g.videoPath,

    settings: {
      load,
      paint: () => { paint(); _paintRecipe(); },
      onAtts: () => { if (_set) _paintParams(); },
      onCount: _paintPrice,
      onProject: () => { if (_set) _paintParams(); },
      room: _room,
      zone: _zone,
      ready: _ready,
      body: _body,
      // The recipe in use goes with the draft, per project (phase V5) - and the zone is laid out by its slots.
      draftExtra: () => (_skill ? { skill: _skill } : null),
      draftLoad: (x) => { _skill = (x && x.skill && x.skill.text) ? x.skill : null; _wantRecipe = false; _cardEls = null; _paintRecipe(); ctx.paintAtts(); _paintFoot(); },
      onPen: () => _paintRecipe(),
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
    // A clip pressed in the right column plays.
    openTile(it) {
      openViewer([{ id: it.libId || it.video, kind: 'birols', media: it.video, thumb: it.poster || it.video, name: it.name || '' }], 0);
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
