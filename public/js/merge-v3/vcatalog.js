/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the video chat's CATALOG (phase V5, docs/local-app/PLAN.md "V-C", "V-D").

   A window over the page (js/layers.js: Escape closes it, the page's shortcuts wait), three columns:

     left    the MODEL - the chat's own dropdown, and what is true of it (who can be asked, how long it takes,
             how fine it gets, whether it speaks) - then a search, the filters with their counts (one group's
             chips are "or", the groups "and") and the order
     centre  what fits THAT model and the filters, by kind: the cookbook's templates and cases, Grok's examples,
             the person's presets. Every tile is a box of one shape (3:4) with its poster cut to fill it; a case's
             clip plays in it while the pointer rests there (one at a time, nothing fetched before)
     right   the one picked: what it is and whose (authors and links - goodcase forbids being shown in a frame,
             so its pages open in the system browser), its price and fit for the model, what it NEEDS attached
             and its SKILL - both editable here, with the way back to the original -, a template's cases by heat,
             a case's or an example's own prompt (read only)

   What fits a model is decided here, and nothing that fits only another model is shown at all (the owner,
   2026-10-05): Seedance - the cookbook's templates and the cases whose references it can take; Grok - its 40
   examples and the cookbook's items that need at most the pictures it takes and no clip or sound, each marked
   "written for Seedance"; Kling motion control - presets of a picture and a clip of the moves (from V7).

   `use` closes the window and hands the chat the model, the settings the item suggests (its shape and length
   where the model takes them) and the skill - its text as it stands here, edited or not, and what it needs.
   The cookbook's cases are fetched the first time the window opens without them (POST .../catalog/fetch); a
   case's poster is fetched once by the server, from goodcase only.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { el, money, json, stored, keep } from './chat-shell.js';

const LS = 'mv3_vc_cat_v1';               // { filters, sort } - the window opens as it was left
const SHOW_CASES = 240;                    // cases drawn at once; "show N more" for the rest
const HOVER_MS = 350;
const KINDS = ['image', 'frame-first', 'frame-last', 'video', 'audio'];
const ROLES = ['person', 'product', 'outfit', 'location', 'prop', 'style', 'motion', 'music', 'voice'];
const KIND_WORD = { template: 'template', case: 'case', example: 'example', preset: 'preset' };

let _data = null;            // { cat, cases, presets }
let _fetchTried = false;     // the cases are fetched by the window at most once per page
let _w = null;               // the open window: { ov, layer, ... }
let _st = null;              // what it shows
let _hover = null;           // { box, video, timer }

const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _key = (it) => it.kind + ':' + it.id;
const _lc = (s) => String(s || '').toLowerCase();

// ── Reading ─────────────────────────────────────────────────────────────────
async function _load() {
  const [cat, cases, presets] = await Promise.all([
    json('/api/mv3/video/catalog'), json('/api/mv3/video/catalog/cases'), json('/api/mv3/video/presets'),
  ]);
  _data = {
    cat: (cat && cat.success) ? cat : { templates: [], categories: [], tags: {}, examples: [], status: {}, credits: {} },
    cases: (cases && cases.success) ? cases.cases : [],
    why: (cases && cases.success) ? cases.why : 'the catalog could not be read',
    presets: (presets && presets.success) ? presets.presets : [],
  };
}

// ── The model ───────────────────────────────────────────────────────────────
const _models = () => ((_st && _st.matrix && _st.matrix.models) || []);
const _model = () => _models().find(m => m.id === (_st && _st.model)) || _models()[0] || null;
// What the model takes at most, over its aggregators.
function _limits(m) {
  const out = { images: 0, videos: 0, audios: 0 };
  for (const r of (m && m.records) || []) {
    out.images = Math.max(out.images, r.limits.images || 0);
    out.videos = Math.max(out.videos, r.limits.videos || 0);
    out.audios = Math.max(out.audios, r.limits.audios || 0);
  }
  return out;
}
// The record prices are read from: the chat's aggregator when it is this model's, else its default, else the first.
function _rec(m) {
  if (!m) return null;
  const want = (_st.agg && _st.chatModel === m.id) ? _st.agg : m.defaultAgg;
  return m.records.find(r => r.agg === want) || m.records.find(r => r.usable) || m.records[0] || null;
}
const _perSec = (r, res) => { const v = (r.rates || {})[res]; return Array.isArray(v) ? v[0] : (v == null ? null : v); };
function _price(m, secs) {
  const r = _rec(m);
  if (!r) return null;
  const per = _perSec(r, r.resDef);
  if (per == null) return null;
  if (r.duration.fromClip) return { per, fromClip: true, r };
  const s = _clamp(+secs || r.duration.def, r.duration.min, r.duration.max);
  return { usd: per * s, secs: s, r };
}
function _modelLine(m) {
  const r = m.records.find(x => x.agg === m.defaultAgg) || m.records[0];
  if (!r) return m.label;
  const t = r.tenSeconds || {};
  const usable = m.usable ? '' : ' (no key)';
  if (r.duration.fromClip) return m.label + ' · ' + money(_perSec(r, r.resDef) || 0) + ' / s of clip' + usable;
  return m.label + (t.usd != null ? ' · ≈' + money(t.usd) + ' / 10 s' : '') + usable;
}
const _wait = (s) => (s < 90 ? '~' + Math.round(s) + ' s' : '~' + Math.round(s / 60) + ' min');

