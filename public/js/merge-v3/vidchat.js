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
    const used = ctx.writing() && !isMC();
    box.className = 'mv3-ig-banner mv3-vc-recipe' + (used ? '' : ' is-off');
    box.appendChild(el('span', 'k', 'recipe'));
    const t = el('button', 't', _skill.title);
    t.type = 'button';
    t.title = 'Open it in the catalog';
    t.addEventListener('click', _openCat);
    box.appendChild(t);
    if (_edited(_skill)) box.appendChild(el('i', null, 'edited'));
    box.appendChild(el('span', 'sp'));
    if (!used) {
      box.appendChild(el('span', 'why', isMC() ? 'Kling motion control has no writer - not used with it'
        : 'the writer is off (✎) - your words go as typed'));
    }
    const x = el('button', 'x', '×');
    x.type = 'button';
    x.title = 'Stop using this recipe';
    x.addEventListener('click', () => { _skill = null; ctx.reslot(); ctx.saveDraft(); _paintRecipe(); });
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
    _skill = u.skill ? {
      id: u.skill.id, kind: u.skill.kind, title: u.skill.title, v: u.skill.v,
      text: u.skill.text, orig: u.skill.orig != null ? u.skill.orig : u.skill.text, slots: u.skill.slots || [],
    } : null;
    if (_set) { _set.model.value = u.model; _paintModel(true); }
    // What was attached before finds the recipe's slots.
    ctx.reslot();
    ctx.saveDraft();
    _paintRecipe();
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
      media: atts.map((a) => ({ path: a.path, kind: _kind(a), role: role(a, atts.filter(x => _kind(x) === _kind(a)).indexOf(a)) })),
      // The catalog's recipe, as it was left (the server keeps it only when the writer will use it).
      skill: _skill ? { id: _skill.id, kind: _skill.kind, title: _skill.title, v: _skill.v, edited: _edited(_skill), text: _skill.text } : undefined,
    };
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
      draftLoad: (x) => { _skill = (x && x.skill && x.skill.text) ? x.skill : null; _paintRecipe(); ctx.paintAtts(); },
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
