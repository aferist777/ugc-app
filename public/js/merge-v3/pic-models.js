/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the settings column of a chat that DRAWS PICTURES: the model, the aggregator, the quality, the price and
   who catches a refusal (phase J; shared since phase V26.5 - the pictures chat and the frames chat of a talking head).

   Read from `/api/mv3/img/matrix` through the current choice: which models can take what is attached (the number of
   pictures is the PAIRING's business - kie takes five for grok, Replicate one), which aggregators can serve the model,
   which qualities they have, and what a picture costs. The pictures chat chooses the shape here too (`shapes`); the
   frames chat draws in the project's own shape (`aspect`) and adds rows of its own under the model (`extra`).
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { el, money, json, stored, keep } from './chat-shell.js';
// (phase V73 block 2, step 2b) The model table being read or not read - the shared parts (a row of the column); the reason a popup.
import { loadingEl, failedEl, cap } from '../ui-state.js';
import { showError } from '../notice.js';

/**
 * The column for `ctx` (the shell's handles). `o`: { lsKey - where the choice is remembered, maxAtts - the most
 * pictures the chat ever takes, defEngine - the model before anything is remembered, shapes - the shape is chosen
 * here, aspect() - else the shape it always draws in,
 * extra(host) - rows of the description's own, laid under the model's when the column is built }.
 * Answers the shell's `settings` and `engine()`.
 */
export function modelColumn(ctx, o) {
  const opts = o || {};
  const MAX = opts.maxAtts || 5;
  let _table = null;         // the model table, once per page
  let _tableErr = '';
  let _set = null;           // the column's own controls

  async function load() {
    if (_table) { paint(); return; }
    const d = await json('/api/mv3/img/matrix');
    if (d && d.success) { _table = d; _tableErr = ''; }
    else {
      _tableErr = (d && d.error) || 'could not read the model table';
      showError(cap(_tableErr));
    }
    paint();
    ctx.paintAtts();
  }

  const engine = () => (_table.engines.find(e => e.id === (_set && _set.eng.value)) || _table.engines[0]);

  // Who can serve this model, at this quality, with this many references - all three are per pairing.
  function _rungs(e, q, n) {
    return (e.rows || []).filter(r => (n ? (r.i2i && r.maxRefs >= n) : r.t2i) && (r.tiers || e.tiers).includes(q));
  }
  function _houses(e, n) {
    return (e.rows || []).filter(r => (n ? (r.i2i && r.maxRefs >= n) : r.t2i));
  }
  const _usable = (n) => _table.engines.filter(e => e.tiers.some(t => _rungs(e, t, n).length));
  // THE PAIRING THAT WILL ACTUALLY RUN: the aggregator named, or the first that can do the job.
  function _rowOf(e, n) {
    const can = _houses(e, n);
    return can.find(r => r.provider === (_set && _set.prov.value)) || can[0] || null;
  }
  const _dir = (n) => (n ? 'i2i' : 't2i');
  const _aspect = () => (opts.shapes ? (_set ? _set.ar : '') : (typeof opts.aspect === 'function' ? opts.aspect() : '9:16'));

  // One kind, and how many is the PAIRING's business: kie takes five pictures for grok, Replicate one.
  function room() {
    if (!_table || !_table.engines.length) return MAX;
    const e = engine();
    const rows = (e.rows || []).filter(r => r.i2i);
    const mine = rows.find(r => r.provider === (_set && _set.prov.value));
    const most = (mine ? mine.maxRefs : Math.max(1, ...rows.map(r => r.maxRefs || 1))) || 0;
    return Math.min(MAX, most);
  }

  function paint() {
    const ui = ctx.ui();
    if (!ui) return;
    const host = ui.left;
    if (!_table || !_table.engines.length) {
      host.textContent = '';
      // (phase V73 block 2, (б2-18)) Not read: "did not load" with Try again - the reason was the popup (load).
      host.appendChild(_tableErr ? failedEl('The models', () => { _tableErr = ''; paint(); load(); }, { line: true })
        : _table ? el('div', 'mv3-ig-fall', 'No picture model is available - check the API keys in Admin.')
          : loadingEl('reading the models…', { line: true }));
      _set = null;
      return;
    }
    if (!_set) {
      host.textContent = '';
      const last = stored(opts.lsKey, {});
      const tl = Store.timeline();
      const row = (label, ctl, cls) => {
        const r = el('div', 'mv3-ig-row' + (cls ? ' ' + cls : ''));
        if (ctl.tagName === 'SELECT') ctl.classList.add('u-in', 'is-s');   // (phase V73 block 2) the shared field at 24, (2a-3) б
        const l = el('label', null, label);
        l.htmlFor = ctl.id;
        r.append(l, ctl);
        host.appendChild(r);
      };
      const id = (k) => (opts.idPrefix || 'mv3-pc') + '-' + k;
      const prov = document.createElement('select');
      prov.id = id('prov');
      prov.title = 'Who is asked';
      row('aggregator', prov, 'is-prov');
      const eng = document.createElement('select');
      eng.id = id('eng');
      eng.title = 'The model';
      row('model', eng);
      const q = document.createElement('select');
      q.id = id('q');
      q.title = 'Quality';
      row('quality', q);
      let arSel = null, arWrap = null, shape = null;
      if (opts.shapes) {
        // The shape twice: buttons in the wide column, a dropdown in the folded row (the owner's answer 3).
        arSel = document.createElement('select');
        arSel.id = id('ar');
        arSel.title = 'Shape';
        row('shape', arSel, 'is-arsel');
        host.appendChild(el('div', 'mv3-ig-sep', 'Shape'));
        arWrap = el('div', 'mv3-ig-ar-row');
        host.appendChild(arWrap);
      } else {
        // (phase V26.5) The shape is not a choice: said, so the price line is not the only place it shows.
        shape = el('div', 'mv3-ig-shape');
        host.appendChild(shape);
      }
      if (typeof opts.extra === 'function') opts.extra(host);
      const cost = el('div', 'mv3-ig-cost');
      host.appendChild(cost);
      const fall = el('div', 'mv3-ig-fall');
      host.appendChild(fall);
      const fmt = (tl && tl.format) || '9:16';
      // Last time's choice is what the empty lists are filled towards the first time (a select with no
      // options cannot hold a value, so it is kept here until they exist).
      _set = { prov, eng, q, arSel, arWrap, shape, cost, fall, fmt,
               ar: opts.shapes ? (_table.aspects.includes(last.aspect) ? last.aspect : fmt) : '',
               want: { provider: last.provider || '', engine: last.engine || opts.defEngine || '', quality: last.quality || '' } };
      // The whole chat, not just this column: the pairing decides how many references fit.
      prov.addEventListener('change', () => { _paintEngines(); ctx.paintAtts(); });
      eng.addEventListener('change', () => { _paintEngines(); ctx.paintAtts(); });
      q.addEventListener('change', _paintPrice);
      if (arSel) arSel.addEventListener('change', () => { _set.ar = arSel.value; _paintAspects(); _paintPrice(); });
      _paintAspects();
    }
    _paintEngines();
  }

  function _paintEngines() {
    if (!_set) return;
    const n = ctx.atts().length;
    const had = _set.eng.value;
    const want = had || _set.want.engine;
    const list = _usable(n).slice().sort((a, b) => a.label.localeCompare(b.label));
    _set.eng.innerHTML = '';
    for (const e of list) {
      const op = document.createElement('option');
      op.value = e.id;
      op.textContent = e.label + ' · ' + _dir(n);
      op.selected = e.id === want;
      _set.eng.appendChild(op);
    }
    // The chosen one cannot take what is attached: SAID, rather than swapped silently.
    if (want && !list.some(e => e.id === want)) {
      const was = (_table.engines.find(e => e.id === want) || {}).label || want;
      _set.eng.value = (list[0] || {}).id || '';
      if (had) ctx.say(was + ' cannot take ' + n + (n === 1 ? ' reference' : ' references') + ' — using ' + ((list[0] || {}).label || 'nothing'));
    }
    _paintProviders();
    _paintQuality();
    _set.want = {};                 // remembered choice used once, on the first fill
  }

  function _paintProviders() {
    const e = engine();
    const can = _houses(e, ctx.atts().length);
    const want = _set.prov.value || _set.want.provider;
    _set.prov.innerHTML = '';
    for (const r of can) {
      const op = document.createElement('option');
      op.value = r.provider; op.textContent = r.label;
      op.selected = r.provider === want;
      _set.prov.appendChild(op);
    }
    if (want && !can.some(r => r.provider === want) && can.length) _set.prov.value = can[0].provider;
    _set.prov.disabled = can.length < 2;
  }

  function _paintQuality() {
    const e = engine();
    const want = _set.q.value || _set.want.quality;
    const row = _rowOf(e, ctx.atts().length);
    const tiers = (row && row.tiers && row.tiers.length) ? row.tiers : e.tiers;
    _set.q.innerHTML = '';
    for (const t of tiers) {
      const op = document.createElement('option');
      op.value = t; op.textContent = t;
      op.selected = (t === want) || (!tiers.includes(want) && t === (tiers.includes(e.def) ? e.def : tiers[0]));
      _set.q.appendChild(op);
    }
    _paintPrice();
  }

  function _paintPrice() {
    if (!_set) return;
    const e = engine();
    const q = _set.q.value;
    const n = ctx.atts().length;
    const many = ctx.n();
    const chosen = _rowOf(e, n);
    const val = chosen ? (chosen.price || {})[q] : null;
    const box = _set.cost;
    if (val == null) {
      box.className = 'mv3-ig-cost is-unknown';
      box.innerHTML = '<b>&mdash;</b><span>no published price for this one</span>';
    } else {
      box.className = 'mv3-ig-cost';
      box.innerHTML = '<b>' + (chosen.approx ? '≈' : '') + money(val) + '</b>'
        + '<span>per picture' + (many > 1 ? ' · ' + money(val * many) + ' for ' + many : '') + '</span>';
    }
    if (ctx.priceFrom) ctx.priceFrom(box);
    // WHO CATCHES A REFUSAL, and what that would cost - known before it happens rather than after.
    const others = _houses(e, n).filter(r => r !== chosen && (r.price || {})[q] != null);
    _set.fall.innerHTML = others.length
      ? 'if it refuses: ' + others.map(x => '<b>' + x.label + '</b> ' + money(x.price[q])).join(', ')
      : '';
    keep(opts.lsKey, { engine: e.id, provider: _set.prov.value, quality: q, aspect: opts.shapes ? _set.ar : (stored(opts.lsKey, {}).aspect || '') });
  }

  function _paintAspects() {
    if (!opts.shapes) {
      if (_set.shape) {
        _set.shape.textContent = '';
        _set.shape.append(el('span', 'k', 'shape'), el('b', null, _aspect()), el('span', null, "the project's own"));
        _set.shape.title = 'Every frame is drawn in the project\'s shape - a frame of another shape would go to the clip with bars';
      }
      return;
    }
    _set.arWrap.textContent = '';
    _set.arSel.textContent = '';
    for (const a of _table.aspects) {
      const b = el('button', 'mv3-ig-ar-b u-chip' + (a === _set.ar ? ' on' : ''));
      b.type = 'button';
      b.textContent = a;
      if (a === _set.fmt) {
        b.appendChild(el('span', 'dot', ' •'));
        b.title = "the project's own shape";
      }
      b.addEventListener('click', () => { _set.ar = a; _paintAspects(); _paintPrice(); });
      _set.arWrap.appendChild(b);
      const op = document.createElement('option');
      op.value = a; op.textContent = a + (a === _set.fmt ? ' •' : '');
      _set.arSel.appendChild(op);
    }
    _set.arSel.value = _set.ar;
  }

  /** What a picture costs with the column as it is, or null (the frames chat's `draw` says it). */
  function price() {
    if (!_set || !_table) return null;
    const chosen = _rowOf(engine(), ctx.atts().length);
    const val = chosen ? (chosen.price || {})[_set.q.value] : null;
    return val == null ? null : { usd: +val, approx: !!chosen.approx, model: engine().label, agg: chosen.label };
  }

  return {
    load,
    paint,
    // The pairing decides how many references fit, so the engines are read again whenever the row changes.
    onAtts: () => { if (_set) _paintEngines(); },
    onCount: _paintPrice,
    // The project's own shape is the dot among the shapes - or, without the shapes, the shape.
    onProject: () => { if (_set) { _set.fmt = (Store.timeline() || {}).format || '9:16'; _paintAspects(); } },
    room,
    ready: () => (_set ? '' : ['No picture model.', _tableErr || 'Check the API keys in Admin.']),
    body: () => ({ engine: engine().id, provider: _set.prov.value, quality: _set.q.value, aspect: _aspect() }),
    engine: () => (_table && _set ? engine() : null),
    price,
  };
}