// ── Items: everything the catalog has, in one shape ─────────────────────────
function _needsOf(slots) {
  const req = (slots || []).filter(s => s.required && s.min > 0);
  const img = req.filter(s => ['image', 'frame-first', 'frame-last'].includes(s.kind)).reduce((n, s) => n + s.min, 0);
  const out = [];
  if (!req.length) out.push('none');
  if (img === 1) out.push('img1');
  if (img >= 2) out.push('img2');
  if (req.some(s => s.kind === 'video')) out.push('video');
  if (req.some(s => s.kind === 'audio')) out.push('audio');
  return out;
}
function _refsWord(it) {
  const n = it.refs || {};
  const parts = [];
  if (n.img) parts.push((n.exact ? n.img : n.img + '?') + ' img');
  if (n.vid) parts.push(n.vid + ' video');
  if (n.aud) parts.push(n.aud + ' sound');
  return parts.length ? parts.join(' · ') : 'words only';
}

let _memo = null;
function _items() {
  if (_memo && _memo.data === _data) return _memo.list;
  const d = _data;
  const out = [];
  const tplOf = new Map((d.cat.templates || []).map(t => [t.id, t]));
  const hottest = new Map();
  for (const c of d.cases) if (c.tp && c.ps && !hottest.has(c.tp)) hottest.set(c.tp, c);   // the index is hottest first
  for (const t of d.cat.templates || []) {
    const slots = t.needs || [];
    const req = slots.filter(s => s.required);
    const img = req.filter(s => s.kind !== 'video' && s.kind !== 'audio').reduce((n, s) => n + (s.min || 0), 0);
    const top = hottest.get(t.id);
    out.push({
      kind: 'template', id: t.id, title: (t.title && t.title.en) || t.id, sub: (t.description && t.description.en) || '',
      poster: top ? '/api/mv3/video/catalog/poster/' + encodeURIComponent(top.s) : '', media: top ? top.ms : '',
      needs: _needsOf(slots), slots, refs: { img, exact: true, vid: req.filter(s => s.kind === 'video').length, aud: req.filter(s => s.kind === 'audio').length },
      a: null, d: null, sp: t.speech ? 1 : 0, ts: t.twoStep ? 1 : 0, lc: '', v: '', cat: t.category, tp: t.id,
      h: top ? top.h : 0, st: 0, dt: '', written: 'seedance', count: t.cases || 0,
      search: _lc([t.id, t.title && t.title.en, t.title && t.title.zh, (t.tags || []).join(' '), t.description && t.description.en].join(' ')),
    });
  }
  for (const c of d.cases) {
    const tpl = c.tp ? tplOf.get(c.tp) : null;
    const needs = [];
    if (c.ri && !c.rx) needs.push('unsure');
    if (c.ri && c.rx) needs.push(c.ri === 1 ? 'img1' : 'img2');
    if (c.rv) needs.push('video');
    if (c.ra) needs.push('audio');
    if (!c.ri && !c.rv && !c.ra) needs.push('none');
    out.push({
      kind: 'case', id: c.s, title: c.t, sub: c.tz || '', creator: c.cr,
      poster: c.ps ? '/api/mv3/video/catalog/poster/' + encodeURIComponent(c.s) : '', media: c.ms || '',
      needs, refs: { img: c.ri, exact: !!c.rx, vid: c.rv, aud: c.ra },
      a: c.a, d: c.d, sp: c.sp, ts: c.ts, lc: c.lc, v: c.v, cat: c.cat || '', tp: c.tp || '',
      h: c.h, st: c.st, dt: c.dt, written: 'seedance', rg: c.rg, rm: c.rm,
      search: _lc([c.s, c.t, c.tz, c.cr, tpl && tpl.title && tpl.title.en].join(' ')),
    });
  }
  for (const x of d.cat.examples || []) {
    const motion = x.mode === 'i2v-motion';
    out.push({
      kind: 'example', id: x.id, title: x.title, sub: x.lead || '', creator: x.author, poster: '', media: '',
      needs: motion ? ['img1'] : ['none'], refs: { img: motion ? 1 : 0, exact: true, vid: 0, aud: 0 },
      a: null, d: null, sp: 0, ts: 0, lc: 'en', v: '', cat: '', tp: '', h: 0, st: 0, dt: '', written: 'grok', bucket: x.bucket,
      search: _lc([x.title, x.author, x.bucket, x.lead].join(' ')),
    });
  }
  for (const p of d.presets || []) {
    const slots = p.slots || [];
    const req = slots.filter(s => s.required);
    out.push({
      kind: 'preset', id: p.id, title: p.title, sub: p.summary || '', poster: '', media: '', preset: p,
      needs: _needsOf(slots), slots,
      refs: { img: req.filter(s => s.kind !== 'video' && s.kind !== 'audio').reduce((n, s) => n + (s.min || 0), 0), exact: true,
              vid: req.filter(s => s.kind === 'video').length, aud: req.filter(s => s.kind === 'audio').length },
      a: p.aspect || null, d: p.duration || null, sp: 0, ts: p.twoStep ? 1 : 0, lc: '', v: '', cat: p.category || '', tp: '',
      h: 0, st: 0, dt: String(p.updated || '').slice(0, 10), written: '', models: p.models || [],
      search: _lc([p.title, p.summary, (p.tags || []).join(' ')].join(' ')),
    });
  }
  _memo = { data: _data, list: out };
  return out;
}

