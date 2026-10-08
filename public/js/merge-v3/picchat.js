/* ════════════════════════════════════════════════════════════════════════════
   MERGE — making pictures, as a conversation, IN THE LIBRARY PANEL (phase J, the owner 2026-10-02).

   It used to be a window over the whole page. Now the Library panel has its views: the shelf, and this
   chat - "LIBRARY / generate image" in the panel's header, a press on "Library" back to the shelf, and
   while the open project has a conversation a pale "/ generate image" beside the title on the shelf,
   back to it in one press. Which view a project was left on is remembered per project; so is what was
   being written and attached, so leaving for the shelf, another project or a reload loses nothing.

   Since phase V1 this file is the chat's DESCRIPTION: the conversation itself - the thread, the countdowns,
   the attachment row, sending, the right column, the narrow layout - is chat-shell.js, shared with the
   video chat. What is the pictures chat's own is here: the model table and its settings column (model,
   aggregator, quality, shape, price), what a finished picture looks like in the thread, and where the
   pictures come from (`POST /api/mv3/img/send`, the project's pictures, the Library's Images).
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { openViewer } from '../library/viewer.js';
import { note } from './ask.js';
import { createChat, el, thumbOf, money, json, stored, keep } from './chat-shell.js';

const MAX_ATTS = 5;
const LS_LAST = 'mv3-imagen-last';       // the model choice - the key the window this replaced used

// A library record carries its size; without one a square is wrong by less than anything else.
function arOf(i) {
  const w = +(i.w || (i.meta || {}).w || 0);
  const h = +(i.h || (i.meta || {}).h || 0);
  return (w > 0 && h > 0) ? (w + ':' + h) : '1:1';
}

function PICTURES(ctx) {
  let _table = null;         // the model table, once per page
  let _tableErr = '';
  let _set = null;           // the settings' own controls

  // ── The model table, read through the current choice ───────────────────
  async function _loadTable() {
    if (_table) { _paintSet(); return; }
    const d = await json('/api/mv3/img/matrix');
    if (d && d.success) { _table = d; _tableErr = ''; }
    else _tableErr = (d && d.error) || 'could not read the model table';
    _paintSet();
    ctx.paintAtts();
  }

  const _engine = () => (_table.engines.find(e => e.id === (_set && _set.eng.value)) || _table.engines[0]);

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

  // One kind, and how many is the PAIRING's business: kie takes five pictures for grok, Replicate one.
  function _room() {
    if (!_table || !_table.engines.length) return MAX_ATTS;
    const e = _engine();
    const rows = (e.rows || []).filter(r => r.i2i);
    const mine = rows.find(r => r.provider === (_set && _set.prov.value));
    const most = (mine ? mine.maxRefs : Math.max(1, ...rows.map(r => r.maxRefs || 1))) || 0;
    return Math.min(MAX_ATTS, most);
  }

  function _paintSet() {
    const ui = ctx.ui();
    if (!ui) return;
    const host = ui.left;
    if (!_table || !_table.engines.length) {
      host.textContent = '';
      host.appendChild(el('div', 'mv3-ig-fall', _tableErr || (_table ? 'No picture model is available - check the API keys in Admin.' : 'reading the models…')));
      _set = null;
      return;
    }
    if (!_set) {
      host.textContent = '';
      const last = stored(LS_LAST, {});
      const tl = Store.timeline();
      const row = (label, ctl, cls) => {
        const r = el('div', 'mv3-ig-row' + (cls ? ' ' + cls : ''));
        const l = el('label', null, label);
        l.htmlFor = ctl.id;
        r.append(l, ctl);
        host.appendChild(r);
      };
      const prov = document.createElement('select');
      prov.id = 'mv3-pc-prov';
      prov.title = 'Who is asked';
      row('aggregator', prov, 'is-prov');
      const eng = document.createElement('select');
      eng.id = 'mv3-pc-eng';
      eng.title = 'The model';
      row('model', eng);
      const q = document.createElement('select');
      q.id = 'mv3-pc-q';
      q.title = 'Quality';
      row('quality', q);
      // The shape twice: buttons in the wide column, a dropdown in the folded row (the owner's answer 3).
      const arSel = document.createElement('select');
      arSel.id = 'mv3-pc-ar';
      arSel.title = 'Shape';
      row('shape', arSel, 'is-arsel');
      host.appendChild(el('div', 'mv3-ig-sep', 'shape'));
      const arWrap = el('div', 'mv3-ig-ar-row');
      host.appendChild(arWrap);
      const cost = el('div', 'mv3-ig-cost');
      host.appendChild(cost);
      const fall = el('div', 'mv3-ig-fall');
      host.appendChild(fall);
      const fmt = (tl && tl.format) || '9:16';
      // Last time's choice is what the empty lists are filled towards the first time (a select with no
      // options cannot hold a value, so it is kept here until they exist).
      _set = { prov, eng, q, arSel, arWrap, cost, fall, fmt, ar: _table.aspects.includes(last.aspect) ? last.aspect : fmt,
               want: { provider: last.provider || '', engine: last.engine || '', quality: last.quality || '' } };
      // The whole chat, not just this column: the pairing decides how many references fit.
      prov.addEventListener('change', () => { _paintEngines(); ctx.paintAtts(); });
      eng.addEventListener('change', () => { _paintEngines(); ctx.paintAtts(); });
      q.addEventListener('change', _paintPrice);
      arSel.addEventListener('change', () => { _set.ar = arSel.value; _paintAspects(); _paintPrice(); });
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
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.label + ' · ' + _dir(n);
      o.selected = e.id === want;
      _set.eng.appendChild(o);
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
    const e = _engine();
    const can = _houses(e, ctx.atts().length);
    const want = _set.prov.value || _set.want.provider;
    _set.prov.innerHTML = '';
    for (const r of can) {
      const o = document.createElement('option');
      o.value = r.provider; o.textContent = r.label;
      o.selected = r.provider === want;
      _set.prov.appendChild(o);
    }
    if (want && !can.some(r => r.provider === want) && can.length) _set.prov.value = can[0].provider;
    _set.prov.disabled = can.length < 2;
  }

  function _paintQuality() {
    const e = _engine();
    const want = _set.q.value || _set.want.quality;
    const row = _rowOf(e, ctx.atts().length);
    const tiers = (row && row.tiers && row.tiers.length) ? row.tiers : e.tiers;
    _set.q.innerHTML = '';
    for (const t of tiers) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      o.selected = (t === want) || (!tiers.includes(want) && t === (tiers.includes(e.def) ? e.def : tiers[0]));
      _set.q.appendChild(o);
    }
    _paintPrice();
  }

  function _paintPrice() {
    if (!_set) return;
    const e = _engine();
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
    // WHO CATCHES A REFUSAL, and what that would cost - known before it happens rather than after.
    const others = _houses(e, n).filter(r => r !== chosen && (r.price || {})[q] != null);
    _set.fall.innerHTML = others.length
      ? 'if it refuses: ' + others.map(x => '<b>' + x.label + '</b> ' + money(x.price[q])).join(', ')
      : '';
    keep(LS_LAST, { engine: e.id, provider: _set.prov.value, quality: q, aspect: _set.ar });
  }

  function _paintAspects() {
    _set.arWrap.textContent = '';
    _set.arSel.textContent = '';
    for (const a of _table.aspects) {
      const b = el('button', 'mv3-ig-ar-b' + (a === _set.ar ? ' on' : ''));
      b.type = 'button';
      b.textContent = a;
      if (a === _set.fmt) {
        b.appendChild(el('span', 'dot', ' •'));
        b.title = "the project's own shape";
      }
      b.addEventListener('click', () => { _set.ar = a; _paintAspects(); _paintPrice(); });
      _set.arWrap.appendChild(b);
      const o = document.createElement('option');
      o.value = a; o.textContent = a + (a === _set.fmt ? ' •' : '');
      _set.arSel.appendChild(o);
    }
    _set.arSel.value = _set.ar;
  }

  return {
    name: 'pictures',
    kind: 'image',
    ids: { root: 'mv3-pc', head: 'mv3-pc-head', crumb: 'mv3-lib-gen' },
    keys: { draft: 'mv3_pc_draft_v1', write: 'mv3_pc_write_v1', strip: 'mv3-ig-strip-w' },
    maxAtts: MAX_ATTS,
    counts: [1, 2, 4],
    noun: { one: 'picture', many: 'pictures' },
    busyWord: 'drawing',
    // Only the first guess. startInlineProgress keeps a running average per key, so each model learns its
    // own pace after one picture - and they differ by a factor of ten.
    eta: 40000,
    progressKey: (g) => 'mv3-imagen-' + (g.engine || ''),
    sendUrl: '/api/mv3/img/send',
    text: {
      placeholder: 'Describe a picture, or say what to change.',
      empty: 'Describe a picture. What comes back stays in this project — and in the Library.',
      emptyNoProject: 'Describe a picture. A project is started for it with the first message.',
      onlyFiles: 'Only pictures can be attached here.',
      slot: 'A picture to work from - from this computer, or press one on the right',
      plus: 'Add a picture from this computer. It goes into Images and straight into the row above the message box.',
      cat: 'This project\'s pictures, or a category of the Library\'s Images',
      crumb: 'The pictures chat - pictures made with a model',
    },
    upload: { url: '/api/mv3/img/upload', field: 'image', accept: 'image/*', ok: (f) => /^image\//.test(f.type || '') },
    // The right column: this project's pictures, or any category of the Library's Images.
    feed: {
      url: (k) => '/api/mv3/img/feed?project=' + encodeURIComponent(k),
      map: (g) => ({ path: g.imagePath, aspect: g.aspect, state: g.state, name: g.prompt || '', error: g.error }),
    },
    cats: {
      url: '/api/library/shelf/media?filter=images',
      map: (i) => ({ path: i.media, aspect: arOf(i), state: 'done', name: i.name || '', libId: i.id || '' }),
      group: 'images',
    },
    resultPath: (g) => g.imagePath,

    settings: {
      load: _loadTable,
      paint: _paintSet,
      // The pairing decides how many references fit, so the engines are read again whenever the row changes.
      onAtts: () => { if (_set) _paintEngines(); },
      onCount: _paintPrice,
      // The project's own shape is the dot among the shapes.
      onProject: () => { if (_set) { _set.fmt = (Store.timeline() || {}).format || '9:16'; _paintAspects(); } },
      room: _room,
      ready: () => (_set ? '' : ['No picture model.', _tableErr || 'Check the API keys in Admin.']),
      body: () => ({ engine: _engine().id, provider: _set.prov.value, quality: _set.q.value, aspect: _set.ar }),
    },

    // A finished picture in the thread: a miniature - hovering shows it properly, a press opens it over
    // everything - with "to reference" and "to timeline" under it.
    shot(g, cell, open) {
      const img = document.createElement('img');
      img.className = 'mv3-ig-shot';
      img.src = thumbOf(g.imagePath, 'strip');
      img.alt = g.prompt || '';
      img.loading = 'lazy'; img.decoding = 'async';
      img.style.aspectRatio = String(g.aspect || '9:16').replace(':', '/');
      img.title = 'Open it large';
      img.addEventListener('mouseenter', () => ctx.peekShow(thumbOf(g.imagePath, 'main'), img));
      img.addEventListener('mouseleave', ctx.peekHide);
      img.addEventListener('click', open);
      cell.appendChild(img);
      const acts = el('div', 'mv3-ig-acts');
      const use = el('button', 'mv3-c-btn', 'to reference');
      use.type = 'button';
      use.title = 'Put it in the row above the message box and carry on from it';
      use.addEventListener('click', () => ctx.attach(g.imagePath, (g.prompt || '').slice(0, 60)));
      const add = el('button', 'mv3-c-btn', 'to timeline');
      add.type = 'button';
      add.title = 'Puts it on the lane above main video, at the playhead.';
      add.addEventListener('click', () => ctx.place({ src: g.imagePath, thumb: g.imagePath, libId: g.imageId || '', name: (g.prompt || '').slice(0, 60) }, add));
      acts.append(use, add);
      cell.appendChild(acts);
      // Taken off the shelf since: said, instead of a broken picture, and nothing builds on it.
      img.addEventListener('error', () => {
        const gone = el('div', 'mv3-ig-gone', 'not in the Library any more');
        gone.style.aspectRatio = img.style.aspectRatio;
        img.replaceWith(gone);
        use.disabled = true; add.disabled = true;
      }, { once: true });
    },

    // The technical half of a turn, folded away under "read more".
    facts: (g) => [
      ['model', (g.engine || '') + ' · ' + (g.provider || '?') + ' · ' + (g.quality || '')],
      ['asked as', g.model || ''],
      ['shape', (g.aspect || '') + ((g.w && g.h) ? ' · ' + g.w + '×' + g.h : '')],
      ['took', g.secs ? g.secs + 's' : ''],
      ['references', (g.refs || []).length ? String(g.refs.length) : ''],
      ['writer', g.fell ? 'sent as typed - ' + g.fell : (g.writer || '')],
      ['sent as', (g.prompt && g.said && g.prompt !== g.said) ? g.prompt : ''],
    ],

    // Every picture this thread finished, in the Library's viewer - drawn from the 2048px tier, never the
    // 4K original (phase J4).
    view(done, at) {
      openViewer(
        done.map(x => ({ id: x.id, kind: 'images', media: x.imagePath, thumb: x.imagePath, name: x.prompt || '', meta: { date: x.at } })),
        at,
        { showSrc: (it) => thumbOf(it.media, 'main') });
    },

    // Beside the clear button: the almanac - how each model wants to be asked - and who reads the message.
    headButtons() {
      const gear = el('button', 'mv3-iconbtn', '⚙');
      gear.type = 'button';
      gear.title = 'The almanac - how each model wants to be asked - and who reads your message';
      gear.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        gear.disabled = true;
        try { const G = await import('./gear.js'); await G.openGear(); }
        catch (err) { note(gear, 'Could not open the settings.', String((err && err.message) || err).slice(0, 120)); }
        finally { gear.disabled = false; }
      });
      return [gear];
    },
  };
}

const CHAT = createChat(PICTURES);

/** Every way in: the generate menu, "+" on the Images shelf, the lane's right-click, ?open=pictures. */
export const openPictures = () => CHAT.open();

export function initPicChat() { CHAT.init(); }