// Whether an item belongs in the chosen model's catalog at all.
function _fits(it, m) {
  if (!m) return false;
  const fam = m.family;
  if (it.kind === 'preset') return (it.models || []).includes(m.id);
  if (fam === 'kmc') return false;
  const L = _limits(m);
  const r = it.refs || {};
  if (fam === 'seedance') {
    if (it.kind === 'example') return false;
    return (r.img || 0) <= L.images && (r.vid || 0) <= L.videos && (r.aud || 0) <= L.audios;
  }
  // Grok: its examples, and from the cookbook what needs at most the pictures it takes and no clip or sound.
  if (it.kind === 'example') return true;
  return (r.img || 0) <= L.images && !r.vid && !r.aud;
}

// ── Filters ─────────────────────────────────────────────────────────────────
const _len = (d) => (d == null ? 'none' : d <= 5 ? '5' : d <= 10 ? '10' : d <= 15 ? '15' : d <= 30 ? '30' : 'more');
function _groups(m) {
  const cats = (_data.cat.categories || []).map(c => [c.id, (c.title && c.title.en) || c.id]);
  const g = [
    { key: 'src', label: 'what', values: [['template', 'templates'], ['case', 'cases'], ['example', 'examples'], ['preset', 'presets']], of: it => [it.kind] },
    { key: 'needs', label: 'needs attached', values: [['none', 'nothing'], ['img1', '1 picture'], ['img2', '2+ pictures'], ['video', 'a clip'], ['audio', 'a sound'], ['unsure', 'unsure']], of: it => it.needs },
    { key: 'shape', label: 'shape', values: [['9:16', '9:16'], ['16:9', '16:9'], ['1:1', '1:1'], ['other', 'other'], ['none', 'not said']],
      of: it => [it.a ? (['9:16', '16:9', '1:1'].includes(it.a) ? it.a : 'other') : 'none'] },
    { key: 'len', label: 'length', values: [['5', 'up to 5 s'], ['10', '6-10 s'], ['15', '11-15 s'], ['30', '16-30 s'], ['more', 'over 30 s'], ['none', 'not said']], of: it => [_len(it.d)] },
    { key: 'speech', label: 'speech', values: [['yes', 'someone speaks'], ['no', 'no speech']], of: it => [it.sp ? 'yes' : 'no'] },
    { key: 'two', label: 'steps', values: [['two', 'two-step'], ['one', 'one step']], of: it => [it.ts ? 'two' : 'one'] },
  ];
  if (m && m.family === 'seedance') g.push({ key: 'ver', label: 'written for Seedance', values: [['2.5', '2.5'], ['2.0', '2.0']], of: it => (it.v ? [it.v] : []) });
  g.push({ key: 'lang', label: 'language of the case', values: [['en', 'English'], ['zh', 'Chinese']], of: it => (it.lc ? [it.lc] : []) });
  g.push({ key: 'cat', label: 'category', values: cats.concat([['none', 'no template']]), of: it => [it.cat || 'none'] });
  // A category picked: its templates, one by one.
  const one = (_st.filters.cat || []);
  if (one.length === 1 && one[0] !== 'none') {
    const tpls = (_data.cat.templates || []).filter(t => t.category === one[0]).map(t => [t.id, (t.title && t.title.en) || t.id]);
    g.push({ key: 'tpl', label: 'template', values: tpls, of: it => (it.tp ? [it.tp] : []) });
  }
  return g;
}
const _match = (it, g, sel) => !sel || !sel.length || g.of(it).some(v => sel.includes(v));
function _passes(it, groups, skip) {
  for (const g of groups) if (g.key !== skip && !_match(it, g, _st.filters[g.key])) return false;
  const q = _lc(_st.q).trim();
  return !q || q.split(/\s+/).every(w => it.search.includes(w));
}

function _sorted(list) {
  const by = _st.sort;
  const k = by === 'steady' ? (it) => it.st : by === 'new' ? (it) => it.dt : (it) => it.h;
  return list.slice().sort((a, b) => (k(b) > k(a) ? 1 : k(b) < k(a) ? -1 : 0));
}

// ── The window ──────────────────────────────────────────────────────────────
/**
 * Open the catalog. o: { matrix, model, agg, onUse(result) } - `matrix` is the chat's model table, `model` and `agg`
 * what the chat has chosen. `onUse` is handed { model, params, skill }.
 */
export async function openCatalog(o) {
  if (_w) return;
  const was = stored(LS, {});
  _st = {
    matrix: o.matrix, chatModel: o.model, model: o.model, agg: o.agg, onUse: o.onUse,
    filters: (was.filters && typeof was.filters === 'object') ? was.filters : {}, sort: was.sort || 'heat', q: '',
    pick: null, edits: new Map(), more: false, fetching: false, error: '',
  };
  _build();
  _paintLeft();
  _w.grid.appendChild(el('div', 'vc-note', 'reading the catalog…'));
  await _load();
  if (!_w) return;
  _paintLeft();
  _paintGrid();
  _paintRight();
  // The cookbook's cases are fetched the first time the window opens without them (PLAN V-D).
  const st = _data.cat.status || {};
  if (st.templates && st.cases === 'missing' && !_fetchTried) _fetch();
}

async function _fetch() {
  _fetchTried = true;
  _st.fetching = true;
  _st.error = '';
  _paintGrid();
  const d = await json('/api/mv3/video/catalog/fetch', { method: 'POST' });
  if (!_w) return;
  _st.fetching = false;
  if (!d || !d.success) _st.error = (d && d.error) || 'the server did not answer';
  else await _load();
  if (!_w) return;
  _paintLeft();
  _paintGrid();
}

function _close() {
  if (!_w) return;
  _stopHover();
  keep(LS, { filters: _st.filters, sort: _st.sort });
  Layers.close(_w.layer);
  _w.ov.remove();
  _w = null;
}

function _build() {
  const ov = el('div', 'vc-ov');
  const box = el('div', 'vc');
  const head = el('div', 'vc-head');
  const h = el('h3', null, 'Catalog');
  const sub = el('span', 'vc-head-sub', '');
  const close = el('button', 'vc-close', '✕');
  close.type = 'button';
  close.title = 'Close (Esc)';
  head.append(h, sub, close);
  const left = el('div', 'vc-left');
  const grid = el('div', 'vc-grid');
  const right = el('div', 'vc-right');
  const body = el('div', 'vc-body');
  body.append(left, grid, right);
  const foot = el('div', 'vc-foot');
  box.append(head, body, foot);
  ov.appendChild(box);
  document.body.appendChild(ov);
  const layer = Layers.open(ov, { name: 'video catalog', onEsc: _close });
  close.addEventListener('click', _close);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _close(); });
  _w = { ov, box, head, sub, left, grid, right, foot, layer };
  _paintFoot();
}

function _paintFoot() {
  const f = _w.foot;
  f.textContent = '';
  const a = (href, text) => { const x = el('a', null, text); x.href = href; x.target = '_blank'; x.rel = 'noopener noreferrer'; return x; };
  f.append('Cookbook: ', a('https://github.com/LearnPrompt/awesome-seedance', 'awesome-seedance'), ' / ', a('https://goodcase.ai', 'goodcase.ai'),
    ' - templates ', a('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'), ', made into recipes for our writer; the cases\' prompts and media © their authors, shown for learning · Examples: ',
    a('https://github.com/YouMind-OpenLab/awesome-grok-imagine-prompts', 'YouMind'), ' (CC BY 4.0 compilation), each prompt © its author');
}

// ── Left: the model, the filters ────────────────────────────────────────────
function _paintLeft() {
  if (!_w) return;
  const L = _w.left;
  const scroll = L.querySelector('.vc-left-in');
  const top = scroll ? scroll.scrollTop : 0;
  L.textContent = '';
  const inner = el('div', 'vc-left-in');
  L.appendChild(inner);
  const m = _model();
  _w.sub.textContent = m ? '· ' + m.label : '';

  // The model: the chat's own dropdown.
  const sel = document.createElement('select');
  sel.className = 'vc-model';
  sel.title = 'The model - the catalog shows only what fits it';
  for (const x of _models()) {
    const op = document.createElement('option');
    op.value = x.id; op.textContent = _modelLine(x);
    sel.appendChild(op);
  }
  if (m) sel.value = m.id;
  sel.addEventListener('change', () => { _st.model = sel.value; _st.pick = null; _stopHover(); _paintLeft(); _paintGrid(false); _paintRight(); });
  inner.append(el('div', 'vc-lab', 'model'), sel);
  if (m) {
    const facts = el('div', 'vc-facts');
    for (const r of m.records) {
      const c = el('span', 'vc-agg' + (r.usable ? ' is-ok' : ''), r.aggLabel + (r.usable ? '' : ' - no key'));
      c.title = r.usable ? r.aggLabel + ' can be asked' : (r.why || '');
      facts.appendChild(c);
    }
    const res = [...new Set([].concat(...m.records.map(r => r.resolutions)))];
    const top = res.sort((a, b) => parseInt(b, 10) - parseInt(a, 10))[0];
    facts.appendChild(el('div', 'vc-fact', [m.speaks ? 'speaks' : 'no speech', top ? 'up to ' + top : '', 'takes ' + _wait(m.wait || 60)].filter(Boolean).join(' · ')));
    inner.appendChild(facts);
  }

  // The search.
  const q = document.createElement('input');
  q.type = 'search';
  q.className = 'vc-q';
  q.placeholder = 'search';
  q.value = _st.q;
  q.addEventListener('input', () => { _st.q = q.value; _paintGrid(false); _paintCounts(); });
  inner.appendChild(q);

  const sort = document.createElement('select');
  sort.className = 'vc-sort';
  sort.title = 'The order of the cases';
  for (const [v, t] of [['heat', 'hottest first'], ['steady', 'steadiest first'], ['new', 'newest first']]) {
    const op = document.createElement('option'); op.value = v; op.textContent = t; sort.appendChild(op);
  }
  sort.value = _st.sort;
  sort.addEventListener('change', () => { _st.sort = sort.value; _paintGrid(false); });
  inner.append(el('div', 'vc-lab', 'order'), sort);

  // The filters - once there is something to filter.
  _w.chips = [];
  for (const g of (_data ? _groups(m) : [])) {
    inner.appendChild(el('div', 'vc-lab', g.label));
    const row = el('div', 'vc-chips');
    for (const [v, t] of g.values) {
      const c = el('button', 'vc-chip', '');
      c.type = 'button';
      c.dataset.g = g.key; c.dataset.v = v;
      c.append(el('span', null, t), el('b', null, ''));
      c.addEventListener('click', () => {
        const cur = new Set(_st.filters[g.key] || []);
        if (cur.has(v)) cur.delete(v); else cur.add(v);
        _st.filters[g.key] = [...cur];
        // A category changed: the template chips of another category go.
        if (g.key === 'cat') delete _st.filters.tpl;
        _st.more = false;
        if (g.key === 'cat') _paintLeft(); else _paintCounts();
        _paintGrid(false);
      });
      row.appendChild(c);
      _w.chips.push({ el: c, g, v });
    }
    inner.appendChild(row);
  }
  const clear = el('button', 'vc-clear', 'clear the filters');
  clear.type = 'button';
  clear.addEventListener('click', () => { _st.filters = {}; _st.q = ''; _st.more = false; _paintLeft(); _paintGrid(false); });
  inner.appendChild(clear);
  _paintCounts();
  inner.scrollTop = top;
}

// Each chip counts what would be shown with it, the other groups as they are.
function _paintCounts() {
  if (!_w || !_w.chips || !_data) return;
  const m = _model();
  const items = _items().filter(it => _fits(it, m));
  const groups = _groups(m);
  for (const { el: c, g, v } of _w.chips) {
    const sel = _st.filters[g.key] || [];
    const n = items.filter(it => _passes(it, groups, g.key) && g.of(it).includes(v)).length;
    c.classList.toggle('is-on', sel.includes(v));
    c.classList.toggle('is-none', !n && !sel.includes(v));
    c.querySelector('b').textContent = n ? String(n) : '';
  }
}

// ── Centre: the tiles ───────────────────────────────────────────────────────
function _paintGrid(keep = true) {
  if (!_w || !_data) return;
  _stopHover();
  const G = _w.grid;
  const top = keep ? G.scrollTop : 0;
  G.textContent = '';
  const m = _model();
  const groups = _groups(m);
  const all = _items().filter(it => _fits(it, m));
  const shown = all.filter(it => _passes(it, groups));
  const by = (k) => shown.filter(it => it.kind === k);
  const st = _data.cat.status || {};

  if (!st.templates && !(_data.cat.examples || []).length) {
    G.appendChild(el('div', 'vc-note', (st.why || 'the cookbook is not installed') + '.'));
  }
  if (m && m.family === 'kmc' && !all.length) {
    G.appendChild(el('div', 'vc-note', m.label + ' has no recipes yet: its presets - a picture and a clip of the moves, like "swap the dancer for my character" - come with clips as references.'));
  }
  const tpl = by('template').sort((a, b) => _catRank(a.cat) - _catRank(b.cat) || b.count - a.count);
  _section(G, 'Templates', tpl, all.filter(it => it.kind === 'template').length, 'Recipes of the awesome-seedance cookbook: the writer follows the structure and fills the gaps from your message.');
  // The cases: their own state when they are not here.
  if (m && m.family !== 'kmc' && st.templates) {
    if (!_data.cases.length) {
      const note = el('div', 'vc-note');
      if (_st.fetching) note.textContent = 'Fetching the cookbook\'s cases - ' + Math.round((st.size || 3300000) / 100000) / 10 + ' MB from GitHub, once…';
      else if (_st.error) {
        note.append('The cases could not be fetched: ' + _st.error + ' ');
        const again = el('button', 'vc-link', 'try again');
        again.type = 'button';
        again.addEventListener('click', _fetch);
        note.appendChild(again);
      } else if (st.cases !== 'ready') {
        note.append('The cookbook\'s ' + (st.count || 670) + ' cases are not on this computer yet. ');
        const go = el('button', 'vc-link', 'fetch them (' + Math.round((st.size || 3300000) / 100000) / 10 + ' MB)');
        go.type = 'button';
        go.addEventListener('click', _fetch);
        note.appendChild(go);
      }
      if (note.childNodes.length) {
        G.appendChild(el('div', 'vc-sec', 'Cases'));
        G.appendChild(note);
      }
    } else {
      const cases = _sorted(by('case'));
      _section(G, 'Cases', _st.more ? cases : cases.slice(0, SHOW_CASES), all.filter(it => it.kind === 'case').length,
        'Real prompts with their videos, filed under the templates - the writer takes one as an example to adapt, never to copy.', cases.length);
    }
  }
  _section(G, 'Examples', by('example'), all.filter(it => it.kind === 'example').length, 'Grok b-roll prompts picked by hand: the writer takes one as an example.');
  _section(G, 'Presets', by('preset'), all.filter(it => it.kind === 'preset').length, 'Yours: the samples that came with the program and your copies of them.');
  if (!shown.length && all.length) G.appendChild(el('div', 'vc-note', 'Nothing fits these filters.'));
  G.scrollTop = top;
}
const _catRank = (id) => { const i = (_data.cat.categories || []).findIndex(c => c.id === id); return i < 0 ? 99 : i; };

function _section(G, title, list, total, hint, full) {
  if (!total) return;
  const h = el('div', 'vc-sec');
  h.append(el('span', null, title), el('b', null, list.length === total ? String(total) : list.length + ' of ' + total));
  h.title = hint;
  G.appendChild(h);
  if (!list.length) return;
  const wrap = el('div', 'vc-tiles');
  for (const it of list) wrap.appendChild(_tile(it));
  G.appendChild(wrap);
  if (full && full > list.length) {
    const more = el('button', 'vc-more', 'show ' + (full - list.length) + ' more');
    more.type = 'button';
    more.addEventListener('click', () => { _st.more = true; _paintGrid(); });
    G.appendChild(more);
  }
}

function _tile(it) {
  const m = _model();
  const b = el('button', 'vc-tile' + (_st.pick === _key(it) ? ' is-picked' : ''));
  b.type = 'button';
  b.dataset.k = _key(it);
  const box = el('span', 'vc-box');
  if (it.poster) {
    const img = document.createElement('img');
    img.loading = 'lazy'; img.decoding = 'async'; img.alt = '';
    img.src = it.poster;
    img.addEventListener('error', () => { img.remove(); box.classList.add('is-text'); }, { once: true });
    box.appendChild(img);
  } else {
    box.classList.add('is-text');
    box.appendChild(el('span', 'vc-lead', it.kind === 'template' ? it.sub : (it.sub || it.title)));
  }
  box.appendChild(el('span', 'vc-kind is-' + it.kind, KIND_WORD[it.kind]));
  if (it.ts) box.appendChild(el('span', 'vc-two', '2-step'));
  b.appendChild(box);
  b.appendChild(el('span', 'vc-cap', it.title));
  const tags = [_refsWord(it)];
  if (it.a) tags.push(it.a);
  if (it.d) tags.push(it.d + ' s');
  if (it.sp) tags.push('speaks');
  if (it.kind === 'template') tags.push(it.count + ' case' + (it.count === 1 ? '' : 's'));
  const pr = _price(m, it.d);
  const line = el('span', 'vc-tags', tags.join(' · '));
  if (pr) line.appendChild(el('i', null, pr.fromClip ? money(pr.per) + '/s' : '≈' + money(pr.usd)));
  b.appendChild(line);
  b.title = it.title + (it.creator ? ' - ' + it.creator : '');
  b.addEventListener('click', () => _pick(it));
  if (it.media) {
    box.addEventListener('pointerenter', () => _hoverOn(box, it.media));
    box.addEventListener('pointerleave', _stopHover);
  }
  return b;
}

// The clip plays where the pointer rests - one at a time, nothing fetched before it does.
function _hoverOn(box, src) {
  _stopHover();
  const timer = setTimeout(() => {
    const v = document.createElement('video');
    v.className = 'vc-vid';
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'none';
    v.src = src;
    box.appendChild(v);
    v.play().catch(() => { /* the pointer left first, or the clip is gone */ });
    _hover.video = v;
  }, HOVER_MS);
  _hover = { box, timer, video: null };
}
function _stopHover() {
  if (!_hover) return;
  clearTimeout(_hover.timer);
  if (_hover.video) { try { _hover.video.pause(); } catch (e) { /* gone */ } _hover.video.removeAttribute('src'); _hover.video.load(); _hover.video.remove(); }
  _hover = null;
}

// ── Right: the one picked ───────────────────────────────────────────────────
async function _pick(it) {
  _st.pick = _key(it);
  for (const t of _w.grid.querySelectorAll('.vc-tile.is-picked')) t.classList.remove('is-picked');
  const t = _w.grid.querySelector('.vc-tile[data-k="' + CSS.escape(_st.pick) + '"]');
  if (t) t.classList.add('is-picked');
  _paintRight();
}

// The item's own data, read once per window: a template's master prompt and cases, a case's prompt and authors, an
// example's prompt. What the person changes here stays with it while the window is open.
const _full = new Map();
async function _read(it) {
  const k = _key(it);
  if (_full.has(k)) return _full.get(k);
  let d = null;
  if (it.kind === 'template') { const r = await json('/api/mv3/video/catalog/template/' + encodeURIComponent(it.id)); d = r && r.success ? { tpl: r.template, skill: r.template.skill, slots: r.template.slots } : null; }
  else if (it.kind === 'case') { const r = await json('/api/mv3/video/catalog/case/' + encodeURIComponent(it.id)); d = r && r.success ? r : null; }
  else if (it.kind === 'example') { const r = await json('/api/mv3/video/catalog/example/' + encodeURIComponent(it.id)); d = r && r.success ? { ex: r.example, skill: r.example.skill, slots: r.example.slots } : null; }
  else if (it.kind === 'preset') d = { preset: it.preset, skill: { text: it.preset.skill || '', v: String(it.preset.v || 1) }, slots: it.preset.slots || [] };
  if (d) _full.set(k, d);
  return d;
}
function _edit(it, d) {
  const k = _key(it);
  if (!_st.edits.has(k)) _st.edits.set(k, { text: (d.skill && d.skill.text) || '', slots: JSON.parse(JSON.stringify(d.slots || [])) });
  return _st.edits.get(k);
}

async function _paintRight() {
  if (!_w) return;
  const R = _w.right;
  const want = _st.pick;
  if (!want) {
    R.textContent = '';
    R.appendChild(el('div', 'vc-note', 'Pick a template, a case or an example: what it is, whose it is, what it needs and the recipe the writer will follow.'));
    return;
  }
  const it = _items().find(x => _key(x) === want);
  if (!it) { _st.pick = null; _paintRight(); return; }
  R.textContent = '';
  R.appendChild(el('div', 'vc-note', 'reading…'));
  const d = await _read(it);
  if (!_w || _st.pick !== want) return;
  R.textContent = '';
  if (!d) { R.appendChild(el('div', 'vc-note', 'It could not be read.')); return; }
  const m = _model();
  const ed = _edit(it, d);
  const scroll = el('div', 'vc-right-in');
  R.appendChild(scroll);

  scroll.appendChild(el('div', 'vc-kindline', KIND_WORD[it.kind] + (it.kind === 'case' && it.v ? ' · Seedance ' + it.v : '') + (it.kind === 'example' ? ' · ' + (it.bucket || '') : '')));
  scroll.appendChild(el('h4', 'vc-title', it.title));
  if (it.kind === 'case' && it.sub) scroll.appendChild(el('div', 'vc-zh', it.sub));
  const desc = it.kind === 'template' ? ((d.tpl.description && d.tpl.description.en) || '')
    : it.kind === 'case' ? (d.details.summary || '') : it.kind === 'preset' ? (d.preset.summary || '') : '';
  if (desc) scroll.appendChild(el('p', 'vc-desc', desc));
  scroll.appendChild(_credits(it, d));

  // The price and the fit, for the model chosen here.
  const pr = _price(m, it.d);
  const fit = el('div', 'vc-fit');
  if (m) {
    const r = pr && pr.r;
    fit.appendChild(el('b', null, pr ? (pr.fromClip ? money(pr.per) + ' / s of clip' : '≈' + money(pr.usd) + ' · ' + pr.secs + ' s') : 'no published price'));
    fit.appendChild(el('span', null, ' · ' + (r ? r.resDef + ' · ' : '') + m.label + (r ? ' (' + r.aggLabel + ')' : '')));
    if (it.written === 'seedance' && m.family === 'grok') fit.appendChild(el('div', 'vc-warn', 'written for Seedance - the writer will make a short Grok prompt of it'));
    if (it.d && pr && pr.secs && pr.secs !== it.d) fit.appendChild(el('div', 'vc-warn', 'it asks for ' + it.d + ' s - ' + m.label + ' makes ' + pr.secs));
    if (!m.usable) fit.appendChild(el('div', 'vc-warn', m.why || 'no aggregator can be asked for this model'));
  }
  scroll.appendChild(fit);

  // What it needs attached - editable.
  scroll.appendChild(el('div', 'vc-hdr', 'needs'));
  scroll.appendChild(_slotsBox(it, ed));

  // The skill - editable, with the way back.
  const sh = el('div', 'vc-hdr', 'skill - the recipe the writer follows');
  scroll.appendChild(sh);
  const ta = document.createElement('textarea');
  ta.className = 'vc-skill';
  ta.spellcheck = false;
  ta.value = ed.text;
  const orig = (d.skill && d.skill.text) || '';
  const back = el('button', 'vc-link', 'back to the original');
  back.type = 'button';
  back.hidden = ed.text === orig;
  ta.addEventListener('input', () => { ed.text = ta.value; back.hidden = ed.text === orig; });
  back.addEventListener('click', () => { ed.text = orig; ta.value = orig; back.hidden = true; });
  scroll.append(ta, back);

  if (it.kind === 'template') scroll.appendChild(_casesOf(d.tpl));
  if (it.kind === 'case' || it.kind === 'example') {
    const det = document.createElement('details');
    det.className = 'vc-prompt';
    const s = document.createElement('summary');
    s.textContent = 'its prompt - © ' + ((it.kind === 'case' ? d.details.creator : d.ex.author) || 'its author') + ', shown for learning';
    const pre = el('pre', null, it.kind === 'case' ? d.details.prompt : d.ex.prompt);
    det.append(s, pre);
    scroll.appendChild(det);
  }

  // use
  const foot = el('div', 'vc-right-foot');
  const use = el('button', 'mv3-c-btn vc-use', 'use');
  use.type = 'button';
  use.disabled = !m || !m.usable;
  use.title = !m ? '' : m.usable ? 'Close the catalog and write with this recipe in the chat - ' + m.label : (m.why || 'no key for this model');
  use.addEventListener('click', () => _use(it, d, ed));
  foot.appendChild(use);
  R.appendChild(foot);
}

function _credits(it, d) {
  const box = el('div', 'vc-cred');
  const a = (href, text) => { const x = el('a', null, text); x.href = href; x.target = '_blank'; x.rel = 'noopener noreferrer'; return x; };
  if (it.kind === 'template') {
    box.append('from ', a('https://github.com/LearnPrompt/awesome-seedance', 'awesome-seedance'), ' / goodcase.ai · ',
      a('https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'), ' · made into a recipe for our writer');
  } else if (it.kind === 'case') {
    const det = d.details;
    if (det.sourceUrl) box.append('by ', a(det.sourceUrl, det.creator || 'its author'));
    else box.append('by ' + (det.creator || 'its author'));
    box.append(' · ', a(det.goodcaseUrl, 'goodcase.ai ↗'));
    if (d.template) {
      box.append(' · ');
      const t = el('button', 'vc-link', 'template: ' + ((d.template.title && d.template.title.en) || d.template.id));
      t.type = 'button';
      t.addEventListener('click', () => { const x = _items().find(y => y.kind === 'template' && y.id === d.template.id); if (x) _pick(x); });
      box.appendChild(t);
    } else box.append(' · no template');
    const rt = (det.retests || []).filter(r => r.verdict).map(r => r.model + ': ' + r.verdict);
    if (rt.length) box.appendChild(el('div', 'vc-rt', 'retested - ' + rt.join(' · ')));
  } else if (it.kind === 'example') {
    const x = d.ex;
    box.append('by ', x.x ? a(x.x, x.author || 'its author') : (x.author || 'its author'), ' · ', a(x.youmind, 'YouMind ↗'),
      ' · prompt © its author, picked from a ', a('https://github.com/YouMind-OpenLab/awesome-grok-imagine-prompts', 'CC BY 4.0 compilation'));
  } else if (it.kind === 'preset') {
    const s = (d.preset.source || {}).kind;
    box.append(s === 'sample' ? 'a sample that came with the program' : s === 'copy' ? 'your copy' : 'yours');
  }
  return box;
}

// What it needs: a row per slot - what, for what, how many, whether it must be there, the hint - editable.
function _slotsBox(it, ed) {
  const box = el('div', 'vc-slots');
  const paint = () => {
    box.textContent = '';
    if (!ed.slots.length) box.appendChild(el('div', 'vc-none', 'nothing - words alone'));
    ed.slots.forEach((s, i) => {
      const row = el('div', 'vc-slot');
      const kind = document.createElement('select');
      for (const k of KINDS) { const o = document.createElement('option'); o.value = k; o.textContent = k.replace('-', ' '); kind.appendChild(o); }
      kind.value = s.kind;
      kind.addEventListener('change', () => { s.kind = kind.value; });
      const role = document.createElement('select');
      for (const r of ROLES) { const o = document.createElement('option'); o.value = r; o.textContent = r; role.appendChild(o); }
      role.value = ROLES.includes(s.role) ? s.role : 'person';
      role.addEventListener('change', () => { s.role = role.value; });
      const num = (v, on) => { const n = document.createElement('input'); n.type = 'number'; n.min = '0'; n.max = '50'; n.value = String(v); n.addEventListener('change', () => on(_clamp(Math.round(+n.value || 0), 0, 50))); return n; };
      const min = num(s.min, (v) => { s.min = v; if (s.max < v) { s.max = v; paint(); } });
      const max = num(s.max, (v) => { s.max = Math.max(v, s.min); paint(); });
      const req = document.createElement('input');
      req.type = 'checkbox'; req.checked = !!s.required; req.title = 'it must be attached';
      req.addEventListener('change', () => { s.required = req.checked; });
      const x = el('button', 'vc-x', '×');
      x.type = 'button'; x.title = 'take this slot away';
      x.addEventListener('click', () => { ed.slots.splice(i, 1); paint(); });
      const hint = document.createElement('input');
      hint.type = 'text'; hint.className = 'vc-hint'; hint.value = s.hint || ''; hint.placeholder = 'a hint for what to attach';
      hint.addEventListener('input', () => { s.hint = hint.value; });
      const lab = (t, n) => { const l = el('label', null, t); l.appendChild(n); return l; };
      row.append(kind, role, lab('from', min), lab('to', max), lab('must', req), x, hint);
      box.appendChild(row);
    });
    const adds = el('div', 'vc-adds');
    for (const [k, t] of [['image', '+ picture'], ['video', '+ clip'], ['audio', '+ sound']]) {
      const b = el('button', 'vc-link', t);
      b.type = 'button';
      b.addEventListener('click', () => {
        ed.slots.push({ key: k + (ed.slots.length + 1), kind: k, role: k === 'video' ? 'motion' : k === 'audio' ? 'music' : 'person', min: 1, max: 1, required: false, hint: '' });
        paint();
      });
      adds.appendChild(b);
    }
    box.appendChild(adds);
  };
  paint();
  return box;
}

// A template's own cases, hottest first - a press opens one.
function _casesOf(t) {
  const box = el('div', 'vc-cases');
  const list = (t.cases || []);
  box.appendChild(el('div', 'vc-hdr', 'its cases - ' + list.length));
  if (!list.length) { box.appendChild(el('div', 'vc-none', _data.cases.length ? 'none filed under it' : 'the cases are not fetched yet')); return box; }
  const byId = new Map(_data.cases.map(c => [c.s, c]));
  for (const s of list.slice(0, 40)) {
    const c = byId.get(s);
    if (!c) continue;
    const row = el('button', 'vc-case');
    row.type = 'button';
    const th = el('span', 'vc-case-th');
    if (c.ps) { const img = document.createElement('img'); img.loading = 'lazy'; img.alt = ''; img.src = '/api/mv3/video/catalog/poster/' + encodeURIComponent(c.s); th.appendChild(img); }
    row.append(th, el('span', 'vc-case-t', c.t), el('span', 'vc-case-a', c.cr || ''));
    row.addEventListener('click', () => { const x = _items().find(y => y.kind === 'case' && y.id === s); if (x) _pick(x); });
    box.appendChild(row);
  }
  if (list.length > 40) box.appendChild(el('div', 'vc-none', 'and ' + (list.length - 40) + ' more - pick the template among the filters to see them all'));
  return box;
}

// use: the model, what the item suggests, the skill - into the chat.
function _use(it, d, ed) {
  const m = _model();
  if (!m || !m.usable) return;
  const r = _rec(m);
  const params = {};
  if (it.a && r && (r.aspects || []).includes(it.a)) params.aspect = it.a;
  if (it.d && r && !r.duration.fromClip) params.duration = _clamp(Math.round(it.d), r.duration.min, r.duration.max);
  if (it.kind === 'preset' && it.preset && it.preset.params) Object.assign(params, it.preset.params);
  const orig = (d.skill && d.skill.text) || '';
  const skill = {
    id: it.id, kind: it.kind, title: it.title, v: (d.skill && d.skill.v) || '',
    edited: ed.text !== orig, text: ed.text, slots: ed.slots,
  };
  const done = _st.onUse;
  _close();
  if (typeof done === 'function') done({ model: m.id, params, skill });
}
